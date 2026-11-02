import { rm } from 'node:fs/promises';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { deadlineDone, deadlines, plannerAssignments } from '../db/schema';
import { AppError, type AuthedContext, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, notFound, requireMember, requireTeacher, studentsOf, teaches } from './access';
import { visibleDeadlines } from './calendar';
import { addComponent } from './courses';
import { m, type NotifyInput, notify, raw } from './notifications';
import { storeAttachment } from './planner';

// Professors post assignments to a section. Each one is a class deadline with instructions
// and a handout, so it's on everyone's calendar and students can plan it like any other (ST2).

const fields = {
  title: nonEmpty('Title', 200),
  dueAt: z.date(),
  notes: z.string().trim().max(5000),
};

// Below this many students, a count could point at someone, so professors don't see one.
const MIN_STUDENTS_FOR_COUNT = 5;

function posted(ctx: AuthedContext, id: number) {
  const row = ctx.db.select().from(deadlines).where(eq(deadlines.id, id)).get();
  if (!row?.official || row.classId == null) notFound('assignment');
  return { ...row, classId: row.classId };
}

function tellStudents(ctx: AuthedContext, classId: number, message: NotifyInput) {
  for (const student of studentsOf(ctx.db, classId)) notify(ctx.db, student.id, message);
}

export const assignmentsRouter = {
  // The assignments posted to a section, soonest first, with whether you've checked each off
  // and planned it. Its professor sees how many students are done, as a count only.
  list: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const rows = visibleDeadlines(ctx.db, ctx.userId).filter((d) => d.classId === classId && d.official);
    if (!rows.length) return [];
    const ids = rows.map((d) => d.id);
    const planned = new Set(
      ctx.db
        .select({ id: plannerAssignments.deadlineId })
        .from(plannerAssignments)
        .where(and(eq(plannerAssignments.userId, ctx.userId), inArray(plannerAssignments.deadlineId, ids)))
        .all()
        .map((p) => p.id),
    );
    const students = teaches(ctx.db, ctx.userId, classId) ? studentsOf(ctx.db, classId).map((s) => s.id) : [];
    const doneCount = (id: number) =>
      ctx.db
        .select({ n: count() })
        .from(deadlineDone)
        .where(and(eq(deadlineDone.deadlineId, id), inArray(deadlineDone.userId, students)))
        .get()?.n ?? 0;
    return rows.map((d) => ({
      ...d,
      planned: planned.has(d.id),
      progress: students.length >= MIN_STUDENTS_FOR_COUNT ? { done: doneCount(d.id), total: students.length } : null,
    }));
  }),

  // With a weight, it also joins the grading scheme as a component.
  post: procedure(
    z.object({
      classId: idSchema,
      ...fields,
      weight: z.number().gt(0, 'Weight must be above 0%').max(100, 'Weight can be at most 100%').nullable().default(null),
      attachmentPath: z.string().nullable(),
    }),
    async ({ classId, weight, attachmentPath, ...input }, ctx) => {
      requireTeacher(ctx.db, ctx.userId, classId);
      if (input.dueAt <= ctx.now()) throw new AppError('Pick a due date in the future');
      if (weight != null) addComponent(ctx, classId, { name: input.title, weight, altWeight: null, dueAt: null });
      const attachment = attachmentPath ? await storeAttachment(ctx, attachmentPath) : {};
      const row = ctx.db
        .insert(deadlines)
        .values({ ...input, ...attachment, classId, kind: 'assignment', official: true, userId: ctx.userId })
        .returning({ id: deadlines.id })
        .get();
      tellStudents(ctx, classId, {
        type: 'assignment-posted',
        title: m('New assignment: {{title}}', { title: input.title }),
        body: m('{{class}} · due {{when}}', { class: classLabel(ctx.db, classId) ?? '', when: { date: input.dueAt.getTime() } }),
        link: `/classes/${classId}/assignments`,
      });
      return row;
    },
  ),

  // A new file replaces the old handout. Both that and moving the due date tell the students (plans that
  // follow the assignment move by themselves, see services/planner.ts).
  update: procedure(z.object({ id: idSchema, ...fields, attachmentPath: z.string().nullable() }), async ({ id, attachmentPath, ...input }, ctx) => {
    const row = posted(ctx, id);
    requireTeacher(ctx.db, ctx.userId, row.classId);
    const attachment = attachmentPath ? await storeAttachment(ctx, attachmentPath) : {};
    if (attachmentPath && row.attachmentPath) await rm(row.attachmentPath, { force: true });
    ctx.db.update(deadlines).set({ ...input, ...attachment }).where(eq(deadlines.id, id)).run();
    // A new handout matters as much as a new date: someone may have started on the old one.
    if (attachmentPath) {
      tellStudents(ctx, row.classId, {
        type: 'assignment-posted',
        title: m('New handout for "{{title}}"', { title: input.title }),
        body: raw(classLabel(ctx.db, row.classId) ?? ''),
        link: `/classes/${row.classId}/assignments`,
      });
    }
    if (input.dueAt.getTime() !== row.dueAt.getTime()) {
      tellStudents(ctx, row.classId, {
        type: 'assignment-posted',
        title: m('"{{title}}" is now due {{when}}', { title: input.title, when: { date: input.dueAt.getTime() } }),
        body: raw(classLabel(ctx.db, row.classId) ?? ''),
        link: `/classes/${row.classId}/assignments`,
      });
    }
  }),

  remove: procedure(z.object({ id: idSchema }), async ({ id }, ctx) => {
    const row = posted(ctx, id);
    requireTeacher(ctx.db, ctx.userId, row.classId);
    if (row.attachmentPath) await rm(row.attachmentPath, { force: true });
    ctx.db.delete(deadlines).where(eq(deadlines.id, id)).run();
  }),

  openFile: procedure(z.object({ id: idSchema }), async ({ id }, ctx) => {
    const row = posted(ctx, id);
    requireMember(ctx.db, ctx.userId, row.classId);
    if (!row.attachmentPath) notFound('handout');
    await ctx.platform.openPath(row.attachmentPath);
  }),

  // For planning from a posted assignment: its handout, to attach and read the problems from.
  handout: procedure(z.object({ deadlineId: idSchema }), ({ deadlineId }, ctx) => {
    const row = ctx.db.select().from(deadlines).where(eq(deadlines.id, deadlineId)).get();
    if (!row?.official || row.classId == null || !row.attachmentPath) return null;
    requireMember(ctx.db, ctx.userId, row.classId);
    return { path: row.attachmentPath, name: row.attachmentName ?? 'handout' };
  }),
};
