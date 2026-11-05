import { isBusyWeek } from '@shared/grades';
import { isOn } from '@shared/variants';
import { read, write } from './variantData';
import { type AnyColumn, and, asc, count, desc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, daysBetween, parseYmd, ymd } from '@shared/dates';
import { type Locale, type Message, type Params, render, translate } from '@shared/i18n';
import { finalExamFor, KEY_DATES } from '@shared/keyDates';
import { channelsFor, NOTIFICATION_TYPES, type NotificationType } from '@shared/notifications';
import type { DB } from '../db/client';
import {
  appState,
  classes,
  courses,
  deadlines,
  enrollments,
  notifications,
  outbox,
  plannerAssignments,
  plannerTasks,
  studySessionMembers,
  studySessions,
  todos,
  users, courseInfo } from '../db/schema';
import { type AuthedContext, idSchema, procedure } from '../rpc/core';
import { classLabel, isProfessor, studentsOf } from './access';
import { visibleDeadlines } from './calendar';
import { gradedItems } from './courses';

// G3: in-app notifications, desktop notifications and email.
// Email can't actually be delivered without a mail server, so messages are kept in
// the `outbox` table, ready for a sender to pick up (see README).

// What a service passes to notify(). title and body are Messages ({ key,
// params }), not finished text, so they can be shown in the reader's language.
export interface NotifyInput {
  type: NotificationType;
  title: Message;
  body?: Message;
  link?: string | null;
  // Reminders pass a key so re-running the sweep never duplicates them.
  dedupeKey?: string;
}

// A type guard: `t in NOTIFICATION_TYPES` checks that the object has that key.
const isType = (t: string): t is NotificationType => t in NOTIFICATION_TYPES;

// Messages are translated when shown, so they follow the reader's language.
export const m = (key: string, params?: Params): Message => ({ key, params });
// User-written text (titles, places) that must never be looked up in the dictionary.
// The key {{text}} has no translation, so it renders as the text itself, unchanged in every language.
export const raw = (text: string): Message => ({ key: '{{text}}', params: { text } });

// What notify() needs to know about the person: where
// to email, their channel choices, and their language.
function recipient(db: DB, userId: number) {
  return db
    .select({ email: users.email, prefs: users.notificationPrefs, locale: users.locale })
    .from(users)
    .where(eq(users.id, userId))
    .get();
}

// Which classes someone's muted or switched off, under the switches that add that.
// Pulls the class id out of a link like /classes/12/chats. `|| null` turns NaN (no match) into null.
const classOfLink = (link?: string) => Number(link?.match(/^\/classes\/(\d+)/)?.[1]) || null;

function isSwitchedOff(db: DB, userId: number, n: NotifyInput) {
  if (n.type === 'study-mode') return false;
  if (isOn('notify-version-a') && (n.type === 'session-spot' || n.type === 'session-host')) return true;
  if (isOn('one-notification-switch') && read<boolean>(db, `variant-notifications-off-${userId}`, false)) return true;
  const classId = classOfLink(n.link ?? undefined);
  if (!classId) return false;
  if (isOn('notify-per-class') && read<number[]>(db, `variant-muted-classes-${userId}`, []).includes(classId)) return true;
  if (isOn('mute-whole-class')) return !!db.select({ muted: courseInfo.muteReplies }).from(courseInfo).where(and(eq(courseInfo.userId, userId), eq(courseInfo.classId, classId))).get()?.muted;
  return false;
}

// Stores one notification, plus an email if that type's email channel is on. Returns
// false when nothing was stored: no such user, switched off, or a duplicate.
export function notify(db: DB, userId: number, n: NotifyInput): boolean {
  const user = recipient(db, userId);
  if (!user || isSwitchedOff(db, userId, n)) return false;
  const inserted = db
    .insert(notifications)
    .values({
      userId,
      type: n.type,
      // The English text goes in the plain columns, and
      // i18n keeps the parts needed to translate it later.
      title: render('en', n.title),
      body: n.body ? render('en', n.body) : '',
      i18n: { title: n.title, body: n.body ?? null },
      link: n.link ?? null,
      dedupeKey: n.dedupeKey ?? null,
    })
    // With a dedupeKey, a repeat of the same reminder hits the unique index and
    // is skipped. returning() then gives no row, so `inserted` is undefined.
    .onConflictDoNothing()
    .returning({ id: notifications.id })
    .get();
  if (!inserted) return false;
  if (channelsFor(user.prefs, n.type).email || isOn('email-all-no-list')) {
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

// There's no mail server, so an email is a row in outbox, which Settings can show.
export function sendEmail(
  db: DB,
  { userId, to, locale, subject, body }: { userId: number | null; to: string; locale: Locale; subject: string; body: string },
) {
  db.insert(outbox)
    .values({ userId, toEmail: to, subject, body: `${body}\n\n${translate(locale, 'Open UniLink to see more.')}`.trim() })
    .run();
}

// "… is due today at 23:59" / "… tomorrow at 10:00" / "… Tue 3 Nov, 23:59".
// Picks the today, tomorrow or dated wording. The time and date params
// are { date } objects, formatted later in the reader's language.
function soon(kind: 'due' | 'starts', title: string, date: Date, now: Date): Message {
  const day = ymd(date);
  const params: Params = { title, time: { date: date.getTime(), style: 'time' }, when: { date: date.getTime() } };
  if (day === ymd(now)) return kind === 'due' ? m('{{title}} is due today at {{time}}', params) : m('"{{title}}" starts today at {{time}}', params);
  if (day === addDays(ymd(now), 1))
    return kind === 'due' ? m('{{title}} is due tomorrow at {{time}}', params) : m('"{{title}}" starts tomorrow at {{time}}', params);
  return kind === 'due' ? m('{{title}} is due {{when}}', params) : m('"{{title}}" starts {{when}}', params);
}

// G3: one summary a week, the first time they open the app after Sunday 16:00, when people plan
// theirs. It covers the next seven days, and stays quiet when there's nothing due.
// Eight hours in milliseconds. Moving the clock forward by this
// much makes Sunday 16:00 count as the start of the next week.
const WEEK_STARTS_EARLY_BY = 8 * 3_600_000;

// The dedupeKey names the week's Monday, so the summary
// goes out at most once a week, whenever the app is opened.
function weekAhead(ctx: AuthedContext, locale: Locale) {
  const { db, userId } = ctx;
  const now = ctx.now();
  const shifted = new Date(now.getTime() + WEEK_STARTS_EARLY_BY);
  // getDay() counts from Sunday as 0, so (getDay() + 6) % 7 is the
  // number of days since Monday. Subtracting it lands on that Monday.
  const dedupeKey = `week-ahead:${addDays(ymd(shifted), -((shifted.getDay() + 6) % 7))}`;
  if (db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.dedupeKey, dedupeKey))).get()) return;

  const until = new Date(now.getTime() + 7 * 86_400_000);
  const due = visibleDeadlines(db, userId, now, until)
    .filter((d) => !d.done)
    .map((d) => ({ title: d.title, classId: d.classId, at: d.dueAt }));
  // A class's midterm is often both a deadline and a graded item; it only counts once.
  // A midterm is often both a deadline and a graded item. Class
  // plus lowercased title identifies it, so it's listed once.
  const seen = new Set(due.map((d) => `${d.classId}|${d.title.toLowerCase()}`));
  const classIds = db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, userId)).all();
  for (const a of classIds.flatMap((c) => gradedItems(db, userId, c.id))) {
    if (a.score != null || !a.dueAt || a.dueAt <= now || a.dueAt > until || seen.has(`${a.classId}|${a.name.toLowerCase()}`)) continue;
    due.push({ title: a.name, classId: a.classId, at: a.dueAt });
  }
  for (const c of db
    .select({ id: classes.id, term: classes.term, section: classes.section, subject: courses.subject, number: courses.number })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(eq(enrollments.userId, userId))
    .all()) {
    const exam = finalExamFor(`${c.subject} ${c.number}`, c.term, c.section);
    const startsAt = exam && atTime(exam.date, exam.start);
    if (exam && startsAt && startsAt > now && startsAt <= until) {
      due.push({ title: translate(locale, '{{course}} final exam', { course: exam.course }), classId: c.id, at: startsAt });
    }
  }
  if (!due.length) return;

  // sort() with a compare function: a negative result puts a
  // first. sort() reorders `due` itself, and also returns it.
  const soonest = due.sort((a, b) => a.at.getTime() - b.at.getTime());
  const listed = soonest.slice(0, 3).map((d) => render(locale, m('{{title}}, {{when}}', { title: d.title, when: { date: d.at.getTime() } })));
  if (soonest.length > 3) listed.push(render(locale, m('+{{count}} more', { count: soonest.length - 3 })));
  notify(db, userId, {
    type: 'week-ahead',
    title: m('Your week ahead: {{count}} things due', { count: soonest.length }),
    body: raw(listed.join(' · ')),
    link: '/calendar',
    dedupeKey,
  });
}

// A3: add/drop and withdrawal deadlines for the terms a student has classes in: a week ahead, when
// there's still time to decide, and again the day before.
function keyDateReminders(ctx: AuthedContext, locale: Locale) {
  const { db, userId } = ctx;
  const today = ymd(ctx.now());
  const terms = new Set(
    db
      .select({ term: classes.term })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .where(eq(enrollments.userId, userId))
      .all()
      .map((c) => c.term),
  );
  for (const k of KEY_DATES) {
    if (k.type !== 'deadline' || !terms.has(k.term)) continue;
    const days = daysBetween(today, k.date);
    if (days < 0 || days > 7) continue;
    const title = render(locale, m(k.title));
    notify(db, userId, {
      type: 'key-date',
      title: days === 0 ? m('{{title}}: today', { title }) : days === 1 ? m('{{title}}: tomorrow', { title }) : m('{{title}} is in {{count}} days', { title, count: days }),
      body: k.approximate ? m('This date is approximate. Check it with McGill.') : raw(k.term),
      link: '/calendar',
      // One key for the week-ahead reminder and one for the
      // day before and the day itself, so each is sent once.
      dedupeKey: `key-date:${k.term}:${k.date}:${days <= 1 ? 'day' : 'week'}`,
    });
  }
}

// Assignments whose time has come go out, and the section hears about them. With a server this would
// be a scheduled job; here it runs with whoever has the app open.
function releaseAssignments(ctx: AuthedContext) {
  const { db } = ctx;
  const now = ctx.now();
  for (const d of db.select().from(deadlines).where(lte(deadlines.releaseAt, now)).all()) {
    db.update(deadlines).set({ releaseAt: null }).where(eq(deadlines.id, d.id)).run();
    if (d.classId != null) tellOfNewAssignment(db, d.classId, d.title, d.dueAt);
  }
}

// One notification for each student in the section.
export function tellOfNewAssignment(db: DB, classId: number, title: string, dueAt: Date) {
  for (const student of studentsOf(db, classId)) {
    notify(db, student.id, {
      type: 'assignment-posted',
      title: m('New assignment: {{title}}', { title }),
      body: m('{{class}} · due {{when}}', { class: classLabel(db, classId) ?? '', when: { date: dueAt.getTime() } }),
      link: `/classes/${classId}/assignments`,
    });
  }
}

// Everything is saved only in this browser, so a backup is the only copy anyone has. A month after
// the first visit or the last backup, once a month.
const FIRST_SEEN_KEY = 'first_seen';
export const LAST_BACKUP_KEY = 'last_backup';
const BACKUP_EVERY = 30 * 86_400_000;

// The first run only records when the app was first seen. The dedupeKey
// holds the year and month, so there's at most one reminder a month.
function backupReminder(ctx: AuthedContext) {
  const { db, userId } = ctx;
  // A tiny helper that reads one app_state value, or undefined.
  const state = (key: string) => db.select({ value: appState.value }).from(appState).where(eq(appState.key, key)).get()?.value;
  const now = ctx.now();
  const since = state(LAST_BACKUP_KEY) ?? state(FIRST_SEEN_KEY);
  if (!since) {
    db.insert(appState).values({ key: FIRST_SEEN_KEY, value: String(now.getTime()) }).run();
    return;
  }
  if (now.getTime() - Number(since) < BACKUP_EVERY) return;
  notify(db, userId, {
    type: 'backup',
    title: m('Time to back up your UniLink work'),
    body: m('It’s saved only in this browser, so clearing its data would erase it. A backup takes a few seconds.'),
    link: '/settings/privacy',
    dedupeKey: `backup:${ymd(now).slice(0, 7)}`,
  });
}

// Time-based reminders for the signed-in user; run every tick by the main process.
// Every reminder has a dedupeKey that includes the due time. So running this every
// 30 seconds sends each reminder once, and a deadline that moves gets a new one.
export function sweepReminders(ctx: AuthedContext) {
  const { db, userId } = ctx;
  releaseAssignments(ctx);
  const now = ctx.now();
  // 'busy-week-notification': next week looks heavy, so say so while there's time.
  if (isOn('busy-week-notification') && !isProfessor(db, userId)) {
    const monday = addDays(ymd(now), ((8 - now.getDay()) % 7) || 7);
    const due = visibleDeadlines(db, userId, parseYmd(monday), parseYmd(addDays(monday, 7))).filter((d) => !d.done);
    if (isBusyWeek(due.map(() => ({})))) {
      notify(db, userId, { type: 'deadline-soon', title: raw(`Busy week ahead: ${due.length} things are due the week of ${monday}`), link: '/calendar', dedupeKey: `busy-week:${monday}` });
    }
  }
  const in24h = new Date(now.getTime() + 24 * 3_600_000);
  const in30m = new Date(now.getTime() + 30 * 60_000);
  // Returns a Drizzle condition for any timestamp column, so the same window works on different tables.
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

  // A3: exams get a heads-up three days ahead as well, while there's still time to study.
  const in3Days = new Date(now.getTime() + 3 * 86_400_000);
  // A local helper for the three-day warning. Anything within 24
  // hours is skipped, because the regular reminder covers it.
  const headsUp = (title: Message, date: Date, body: Message, link: string, key: string) => {
    if (date <= in24h || date > in3Days) return;
    notify(db, userId, {
      type: 'deadline-soon',
      title: m('{{title}} is in {{count}} days', { title: render(locale, title), count: daysBetween(ymd(now), ymd(date)) }),
      body,
      link,
      dedupeKey: `heads-up:${key}:${date.getTime()}`,
    });
  };
  // A3: final exams from the exam schedule, in the student's language.
  const locale = recipient(db, userId)?.locale ?? 'en';
  if (!teaching) weekAhead(ctx, locale);
  if (!teaching) keyDateReminders(ctx, locale);
  backupReminder(ctx);
  for (const d of teaching ? [] : visibleDeadlines(db, userId, in24h, in3Days)) {
    if (d.kind !== 'exam' || d.done) continue;
    headsUp(raw(d.title), d.dueAt, raw(classLabel(db, d.classId) ?? ''), d.classId ? `/classes/${d.classId}` : '/calendar', `deadline:${d.id}`);
  }
  for (const a of classIds.flatMap((c) => gradedItems(db, userId, c.id))) {
    // Graded items have no kind, so exams are recognised by name. \b
    // marks a word boundary, so "test" matches but "latest" doesn't.
    if (a.score != null || !a.dueAt || !/midterm|exam|\btest\b/i.test(a.name)) continue;
    headsUp(raw(a.name), a.dueAt, m('{{class}} · worth {{weight}}%', { class: classLabel(db, a.classId) ?? '', weight: a.weight }), `/classes/${a.classId}/grades`, `assessment:${a.id}`);
  }
  for (const c of teaching
    ? []
    : db
        .select({ id: classes.id, term: classes.term, section: classes.section, subject: courses.subject, number: courses.number })
        .from(enrollments)
        .innerJoin(classes, eq(enrollments.classId, classes.id))
        .innerJoin(courses, eq(classes.courseId, courses.id))
        .where(eq(enrollments.userId, userId))
        .all()) {
    const exam = finalExamFor(`${c.subject} ${c.number}`, c.term, c.section);
    const startsAt = exam && atTime(exam.date, exam.start);
    if (!exam || !startsAt) continue;
    const name = { key: '{{course}} final exam', params: { course: exam.course } };
    headsUp(name, startsAt, raw(`${classLabel(db, c.id) ?? ''} · ${exam.location}`), `/classes/${c.id}`, `final:${c.id}`);
    if (startsAt <= now || startsAt > in24h) continue;
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
  // Only from 8 in the morning. The dedupeKey holds today's date, so this is sent once a day.
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
    // 'urgent-notifications-through': a session cancelled today can't wait.
    .filter((n) => !silenced || n.type === 'study-mode' || (isOn('urgent-notifications-through') && n.type === 'session-cancelled'));
  if (!pending.length) return [];

  db.update(notifications)
    // Marked as delivered before they're shown, so a notification
    // is never shown twice, however soon the next tick comes.
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
  // More than three at once become a single summary instead of a burst of pop-ups.
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

// What the bell and Settings call. Notifications themselves are created elsewhere, through notify().
export const notificationsRouter = {
  list: procedure(z.void(), (_input, ctx) => {
    const items = ctx.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ctx.userId))
      // The id breaks ties between notifications created in the same millisecond.
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

  // 'one-notification-switch' and 'notify-per-class'.
  switches: procedure(z.void(), (_input, ctx) => ({
    off: read<boolean>(ctx.db, `variant-notifications-off-${ctx.userId}`, false),
    mutedClasses: read<number[]>(ctx.db, `variant-muted-classes-${ctx.userId}`, []),
  })),
  setAllOff: procedure(z.object({ off: z.boolean() }), ({ off }, ctx) => write(ctx.db, `variant-notifications-off-${ctx.userId}`, off)),
  setClassMuted: procedure(z.object({ classId: z.number().int(), muted: z.boolean() }), ({ classId, muted }, ctx) => {
    const others = read<number[]>(ctx.db, `variant-muted-classes-${ctx.userId}`, []).filter((id) => id !== classId);
    write(ctx.db, `variant-muted-classes-${ctx.userId}`, muted ? [...others, classId] : others);
  }),

  // Every type this person can get, with their current channels. The cast
  // to { only?: string } is needed because only some types have `only`.
  prefs: procedure(z.void(), (_input, ctx) => {
    const prefs = ctx.db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, ctx.userId)).get()?.prefs;
    const role = isProfessor(ctx.db, ctx.userId) ? 'professor' : 'student';
    return (Object.keys(NOTIFICATION_TYPES) as NotificationType[])
      .filter((type) => {
        const only = (NOTIFICATION_TYPES[type] as { only?: string }).only;
        return !only || only === role;
      })
      .map((type) => ({
        type,
        label: NOTIFICATION_TYPES[type].label,
        group: NOTIFICATION_TYPES[type].group,
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
        // [type] is a computed key: the property's name is the value of
        // `type`. Spreading `current` keeps every other type's choices.
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
