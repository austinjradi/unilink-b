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
