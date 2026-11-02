import { MCGILL_SCALE } from './grades';

// A1: course record, GPA and credits.

export const RECORD_STATUSES = ['completed', 'in-progress', 'planned'] as const;
export type RecordStatus = (typeof RECORD_STATUSES)[number];

// McGill letter grades plus the common non-GPA ones.
export const OTHER_GRADES = {
  P: 'Pass',
  S: 'Satisfactory',
  U: 'Unsatisfactory',
  W: 'Withdrew',
  J: 'Unexcused absence (failed)',
} as const;
export const RECORD_GRADES = [...MCGILL_SCALE.map((g) => g.letter), ...Object.keys(OTHER_GRADES)] as string[];

const gpaOf = new Map<string, number>([...MCGILL_SCALE.map((g) => [g.letter, g.gpa] as const), ['J', 0]]);

// Grade points, or null for grades that don't count in the GPA (P, S, U, W).
export function gradePoints(grade: string | null): number | null {
  return grade == null ? null : (gpaOf.get(grade) ?? null);
}

// Whether a completed course earns its credits.
export function earnsCredits(grade: string | null): boolean {
  return grade != null && !['F', 'J', 'U', 'W'].includes(grade);
}

const SEASONS = ['Winter', 'Summer', 'Fall'];

// Sort key: Winter < Summer < Fall within a year.
export function termOrder(term: string): number {
  const [season, year] = term.split(' ');
  return Number(year) * 3 + Math.max(0, SEASONS.indexOf(season));
}

export function termOptions(fromYear: number, toYear: number): string[] {
  const terms: string[] = [];
  for (let y = fromYear; y <= toYear; y++) for (const s of SEASONS) terms.push(`${s} ${y}`);
  return terms;
}

export interface RecordLike {
  credits: number;
  term: string;
  status: RecordStatus;
  grade: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function gpa(records: RecordLike[]): { gpa: number | null; credits: number } {
  let points = 0;
  let credits = 0;
  for (const r of records) {
    const p = r.status === 'completed' ? gradePoints(r.grade) : null;
    if (p == null) continue;
    points += p * r.credits;
    credits += r.credits;
  }
  return { gpa: credits ? round2(points / credits) : null, credits };
}

export function summarizeRecord(records: RecordLike[]) {
  const sum = (rs: RecordLike[]) => rs.reduce((n, r) => n + r.credits, 0);
  const terms = [...new Set(records.map((r) => r.term))].sort((a, b) => termOrder(a) - termOrder(b));
  const overall = gpa(records);
  return {
    cgpa: overall.gpa,
    // Credits that count in the CGPA.
    cgpaCredits: overall.credits,
    creditsEarned: sum(records.filter((r) => r.status === 'completed' && earnsCredits(r.grade))),
    creditsInProgress: sum(records.filter((r) => r.status === 'in-progress')),
    creditsPlanned: sum(records.filter((r) => r.status === 'planned')),
    terms: terms.map((term) => {
      const inTerm = records.filter((r) => r.term === term);
      return { term, ...gpa(inTerm), totalCredits: sum(inTerm) };
    }),
  };
}
