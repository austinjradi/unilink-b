import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, parseYmd, ymd } from '@shared/dates';
import type { DB } from '../db/client';
import { plannerAssignments, plannerTasks, todos } from '../db/schema';
import { idSchema, nonEmpty, procedure } from '../rpc/core';
import { classLabel, notFound, requireMember } from './access';
import { reconcile } from './planner';

// ST3: today's tasks first (planned work from ST2 plus the student's own to-dos);
// upcoming deadlines come from the A3 calendar.

const todoFields = {
  title: nonEmpty('Task', 200),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  classId: idSchema.nullable(),
};

function ownTodo(db: DB, userId: number, id: number) {
  return (
    db
      .select()
      .from(todos)
      .where(and(eq(todos.id, id), eq(todos.userId, userId)))
      .get() ?? notFound('task')
  );
}

export interface TodayItem {
  key: string;
  kind: 'task' | 'todo';
  id: number;
  title: string;
  classId: number | null;
  context: string | null;
  due: string | null;
  overdue: boolean;
  done: boolean;
  // For planned work: how far along the whole assignment is, e.g. 2 of 5 done.
  progress: { done: number; total: number } | null;
  weekly: boolean;
}

export const todosRouter = {
  today: procedure(z.void(), (_input, ctx) => {
    reconcile(ctx);
    const today = ymd(ctx.now());
    const startOfToday = parseYmd(today);
    const doneToday = gte(plannerTasks.doneAt, startOfToday);

    const progress = new Map(
      ctx.db
        .select({
          id: plannerTasks.assignmentId,
          total: sql<number>`count(*)`.mapWith(Number),
          done: sql<number>`count(${plannerTasks.doneAt})`.mapWith(Number),
        })
        .from(plannerTasks)
        .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
        .where(eq(plannerAssignments.userId, ctx.userId))
        .groupBy(plannerTasks.assignmentId)
        .all()
        .map((r) => [r.id, { done: r.done, total: r.total }]),
    );

    const tasks: TodayItem[] = ctx.db
      .select({ task: plannerTasks, assignment: plannerAssignments.title, classId: plannerAssignments.classId })
      .from(plannerTasks)
      .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
      .where(
        and(
          eq(plannerAssignments.userId, ctx.userId),
          lte(plannerTasks.scheduledFor, today),
          or(isNull(plannerTasks.doneAt), doneToday),
        ),
      )
      .orderBy(asc(plannerTasks.scheduledFor), asc(plannerTasks.position))
      .all()
      .map(({ task, assignment, classId }) => ({
        key: `task-${task.id}`,
        kind: 'task',
        id: task.id,
        title: task.title,
        classId,
        context: [assignment, classLabel(ctx.db, classId)].filter(Boolean).join(' · '),
        due: task.scheduledFor,
        overdue: !task.doneAt && task.scheduledFor < today,
        done: !!task.doneAt,
        progress: progress.get(task.assignmentId) ?? null,
        weekly: false,
      }));

    const mine = ctx.db
      .select()
      .from(todos)
      .where(and(eq(todos.userId, ctx.userId), or(isNull(todos.doneAt), gte(todos.doneAt, startOfToday))))
      .orderBy(sql`${todos.dueDate} is null`, asc(todos.dueDate), asc(todos.createdAt))
      .all()
      .map(
        (t): TodayItem => ({
          key: `todo-${t.id}`,
          kind: 'todo',
          id: t.id,
          title: t.title,
          classId: t.classId,
          context: classLabel(ctx.db, t.classId),
          due: t.dueDate,
          overdue: !t.doneAt && t.dueDate != null && t.dueDate < today,
          done: !!t.doneAt,
          progress: null,
          weekly: t.repeatsWeekly,
        }),
      );

    const isToday = (t: TodayItem) => t.due == null || t.due <= today;
    return {
      today: [...tasks, ...mine.filter(isToday)],
      later: mine.filter((t) => !isToday(t) && !t.done),
    };
  }),

  add: procedure(z.object({ ...todoFields, weekly: z.boolean().default(false) }), ({ weekly, ...fields }, ctx) => {
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    // A to-do with no date has no next week to come back on.
    ctx.db
      .insert(todos)
      .values({ ...fields, userId: ctx.userId, repeatsWeekly: weekly && fields.dueDate != null })
      .run();
  }),

  update: procedure(z.object({ id: idSchema, ...todoFields }), ({ id, ...fields }, ctx) => {
    ownTodo(ctx.db, ctx.userId, id);
    if (fields.classId) requireMember(ctx.db, ctx.userId, fields.classId);
    ctx.db.update(todos).set(fields).where(eq(todos.id, id)).run();
  }),

  // Checking off a weekly to-do adds the next one, skipping any weeks already gone by; taking the
  // check back takes that next one away again.
  setDone: procedure(z.object({ id: idSchema, done: z.boolean() }), ({ id, done }, ctx) => {
    const todo = ownTodo(ctx.db, ctx.userId, id);
    ctx.db
      .update(todos)
      .set({ doneAt: done ? ctx.now() : null })
      .where(eq(todos.id, id))
      .run();
    if (!todo.repeatsWeekly || !todo.dueDate) return;
    const next = () => ctx.db.select().from(todos).where(and(eq(todos.previousId, id), eq(todos.userId, ctx.userId))).get();
    if (!done) {
      const following = next();
      if (following && !following.doneAt) ctx.db.delete(todos).where(eq(todos.id, following.id)).run();
    } else if (!next()) {
      const today = ymd(ctx.now());
      let dueDate = addDays(todo.dueDate, 7);
      while (dueDate <= today) dueDate = addDays(dueDate, 7);
      ctx.db
        .insert(todos)
        .values({ userId: ctx.userId, title: todo.title, classId: todo.classId, dueDate, repeatsWeekly: true, previousId: id })
        .run();
    }
  }),

  remove: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    ownTodo(ctx.db, ctx.userId, id);
    ctx.db.delete(todos).where(eq(todos.id, id)).run();
  }),
};
