// Weekly class times (A3), as a section's classmates entered them. Used to warn about
// sections whose times clash with classes a student is already in (S1).

export interface MeetingTime {
  weekday: number; // 0 = Sunday … 6 = Saturday
  startTime: string; // "HH:mm"
  endTime: string;
}

export const overlaps = (a: MeetingTime, b: MeetingTime) => a.weekday === b.weekday && a.startTime < b.endTime && b.startTime < a.endTime;

export const clashes = (a: MeetingTime[], b: MeetingTime[]) => a.some((x) => b.some((y) => overlaps(x, y)));

// Days that share a time go together: [[1, 3], "10:05", "11:25"] for Monday and Wednesday.
export function groupMeetings(meetings: MeetingTime[]) {
  const groups: { weekdays: number[]; startTime: string; endTime: string }[] = [];
  const order = (d: number) => (d + 6) % 7; // Monday first
  for (const m of [...meetings].sort((a, b) => order(a.weekday) - order(b.weekday) || a.startTime.localeCompare(b.startTime))) {
    const group = groups.find((g) => g.startTime === m.startTime && g.endTime === m.endTime);
    if (group) {
      if (!group.weekdays.includes(m.weekday)) group.weekdays.push(m.weekday);
    } else groups.push({ weekdays: [m.weekday], startTime: m.startTime, endTime: m.endTime });
  }
  return groups;
}

// 'office-hours-on-calendar': the first day and time in free text, like "Tue 14:00–15:30, McConnell 324".
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function parseOfficeHours(text: string): MeetingTime | null {
  const match = text.toLowerCase().match(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s+(\d{1,2}:\d{2})\s*[–—-]\s*(\d{1,2}:\d{2})/);
  if (!match) return null;
  return { weekday: DAYS.indexOf(match[1]), startTime: match[2].padStart(5, '0'), endTime: match[3].padStart(5, '0') };
}

