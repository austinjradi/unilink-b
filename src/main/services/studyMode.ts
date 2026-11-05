import { inArray, and, eq, gt, gte, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, parseYmd, termRange, ymd } from '@shared/dates';
import { noClassesOn } from '@shared/keyDates';
import { type FocusWindow, focusSummary, studyModeStatus } from '@shared/studyMode';
import type { DB } from '../db/client';
import {
  classes,
  classMeetings,
  courseInfo,
  courses,
  enrollments,
  focusLog,
  plannerTasks,
  studyModeSettings,
  studySessionMembers,
  studySessions,
  users,
} from '../db/schema';
import { AppError, type AuthedContext, type Context, idSchema, procedure } from '../rpc/core';
import { isOn } from '@shared/variants';
import { isProfessor, requireMember, sectionCode } from './access';
import { m, notify, sweepReminders, takeDesktopNotifications } from './notifications';
import { ownTask } from './planner';

// Switches stay in English, so this isn't written where the French check would ask for a translation.
const NO_STOPPING = 'A focus session can’t be stopped early.';

// ST1: study mode switches on during class times and study sessions (or by hand),
// holds back notifications while it's on, and can turn on GNOME's Do Not Disturb.
// Blocking websites isn't possible from here; see README.

// `null as Date | null` gives these fields a wider type
// than their starting value, so they can hold a Date later.
const DEFAULTS = {
  autoForClasses: true,
  autoForSessions: true,
  silenceNotifications: true,
  systemDnd: false,
  manualUntil: null as Date | null,
  pausedUntil: null as Date | null,
  focusTaskId: null as number | null,
};

// No row means the defaults, so nothing needs creating until someone changes a setting.
function settingsFor(db: DB, userId: number) {
  return db.select().from(studyModeSettings).where(eq(studyModeSettings.userId, userId)).get() ?? { userId, ...DEFAULTS };
}

// Partial<typeof DEFAULTS> means any subset of the settings. The first
// save inserts every default; later saves update only the fields given.
function saveSettings(db: DB, userId: number, patch: Partial<typeof DEFAULTS>) {
  db.insert(studyModeSettings)
    .values({ userId, ...DEFAULTS, ...patch })
    .onConflictDoUpdate({ target: studyModeSettings.userId, set: patch })
    .run();
}

// Class times and study sessions from yesterday through tomorrow.
// Weekly class times become dated windows: for each of the three days, a meeting
// on that weekday, within the term and not on a holiday, becomes one window.
function focusWindows(db: DB, userId: number, now: Date): FocusWindow[] {
  // A professor's class times are when they're teaching, not when to go quiet.
  if (isProfessor(db, userId)) return [];
  const settings = settingsFor(db, userId);
  const windows: FocusWindow[] = [];
  const today = ymd(now);
  const days = [addDays(today, -1), today, addDays(today, 1)];

  if (isOn('manual-study-mode')) return [];
  if (settings.autoForClasses) {
    const meetings = db
      .select({ meeting: classMeetings, term: classes.term, code: sectionCode, auto: courseInfo.studyModeAuto })
      .from(classMeetings)
      .innerJoin(classes, eq(classMeetings.classId, classes.id))
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, userId)))
      // A left join keeps meetings even with no course_info row, giving null for that table's columns.
      .leftJoin(courseInfo, and(eq(courseInfo.classId, classes.id), eq(courseInfo.userId, userId)))
      .all();
    for (const { meeting: m, term, code, auto } of meetings) {
      if (auto === false && !isOn('one-study-setting')) continue;
      // Version A: only what you entered yourself.
      if (isOn('study-own-class-times') && m.userId !== userId) continue;
      const range = termRange(term);
      for (const day of days) {
        if (parseYmd(day).getDay() !== m.weekday || day < range.start || day > range.end || noClassesOn(day)) continue;
        windows.push({ start: atTime(day, m.startTime), end: atTime(day, m.endTime), reason: 'class', label: code });
      }
    }
  }

  if (settings.autoForSessions) {
    const sessions = db
      .select({ session: studySessions })
      .from(studySessions)
      .innerJoin(studySessionMembers, and(eq(studySessionMembers.sessionId, studySessions.id), eq(studySessionMembers.userId, userId)))
      .where(
        and(
          eq(studySessionMembers.status, 'going'),
          isNull(studySessions.cancelledAt),
          gte(studySessions.endsAt, parseYmd(days[0])),
          lt(studySessions.startsAt, parseYmd(addDays(today, 2))),
        ),
      )
      .all();
    for (const { session: s } of sessions) {
      windows.push({ start: s.startsAt, end: s.endsAt, reason: 'session', label: s.title });
    }
  }
  return windows;
}

// Combines the settings and the windows. studyModeStatus in
// shared/studyMode.ts decides whether it's on right now.
export function currentStudyMode(ctx: AuthedContext) {
  const settings = settingsFor(ctx.db, ctx.userId);
  const now = ctx.now();
  return {
    settings,
    status: studyModeStatus({
      windows: focusWindows(ctx.db, ctx.userId, now),
      manualUntil: settings.manualUntil,
      pausedUntil: settings.pausedUntil,
      now,
    }),
  };
}

// A session stopped or replaced ends now. One that already ran its course keeps its planned end.
function endFocus(ctx: AuthedContext) {
  ctx.db
    .update(focusLog)
    .set({ endedAt: ctx.now() })
    .where(and(eq(focusLog.userId, ctx.userId), isNull(focusLog.endedAt), gt(focusLog.plannedEnd, ctx.now())))
    .run();
}

function startFocus(ctx: AuthedContext, minutes: number, focusTaskId: number | null) {
  endFocus(ctx);
  const plannedEnd = new Date(ctx.now().getTime() + minutes * 60_000);
  saveSettings(ctx.db, ctx.userId, { manualUntil: plannedEnd, pausedUntil: null, focusTaskId });
  ctx.db.insert(focusLog).values({ userId: ctx.userId, startedAt: ctx.now(), plannedEnd }).run();
}

export const studyModeRouter = {
  // 'focus-leaderboard': this week's focus time for people who share a class with you.
  leaderboard: procedure(z.void(), (_input, ctx) => {
    const mine = ctx.db.select({ id: enrollments.classId }).from(enrollments).where(eq(enrollments.userId, ctx.userId));
    const people = ctx.db.selectDistinct({ id: users.id, name: users.name }).from(enrollments).innerJoin(users, eq(enrollments.userId, users.id)).where(and(inArray(enrollments.classId, mine), eq(users.role, 'student'))).all();
    return people
      .map((person) => ({ name: person.name, me: person.id === ctx.userId, thisWeek: focusSummary(ctx.db.select().from(focusLog).where(eq(focusLog.userId, person.id)).all(), ctx.now()).thisWeek }))
      .sort((a, b) => b.thisWeek - a.thisWeek)
      .slice(0, 10);
  }),

  focusTime: procedure(z.void(), (_input, ctx) =>
    focusSummary(ctx.db.select().from(focusLog).where(eq(focusLog.userId, ctx.userId)).all(), ctx.now()),
  ),

  status: procedure(z.void(), (_input, ctx) => {
    const { settings, status } = currentStudyMode(ctx);
    const { manualUntil: _m, pausedUntil: _p, userId: _u, focusTaskId, ...prefs } = settings;
    const task = focusTaskId == null ? undefined : ctx.db.select().from(plannerTasks).where(eq(plannerTasks.id, focusTaskId)).get();
    const focusing = status.reason === 'manual';
    return {
      ...status,
      settings: prefs,
      systemDndSupported: ctx.platform.systemDndSupported(),
      focusTask: focusing ? (task?.title ?? null) : null,
      // The session is over: did they finish it? Asked once, and not if they checked it off already.
      finishedTask: !focusing && task && !task.doneAt ? { id: task.id, title: task.title } : null,
    };
  }),

  updateSettings: procedure(
    z.object({
      autoForClasses: z.boolean(),
      autoForSessions: z.boolean(),
      silenceNotifications: z.boolean(),
      systemDnd: z.boolean(),
    }),
    (patch, ctx) => saveSettings(ctx.db, ctx.userId, patch),
  ),

  start: procedure(z.object({ minutes: z.number().int().min(5).max(8 * 60) }), ({ minutes }, ctx) => {
    startFocus(ctx, minutes, null);
  }),

  // ST1 + ST2: a focus session as long as the planned task is meant to take.
  focusOnTask: procedure(z.object({ taskId: idSchema }), ({ taskId }, ctx) => {
    ownTask(ctx.db, ctx.userId, taskId);
    const task = ctx.db.select({ minutes: plannerTasks.minutes }).from(plannerTasks).where(eq(plannerTasks.id, taskId)).get()!;
    startFocus(ctx, Math.min(8 * 60, task.minutes), taskId);
  }),

  clearFocusTask: procedure(z.void(), (_input, ctx) => {
    saveSettings(ctx.db, ctx.userId, { focusTaskId: null });
  }),

  // Ends a focus session, and pauses any class or study session window running right now.
  stop: procedure(z.void(), (_input, ctx) => {
    if (isOn('no-stopping-early') && settingsFor(ctx.db, ctx.userId).manualUntil && settingsFor(ctx.db, ctx.userId).manualUntil! > ctx.now()) throw new AppError(NO_STOPPING, 'FORBIDDEN');
    endFocus(ctx);
    saveSettings(ctx.db, ctx.userId, { manualUntil: null, pausedUntil: null });
    const { status } = currentStudyMode(ctx);
    if (status.active) saveSettings(ctx.db, ctx.userId, { pausedUntil: status.until });
  }),

  // Per-class choice: should this class's meetings switch study mode on?
  classes: procedure(z.void(), (_input, ctx) =>
    ctx.db
      .select({ classId: classes.id, code: sectionCode, term: classes.term, auto: courseInfo.studyModeAuto })
      .from(enrollments)
      .innerJoin(classes, eq(enrollments.classId, classes.id))
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .leftJoin(courseInfo, and(eq(courseInfo.classId, classes.id), eq(courseInfo.userId, ctx.userId)))
      .where(eq(enrollments.userId, ctx.userId))
      .orderBy(courses.subject, courses.number, classes.section)
      .all()
      .map((c) => ({ ...c, auto: c.auto ?? true })),
  ),

  setClassAuto: procedure(z.object({ classId: idSchema, enabled: z.boolean() }), ({ classId, enabled }, ctx) => {
    requireMember(ctx.db, ctx.userId, classId);
    ctx.db
      .insert(courseInfo)
      .values({ userId: ctx.userId, classId, studyModeAuto: enabled })
      .onConflictDoUpdate({ target: [courseInfo.userId, courseInfo.classId], set: { studyModeAuto: enabled } })
      .run();
  }),
};

// --- Background tick (run by the main process every 30 seconds) ------------------------

export interface TickState {
  userId: number | null;
  studyActive: boolean;
  dndOn: boolean;
}

export const initialTickState = (): TickState => ({ userId: null, studyActive: false, dndOn: false });

// The bridge runs this every 30 seconds. The tab's ctx has no userId
// of its own, so this reads ctx.session and builds an authed copy.
export async function backgroundTick(ctx: Context, state: TickState) {
  const userId = ctx.session.userId;
  if (userId !== state.userId) {
    // Signed out or switched accounts: undo anything done for the previous user.
    if (state.dndOn) await ctx.platform.setSystemDnd(false);
    Object.assign(state, initialTickState(), { userId });
  }
  if (userId == null) return;

  // Spreading builds the AuthedContext the services expect.
  const authed = { ...ctx, userId };
  sweepReminders(authed);

  const { settings, status } = currentStudyMode(authed);
  // Only a change sends a notification, not every tick.
  if (status.active !== state.studyActive) {
    state.studyActive = status.active;
    notify(ctx.db, userId, {
      type: 'study-mode',
      title: status.active
        ? m('Study mode on: {{label}}', { label: status.reason === 'manual' ? { t: 'Focus session' } : status.label! })
        : m('Study mode off'),
      body: status.active
        ? m(settings.silenceNotifications ? 'Until {{time}}. Notifications are held until it ends.' : 'Until {{time}}.', {
            time: { date: status.until!.getTime(), style: 'time' },
          })
        : m('Notifications are back on.'),
      link: '/study-mode',
    });
  }

  const wantDnd = status.active && settings.systemDnd;
  // setSystemDnd returns false where it isn't supported (always, in a browser), so dndOn stays false.
  if (wantDnd !== state.dndOn) state.dndOn = (await ctx.platform.setSystemDnd(wantDnd)) && wantDnd;

  // Shows whatever is new on the desktop, unless study mode is holding notifications back.
  for (const n of takeDesktopNotifications(authed, { silenced: status.active && settings.silenceNotifications })) {
    ctx.platform.showNotification(n);
  }
}
