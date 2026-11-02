// A3: the term's key dates and the final exam schedule. Like the course catalogue (G2),
// these are built in until there's an import from McGill.
//
// Key dates follow McGill's published 2026–2027 dates (mcgill.ca/importantdates); the
// Winter course-change and withdrawal deadlines weren't out yet, so they're marked
// approximate. The exam schedule is a SAMPLE: McGill publishes the real one per course
// during the term (mcgill.ca/exams).

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
  course: string; // "COMP 251": every section writes the same exam
  term: string;
  date: string;
  start: string; // "HH:mm"
  end: string;
  location: string;
}

// Three sittings a day, as in McGill's exam timetables.
const MORNING = ['09:00', '12:00'] as const;
const AFTERNOON = ['14:00', '17:00'] as const;
const EVENING = ['18:30', '21:30'] as const;

const exam = (course: string, date: string, [start, end]: readonly [string, string], location: string): FinalExam => ({
  course,
  term: 'Fall 2026',
  date,
  start,
  end,
  location,
});

// SAMPLE Fall 2026 schedule for the built-in catalogue.
export const FINAL_EXAMS: FinalExam[] = [
  exam('BIOL 111', '2026-12-10', MORNING, 'Currie Gym'),
  exam('BIOL 112', '2026-12-16', AFTERNOON, 'Currie Gym'),
  exam('CHEM 110', '2026-12-08', MORNING, 'Field House'),
  exam('CHEM 120', '2026-12-18', MORNING, 'Field House'),
  exam('COMP 202', '2026-12-11', AFTERNOON, 'Field House'),
  exam('COMP 206', '2026-12-15', MORNING, 'Leacock 132'),
  exam('COMP 250', '2026-12-09', EVENING, 'Currie Gym'),
  exam('COMP 251', '2026-12-14', AFTERNOON, 'Field House'),
  exam('COMP 273', '2026-12-17', MORNING, 'Leacock 132'),
  exam('COMP 302', '2026-12-08', AFTERNOON, 'Leacock 132'),
  exam('COMP 303', '2026-12-19', MORNING, 'Trottier 0100'),
  exam('COMP 307', '2026-12-12', AFTERNOON, 'Trottier 0060'),
  exam('COMP 330', '2026-12-21', AFTERNOON, 'Trottier 0100'),
  exam('COMP 360', '2026-12-16', EVENING, 'Trottier 0060'),
  exam('COMP 421', '2026-12-10', AFTERNOON, 'Stewart Biology S1/4'),
  exam('COMP 424', '2026-12-18', AFTERNOON, 'Stewart Biology S1/4'),
  exam('COMP 551', '2026-12-22', MORNING, 'Leacock 132'),
  exam('ECON 208', '2026-12-07', MORNING, 'Currie Gym'),
  exam('ECON 209', '2026-12-14', MORNING, 'Currie Gym'),
  exam('ECSE 200', '2026-12-09', MORNING, 'McConnell 204'),
  exam('ECSE 202', '2026-12-12', MORNING, 'McConnell 204'),
  exam('ECSE 205', '2026-12-15', AFTERNOON, 'Rutherford Physics 112'),
  exam('ECSE 222', '2026-12-18', EVENING, 'McConnell 204'),
  exam('MATH 133', '2026-12-07', AFTERNOON, 'Field House'),
  exam('MATH 140', '2026-12-10', EVENING, 'Field House'),
  exam('MATH 141', '2026-12-17', AFTERNOON, 'Field House'),
  exam('MATH 222', '2026-12-11', MORNING, 'Currie Gym'),
  exam('MATH 223', '2026-12-19', AFTERNOON, 'Burnside 1B45'),
  exam('MATH 235', '2026-12-14', EVENING, 'Burnside 1B36'),
  exam('MATH 240', '2026-12-16', MORNING, 'Leacock 132'),
  exam('MATH 323', '2026-12-21', MORNING, 'Leacock 132'),
  exam('MATH 324', '2026-12-09', AFTERNOON, 'Burnside 1B45'),
  exam('MGCR 211', '2026-12-12', EVENING, 'Bronfman 151'),
  exam('PHYS 131', '2026-12-15', EVENING, 'Field House'),
  exam('PHYS 142', '2026-12-08', EVENING, 'Rutherford Physics 112'),
  exam('PSYC 100', '2026-12-19', EVENING, 'Field House'),
];

// Terms whose exam schedule is out (the rest show "not published yet").
export const EXAM_SCHEDULE_TERMS = ['Fall 2026'];

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

export const finalExamFor = (course: string, term: string) => FINAL_EXAMS.find((e) => e.course === course && e.term === term) ?? null;
