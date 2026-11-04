// S1.1 in version B: course codes can use wildcards, like the board's own example
// "COMP 2XX" (any 200-level COMP course). X, * and ? each stand for one digit.

export type CourseQuery =
  // `number` is a SQL LIKE pattern for the course number, e.g. "2__".
  | { kind: 'code'; subject: string | null; number: string }
  // Every word must appear in the title. A lone four-letter word may also be a subject ("COMP").
  | { kind: 'text'; words: string[]; subject: string | null };

// A subject can end in a digit (NUR1), and a number can carry a term suffix (361D1).
const CODE = /^([a-z]{3}[a-z0-9])?\s*-?\s*([0-9x*?]{1,3}(?:[a-z]\d?){0,2})$/i;

export function parseCourseQuery(input: string): CourseQuery {
  const query = input.trim();
  const code = query.match(CODE);
  if (code && (code[1] || /\d/.test(code[2]))) {
    const number = code[2].toLowerCase().replace(/[x*?]/g, '_').padEnd(3, '_');
    return { kind: 'code', subject: code[1]?.toUpperCase() ?? null, number };
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return { kind: 'text', words, subject: words.length === 1 && /^[a-z]{3}[a-z0-9]$/.test(words[0]) ? words[0].toUpperCase() : null };
}

// The search's own rule, for catalogue courses that aren't in the database yet.
export function courseMatches(query: CourseQuery, subject: string, number: string, title: string) {
  if (query.kind === 'code') {
    if (query.subject && query.subject !== subject) return false;
    return new RegExp(`^${query.number.replace(/_/g, '.')}`, 'i').test(number);
  }
  if (!query.words.length) return true;
  const lower = title.toLowerCase();
  return query.subject === subject || query.words.every((word) => lower.includes(word));
}

export const LEVELS = [100, 200, 300, 400, 500] as const;

export interface ScheduleEntry {
  subject: string;
  number: string;
  // null when the text gives no section.
  section: string | null;
}

// Sections in a schedule pasted from Minerva: "COMP 251 001", "MATH-240-002", or just "ECSE 202".
// Subjects are matched in capitals only, so "room 101" isn't a course. Each course counts once.
export function parseSchedule(text: string): ScheduleEntry[] {
  const found = new Map<string, ScheduleEntry>();
  for (const m of text.matchAll(/\b([A-Z]{3}[A-Z0-9])[ -]?(\d{3}(?:[A-Z]\d?)*)\b(?:[ \t-]+(?:[Ss]ec(?:tion)?\.?[ \t]*)?(\d{3})\b)?/g)) {
    const key = `${m[1]} ${m[2]}`;
    const known = found.get(key);
    if (!known || (!known.section && m[3])) found.set(key, { subject: m[1], number: m[2], section: m[3] ?? null });
  }
  return [...found.values()];
}
