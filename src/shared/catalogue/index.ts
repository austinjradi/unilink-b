import { TERMS } from '../dates';
import type { GroupRule, Program, RequirementGroup } from '../degree';
import type { PrereqData } from '../prereqs';

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
  // Limits read from the part's text: "at most 6 credits at the 200 level".
  rules?: GroupRule[];
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
export const loadSubjects = () => import('./data/subjects.json').then((m) => m.default as unknown as Record<string, string>);
export const loadOfferings = () => import('./data/offerings.json').then((m) => m.default as unknown as Record<string, string>);
export const loadPrereqs = () => import('./data/prereqs.json').then((m) => m.default as unknown as PrereqData);
export const loadContents = () => import('./data/contents.json').then((m) => m.default as unknown as ContentsEntry[]);

// "COMP 361D1" -> subject, number and the level its first digit gives.
export function courseParts(code: string) {
  const [subject, number = ''] = code.split(' ');
  return { subject, number, level: Number(number[0]) * 100 };
}

// When a course runs. Only Fall sections on the December exam schedule are McGill's own word;
// all the rest is worked out by scripts/catalogue/infer.py, and `why` says from what.
export type OfferingWhy = 'schedule' | 'two-term' | 'program' | 'title' | 'no-final' | 'not-in-december' | 'sample';

export interface Offering {
  terms: string[];
  why: OfferingWhy;
  // Its sections on the December schedule.
  scheduled: string[];
}

const [FALL, WINTER] = TERMS;

// "B|schedule|001,002" -> both terms, from the schedule, with these sections.
export function parseOffering(raw: string | undefined): Offering | null {
  if (!raw) return null;
  const [terms, why, sections] = raw.split('|');
  return {
    terms: terms === 'B' ? [FALL, WINTER] : [terms === 'F' ? FALL : WINTER],
    why: why as OfferingWhy,
    scheduled: sections ? sections.split(',') : [],
  };
}

const guessSections = (number: string, count = number.startsWith('1') ? 2 : 1) => Array.from({ length: count }, (_, i) => `00${i + 1}`);

// The sections a course gets in a term: the schedule's in Fall, as many again in Winter, or a guess from its level.
export function sectionsIn(number: string, offering: Offering | null, term: string): string[] {
  const scheduled = offering?.scheduled ?? [];
  if (term === FALL && scheduled.length) return scheduled;
  return scheduled.length > 1 ? guessSections(number, scheduled.length) : guessSections(number);
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

// The catalogue's requirements in the shape the degree check (A2) understands. Rules like "at least
// 3 credits from each group" are read from the program's text by scripts/catalogue/infer.py, so the
// check is a guide: the program's own page and an adviser have the last word.
export function toDegreeProgram(program: CatalogueProgram, creditsOf: (code: string) => number = () => 3): Program {
  const groups: RequirementGroup[] = [];
  const creditsIn = (codes: string[]) => sum([...new Set(codes)].map((code) => creditsOf(code)));
  // A pool over lists that have their own minimums, and the credits those take from it.
  const overLists = new Map<RequirementGroup, number>();
  program.parts.forEach((part, partIndex) => {
    const firstGroup = groups.length;
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
    const ownCredits = sum(own.map((r) => r.credits!));
    const left = part.credits ? part.credits[0] - ownCredits : 0;
    if (!courses.length) {
      // "3-9 credits from A" and "3-9 credits from B" in a 15-credit part: the 9 above their minimums come from either.
      if (left > 0 && own.length) {
        push(`${part.title}: any list`, 'choose', own.flatMap((r) => r.list.courses), left);
        overLists.set(groups.at(-1)!, ownCredits);
      }
    } else if (part.kind === 'required' && !part.lists.some((l) => l.rule)) {
      push(part.title, 'required', courses);
    } else if (part.credits) {
      push(part.title, 'choose', courses, Math.max(left, 0));
    } else {
      // A heading without credits belongs to the pool before it ("Group C" under "24 credits from...").
      const last = groups.at(-1);
      if (last?.kind === 'choose') last.courses = [...new Set([...last.courses, ...courses])];
      else push(part.title, 'required', courses);
    }
    // Each rule goes with the part's group that has most of its courses.
    const ownGroups = groups.slice(firstGroup).length ? groups.slice(firstGroup) : groups.slice(-1);
    for (const rule of part.rules ?? []) {
      const overlap = (g: RequirementGroup) => (rule.courses ?? []).filter((c) => g.courses.includes(c)).length + (g.kind === 'choose' ? 0.5 : 0);
      const home = [...ownGroups].sort((a, b) => overlap(b) - overlap(a))[0];
      if (home) home.rules = [...(home.rules ?? []), rule];
    }
  });
  // Some programs ask for more than their tables name ("the rest from COMP courses at the 300 level").
  // Those courses can't be checked here, so they don't hold the plan back; they still count toward the total.
  const addNote = (group: RequirementGroup | undefined, credits: number) => {
    if (group) group.rules = [...(group.rules ?? []), { text: `${credits} credits partly from courses this list doesn't name. See the program's page.` }];
  };
  for (const group of [...groups]) {
    const needed = group.credits ?? 0;
    if (group.kind !== 'choose' || !needed || creditsIn(group.courses) - (overLists.get(group) ?? 0) >= needed) continue;
    const index = groups.indexOf(group);
    if (overLists.has(group) && index > 0) {
      groups.splice(index, 1);
      const before = groups[index - 1];
      before.rules = [...(before.rules ?? []), ...(group.rules ?? [])];
      addNote(before, needed);
    } else {
      group.credits = 0;
      addNote(group, needed);
    }
  }
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
