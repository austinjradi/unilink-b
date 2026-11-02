import { type AnyColumn, and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, ymd } from '@shared/dates';
import { type Locale, type Message, type Params, render, translate } from '@shared/i18n';
import { finalExamFor } from '@shared/keyDates';
import { channelsFor, NOTIFICATION_TYPES, type NotificationType } from '@shared/notifications';
import type { DB } from '../db/client';
import {
  classes,
  courses,
  enrollments,
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
import { classLabel, isProfessor } from './access';
import { visibleDeadlines } from './calendar';
import { gradedItems } from './courses';

// G3: in-app notifications, desktop notifications and email.
// Email can't actually be delivered without a mail server, so messages are kept in
// the `outbox` table, ready for a sender to pick up (see README).

export interface NotifyInput {
  type: NotificationType;
  title: Message;
  body?: Message;
  link?: string | null;
  // Reminders pass a key so re-running the sweep never duplicates them.
  dedupeKey?: string;
}

const isType = (t: string): t is NotificationType => t in NOTIFICATION_TYPES;

// Messages are translated when shown, so they follow the reader's language.
export const m = (key: string, params?: Params): Message => ({ key, params });
// User-written text (titles, places) that must never be looked up in the dictionary.
export const raw = (text: string): Message => ({ key: '{{text}}', params: { text } });

function recipient(db: DB, userId: number) {
  return db
    .select({ email: users.email, prefs: users.notificationPrefs, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

export function notify(db: DB, userId: number, n: NotifyInput): boolean {
  const user = recipient(db, userId);
  if (!user) return false;
  const inserted = db
    .insert(notifications)
    .values({
      userId,
      type: n.type,
      title: render('en', n.title),
      body: n.body ? render('en', n.body) : '',
      i18n: { title: n.title, body: n.body ?? null },
      link: n.link ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id })
    .get();
  if (!inserted) return false;
  if (channelsFor(user.prefs, n.type).email) {
    sendEmail(db, {
      userId,
      to: user.email,
      locale: user.locale,
      subject: `UniLink: ${render(user.locale, n.title)}`,
      body: n.body ? render(user.locale, n.body) : '',
    });
  }
  return true;
}

export function sendEmail(
  db: DB,
  { userId, to, locale, subject, body }: { userId: number | null; to: string; locale: Locale; subject: string; body: string },
) {
  db.insert(outbox)
    .values({ userId, toEmail: to, subject, body: `${body}\n\n${translate(locale, 'Open UniLink to see more.')}`.trim() })
    .run();
}

// "… is due today at 23:59" / "… tomorrow at 10:00" / "… Tue 3 Nov, 23:59".
function soon(kind: 'due' | 'starts', title: string, date: Date, now: Date): Message {
  const day = ymd(date);
  const params: Params = { title, time: { date: date.getTime(), style: 'time' }, when: { date: date.getTime() } };
  if (day === ymd(now)) return kind === 'due' ? m('{{title}} is due today at {{time}}', params) : m('"{{title}}" starts today at {{time}}', params);
  if (day === addDays(ymd(now), 1))
    return kind === 'due' ? m('{{title}} is due tomorrow at {{time}}', params) : m('"{{title}}" starts tomorrow at {{time}}', params);
  return kind === 'due' ? m('{{title}} is due {{when}}', params) : m('"{{title}}" starts {{when}}', params);
}

// Time-based reminders for the signed-in user; run every tick by the main process.
export function sweepReminders(ctx: AuthedContext) {
  const { db, userId } = ctx;
  const now = ctx.now();
  const in24h = new Date(now.getTime() + 24 * 3_600_000);
  const in30m = new Date(now.getTime() + 30 * 60_000);
  const within24h = (dueAt: AnyColumn) => and(gt(dueAt, now), lte(dueAt, in24h));

  // Deadlines and exam reminders are for the students writing them, not whoever teaches them.
  const teaching = isProfessor(db, userId);
  for (const d of teaching ? [] : visibleDeadlines(db, userId, now, in24h)) {
    if (d.done) continue;
    notify(db, userId, {
      type: 'deadline-soon',
      title: soon('due', d.title, d.dueAt, now),
      body: raw(classLabel(db, d.classId) ?? ''),
      link: '/',
      dedupeKey: `deadline:${d.id}:${d.dueAt.getTime()}`,
    });
  }

  const classIds = teaching ? [] : db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId)).all();
  for (const a of classIds.flatMap((c) => gradedItems(db, userId, c.id))) {
    if (a.score != null || !a.dueAt || a.dueAt <= now || a.dueAt > in24h) continue;
    notify(db, userId, {
      type: 'deadline-soon',
      title: soon('due', a.name, a.dueAt, now),
      body: m('{{class}} · worth {{weight}}%', { class: classLabel(db, a.classId) ?? '', weight: a.weight }),
      link: `/classes/${a.classId}/grades`,
      dedupeKey: `assessment:${a.id}:${a.dueAt.getTime()}`,
    });
  }

  // A3: final exams from the exam schedule, in the student's language.
  const locale = recipient(db, userId)?.locale ?? 'en';
  for (const c of db
    .select({ id: classes.id, term: classes.term, subject: courses.subject, number: courses.number })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(eq(enrollments.userId, userId))
    .all()) {
    const exam = finalExamFor(`${c.subject} ${c.number}`, c.term);
    const startsAt = exam && atTime(exam.date, exam.start);
    if (!exam || !startsAt || startsAt <= now || startsAt > in24h) continue;
    notify(db, userId, {
      type: 'deadline-soon',
      title: soon('starts', translate(locale, '{{course}} final exam', { course: exam.course }), startsAt, now),
      body: raw(`${classLabel(db, c.id) ?? ''} · ${exam.location}`),
      link: `/classes/${c.id}`,
      dedupeKey: `final:${c.id}:${startsAt.getTime()}`,
    });
  }

  for (const p of db
    .select()
    .from(plannerAssignments)
    .where(and(eq(plannerAssignments.userId, userId), within24h(plannerAssignments.dueAt)))
    .all()) {
    const open = db
      .select({ n: count() })
      .from(plannerTasks)
      .where(and(eq(plannerTasks.assignmentId, p.id), isNull(plannerTasks.doneAt)))
      .get()!.n;
    if (!open) continue;
    notify(db, userId, {
      type: 'deadline-soon',
      title: soon('due', p.title, p.dueAt, now),
      body: m('{{count}} planned tasks left', { count: open }),
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
      title: soon('starts', s.title, s.startsAt, now),
      body: raw(s.location),
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
        title: m('You have {{count}} tasks for today', { count: tasks + due }),
        body: m('Open your to-do list to get started.'),
        link: '/',
        dedupeKey: `tasks:${today}`,
      });
    }
  }
}

// Notifications not yet shown on the desktop, in the student's language. While study
// mode silences notifications, they wait (except study mode's own) until it ends.
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

  const user = recipient(db, userId);
  const locale = user?.locale ?? 'en';
  const text = (n: (typeof pending)[number]) => ({
    title: n.i18n ? render(locale, n.i18n.title) : n.title,
    body: n.i18n?.body ? render(locale, n.i18n.body) : n.body,
  });
  const shown = pending.filter((n) => isType(n.type) && channelsFor(user?.prefs, n.type).desktop);
  if (shown.length > 3) {
    return [
      {
        title: translate(locale, '{{count}} new notifications', { count: shown.length }),
        body: shown.slice(-3).map((n) => text(n).title).join('\n'),
        link: '/',
      },
    ];
  }
  return shown.map((n) => ({ ...text(n), link: n.link }));
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
