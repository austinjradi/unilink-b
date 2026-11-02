import { RECORD_GRADES } from './academics';

// A1: reads courses from a pasted Minerva unofficial transcript, or any list of
// "SUBJ 123 … credits grade" lines under term headings like "Fall 2025". The student
// reviews what it found before anything is added to their record.

export interface TranscriptCourse {
  code: string; // "COMP 250"
  title: string;
  credits: number;
  // The line had no credits, so the catalogue's (or 3) is used.
  creditsGuessed: boolean;
  grade: string | null;
  term: string; // "Fall 2025"
}

const TERM = /\b(Fall|Winter|Summer|Automne|Hiver|[ÉE]t[ée])\s+(\d{4})\b/i;
const SEASON: Record<string, string> = { fall: 'Fall', automne: 'Fall', winter: 'Winter', hiver: 'Winter', summer: 'Summer', été: 'Summer', ete: 'Summer' };
const COURSE = /\b([A-Z]{4})[\s-]?(\d{3}[A-Z0-9]*)\b/;
const GRADES = new Set(RECORD_GRADES);

export function parseTranscript(text: string): TranscriptCourse[] {
  const courses: TranscriptCourse[] = [];
  let term: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const course = line.match(COURSE);
    const heading = line.match(TERM);
    if (heading && !course) {
      term = `${SEASON[heading[1].toLowerCase()] ?? heading[1]} ${heading[2]}`;
      continue;
    }
    if (!course || !term) continue;

    // After the code: an optional section ("001"), the title, the credits, then the grade and
    // the class average, as on McGill transcripts ("Programming in C 3 A B+"). Some copies put
    // the grade before the credits, so that's used when there's none after.
    const tokens = line.slice((course.index ?? 0) + course[0].length).trim().split(/\s+/).filter(Boolean);
    const start = /^\d{3}$/.test(tokens[0] ?? '') ? 1 : 0;
    // Titles can hold numbers too ("Calculus 3 3 B+"), so the credits are the number right
    // before the grade, else one written like "3.00", else the last number.
    const numbers = tokens.map((tok, n) => n).filter((n) => n >= start && /^\d{1,2}(\.\d+)?$/.test(tokens[n]) && Number(tokens[n]) <= 12);
    const creditsAt =
      numbers.find((n) => GRADES.has(tokens[n + 1])) ?? numbers.find((n) => tokens[n].includes('.')) ?? numbers.at(-1) ?? -1;
    const titleEnd = creditsAt >= 0 ? creditsAt : tokens.length;
    const after = creditsAt >= 0 ? tokens.slice(creditsAt + 1).find((tok) => GRADES.has(tok)) : undefined;
    const before = !after && titleEnd > start + 1 && GRADES.has(tokens[titleEnd - 1]) ? tokens[titleEnd - 1] : undefined;
    const title = tokens.slice(start, before ? titleEnd - 1 : titleEnd);
    const grade = after ?? before ?? null;
    const credits = creditsAt >= 0 ? Number(tokens[creditsAt]) : null;

    courses.push({
      code: `${course[1]} ${course[2]}`,
      title: title.join(' '),
      credits: credits ?? 3,
      creditsGuessed: credits == null,
      grade,
      term,
    });
  }
  return courses;
}
