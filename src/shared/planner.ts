import { addDays, eachDay, parseYmd } from './dates';

// ST2 in version B: work is scheduled as early as possible, not spread evenly. Each task
// goes on the first day, from today, with enough free study time left, in order, so the
// plan finishes early and the days before the deadline stay free. "Free time" is set per
// weekday (e.g. 90 minutes on weekdays, 3 hours on weekends) rather than one daily number.

// Sunday first, like Date.getDay().
export const DEFAULT_WEEKLY_MINUTES = [180, 90, 90, 90, 90, 60, 180];
export const DEFAULT_BUFFER_DAYS = 2;

export function weeklyMinutes(saved: number[] | null | undefined): number[] {
  return saved?.length === 7 ? saved : DEFAULT_WEEKLY_MINUTES;
}

export const minutesOn = (weekly: number[], day: string) => weekly[parseYmd(day).getDay()] ?? 0;

// A starting point for the free time, Sunday first: four hours on a day with no classes, less
// the time spent in class, and at least an hour.
export function minutesAroundClasses(meetings: { weekday: number; startTime: string; endTime: string }[]): number[] {
  const clock = (time: string) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };
  return Array.from({ length: 7 }, (_, weekday) => {
    const inClass = meetings.filter((m) => m.weekday === weekday).reduce((sum, m) => sum + clock(m.endTime) - clock(m.startTime), 0);
    return Math.max(60, Math.round((240 - inClass) / 15) * 15);
  });
}

export interface PlannableTask {
  id: number;
  minutes: number;
  scheduledFor: string;
  pinned: boolean;
  done: boolean;
}

export interface PlanInput {
  tasks: PlannableTask[]; // in the order they should be done
  today: string;
  dueDate: string;
  // Days kept free right before the deadline (1 = finish the day before it's due).
  bufferDays: number;
  // Study minutes still free on a day, before this assignment's tasks.
  capacity: (day: string) => number;
}

export interface PlanResult {
  dates: Map<number, string>;
  lastWorkDay: string;
  // The buffer had to be shortened or skipped to fit the work in.
  tight: boolean;
  // Some day ends up with more work than the student's free time.
  overloaded: boolean;
}

export function planTasks({ tasks, today, dueDate, bufferDays, capacity }: PlanInput): PlanResult {
  let lastWorkDay = addDays(dueDate, -bufferDays);
  let tight = false;
  if (lastWorkDay < today) {
    lastWorkDay = dueDate < today ? today : dueDate;
    tight = bufferDays > 0 || dueDate < today;
  }

  const days = eachDay(today, lastWorkDay);
  const remaining = new Map(days.map((d) => [d, capacity(d)]));
  const dates = new Map<number, string>();

  // Tasks the student placed by hand stay put (unless that day has passed).
  const open = tasks.filter((t) => !t.done);
  const isKept = (t: PlannableTask) => t.pinned && t.scheduledFor >= today;
  for (const task of open.filter(isKept)) {
    dates.set(task.id, task.scheduledFor);
    const left = remaining.get(task.scheduledFor);
    if (left != null) remaining.set(task.scheduledFor, left - task.minutes);
  }

  let overloaded = false;
  let earliest = 0;
  for (const task of open.filter((t) => !isKept(t))) {
    // First day with room, never before the previous task.
    let index = earliest;
    while (index < days.length && remaining.get(days[index])! < task.minutes) index++;

    if (index === days.length) {
      // Nowhere has room: use the roomiest remaining day.
      overloaded = true;
      index = earliest;
      for (let j = earliest; j < days.length; j++) {
        if (remaining.get(days[j])! > remaining.get(days[index])!) index = j;
      }
    }

    const day = days[index];
    dates.set(task.id, day);
    remaining.set(day, remaining.get(day)! - task.minutes);
    earliest = index;
  }

  return { dates, lastWorkDay, tight, overloaded };
}
