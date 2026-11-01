import { type AnyColumn, and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, fmtClock, fmtWhen, ymd } from '@shared/dates';
import { channelsFor, NOTIFICATION_TYPES, type NotificationType } from '@shared/notifications';
import type { DB } from '../db/client';
import {
  assessments,
  deadlines,
  notifications,
  outbox,
  plannerAssignments,
  plannerTasks,
  studySessionMembers,
  studySessions,
  todos,
  users,
} from '../db/schema';
import { type AuthedContext, idSchema, procedure } from '../rpc/core';
import { classLabel } from './access';

// G3: in-app notifications, desktop notifications and email.
// Email can't actually be delivered without a mail server, so messages are kept in
// the `outbox` table, ready for a sender to pick up (see README).

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string;
  link?: string | null;
  // Reminders pass a key so re-running the sweep never duplicates them.
  dedupeKey?: string;
}

const isType = (t: string): t is NotificationType => t in NOTIFICATION_TYPES;

export function notify(db: DB, userId: number, n: NotifyInput): boolean {
  const user = db.select({ email: users.email, prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId)).get();
  if (!user) return false;
  const inserted = db
    .insert(notifications)
    .values({ userId, type: n.type, title: n.title, body: n.body ?? '', link: n.link ?? null, dedupeKey: n.dedupeKey ?? null })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
    .get();
  if (!inserted) return false;
  if (channelsFor(user.prefs, n.type).email) {
    sendEmail(db, { userId, to: user.email, subject: `UniLink: ${n.title}`, body: n.body ?? '' });
  }
  return true;
}

export function sendEmail(db: DB, { userId, to, subject, body }: { userId: number | null; to: string; subject: string; body: string }) {
  db.insert(outbox)
    .values({ userId, toEmail: to, subject, body: `${body}\n\nOpen UniLink to see more.`.trim() })
    .run();
}

const relative = (date: Date, now: Date) => {
  const day = ymd(date);
  if (day === ymd(now)) return `today at ${fmtClock(date)}`;
  if (day === addDays(ymd(now), 1)) return `tomorrow at ${fmtClock(date)}`;
  return fmtWhen(date);
};

// Time-based reminders for the signed-in user; run every tick by the main process.
export function sweepReminders(ctx: AuthedContext) {
  const { db, userId } = ctx;
  const now = ctx.now();
  const in24h = new Date(now.getTime() + 24 * 3_600_000);
  const in30m = new Date(now.getTime() + 30 * 60_000);
  const soon = (dueAt: AnyColumn) => and(gt(dueAt, now), lte(dueAt, in24h));

  for (const d of db
    .select()
    .from(deadlines)
    .where(and(eq(deadlines.userId, userId), isNull(deadlines.completedAt), soon(deadlines.dueAt)))
    .all()) {
    notify(db, userId, {
      type: 'deadline-soon',
      title: `${d.title} is due ${relative(d.dueAt, now)}`,
      body: classLabel(db, d.classId) ?? '',
      link: '/',
      dedupeKey: `deadline:${d.id}:${d.dueAt.getTime()}`,
    });
  }

  for (const a of db
    .select()
    .from(assessments)
    .where(and(eq(assessments.userId, userId), isNull(assessments.score), soon(assessments.dueAt)))
    .all()) {
    notify(db, userId, {
      type: 'deadline-soon',
      title: `${a.name} is due ${relative(a.dueAt!, now)}`,
      body: `${classLabel(db, a.classId) ?? ''} · worth ${a.weight}%`,
      link: `/classes/${a.classId}/grades`,
      dedupeKey: `assessment:${a.id}:${a.dueAt!.getTime()}`,
    });
  }

  for (const p of db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.userId, userId), soon(plannerAssignments.dueAt)))
    .all()) {
    const open = db
      .select({ n: count() })
      .from(plannerTasks)
      .where(and(eq(plannerTasks.assignmentId, p.id), isNull(plannerTasks.doneAt)))
      .get()!.n;
    if (!open) continue;
    notify(db, userId, {
      type: 'deadline-soon',
      title: `${p.title} is due ${relative(p.dueAt, now)}`,
      body: `${open} planned task${open === 1 ? '' : 's'} left`,
      link: '/planner',
      dedupeKey: `planner:${p.id}:${p.dueAt.getTime()}`,
    });
  }

  const starting = db
    .select({ session: studySessions })
    .from(studySessions)
    .innerJoin(studySessionMembers, and(eq(studySessionMembers.sessionId, studySessions.id), eq(studySessionMembers.userId, userId)))
    .where(
      and(
        eq(studySessionMembers.status, 'going'),
        isNull(studySessions.cancelledAt),
        gt(studySessions.startsAt, now),
        lte(studySessions.startsAt, in30m),
      ),
    )
    .all();
  for (const { session: s } of starting) {
    notify(db, userId, {
      type: 'session-starting',
      title: `"${s.title}" starts ${relative(s.startsAt, now)}`,
      body: s.location,
      link: `/classes/${s.classId}/sessions`,
      dedupeKey: `session-start:${s.id}:${s.startsAt.getTime()}`,
    });
  }

  // A morning summary of today's planned work and to-dos, once a day.
  const today = ymd(now);
  if (now.getHours() >= 8) {
    const tasks = db
      .select({ n: count() })
      .from(plannerTasks)
      .innerJoin(plannerAssignments, eq(plannerTasks.assignmentId, plannerAssignments.id))
      .where(and(eq(plannerAssignments.userId, userId), eq(plannerTasks.scheduledFor, today), isNull(plannerTasks.doneAt)))
      .get()!.n;
    const due = db
      .select({ n: count() })
      .from(todos)
      // Undated to-dos sit in today's list too.
      .where(and(eq(todos.userId, userId), or(isNull(todos.dueDate), lte(todos.dueDate, today)), isNull(todos.doneAt)))
      .get()!.n;
    if (tasks + due > 0) {
      notify(db, userId, {
        type: 'tasks-today',
        title: `You have ${tasks + due} task${tasks + due === 1 ? '' : 's'} for today`,
        body: 'Open your to-do list to get started.',
        link: '/',
        dedupeKey: `tasks:${today}`,
      });
    }
  }
}

// Notifications not yet shown on the desktop. While study mode silences notifications,
// they wait (except study mode's own) and are shown once it ends.
export function takeDesktopNotifications(ctx: AuthedContext, { silenced }: { silenced: boolean }) {
  const { db, userId } = ctx;
  const pending = db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.deliveredAt)))
    .orderBy(asc(notifications.createdAt))
    .all()
    .filter((n) => !silenced || n.type === 'study-mode');
  if (!pending.length) return [];

  db.update(notifications)
    .set({ deliveredAt: ctx.now() })
    .where(inArray(notifications.id, pending.map((n) => n.id)))
    .run();

  const prefs = db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId)).get()?.prefs;
  const shown = pending.filter((n) => isType(n.type) && channelsFor(prefs, n.type).desktop);
  if (shown.length > 3) {
    return [{ title: `${shown.length} new notifications`, body: shown.slice(-3).map((n) => n.title).join('\n'), link: '/' }];
  }
  return shown.map((n) => ({ title: n.title, body: n.body, link: n.link }));
}

export const notificationsRouter = {
  list: procedure(z.void(), (_input, ctx) => {
    const items = ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(50)
      .all();
    const unread = ctx.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
      .get()!.n;
    return { items, unread };
  }),

  markRead: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    ctx.db
      .update(notifications)
      .set({ readAt: ctx.now() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)))
      .run();
  }),

  markAllRead: procedure(z.void(), (_input, ctx) => {
    ctx.db
      .update(notifications)
      .set({ readAt: ctx.now() })
      .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
      .run();
  }),

  prefs: procedure(z.void(), (_input, ctx) => {
    const prefs = ctx.db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, ctx.userId)).get()?.prefs;
    return (Object.keys(NOTIFICATION_TYPES) as NotificationType[]).map((type) => ({
      type,
      label: NOTIFICATION_TYPES[type].label,
      ...channelsFor(prefs, type),
    }));
  }),

  setPref: procedure(
    z.object({
      type: z.enum(Object.keys(NOTIFICATION_TYPES) as [NotificationType, ...NotificationType[]]),
      desktop: z.boolean(),
      email: z.boolean(),
    }),
    ({ type, desktop, email }, ctx) => {
      const current = ctx.db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, ctx.userId)).get()?.prefs;
      ctx.db
        .update(users)
        .set({ notificationPrefs: { ...current, [type]: { desktop, email } } })
        .where(eq(users.id, ctx.userId))
        .run();
    },
  ),

  // Emails waiting for a mail server.
  outbox: procedure(z.void(), (_input, ctx) =>
    ctx.db.select().from(outbox).where(eq(outbox.userId, ctx.userId)).orderBy(desc(outbox.id)).limit(50).all(),
  ),
};
