import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { and, asc, eq, gte, isNotNull, isNull, lt, lte, max, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { findParts } from '@shared/assignment';
import { addDays, CURRENT_TERM, parseYmd, ymd } from '@shared/dates';
import { noClassesOn } from '@shared/keyDates';
import { DEFAULT_BUFFER_DAYS, minutesAroundClasses, minutesOn, oneTaskADay, planTasks, spreadTasks, weeklyMinutes } from '@shared/planner';
import { isOn } from '@shared/variants';
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
import { isMember, notFound, requireMember, requireTeacher } from './access';
import { myMeetings, visibleDeadlines } from './calendar';
import { m, notify, raw } from './notifications';
import { read, write } from './variantData';

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

// Switches stay in English, so these aren't written where the French check would ask for a translation.
const DOESNT_FIT = "This plan doesn't fit in your free time before the deadline. Add free time or fewer tasks.";
const NEEDS_CLASS = 'Pick the class this plan is for.';
const ONLY_POSTED = 'Start from an assignment the professor has posted.';

// What people do under a switch, kept in app_state.
const ARCHIVED = (userId: number) => `variant-archived-plans-${userId}`;
const SKIPPED = 'variant-skipped-tasks';
const TASK_NOTES = 'variant-task-notes';
const COMMITMENTS = (userId: number) => `variant-commitments-${userId}`;
const MOVES = (userId: number) => `variant-plan-moves-${userId}`;

// Days kept free before a deadline, under the switches that change it.
function bufferFor(bufferDays: number, today: string, dueDate: string) {
  if (isOn('spread-work-evenly')) return 1;
  if (!isOn('proportional-buffer')) return bufferDays;
  const available = Math.max(0, Math.round((parseYmd(dueDate).getTime() - parseYmd(today).getTime()) / 86_400_000));
  return Math.ceil(available * 0.1);
}

function ownAssignment(db: DB, userId: number, id: number) {
  const row = db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.id, id), eq(plannerAssignments.userId, userId)))
    .get();
  return row ?? notFound('assignment');
}

export function ownTask(db: DB, userId: number, taskId: number) {
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

// Free study minutes for a given day, from the student's weekly availability and days off.
function studyBudget(db: DB, userId: number) {
  const user = db.select({ weekly: users.weeklyStudyMinutes, off: users.daysOff }).from(users).where(eq(users.id, userId)).get();
  const weekly = weeklyMinutes(user?.weekly);
  const off = new Set(user?.off ?? []);
  const commitments = isOn('other-commitments') ? read<number[]>(db, COMMITMENTS(userId), []) : [];
  return (day: string) => {
    if (off.has(day) || (isOn('holidays-as-days-off') && noClassesOn(day))) return 0;
    // Version A: one budget for every day, 120 minutes unless it's been set.
    const free = isOn('one-daily-budget') ? (weekly.every((minutes) => minutes === weekly[0]) ? weekly[0] : 120) : minutesOn(weekly, day);
    return Math.max(0, free - (commitments[parseYmd(day).getDay()] ?? 0));
  };
}

// Free time changed, so every assignment still to come is planned again.
function replanOpen(ctx: AuthedContext) {
  const today = ymd(ctx.now());
  for (const a of ctx.db.select().from(plannerAssignments).where(eq(plannerAssignments.userId, ctx.userId)).all()) {
    if (ymd(a.dueAt) >= today) replan(ctx, a.id);
  }
}

export function replan(ctx: Context & { userId: number }, assignmentId: number, { unpinAll = false } = {}) {
  const { db, userId } = ctx;
  const assignment = ownAssignment(db, userId, assignmentId);
  const today = ymd(ctx.now());
  // 'place-tasks-yourself': tasks stay where they are until moved by hand.
  if (isOn('place-tasks-yourself')) return;
  const tasks = db
    .select()
    .from(plannerTasks)
    .where(eq(plannerTasks.assignmentId, assignmentId))
    .orderBy(asc(plannerTasks.position), asc(plannerTasks.id))
    .all()
    // 'missed-tasks-stay-late': what's been missed stays put, until the student moves it.
    .filter((t) => !isOn('missed-tasks-stay-late') || t.doneAt != null || t.scheduledFor >= today);
  const dueDate = ymd(assignment.dueAt);
  const budget = studyBudget(db, userId);
  const load = dailyLoad(db, userId, today, dueDate < today ? today : dueDate, assignmentId);

  const plan = schedule({
    tasks: tasks.map((t) => ({
      id: t.id,
      minutes: t.minutes,
      scheduledFor: t.scheduledFor,
      pinned: t.pinned && !unpinAll && !isOn('replan-moves-all'),
      done: t.doneAt != null,
    })),
    today,
    dueDate,
    bufferDays: bufferFor(assignment.bufferDays, today, dueDate),
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

function schedule(input: Parameters<typeof planTasks>[0]) {
  if (isOn('spread-work-evenly')) return { dates: spreadTasks(input) };
  if (isOn('one-task-a-day')) return { dates: oneTaskADay(input) };
  return planTasks(input);
}

// 'auto-plan-deadlines' and 'auto-plan-on-post': a plan appears for each deadline that has none.
function planMissingDeadlines(ctx: AuthedContext) {
  const auto = isOn('auto-plan-deadlines');
  if (!auto && !isOn('auto-plan-on-post')) return;
  const planned = new Set(ctx.db.select({ id: plannerAssignments.deadlineId }).from(plannerAssignments).where(eq(plannerAssignments.userId, ctx.userId)).all().map((row) => row.id));
  for (const d of visibleDeadlines(ctx.db, ctx.userId, ctx.now())) {
    if (planned.has(d.id) || d.releaseAt || (!auto && !d.official)) continue;
    const row = ctx.db
      .insert(plannerAssignments)
      .values({ title: d.title, classId: d.classId, dueAt: d.dueAt, notes: '', bufferDays: DEFAULT_BUFFER_DAYS, deadlineId: d.id, userId: ctx.userId })
      .returning({ id: plannerAssignments.id })
      .get();
    ctx.db.insert(plannerTasks).values({ title: `Work on ${d.title}`, minutes: 60, position: 0, assignmentId: row.id, scheduledFor: ymd(ctx.now()) }).run();
    replan(ctx, row.id);
  }
}

// "If I miss a task, the plan adjusts automatically", and the plan follows free time:
// an assignment is re-planned when an open task is left on a past day, or sits on a
// day that's now over the study budget (e.g. after joining a study session).
// Past-due assignments are left alone.
export function reconcile(ctx: AuthedContext) {
  if (!isOn('plan-date-by-hand')) followMovedDeadlines(ctx);
  planMissingDeadlines(ctx);
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
  // 'daily-replan': every plan is rebuilt, whether or not anything was missed.
  if (isOn('daily-replan')) {
    for (const id of new Set(open.map((t) => t.assignmentId))) replan(ctx, id);
    return;
  }

  const lastDay = open.reduce((d, t) => (t.scheduledFor > d ? t.scheduledFor : d), today);
  const load = dailyLoad(ctx.db, ctx.userId, today, lastDay);
  const budget = studyBudget(ctx.db, ctx.userId);
  const stale = new Set(
    open
      .filter((t) => (t.scheduledFor < today && !isOn('missed-tasks-stay-late')) || (!t.pinned && (load.get(t.scheduledFor) ?? 0) > budget(t.scheduledFor)))
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
    // 'ask-before-moving-plan': the plan waits for the student's answer.
    if (isOn('ask-before-moving-plan')) {
      const moves = read<Record<string, number>>(ctx.db, MOVES(ctx.userId), {});
      if (moves[a.id] !== due.getTime()) {
        write(ctx.db, MOVES(ctx.userId), { ...moves, [a.id]: due.getTime() });
        notify(ctx.db, ctx.userId, { type: 'plan-moved', title: raw(`"${a.title}" moved. Move your plan too?`), link: '/planner' });
      }
      continue;
    }
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
    if (d.releaseAt) notFound('deadline');
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
  // What the free time could be, going by this term's class times. null with no class times to go by.
  freeTimeAroundClasses: procedure(z.void(), (_input, ctx) => {
    const meetings = myMeetings(ctx.db, ctx.userId).filter((m) => m.term === CURRENT_TERM);
    return meetings.length ? minutesAroundClasses(meetings.map((m) => m.meeting)) : null;
  }),

  // Free study minutes for each weekday, Sunday first. Every open assignment is re-planned.
  setAvailability: procedure(
    z.object({ minutes: z.array(z.number().int().min(0).max(16 * 60)).length(7) }),
    ({ minutes }, ctx) => {
      if (!minutes.some((m) => m > 0)) throw new AppError('Leave some study time on at least one day.');
      ctx.db.update(users).set({ weeklyStudyMinutes: minutes }).where(eq(users.id, ctx.userId)).run();
      replanOpen(ctx);
    },
  ),

  // Days with no study time at all. Past ones are dropped, since they no longer matter.
  setDaysOff: procedure(z.object({ days: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(120) }), ({ days }, ctx) => {
    const today = ymd(ctx.now());
    const upcoming = [...new Set(days)].filter((day) => day >= today).sort();
    ctx.db.update(users).set({ daysOff: upcoming }).where(eq(users.id, ctx.userId)).run();
    replanOpen(ctx);
  }),

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

    const archived = isOn('archive-plans') ? read<number[]>(ctx.db, ARCHIVED(ctx.userId), []) : [];
    const skipped = read<number[]>(ctx.db, SKIPPED, []);
    const notes = isOn('task-notes') ? read<Record<string, string>>(ctx.db, TASK_NOTES, {}) : {};
    const moves = isOn('ask-before-moving-plan') ? read<Record<string, number>>(ctx.db, MOVES(ctx.userId), {}) : {};
    return rows.map(({ assignment, subject, number }) => {
      const own = tasks.filter((t) => t.assignmentId === assignment.id).map((t) => ({ ...t, skipped: isOn('skip-tasks') && skipped.includes(t.id), note: notes[t.id] ?? '' }));
      const open = own.filter((t) => !t.doneAt);
      const dueDate = ymd(assignment.dueAt);
      return {
        ...assignment,
        archived: archived.includes(assignment.id),
        movedTo: moves[assignment.id] && moves[assignment.id] !== assignment.dueAt.getTime() ? new Date(moves[assignment.id]) : null,
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
  // kind of file UniLink can read (PDFs, Word documents and plain text are).
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
      if (isOn('require-class-for-plan') && !fields.classId) throw new AppError(NEEDS_CLASS);
      if (isOn('only-posted-assignments') && !(fields.deadlineId && ctx.db.select({ official: deadlines.official }).from(deadlines).where(eq(deadlines.id, fields.deadlineId)).get()?.official)) throw new AppError(ONLY_POSTED);
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
      // 'refuse-plans-that-dont-fit': more work on some day than there's free time for.
      if (isOn('refuse-plans-that-dont-fit')) {
        const planned = ctx.db.select().from(plannerTasks).where(eq(plannerTasks.assignmentId, assignment.id)).all();
        const days = planned.map((t) => t.scheduledFor).sort();
        const load = dailyLoad(ctx.db, ctx.userId, today, days.at(-1) ?? today);
        const budget = studyBudget(ctx.db, ctx.userId);
        if (planned.some((t) => (load.get(t.scheduledFor) ?? 0) > budget(t.scheduledFor))) {
          ctx.db.delete(plannerAssignments).where(eq(plannerAssignments.id, assignment.id)).run();
          throw new AppError(DOESNT_FIT);
        }
      }
      return assignment;
    },
  ),

  // 'preview-plan': the days the tasks would land on, without saving anything.
  preview: procedure(
    z.object({ dueAt: z.date(), bufferDays: z.number().int(), tasks: z.array(z.object({ title: z.string(), minutes: z.number() })) }),
    ({ dueAt, bufferDays, tasks }, ctx) => {
      const today = ymd(ctx.now());
      const dueDate = ymd(dueAt);
      const budget = studyBudget(ctx.db, ctx.userId);
      const load = dailyLoad(ctx.db, ctx.userId, today, dueDate < today ? today : dueDate);
      const plan = schedule({
        tasks: tasks.map((t, id) => ({ id, minutes: t.minutes, scheduledFor: today, pinned: false, done: false })),
        today,
        dueDate,
        bufferDays: bufferFor(bufferDays, today, dueDate),
        capacity: (day) => Math.max(0, budget(day) - (load.get(day) ?? 0)),
      });
      return tasks.map((t, id) => ({ title: t.title, day: plan.dates.get(id) ?? today }));
    },
  ),

  // 'ask-before-moving-plan': the student's answer.
  answerMove: procedure(z.object({ assignmentId: idSchema, move: z.boolean() }), ({ assignmentId, move }, ctx) => {
    const moves = read<Record<string, number>>(ctx.db, MOVES(ctx.userId), {});
    const when = moves[assignmentId];
    if (move && when) {
      ctx.db.update(plannerAssignments).set({ dueAt: new Date(when) }).where(eq(plannerAssignments.id, assignmentId)).run();
      replan(ctx, assignmentId);
    } else if (!move) {
      ctx.db.update(plannerAssignments).set({ deadlineId: null, assessmentId: null }).where(eq(plannerAssignments.id, assignmentId)).run();
    }
    const { [assignmentId]: _answered, ...rest } = moves;
    write(ctx.db, MOVES(ctx.userId), rest);
  }),

  // 'archive-plans'.
  setArchived: procedure(z.object({ assignmentId: idSchema, archived: z.boolean() }), ({ assignmentId, archived }, ctx) => {
    ownAssignment(ctx.db, ctx.userId, assignmentId);
    const ids = read<number[]>(ctx.db, ARCHIVED(ctx.userId), []).filter((id) => id !== assignmentId);
    write(ctx.db, ARCHIVED(ctx.userId), archived ? [...ids, assignmentId] : ids);
  }),

  // 'skip-tasks': it stays in the plan's history, but counts as dealt with.
  skipTask: procedure(z.object({ taskId: idSchema }), ({ taskId }, ctx) => {
    ownTask(ctx.db, ctx.userId, taskId);
    write(ctx.db, SKIPPED, [...read<number[]>(ctx.db, SKIPPED, []), taskId]);
    ctx.db.update(plannerTasks).set({ doneAt: ctx.now() }).where(eq(plannerTasks.id, taskId)).run();
  }),

  // 'task-notes'.
  setTaskNote: procedure(z.object({ taskId: idSchema, note: z.string().trim().max(1000) }), ({ taskId, note }, ctx) => {
    ownTask(ctx.db, ctx.userId, taskId);
    write(ctx.db, TASK_NOTES, { ...read<Record<string, string>>(ctx.db, TASK_NOTES, {}), [taskId]: note });
  }),

  // 'other-commitments': minutes a week that aren't free, Sunday first.
  commitments: procedure(z.void(), (_input, ctx) => read<number[]>(ctx.db, COMMITMENTS(ctx.userId), [0, 0, 0, 0, 0, 0, 0])),
  setCommitments: procedure(z.object({ minutes: z.array(z.number().int().min(0).max(16 * 60)).length(7) }), ({ minutes }, ctx) => {
    write(ctx.db, COMMITMENTS(ctx.userId), minutes);
    replanOpen(ctx);
  }),

  // 'prof-plan-totals': how much students plan for a section's work, as totals only.
  classTotals: procedure(z.object({ classId: idSchema }), ({ classId }, ctx) => {
    requireTeacher(ctx.db, ctx.userId, classId);
    const rows = ctx.db
      .select({ assignmentId: plannerTasks.assignmentId, minutes: plannerTasks.minutes })
      .from(plannerTasks)
      .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
      .where(eq(plannerAssignments.classId, classId))
      .all();
    return { plans: new Set(rows.map((row) => row.assignmentId)).size, minutes: rows.reduce((sum, row) => sum + row.minutes, 0) };
  }),

  // 'share-task-lists': classmates' tasks for an assignment of the same name, without their names.
  sharedLists: procedure(z.object({ classId: idSchema, title: z.string().trim() }), ({ classId, title }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    const plans = ctx.db
      .select({ id: plannerAssignments.id })
      .from(plannerAssignments)
      .where(and(eq(plannerAssignments.classId, classId), eq(plannerAssignments.title, title), ne(plannerAssignments.userId, ctx.userId)))
      .all();
    return plans.map((plan) =>
      ctx.db.select({ title: plannerTasks.title, minutes: plannerTasks.minutes }).from(plannerTasks).where(eq(plannerTasks.assignmentId, plan.id)).orderBy(asc(plannerTasks.position)).all(),
    );
  }),

  // A moved deadline re-plans the remaining work (hand-placed tasks stay put).
  update: procedure(z.object({ assignmentId: idSchema, ...assignmentFields }), ({ assignmentId, ...fields }, ctx) => {
    const before = ownAssignment(ctx.db, ctx.userId, assignmentId);
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    // Setting your own due date stops following the class deadline.
    if (isOn('require-class-for-plan') && !fields.classId) throw new AppError(NEEDS_CLASS);
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
