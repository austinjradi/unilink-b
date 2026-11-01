// S1.1 in version B: course codes can use wildcards, like the board's own example
// "COMP 2XX" (any 200-level COMP course). X, * and ? each stand for one digit.

export type CourseQuery =
  // `number` is a SQL LIKE pattern for the course number, e.g. "2__".
  | { kind: 'code'; subject: string | null; number: string }
  // Every word must appear in the title. A lone four-letter word may also be a subject ("COMP").
  | { kind: 'text'; words: string[]; subject: string | null };

const CODE = /^([a-z]{4})?\s*-?\s*([0-9x*?]{1,3})$/i;

export function parseCourseQuery(input: string): CourseQuery {
  const query = input.trim();
  const code = query.match(CODE);
  if (code && (code[1] || /\d/.test(code[2]))) {
    const number = code[2].toLowerCase().replace(/[x*?]/g, '_').padEnd(3, '_');
    return { kind: 'code', subject: code[1]?.toUpperCase() ?? null, number };
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return { kind: 'text', words, subject: words.length === 1 && /^[a-z]{4}$/.test(words[0]) ? words[0].toUpperCase() : null };
}

export const LEVELS = [100, 200, 300, 400, 500] as const;
