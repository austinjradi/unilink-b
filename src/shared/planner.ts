import { addDays, eachDay } from './dates';

// ST2: spread an assignment's tasks over the days before its deadline.

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

  const movable = open.filter((t) => !isKept(t));
  let overloaded = false;
  let earliest = 0;
  movable.forEach((task, i) => {
    // Even spread: task i of k lands on day ⌊i·n/k⌋, never before the previous task.
    let index = Math.max(earliest, Math.floor((i * days.length) / movable.length));
    while (index < days.length && remaining.get(days[index])! < task.minutes) index++;

    if (index === days.length) {
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
  });

  return { dates, lastWorkDay, tight, overloaded };
}
