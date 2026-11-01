// Calendar days are handled as local "YYYY-MM-DD" strings so they compare and
// sort lexically and never drift across time zones.

const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseYmd(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const date = parseYmd(day);
  date.setDate(date.getDate() + n);
  return ymd(date);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseYmd(to).getTime() - parseYmd(from).getTime()) / 86_400_000);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to && days.length < 1000; d = addDays(d, 1)) days.push(d);
  return days;
}

export function atTime(day: string, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const date = parseYmd(day);
  date.setHours(h, m, 0, 0);
  return date;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "23:59" and "Tue 3 Nov, 23:59", for notification text written in the main process.
export const fmtClock = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function fmtWhen(date: Date): string {
  return `${WEEKDAYS[date.getDay()].slice(0, 3)} ${date.getDate()} ${SHORT_MONTHS[date.getMonth()]}, ${fmtClock(date)}`;
}

export const WEEKDAYS =['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const TERMS = ['Fall 2026', 'Winter 2027'] as const;
export const CURRENT_TERM = TERMS[0];

// Approximate McGill teaching periods, used to bound recurring class times.
export function termRange(term: string): { start: string; end: string } {
  const [season, yearText] = term.split(' ');
  const year = Number(yearText);
  switch (season) {
    case 'Winter':
      return { start: `${year}-01-06`, end: `${year}-04-14` };
    case 'Summer':
      return { start: `${year}-05-04`, end: `${year}-08-14` };
    default:
      return { start: `${year}-09-01`, end: `${year}-12-03` };
  }
}
