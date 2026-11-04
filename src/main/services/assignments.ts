import { rm } from 'node:fs/promises';
import { and, count, eq, inArray } from 'drizzle-orm';
import { isOn } from '@shared/variants';
import { z } from 'zod';
import { deadlineDone, deadlines, plannerAssignments } from '../db/schema';
import { AppError, type AuthedContext, idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, notFound, requireMember, requireTeacher, sameCourseSections, studentsOf, teaches } from './access';
import { EXTENSIONS, visibleDeadlines } from './calendar';
import { addComponent } from './courses';
import { m, type NotifyInput, notify, raw, tellOfNewAssignment } from './notifications';
import { storeAttachment } from './planner';
import { read, write } from './variantData';

// Professors post assignments to a section. Each one is a class deadline with instructions
// and a handout, so it's on everyone's calendar and students can plan it like any other (ST2).

const fields = {
  title: nonEmpty('Title', 200),
  dueAt: z.date(),
  notes: z.string().trim().max(5000),
  // When it goes out to students, if not right away.
  releaseAt: z.date().nullable().default(null),
  // 'handout-link': instead of a file.
  handoutLink: z.string().url().nullable().default(null),
};

const HANDOUT_LINKS = 'variant-handout-links';
function setHandoutLink(ctx: AuthedContext, id: number, link: string | null) {
  if (link) write(ctx.db, HANDOUT_LINKS, { ...read<Record<string, string>>(ctx.db, HANDOUT_LINKS, {}), [id]: link });
}

// 'students-post-assignments': whoever posted one can change it, as well as the professor.
function requireManager(ctx: AuthedContext, row: { classId: number; userId: number }) {
  if (!isOn('students-post-assignments') || row.userId !== ctx.userId) requireTeacher(ctx.db, ctx.userId, row.classId);
}

// 'shared-assignment': the same assignment in the poster's other sections of the course.
function otherCopies(ctx: AuthedContext, row: { classId: number; title: string; userId: number }) {
  if (!isOn('shared-assignment')) return [];
  const sections = sameCourseSections(ctx.db, row.classId).filter((id) => id !== row.classId && teaches(ctx.db, ctx.userId, id));
  return ctx.db
    .select()
    .from(deadlines)
    .where(and(inArray(deadlines.classId, sections), eq(deadlines.official, true), eq(deadlines.title, row.title), eq(deadlines.userId, row.userId)))
    .all();
}

function checkRelease(ctx: AuthedContext, releaseAt: Date | null, dueAt: Date) {
  if (!releaseAt) return;
  if (releaseAt <= ctx.now()) throw new AppError('Pick a time in the future to send it out.');
  if (releaseAt >= dueAt) throw new AppError('It has to go out before it’s due.');
}

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
    const links = read<Record<string, string>>(ctx.db, HANDOUT_LINKS, {});
    // 'progress-names': who has checked it off and who hasn't.
    const whoDid = (id: number) => {
      const done = new Set(ctx.db.select({ id: deadlineDone.userId }).from(deadlineDone).where(eq(deadlineDone.deadlineId, id)).all().map((d) => d.id));
      const everyone = studentsOf(ctx.db, classId);
      return { done: everyone.filter((s) => done.has(s.id)).map((s) => s.name), waiting: everyone.filter((s) => !done.has(s.id)).map((s) => s.name) };
    };
    const doneCount = (id: number) =>
      ctx.db
        .select({ n: count() })
        .from(deadlineDone)
        .where(and(eq(deadlineDone.deadlineId, id), inArray(deadlineDone.userId, students)))
        .get()?.n ?? 0;
    return rows.map((d) => ({
      ...d,
      planned: planned.has(d.id),
      progress: !isOn('progress-private') && !isOn('progress-names') && students.length >= MIN_STUDENTS_FOR_COUNT ? { done: doneCount(d.id), total: students.length } : null,
      who: isOn('progress-names') && students.length ? whoDid(d.id) : null,
      handoutLink: isOn('handout-link') ? (links[d.id] ?? null) : null,
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
    async ({ classId, weight, attachmentPath, handoutLink, ...input }, ctx) => {
      if (isOn('students-post-assignments')) requireMember(ctx.db, ctx.userId, classId);
      else requireTeacher(ctx.db, ctx.userId, classId);
      if (input.dueAt <= ctx.now()) throw new AppError('Pick a due date in the future');
      checkRelease(ctx, input.releaseAt, input.dueAt);
      const graded = weight != null && !isOn('no-assignment-weight') && teaches(ctx.db, ctx.userId, classId);
      if (graded) addComponent(ctx, classId, { name: input.title, weight, altWeight: null, dueAt: null });
      const attachment = attachmentPath ? await storeAttachment(ctx, attachmentPath) : {};
      const row = ctx.db
        .insert(deadlines)
        .values({ ...input, ...attachment, classId, kind: 'assignment', official: true, userId: ctx.userId })
        .returning({ id: deadlines.id })
        .get();
      if (!input.releaseAt) tellOfNewAssignment(ctx.db, classId, input.title, input.dueAt);
      setHandoutLink(ctx, row.id, handoutLink);
      if (isOn('shared-assignment')) {
        for (const other of sameCourseSections(ctx.db, classId)) {
          if (other === classId || !teaches(ctx.db, ctx.userId, other)) continue;
          if (graded) addComponent(ctx, other, { name: input.title, weight, altWeight: null, dueAt: null });
          const copy = ctx.db.insert(deadlines).values({ ...input, ...attachment, classId: other, kind: 'assignment', official: true, userId: ctx.userId }).returning({ id: deadlines.id }).get();
          setHandoutLink(ctx, copy.id, handoutLink);
          if (!input.releaseAt) tellOfNewAssignment(ctx.db, other, input.title, input.dueAt);
        }
      }
      return row;
    },
  ),

  // A new file replaces the old handout. Both that and moving the due date tell the students (plans that
  // follow the assignment move by themselves, see services/planner.ts).
  update: procedure(z.object({ id: idSchema, ...fields, attachmentPath: z.string().nullable() }), async ({ id, attachmentPath, handoutLink, ...input }, ctx) => {
    const row = posted(ctx, id);
    requireManager(ctx, row);
    setHandoutLink(ctx, id, handoutLink);
    const copies = otherCopies(ctx, row);
    for (const copy of copies) {
      ctx.db.update(deadlines).set({ title: input.title, dueAt: input.dueAt, notes: input.notes }).where(eq(deadlines.id, copy.id)).run();
    }
    // Only what hasn't gone out can be scheduled. Students don't hear about changes to it, and they
    // hear it's new when it goes out.
    const waiting = row.releaseAt != null;
    checkRelease(ctx, waiting ? input.releaseAt : null, input.dueAt);
    const attachment = attachmentPath ? await storeAttachment(ctx, attachmentPath) : {};
    if (attachmentPath && row.attachmentPath) await rm(row.attachmentPath, { force: true });
    ctx.db.update(deadlines).set({ ...input, ...attachment, releaseAt: waiting ? input.releaseAt : null }).where(eq(deadlines.id, id)).run();
    if (waiting) {
      if (!input.releaseAt) tellOfNewAssignment(ctx.db, row.classId, input.title, input.dueAt);
      return;
    }
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
      for (const copy of copies) {
        tellStudents(ctx, copy.classId!, {
          type: 'assignment-posted',
          title: raw(`"${input.title}" has a new due date`),
          body: raw(classLabel(ctx.db, copy.classId!) ?? ''),
          link: `/classes/${copy.classId}/assignments`,
        });
      }
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
    requireManager(ctx, row);
    if (row.attachmentPath) await rm(row.attachmentPath, { force: true });
    for (const copy of otherCopies(ctx, row)) ctx.db.delete(deadlines).where(eq(deadlines.id, copy.id)).run();
    ctx.db.delete(deadlines).where(eq(deadlines.id, id)).run();
    if (isOn('notify-assignment-removed') && !row.releaseAt) {
      tellStudents(ctx, row.classId, { type: 'assignment-posted', title: raw(`"${row.title}" was removed`), body: raw(classLabel(ctx.db, row.classId) ?? ''), link: `/classes/${row.classId}/assignments` });
    }
  }),

  // 'extensions': the section's students, and who has a later date.
  extensions: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    const row = posted(ctx, id);
    requireTeacher(ctx.db, ctx.userId, row.classId);
    const given = read<Record<string, string>>(ctx.db, EXTENSIONS, {});
    return studentsOf(ctx.db, row.classId).map((s) => ({ id: s.id, name: s.name, until: given[`${id}-${s.id}`] ?? null }));
  }),
  setExtension: procedure(z.object({ id: idSchema, userId: idSchema, until: z.date().nullable() }), ({ id, userId, until }, ctx) => {
    const row = posted(ctx, id);
    requireTeacher(ctx.db, ctx.userId, row.classId);
    const { [`${id}-${userId}`]: _old, ...others } = read<Record<string, string>>(ctx.db, EXTENSIONS, {});
    write(ctx.db, EXTENSIONS, until ? { ...others, [`${id}-${userId}`]: until.toISOString() } : others);
    notify(ctx.db, userId, { type: 'assignment-posted', title: raw(until ? `You have until later for "${row.title}"` : `"${row.title}" is back to the section's due date`), body: raw(classLabel(ctx.db, row.classId) ?? ''), link: `/classes/${row.classId}/assignments` });
  }),

  openFile: procedure(z.object({ id: idSchema }), async ({ id }, ctx) => {
    const row = posted(ctx, id);
    requireMember(ctx.db, ctx.userId, row.classId);
    if (row.releaseAt && !isOn('draft-visible') && !teaches(ctx.db, ctx.userId, row.classId)) notFound('assignment');
    if (!row.attachmentPath) notFound('handout');
    await ctx.platform.openPath(row.attachmentPath);
  }),

  // For planning from a posted assignment: its handout, to attach and read the problems from.
  handout: procedure(z.object({ deadlineId: idSchema }), ({ deadlineId }, ctx) => {
    const row = ctx.db.select().from(deadlines).where(eq(deadlines.id, deadlineId)).get();
    if (!row?.official || row.classId == null || !row.attachmentPath) return null;
    requireMember(ctx.db, ctx.userId, row.classId);
    if (row.releaseAt && !isOn('draft-visible') && !teaches(ctx.db, ctx.userId, row.classId)) return null;
    return { path: row.attachmentPath, name: row.attachmentName ?? 'handout' };
  }),
};
