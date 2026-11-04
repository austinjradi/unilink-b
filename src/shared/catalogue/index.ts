import type { Program, RequirementGroup } from '../degree';

// The McGill Course Catalogue 2026–2027, imported by scripts/catalogue. Facts come straight from it;
// `points` are short summaries in our own words, and `page` is where to read the original.
// It's big, so each part loads when first needed and then stays in memory.

export type ProgramKind =
  | 'Major' | 'Minor' | 'Honours' | 'Joint Honours' | 'Concentration' | 'Foundation' | 'Faculty Program'
  | 'Liberal Program' | 'Specialization' | 'Certificate' | 'Diploma' | 'Degree';

export interface CourseList {
  label: string | null;
  // The catalogue's own line above the list, like "3 credits from:".
  rule: string | null;
  page: number;
  courses: string[];
}

export interface ProgramPart {
  title: string;
  credits: [number, number] | null;
  kind: 'required' | 'choose';
  lists: CourseList[];
}

export interface ProgramListing {
  id: string;
  name: string;
  kind: ProgramKind;
  part: string;
  faculty: string | null;
  unit: string | null;
  credits: number | null;
  page: number;
}

export interface CatalogueProgram extends Omit<ProgramListing, 'part'> {
  degrees: string[];
  parts: ProgramPart[];
  // Keys of the guide sections that describe this program.
  prose: string[];
}

export type CourseRow = [code: string, title: string, credits: number | null];

export interface SectionFacts {
  dates?: string[];
  money?: string[];
  phones?: string[];
  emails?: string[];
  links?: string[];
  percents?: string[];
}

export interface GuideSection {
  key: string;
  title: string;
  level: number;
  page: number;
  part: string;
  program?: string;
  points?: string[];
  facts?: SectionFacts;
  courses?: string[];
  // Where the catalogue points to next: "Computer Science Major (p. 1170)".
  refs?: { label: string; page?: number }[];
}

export interface Contact {
  where: string;
  unit: string | null;
  section: string;
  page: number;
  address: string[];
  phones: string[];
  emails: string[];
  links: string[];
}

export interface Award {
  name: string;
  kind: string;
  value: string | null;
  faculty: string;
  page: number;
  key: string;
}

export interface CatalogueIndex {
  parts: { title: string; page: number }[];
  programs: ProgramListing[];
  guide: { key: string; title: string; part: string; page: number }[];
}

export interface ContentsEntry {
  depth: number;
  title: string;
  page: number;
}

export const loadIndex = () => import('./data/index.json').then((m) => m.default as unknown as CatalogueIndex);
export const loadCourses = () => import('./data/courses.json').then((m) => m.default as unknown as CourseRow[]);
export const loadPrograms = () => import('./data/programs.json').then((m) => m.default as unknown as CatalogueProgram[]);
export const loadGuide = () => import('./data/guide.json').then((m) => m.default as unknown as GuideSection[]);
export const loadContacts = () => import('./data/contacts.json').then((m) => m.default as unknown as Contact[]);
export const loadAwards = () => import('./data/awards.json').then((m) => m.default as unknown as Award[]);
export const loadContents = () => import('./data/contents.json').then((m) => m.default as unknown as ContentsEntry[]);

// "COMP 361D1" -> subject, number and the level its first digit gives.
export function courseParts(code: string) {
  const [subject, number = ''] = code.split(' ');
  return { subject, number, level: Number(number[0]) * 100 };
}

// The degree's short form, from the end of the program's name: "... Major (B.Sc.)" -> "B.Sc."
export function degreeLabel(name: string, degrees: string[] = []) {
  const found = name.match(/\(([^()]*(?:\([^()]*\))?[^()]*)\)\s*$/);
  return found?.[1] ?? degrees[0] ?? '';
}

function ruleCredits(rule: string | null, oneCourse: number) {
  if (!rule) return null;
  const range = rule.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?\s*(?:credits?|crédits?)/i);
  if (range) return Number(range[1]);
  return /\bone of\b|^or\b/i.test(rule) ? oneCourse : null;
}

const sum = (values: number[]) => values.reduce((total, n) => total + n, 0);

// The catalogue's requirements in the shape the degree check (A2) understands. Rules it can't
// express, like "at least 3 credits from each group", count as one pool of the part's credits,
// so the check is a guide: the program's own page and an adviser have the last word.
export function toDegreeProgram(program: CatalogueProgram, creditsOf: (code: string) => number = () => 3): Program {
  const groups: RequirementGroup[] = [];
  program.parts.forEach((part, partIndex) => {
    const push = (name: string, kind: RequirementGroup['kind'], courses: string[], credits?: number) => {
      if (courses.length) groups.push({ id: `${partIndex}-${groups.length}`, name, kind, courses: [...new Set(courses)], ...(credits === undefined ? {} : { credits }) });
    };
    const ruled = part.lists.map((list) => ({ list, credits: ruleCredits(list.rule, creditsOf(list.courses[0])) }));
    const own = ruled.filter((r) => r.credits !== null);
    const rest = ruled.filter((r) => r.credits === null);
    for (const { list, credits } of own) {
      if (credits! > 0) push(list.label ? `${part.title}: ${list.label}` : part.title, 'choose', list.courses, credits!);
    }
    const courses = rest.flatMap((r) => r.list.courses);
    if (!courses.length) return;
    if (part.kind === 'required' && !part.lists.some((l) => l.rule)) {
      push(part.title, 'required', courses);
    } else if (part.credits) {
      push(part.title, 'choose', courses, Math.max(part.credits[0] - sum(own.map((r) => r.credits!)), 0));
    } else {
      // A heading without credits belongs to the pool before it ("Group C" under "24 credits from...").
      const last = groups.at(-1);
      if (last?.kind === 'choose') last.courses = [...new Set([...last.courses, ...courses])];
      else push(part.title, 'required', courses);
    }
  });
  const required = sum(groups.map((g) => (g.kind === 'choose' ? (g.credits ?? 0) : sum(g.courses.map(creditsOf)))));
  return {
    id: program.id,
    name: program.name,
    degree: degreeLabel(program.name, program.degrees),
    totalCredits: program.credits ?? required,
    minProgramGrade: 'C',
    groups,
  };
}

export interface MonthDay {
  month: number;
  day: number | null;
  year: number | null;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function parseCatalogueDate(text: string): MonthDay | null {
  const m = text.match(/^([A-Z][a-z]+)\s+(\d{1,4})(?:,\s*(\d{4}))?$/);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  const n = Number(m[2]);
  return n > 31 ? { month, day: null, year: n } : { month, day: n, year: m[3] ? Number(m[3]) : null };
}

// Dates in the catalogue's academic year order: August 2026 to July 2027, others after.
export function dateOrder(date: MonthDay) {
  const year = date.year ?? (date.month >= 7 ? 2026 : 2027);
  return year * 10000 + (date.month + 1) * 100 + (date.day ?? 0);
}
