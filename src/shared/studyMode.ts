import { addDays, ymd } from './dates';

// ST1: is study mode on right now, and why?

export interface FocusWindow {
  start: Date;
  end: Date;
  reason: 'class' | 'session';
  label: string;
}

export interface StudyModeStatus {
  active: boolean;
  reason: 'manual' | 'class' | 'session' | null;
  label: string | null;
  until: Date | null;
  // An automatic window is running but the student switched study mode off for it.
  pausedWindow: FocusWindow | null;
  next: FocusWindow | null;
}

export function studyModeStatus({
  windows,
  manualUntil,
  pausedUntil,
  now,
}: {
  windows: FocusWindow[];
  manualUntil: Date | null;
  pausedUntil: Date | null;
  now: Date;
}): StudyModeStatus {
  const current = windows
    .filter((w) => w.start <= now && now < w.end)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const next =
    windows.filter((w) => w.start > now).sort((a, b) => a.start.getTime() - b.start.getTime())[0] ?? null;

  if (manualUntil && manualUntil > now) {
    return { active: true, reason: 'manual', label: 'Focus session', until: manualUntil, pausedWindow: null, next };
  }
  if (current && !(pausedUntil && pausedUntil > now)) {
    return { active: true, reason: current.reason, label: current.label, until: current.end, pausedWindow: null, next };
  }
  return { active: false, reason: null, label: null, until: null, pausedWindow: current ?? null, next };
}

export interface FocusEntry {
  startedAt: Date;
  plannedEnd: Date;
  endedAt: Date | null;
}

// ST1: time spent in focus sessions, with weeks starting on Monday. One that's still running counts
// up to now, and one stopped within a minute of starting doesn't count.
export function focusSummary(entries: FocusEntry[], now: Date) {
  const sessions = entries
    .map((e) => ({
      day: ymd(e.startedAt),
      minutes: Math.round((Math.min((e.endedAt ?? e.plannedEnd).getTime(), now.getTime()) - e.startedAt.getTime()) / 60_000),
    }))
    .filter((s) => s.minutes >= 1);
  const today = ymd(now);
  const monday = addDays(today, -((now.getDay() + 6) % 7));
  const between = (from: string, to: string) => sessions.filter((s) => s.day >= from && s.day < to);
  const total = (list: typeof sessions) => list.reduce((sum, s) => sum + s.minutes, 0);
  const thisWeek = between(monday, addDays(monday, 7));

  // Days in a row, up to today. Today not having one yet doesn't break it.
  const days = new Set(sessions.map((s) => s.day));
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return { thisWeek: total(thisWeek), sessions: thisWeek.length, lastWeek: total(between(addDays(monday, -7), monday)), streak };
}
