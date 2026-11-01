import { and, eq, gte, isNull, lt } from 'drizzle-orm';
import { z } from 'zod';
import { addDays, atTime, parseYmd, termRange, ymd } from '@shared/dates';
import { type FocusWindow, studyModeStatus } from '@shared/studyMode';
import type { DB } from '../db/client';
import {
  classes,
  classMeetings,
  courseInfo,
  courses,
  enrollments,
  studyModeSettings,
  studySessionMembers,
  studySessions,
} from '../db/schema';
import { type AuthedContext, type Context, idSchema, procedure } from '../rpc/core';
import { requireMember, sectionCode } from './access';
import { m, notify, sweepReminders, takeDesktopNotifications } from './notifications';

// ST1: study mode switches on during class times and study sessions (or by hand),
// holds back notifications while it's on, and can turn on GNOME's Do Not Disturb.
// Blocking websites isn't possible from here; see README.

const DEFAULTS = {
  autoForClasses: true,
  autoForSessions: true,
  silenceNotifications: true,
  systemDnd: false,
  manualUntil: null as Date | null,
  pausedUntil: null as Date | null,
};

function settingsFor(db: DB, userId: number) {
  return db.select().from(studyModeSettings).where(eq(studyModeSettings.userId, userId)).get() ?? { userId, ...DEFAULTS };
}

function saveSettings(db: DB, userId: number, patch: Partial<typeof DEFAULTS>) {
  db.insert(studyModeSettings)
    .values({ userId, ...DEFAULTS, ...patch })
    .onConflictDoUpdate({ target: studyModeSettings.userId, set: patch })
    .run();
}

// Class times and study sessions from yesterday through tomorrow.
function focusWindows(db: DB, userId: number, now: Date): FocusWindow[] {
  const settings = settingsFor(db, userId);
  const windows: FocusWindow[] = [];
  const today = ymd(now);
  const days = [addDays(today, -1), today, addDays(today, 1)];

  if (settings.autoForClasses) {
    const meetings = db
      .select({ meeting: classMeetings, term: classes.term, code: sectionCode, auto: courseInfo.studyModeAuto })
      .from(classMeetings)
      .innerJoin(classes, eq(classMeetings.classId, classes.id))
      .innerJoin(courses, eq(classes.courseId, courses.id))
      .innerJoin(enrollments, and(eq(enrollments.classId, classes.id), eq(enrollments.userId, userId)))
      .leftJoin(courseInfo, and(eq(courseInfo.classId, classes.id), eq(courseInfo.userId, userId)))
      .all();
    for (const { meeting: m, term, code, auto } of meetings) {
      if (auto === false) continue;
      const range = termRange(term);
      for (const day of days) {
        if (parseYmd(day).getDay() !== m.weekday || day < range.start || day > range.end) continue;
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

export const studyModeRouter = {
  status: procedure(z.void(), (_input, ctx) => {
    const { settings, status } = currentStudyMode(ctx);
    const { manualUntil: _m, pausedUntil: _p, userId: _u, ...prefs } = settings;
    return { ...status, settings: prefs, systemDndSupported: ctx.platform.systemDndSupported() };
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
    saveSettings(ctx.db, ctx.userId, { manualUntil: new Date(ctx.now().getTime() + minutes * 60_000), pausedUntil: null });
  }),

  // Ends a focus session, and pauses any class or study session window running right now.
  stop: procedure(z.void(), (_input, ctx) => {
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

export async function backgroundTick(ctx: Context, state: TickState) {
  const userId = ctx.session.userId;
  if (userId !== state.userId) {
    // Signed out or switched accounts: undo anything done for the previous user.
    if (state.dndOn) await ctx.platform.setSystemDnd(false);
    Object.assign(state, initialTickState(), { userId });
  }
  if (userId == null) return;

  const authed = { ...ctx, userId };
  sweepReminders(authed);

  const { settings, status } = currentStudyMode(authed);
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
  if (wantDnd !== state.dndOn) state.dndOn = (await ctx.platform.setSystemDnd(wantDnd)) && wantDnd;

  for (const n of takeDesktopNotifications(authed, { silenced: status.active && settings.silenceNotifications })) {
    ctx.platform.showNotification(n);
  }
}
