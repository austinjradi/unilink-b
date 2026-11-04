import schedule from './catalogue/data/exams.json';

// A3: the term's key dates and the final exam schedule. Like the course catalogue (G2),
// these are built in until there's an import from McGill.
//
// Key dates follow McGill's published 2026–2027 dates (mcgill.ca/importantdates); the
// Winter course-change and withdrawal deadlines weren't out yet, so they're marked
// approximate. Fall exams are McGill's December 2026 schedule, in catalogue/data/exams.json.
// April's isn't out, so Winter exams are estimates, each marked as one.

// Breaks and holidays have no classes; weekly class times skip them.
export type KeyDateType = 'deadline' | 'milestone' | 'break' | 'holiday';

export interface KeyDate {
  term: string;
  type: KeyDateType;
  // English text; it's also the translation key.
  title: string;
  date: string; // "YYYY-MM-DD"
  end?: string; // last day, for breaks and periods
  approximate?: boolean;
}

export const KEY_DATES: KeyDate[] = [
  { term: 'Fall 2026', type: 'milestone', title: 'Classes start', date: '2026-08-31' },
  { term: 'Fall 2026', type: 'holiday', title: 'Labour Day, no classes', date: '2026-09-07' },
  { term: 'Fall 2026', type: 'deadline', title: 'Course add/drop deadline', date: '2026-09-15' },
  { term: 'Fall 2026', type: 'deadline', title: 'Last day to withdraw with a refund', date: '2026-09-22' },
  { term: 'Fall 2026', type: 'break', title: 'Fall reading break', date: '2026-10-09', end: '2026-10-14' },
  { term: 'Fall 2026', type: 'deadline', title: 'Last day to withdraw (W, no refund)', date: '2026-10-27' },
  { term: 'Fall 2026', type: 'milestone', title: 'Last day of classes', date: '2026-12-04' },
  { term: 'Fall 2026', type: 'break', title: 'Final exams', date: '2026-12-07', end: '2026-12-22' },
  { term: 'Fall 2026', type: 'break', title: 'University closed for the holidays', date: '2026-12-24', end: '2027-01-01' },
  { term: 'Winter 2027', type: 'milestone', title: 'Classes start', date: '2027-01-05' },
  { term: 'Winter 2027', type: 'deadline', title: 'Course add/drop deadline', date: '2027-01-19', approximate: true },
  { term: 'Winter 2027', type: 'deadline', title: 'Last day to withdraw with a refund', date: '2027-01-26', approximate: true },
  { term: 'Winter 2027', type: 'break', title: 'Winter reading break', date: '2027-03-01', end: '2027-03-05' },
  { term: 'Winter 2027', type: 'deadline', title: 'Last day to withdraw (W, no refund)', date: '2027-03-09', approximate: true },
  { term: 'Winter 2027', type: 'holiday', title: 'Good Friday, no classes', date: '2027-03-26' },
  { term: 'Winter 2027', type: 'holiday', title: 'Easter Monday, no classes', date: '2027-03-29' },
  { term: 'Winter 2027', type: 'milestone', title: 'Last day of classes', date: '2027-04-14' },
  { term: 'Winter 2027', type: 'break', title: 'Final exams', date: '2027-04-16', end: '2027-04-30' },
];

export const keyDatesFor = (term: string) => KEY_DATES.filter((d) => d.term === term);

// The break or holiday that cancels classes on `day` ("YYYY-MM-DD"), if any.
export const noClassesOn = (day: string) =>
  KEY_DATES.find((d) => (d.type === 'break' || d.type === 'holiday') && d.date <= day && day <= (d.end ?? d.date)) ?? null;

// First and last day of classes, when the key dates have them.
export function teachingPeriod(term: string): { start: string; end: string } | null {
  const dates = keyDatesFor(term);
  const start = dates.find((d) => d.title === 'Classes start')?.date;
  const end = dates.find((d) => d.title === 'Last day of classes')?.date;
  return start && end ? { start, end } : null;
}

// The whole term including its exam period, for the semester-at-a-glance view.
export function termWithExams(term: string): { start: string; end: string } | null {
  const period = teachingPeriod(term);
  const exams = keyDatesFor(term).find((d) => d.title === 'Final exams');
  return period ? { start: period.start, end: exams?.end ?? period.end } : null;
}

export interface FinalExam {
  course: string; // "COMP 251"
  term: string;
  date: string;
  start: string; // "HH:mm"
  end: string;
  endDate?: string; // for an exam that runs over several days, like a take-home
  location: string;
  section?: string; // "001", or "001L" for its lab exam
  estimated?: boolean; // not from McGill's schedule
}

// Three sittings a day, as in McGill's exam timetables.
const MORNING = ['09:00', '12:00'] as const;
const AFTERNOON = ['14:00', '17:00'] as const;
const EVENING = ['18:30', '21:30'] as const;

const NOT_ON_SCHEDULE = 'Estimated: not on the December schedule';
const NOT_POSTED = 'Estimated: April schedule not posted';

// The demo's courses that aren't on the December schedule. Its people are in them, so they keep a date.
const estimate = (course: string, date: string, [start, end]: readonly [string, string]): FinalExam => ({
  course,
  term: 'Fall 2026',
  date,
  start,
  end,
  location: NOT_ON_SCHEDULE,
  estimated: true,
});

// Rows are [course, section, kind, start date, start time, end date, end time].
const onSchedule: FinalExam[] = (schedule.rows as [string, string, number, string, string, string, string][]).map(([course, section, kind, date, start, endDate, end]) => ({
  course,
  term: 'Fall 2026',
  date,
  start,
  end,
  ...(endDate === date ? {} : { endDate }),
  location: schedule.kinds[kind],
  section,
}));

// Every Fall 2026 final.
export const FINAL_EXAMS: FinalExam[] = [
  ...onSchedule,
  estimate('BIOL 112', '2026-12-16', AFTERNOON),
  estimate('CHEM 120', '2026-12-18', MORNING),
  estimate('COMP 202', '2026-12-11', AFTERNOON),
  estimate('COMP 251', '2026-12-14', AFTERNOON),
  estimate('COMP 421', '2026-12-10', AFTERNOON),
  estimate('ECSE 202', '2026-12-12', MORNING),
  estimate('PHYS 142', '2026-12-08', EVENING),
];

const fallExams = new Map<string, FinalExam[]>();
for (const exam of FINAL_EXAMS) fallExams.set(exam.course, [...(fallExams.get(exam.course) ?? []), exam]);
const noFinal = new Set(schedule.noFinal);

// The April exam period without its Sundays, and a sitting picked from the code. McGill's schedule
// will differ; this is so a Winter course has something to plan around until it's out.
const APRIL_DAYS = Array.from({ length: 15 }, (_, i) => `2027-04-${16 + i}`).filter((d) => new Date(`${d}T12:00`).getDay() !== 0);
const SITTINGS = [MORNING, AFTERNOON, EVENING];

function aprilExam(course: string): FinalExam | null {
  const level = Number(course.split(' ')[1]?.[0]);
  if (noFinal.has(course) || (level >= 5 && !fallExams.has(course))) return null;
  const hash = [...course].reduce((sum, letter) => (sum * 31 + letter.charCodeAt(0)) % 9973, 7);
  const [start, end] = SITTINGS[hash % SITTINGS.length];
  return { course, term: 'Winter 2027', date: APRIL_DAYS[hash % APRIL_DAYS.length], start, end, location: NOT_POSTED, estimated: true };
}

// A course's finals in a term: for one section with its lab exam, or the first section when that one isn't listed.
export function finalExamsFor(course: string, term: string, section?: string): FinalExam[] {
  if (term === 'Winter 2027') {
    const exam = aprilExam(course);
    return exam ? [exam] : [];
  }
  if (term !== 'Fall 2026') return [];
  const rows = fallExams.get(course) ?? [];
  const lectures = rows.filter((e) => !e.section?.endsWith('L')).map((e) => e.section);
  if (!lectures.length) return rows;
  const mine = section && lectures.includes(section) ? section : lectures[0];
  return rows.filter((e) => e.section === mine || e.section === `${mine}L`);
}

export const finalExamFor = (course: string, term: string, section?: string): FinalExam | null => finalExamsFor(course, term, section)[0] ?? null;

// A student's exams that overlap, or at least fall on the same day, by course.
export function examConflicts(exams: Pick<FinalExam, 'course' | 'date' | 'start' | 'end'>[]) {
  const conflicts = new Map<string, { overlap: boolean; with: string }>();
  for (const exam of exams) {
    const sameDay = exams.filter((other) => other.course !== exam.course && other.date === exam.date);
    const overlapping = sameDay.find((other) => other.start < exam.end && exam.start < other.end);
    if (overlapping) conflicts.set(exam.course, { overlap: true, with: overlapping.course });
    else if (sameDay[0]) conflicts.set(exam.course, { overlap: false, with: sameDay[0].course });
  }
  return conflicts;
}
