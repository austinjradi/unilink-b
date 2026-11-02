import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { and, asc, eq, gte, isNotNull, isNull, lt, lte, max, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { findParts } from '@shared/assignment';
import { addDays, parseYmd, ymd } from '@shared/dates';
import { DEFAULT_BUFFER_DAYS, minutesOn, planTasks, weeklyMinutes } from '@shared/planner';
import { randomUUID } from '../crypto';
import type { DB } from '../db/client';
import {
  assessments,
  classes,
  courses,
  deadlines,
  plannerAssignments,
  plannerTasks,
  studySessionMembers,
  studySessions,
  users,
} from '../db/schema';
import { AppError, type AuthedContext, type Context, idSchema, nonEmpty, procedure } from '../rpc/core';
import { isMember, notFound, requireMember } from './access';
import { m, notify } from './notifications';

// ST2: assignments broken into tasks, scheduled as early as the student's free study
// time per weekday allows (see shared/planner.ts), and re-planned when tasks are missed.

const taskInput = z.object({
  title: nonEmpty('Task', 200),
  minutes: z.number().int().min(5, 'Tasks take at least 5 minutes').max(600, 'Split tasks longer than 10 hours'),
});

const assignmentFields = {
  title: nonEmpty('Title', 200),
  classId: idSchema.nullable(),
  dueAt: z.date(),
  notes: z.string().trim().max(5000),
  bufferDays: z.number().int().min(0).max(7).default(DEFAULT_BUFFER_DAYS),
};

function ownAssignment(db: DB, userId: number, id: number) {
  const row = db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.id, id), eq(plannerAssignments.userId, userId)))
    .get();
  return row ?? notFound('assignment');
}

function ownTask(db: DB, userId: number, taskId: number) {
  const row = db
    .select({ task: plannerTasks, userId: plannerAssignments.userId })
    .from(plannerTasks)
    .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
    .where(eq(plannerTasks.id, taskId))
    .get();
  if (!row || row.userId !== userId) notFound('task');
  return row.task;
}

// Minutes already committed per day: other assignments' open tasks and study sessions you're going to.
function dailyLoad(db: DB, userId: number, from: string, to: string, excludeAssignmentId?: number) {
  const load = new Map<string, number>();
  const add = (day: string, minutes: number) => load.set(day, (load.get(day) ?? 0) + minutes);

  const tasks = db
    .select({ day: plannerTasks.scheduledFor, minutes: plannerTasks.minutes })
    .from(plannerTasks)
    .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
    .where(
      and(
        eq(plannerAssignments.userId, userId),
        excludeAssignmentId ? ne(plannerAssignments.id, excludeAssignmentId) : undefined,
        isNull(plannerTasks.doneAt),
        gte(plannerTasks.scheduledFor, from),
        lte(plannerTasks.scheduledFor, to),
      ),
    )
    .all();
  for (const t of tasks) add(t.day, t.minutes);

  const sessions = db
    .select({ startsAt: studySessions.startsAt, endsAt: studySessions.endsAt })
    .from(studySessions)
    .innerJoin(studySessionMembers, eq(studySessionMembers.sessionId, studySessions.id))
    .where(
      and(
        eq(studySessionMembers.userId, userId),
        eq(studySessionMembers.status, 'going'),
        isNull(studySessions.cancelledAt),
        gte(studySessions.startsAt, parseYmd(from)),
        lt(studySessions.startsAt, parseYmd(addDays(to, 1))),
      ),
    )
    .all();
  for (const s of sessions) add(ymd(s.startsAt), Math.round((s.endsAt.getTime() - s.startsAt.getTime()) / 60_000));

  return load;
}

// Free study minutes for a given day, from the student's weekly availability.
function studyBudget(db: DB, userId: number) {
  const weekly = weeklyMinutes(db.select({ m: users.weeklyStudyMinutes }).from(users).where(eq(users.id, userId)).get()?.m);
  return (day: string) => minutesOn(weekly, day);
}

export function replan(ctx: Context & { userId: number }, assignmentId: number, { unpinAll = false } = {}) {
  const { db, userId } = ctx;
  const assignment = ownAssignment(db, userId, assignmentId);
  const tasks = db
    .select()
    .from(plannerTasks)
    .where(eq(plannerTasks.assignmentId, assignmentId))
    .orderBy(asc(plannerTasks.position), asc(plannerTasks.id))
    .all();
  const today = ymd(ctx.now());
  const dueDate = ymd(assignment.dueAt);
  const budget = studyBudget(db, userId);
  const load = dailyLoad(db, userId, today, dueDate < today ? today : dueDate, assignmentId);

  const plan = planTasks({
    tasks: tasks.map((t) => ({
      id: t.id,
      minutes: t.minutes,
      scheduledFor: t.scheduledFor,
      pinned: t.pinned && !unpinAll,
      done: t.doneAt != null,
    })),
    today,
    dueDate,
    bufferDays: assignment.bufferDays,
    capacity: (day) => Math.max(0, budget(day) - (load.get(day) ?? 0)),
  });

  db.transaction((tx) => {
    for (const t of tasks) {
      const day = plan.dates.get(t.id);
      if (!day) continue;
      const moved = day !== t.scheduledFor;
      if (moved || (unpinAll && t.pinned)) {
        tx.update(plannerTasks)
          .set({ scheduledFor: day, pinned: moved ? false : t.pinned && !unpinAll })
          .where(eq(plannerTasks.id, t.id))
          .run();
      }
    }
  });
}

// "If I miss a task, the plan adjusts automatically", and the plan follows free time:
// an assignment is re-planned when an open task is left on a past day, or sits on a
// day that's now over the study budget (e.g. after joining a study session).
// Past-due assignments are left alone.
export function reconcile(ctx: AuthedContext) {
  followMovedDeadlines(ctx);
  const today = ymd(ctx.now());
  const open = ctx.db
    .select({
      assignmentId: plannerTasks.assignmentId,
      scheduledFor: plannerTasks.scheduledFor,
      pinned: plannerTasks.pinned,
      dueAt: plannerAssignments.dueAt,
    })
    .from(plannerTasks)
    .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
    .where(and(eq(plannerAssignments.userId, ctx.userId), isNull(plannerTasks.doneAt)))
    .all()
    .filter((t) => ymd(t.dueAt) >= today);
  if (!open.length) return;

  const lastDay = open.reduce((d, t) => (t.scheduledFor > d ? t.scheduledFor : d), today);
  const load = dailyLoad(ctx.db, ctx.userId, today, lastDay);
  const budget = studyBudget(ctx.db, ctx.userId);
  const stale = new Set(
    open
      .filter((t) => t.scheduledFor < today || (!t.pinned && (load.get(t.scheduledFor) ?? 0) > budget(t.scheduledFor)))
      .map((t) => t.assignmentId),
  );
  for (const id of stale) replan(ctx, id);
}

// Plans made from a class deadline or graded item move with it: when a classmate changes
// the shared due date, the plan takes the new one, re-plans, and says so.
function followMovedDeadlines(ctx: AuthedContext) {
  const linked = ctx.db
    .select({
      id: plannerAssignments.id,
      title: plannerAssignments.title,
      dueAt: plannerAssignments.dueAt,
      deadlineDue: deadlines.dueAt,
      assessmentDue: assessments.dueAt,
    })
    .from(plannerAssignments)
    .leftJoin(deadlines, eq(plannerAssignments.deadlineId, deadlines.id))
    .leftJoin(assessments, eq(plannerAssignments.assessmentId, assessments.id))
    .where(
      and(
        eq(plannerAssignments.userId, ctx.userId),
        or(isNotNull(plannerAssignments.deadlineId), isNotNull(plannerAssignments.assessmentId)),
      ),
    )
    .all();
  for (const a of linked) {
    const due = a.deadlineDue ?? a.assessmentDue;
    if (!due || due.getTime() === a.dueAt.getTime()) continue;
    ctx.db.update(plannerAssignments).set({ dueAt: due }).where(eq(plannerAssignments.id, a.id)).run();
    replan(ctx, a.id);
    notify(ctx.db, ctx.userId, {
      type: 'plan-moved',
      title: m('"{{title}}" is now due {{when}}', { title: a.title, when: { date: due.getTime() } }),
      body: m('Your plan was adjusted to the new date.'),
      link: '/planner',
    });
  }
}

// What a new plan can follow: a deadline the student can see, or a graded item in their section.
function checkSource(db: DB, userId: number, { deadlineId, assessmentId }: { deadlineId: number | null; assessmentId: number | null }) {
  if (deadlineId) {
    const d = db.select().from(deadlines).where(eq(deadlines.id, deadlineId)).get() ?? notFound('deadline');
    if (d.classId ? !isMember(db, userId, d.classId) : d.userId !== userId) notFound('deadline');
  }
  if (assessmentId) {
    const a = db.select().from(assessments).where(eq(assessments.id, assessmentId)).get() ?? notFound('assessment');
    requireMember(db, userId, a.classId);
  }
}

export async function storeAttachment(ctx: Context, source: string) {
  const info = await stat(source).catch(() => null);
  if (!info?.isFile()) throw new AppError('That file could not be read.');
  await mkdir(ctx.filesDir, { recursive: true });
  const name = basename(source);
  const target = join(ctx.filesDir, `${randomUUID()}-${name}`);
  await copyFile(source, target);
  return { attachmentName: name, attachmentPath: target };
}

export async function deleteUserFiles(db: DB, userId: number) {
  const rows = db
    .select({ path: plannerAssignments.attachmentPath })
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.userId, userId), isNotNull(plannerAssignments.attachmentPath)))
    .all();
  await Promise.all(rows.map((r) => rm(r.path!, { force: true })));
}

export const plannerRouter = {
  // Free study minutes for each weekday, Sunday first. Every open assignment is re-planned.
  setAvailability: procedure(
    z.object({ minutes: z.array(z.number().int().min(0).max(16 * 60)).length(7) }),
    ({ minutes }, ctx) => {
      if (!minutes.some((m) => m > 0)) throw new AppError('Leave some study time on at least one day.');
      ctx.db.update(users).set({ weeklyStudyMinutes: minutes }).where(eq(users.id, ctx.userId)).run();
      const today = ymd(ctx.now());
      for (const a of ctx.db.select().from(plannerAssignments).where(eq(plannerAssignments.userId, ctx.userId)).all()) {
        if (ymd(a.dueAt) >= today) replan(ctx, a.id);
      }
    },
  ),

  list: procedure(z.void(), (_input, ctx) => {
    reconcile(ctx);
    const today = ymd(ctx.now());
    const rows = ctx.db
      .select({
        assignment: plannerAssignments,
        subject: courses.subject,
        number: courses.number,
      })
      .from(plannerAssignments)
      .leftJoin(classes, eq(plannerAssignments.classId, classes.id))
      .leftJoin(courses, eq(classes.courseId, courses.id))
      .where(eq(plannerAssignments.userId, ctx.userId))
      .orderBy(asc(plannerAssignments.dueAt))
      .all();
    const tasks = ctx.db
      .select({ task: plannerTasks })
      .from(plannerTasks)
      .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
      .where(eq(plannerAssignments.userId, ctx.userId))
      .orderBy(asc(plannerTasks.scheduledFor), asc(plannerTasks.position))
      .all()
      .map((r) => r.task);

    const lastDue = rows.reduce((d, r) => (ymd(r.assignment.dueAt) > d ? ymd(r.assignment.dueAt) : d), today);
    const load = dailyLoad(ctx.db, ctx.userId, today, lastDue);
    const budget = studyBudget(ctx.db, ctx.userId);

    return rows.map(({ assignment, subject, number }) => {
      const own = tasks.filter((t) => t.assignmentId === assignment.id);
      const open = own.filter((t) => !t.doneAt);
      const dueDate = ymd(assignment.dueAt);
      return {
        ...assignment,
        classLabel: subject ? `${subject} ${number}` : null,
        tasks: own,
        doneCount: own.length - open.length,
        pastDue: dueDate < today,
        // Work landed inside the buffer before the deadline.
        tight: open.some((t) => t.scheduledFor > addDays(dueDate, -assignment.bufferDays)),
        // A day this assignment uses is booked beyond the daily study time.
        overloaded: open.some((t) => t.scheduledFor >= today && (load.get(t.scheduledFor) ?? 0) > budget(t.scheduledFor)),
      };
    });
  }),

  chooseAttachment: procedure(z.void(), async (_input, ctx) => {
    const path = await ctx.platform.chooseFile({ title: 'Attach the assignment' });
    return path ? { path, name: basename(path) } : null;
  }),

  // The problems in a file the student just picked, to offer as tasks. null when it isn't a
  // kind of file UniLink can read (PDFs and plain text are).
  readParts: procedure(z.object({ path: z.string() }), async ({ path }, ctx) => {
    const text = await ctx.platform.readText(path).catch(() => null);
    return text == null ? null : findParts(text);
  }),

  openAttachment: procedure(z.object({ assignmentId: idSchema }), async ({ assignmentId }, ctx) => {
    const a = ownAssignment(ctx.db, ctx.userId, assignmentId);
    if (!a.attachmentPath) notFound('attachment');
    await ctx.platform.openPath(a.attachmentPath);
  }),

  create: procedure(
    z.object({
      ...assignmentFields,
      tasks: z.array(taskInput).min(1, 'Add at least one task').max(100),
      attachmentPath: z.string().nullable(),
      // The class deadline or graded item it was started from, if any.
      deadlineId: idSchema.nullable().default(null),
      assessmentId: idSchema.nullable().default(null),
    }),
    async ({ tasks, attachmentPath, ...fields }, ctx) => {
      if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
      checkSource(ctx.db, ctx.userId, fields);
      const attachment = attachmentPath ? await storeAttachment(ctx, attachmentPath) : {};
      const today = ymd(ctx.now());
      const assignment = ctx.db.transaction((tx) => {
        const row = tx
          .insert(plannerAssignments)
          .values({ ...fields, ...attachment, userId: ctx.userId })
          .returning({ id: plannerAssignments.id })
          .get();
        tx.insert(plannerTasks)
          .values(tasks.map((t, position) => ({ ...t, position, assignmentId: row.id, scheduledFor: today })))
          .run();
        return row;
      });
      replan(ctx, assignment.id);
      return assignment;
    },
  ),

  // A moved deadline re-plans the remaining work (hand-placed tasks stay put).
  update: procedure(z.object({ assignmentId: idSchema, ...assignmentFields }), ({ assignmentId, ...fields }, ctx) => {
    const before = ownAssignment(ctx.db, ctx.userId, assignmentId);
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    // Setting your own due date stops following the class deadline.
    const moved = before.dueAt.getTime() !== fields.dueAt.getTime();
    ctx.db
      .update(plannerAssignments)
      .set(moved ? { ...fields, deadlineId: null, assessmentId: null } : fields)
      .where(eq(plannerAssignments.id, assignmentId))
      .run();
    if (moved || before.bufferDays !== fields.bufferDays) {
      replan(ctx, assignmentId);
    }
  }),

  remove: procedure(z.object({ assignmentId: idSchema }), async ({ assignmentId }, ctx) => {
    const a = ownAssignment(ctx.db, ctx.userId, assignmentId);
    ctx.db.delete(plannerAssignments).where(eq(plannerAssignments.id, assignmentId)).run();
    if (a.attachmentPath) await rm(a.attachmentPath, { force: true });
  }),

  replan: procedure(z.object({ assignmentId: idSchema }), ({ assignmentId }, ctx) => {
    replan(ctx, assignmentId, { unpinAll: true });
  }),

  addTask: procedure(z.object({ assignmentId: idSchema }).and(taskInput), ({ assignmentId, ...task }, ctx) => {
    ownAssignment(ctx.db, ctx.userId, assignmentId);
    const last = ctx.db
      .select({ position: max(plannerTasks.position) })
      .from(plannerTasks)
      .where(eq(plannerTasks.assignmentId, assignmentId))
      .get();
    ctx.db
      .insert(plannerTasks)
      .values({ ...task, assignmentId, position: (last?.position ?? -1) + 1, scheduledFor: ymd(ctx.now()) })
      .run();
    replan(ctx, assignmentId);
  }),

  updateTask: procedure(z.object({ taskId: idSchema }).and(taskInput), ({ taskId, ...task }, ctx) => {
    ownTask(ctx.db, ctx.userId, taskId);
    ctx.db.update(plannerTasks).set(task).where(eq(plannerTasks.id, taskId)).run();
  }),

  // Moving a task by hand pins it so automatic re-plans leave it there.
  moveTask: procedure(
    z.object({ taskId: idSchema, day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    ({ taskId, day }, ctx) => {
      ownTask(ctx.db, ctx.userId, taskId);
      ctx.db.update(plannerTasks).set({ scheduledFor: day, pinned: true }).where(eq(plannerTasks.id, taskId)).run();
    },
  ),

  setDone: procedure(z.object({ taskId: idSchema, done: z.boolean() }), ({ taskId, done }, ctx) => {
    ownTask(ctx.db, ctx.userId, taskId);
    ctx.db
      .update(plannerTasks)
      .set({ doneAt: done ? ctx.now() : null })
      .where(eq(plannerTasks.id, taskId))
      .run();
  }),

  removeTask: procedure(z.object({ taskId: idSchema }), ({ taskId }, ctx) => {
    ownTask(ctx.db, ctx.userId, taskId);
    ctx.db.delete(plannerTasks).where(eq(plannerTasks.id, taskId)).run();
  }),
};
