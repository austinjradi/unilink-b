import { describe, expect, it } from 'vitest';
import { letterFor, summarize } from '@shared/grades';
import { buildCalendar, parseCalendar } from '@shared/ics';
import { isHidden, parseChatLink } from '@shared/links';
import { DEFAULT_WEEKLY_MINUTES, minutesOn, planTasks, type PlannableTask, weeklyMinutes } from '@shared/planner';
import { passwordProblems } from '@shared/validation';
import { parseCourseQuery } from '@shared/courseQuery';
import { summarizeRecord, termOrder } from '@shared/academics';
import { evaluateDegree, type Program } from '@shared/degree';
import { type FocusWindow, studyModeStatus } from '@shared/studyMode';
import { parseSyllabus } from '@shared/syllabus';
import { parseTranscript } from '@shared/transcript';

describe('grades (A4)', () => {
  it('maps percentages onto the McGill scale', () => {
    expect(letterFor(85).letter).toBe('A');
    expect(letterFor(84.9).letter).toBe('A-');
    expect(letterFor(50).letter).toBe('D');
    expect(letterFor(49.9).letter).toBe('F');
  });

  it('works out what is needed on the remaining assessments', () => {
    const s = summarize([
      { weight: 30, score: 80 }, // midterm
      { weight: 20, score: 90 }, // assignments
      { weight: 50, score: null }, // final
    ]);
    expect(s.currentAverage).toBe(84);
    expect(s.remainingWeight).toBe(50);
    expect([s.worstFinal, s.bestFinal]).toEqual([42, 92]);
    expect(s.requirements.find((r) => r.letter === 'A')).toEqual({ letter: 'A', needed: 86, status: 'possible' });
    expect(s.requirements.find((r) => r.letter === 'D')?.needed).toBe(16);
  });

  it('flags grades that are secured or out of reach', () => {
    const s = summarize([
      { weight: 60, score: 95 },
      { weight: 40, score: null },
    ]);
    // 57 points banked: a C (55) is guaranteed even with 0% on the rest.
    expect(s.requirements.find((r) => r.letter === 'C')?.status).toBe('secured');
    expect(s.requirements.find((r) => r.letter === 'B')).toEqual({ letter: 'B', needed: 32.5, status: 'possible' });
    const low = summarize([
      { weight: 80, score: 40 },
      { weight: 20, score: null },
    ]);
    expect(low.requirements.find((r) => r.letter === 'A')?.status).toBe('out-of-reach');
  });

  it('counts weight missing from the scheme as work still to come', () => {
    // Only the 50% midterm is listed so far: the other 50% isn't graded yet, not ignored.
    const s = summarize([{ weight: 50, score: 80 }]);
    expect(s.unlistedWeight).toBe(50);
    expect(s.remainingWeight).toBe(50);
    expect([s.worstFinal, s.bestFinal]).toEqual([40, 90]);
    expect(s.requirements.find((r) => r.letter === 'A')).toEqual({ letter: 'A', needed: 90, status: 'possible' });
  });
});

describe('assignment planner (ST2)', () => {
  const tasks = (n: number, minutes = 60): PlannableTask[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, minutes, scheduledFor: '2026-10-05', pinned: false, done: false }));
  const base = { today: '2026-10-05', dueDate: '2026-10-08', bufferDays: 2, capacity: () => 120 };

  it('schedules work as early as free time allows, keeping two spare days', () => {
    const plan = planTasks({ ...base, tasks: tasks(3) });
    expect([...plan.dates.values()]).toEqual(['2026-10-05', '2026-10-05', '2026-10-06']);
    expect(plan.lastWorkDay).toBe('2026-10-06');
    expect(plan.tight || plan.overloaded).toBe(false);
  });

  it('fills each day before moving to the next', () => {
    const plan = planTasks({ ...base, dueDate: '2026-10-12', tasks: tasks(5) });
    expect([...plan.dates.values()]).toEqual(['2026-10-05', '2026-10-05', '2026-10-06', '2026-10-06', '2026-10-07']);
  });

  it('skips days without free time', () => {
    const plan = planTasks({ ...base, tasks: tasks(2), capacity: (d) => (d === '2026-10-05' ? 0 : 120) });
    expect([...plan.dates.values()]).toEqual(['2026-10-06', '2026-10-06']);
  });

  it('uses free time set per weekday', () => {
    const weekly = weeklyMinutes(null);
    expect(weekly).toEqual(DEFAULT_WEEKLY_MINUTES);
    expect(minutesOn(weekly, '2026-10-05')).toBe(90); // Monday
    expect(minutesOn(weekly, '2026-10-10')).toBe(180); // Saturday
    const plan = planTasks({ ...base, dueDate: '2026-10-13', tasks: tasks(4, 90), capacity: (d) => minutesOn(weekly, d) });
    // Mon–Thu take one 90-minute task each.
    expect([...plan.dates.values()]).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
  });

  it('keeps hand-placed tasks but moves missed ones', () => {
    const plan = planTasks({
      ...base,
      tasks: [
        { id: 1, minutes: 60, scheduledFor: '2026-10-06', pinned: true, done: false },
        { id: 2, minutes: 60, scheduledFor: '2026-10-01', pinned: true, done: false },
        { id: 3, minutes: 60, scheduledFor: '2026-10-01', pinned: false, done: true },
      ],
    });
    expect(plan.dates.get(1)).toBe('2026-10-06');
    expect(plan.dates.get(2)).toBe('2026-10-05');
    expect(plan.dates.has(3)).toBe(false);
  });

  it('reports when the buffer or the free study time cannot be respected', () => {
    expect(planTasks({ ...base, dueDate: '2026-10-06', tasks: tasks(1) }).tight).toBe(true);
    expect(planTasks({ ...base, tasks: tasks(3), capacity: () => 30 }).overloaded).toBe(true);
  });
});

describe('group chat links (S2)', () => {
  it('detects the platform and normalizes the URL', () => {
    expect(parseChatLink('http://chat.whatsapp.com/AbC123/?utm_source=x')).toEqual({
      url: 'https://chat.whatsapp.com/AbC123',
      platform: 'WhatsApp',
      chatKey: 'whatsapp:AbC123',
    });
    expect(parseChatLink(' https://discord.gg/xyz#intro ')?.platform).toBe('Discord');
    expect(parseChatLink('https://www.example.com/group')?.platform).toBe('Other');
  });

  it('recognizes the same chat under different URLs', () => {
    const key = (url: string) => parseChatLink(url)?.chatKey;
    expect(key('https://discord.gg/abc')).toBe('discord:abc');
    expect(key('https://discord.com/invite/abc?ref=x')).toBe('discord:abc');
    expect(key('https://t.me/joinchat/Qwe')).toBe(key('https://t.me/+Qwe'));
    expect(key('https://discord.gg/ABC')).not.toBe(key('https://discord.gg/abc')); // invite codes are case-sensitive
    expect(key('https://teams.microsoft.com/l/chat?id=1')).not.toBe(key('https://teams.microsoft.com/l/chat?id=2'));
  });

  it('hides a link once reports reach 2 and outnumber "works"', () => {
    expect(isHidden(1, 0)).toBe(false);
    expect(isHidden(2, 0)).toBe(true);
    expect(isHidden(2, 2)).toBe(false);
    expect(isHidden(3, 2)).toBe(true);
  });

  it('rejects things that are not web links', () => {
    for (const bad of ['discord group', 'javascript:alert(1)', 'https://localhost/x', 'ftp://files.example.com']) {
      expect(parseChatLink(bad)).toBeNull();
    }
  });
});

describe('course search (S1)', () => {
  it('reads course codes with wildcards', () => {
    expect(parseCourseQuery('COMP 2XX')).toEqual({ kind: 'code', subject: 'COMP', number: '2__' });
    expect(parseCourseQuery('comp251')).toEqual({ kind: 'code', subject: 'COMP', number: '251' });
    expect(parseCourseQuery('3**')).toEqual({ kind: 'code', subject: null, number: '3__' });
    expect(parseCourseQuery('math 24')).toEqual({ kind: 'code', subject: 'MATH', number: '24_' });
    expect(parseCourseQuery('COMP')).toEqual({ kind: 'text', words: ['comp'], subject: 'COMP' });
    expect(parseCourseQuery('linear algebra')).toEqual({ kind: 'text', words: ['linear', 'algebra'], subject: null });
  });
});

describe('accounts (G4)', () => {
  it('uses passphrase rules', () => {
    expect(passwordProblems('short1')).toEqual(['At least 12 characters (a few words work well)']);
    expect(passwordProblems('Password1234')).toEqual(['Not a common password']);
    expect(passwordProblems('maya loves algorithms', 'maya.chen@mail.mcgill.ca')).toEqual(["Doesn't contain your name from your email"]);
    expect(passwordProblems('purple goat on a bike', 'maya.chen@mail.mcgill.ca')).toEqual([]);
  });
});

describe('iCalendar (G2)', () => {
  it('writes whole-day events as dates, ending the day after', () => {
    const ics = buildCalendar([{ uid: 'break@unilink', title: 'Fall reading break', start: new Date(2026, 9, 9), end: new Date(2026, 9, 14), allDay: true }], 'America/Toronto');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261009');
    expect(ics).toContain('DTEND;VALUE=DATE:20261015');
  });

  it('round-trips events, escaping and folding long lines', () => {
    const start = new Date(2026, 9, 14, 23, 59);
    const title = 'Due: COMP 251 Assignment 2, part (a); see myCourses for the full instructions and rubric';
    const ics = buildCalendar([{ uid: 'a@unilink', title, start, end: start }], 'America/Toronto');
    expect(ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    const [event] = parseCalendar(ics);
    expect(event.title).toBe(title);
    expect(event.start.getTime()).toBe(start.getTime());
  });

  it('reads all-day and UTC dates from other calendars', () => {
    const events = parseCalendar(
      [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'SUMMARY:Quiz 3',
        'DTSTART;VALUE=DATE:20261020',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'SUMMARY:Midterm',
        'DTSTART:20261022T140000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    );
    expect(events[0].start).toEqual(new Date(2026, 9, 20, 23, 59));
    expect(events[1].start.toISOString()).toBe('2026-10-22T14:00:00.000Z');
  });
});

describe('course record (A1)', () => {
  it('computes GPA and credits the McGill way', () => {
    const s = summarizeRecord([
      { credits: 3, term: 'Fall 2025', status: 'completed', grade: 'A' },
      { credits: 3, term: 'Fall 2025', status: 'completed', grade: 'B' },
      { credits: 3, term: 'Winter 2026', status: 'completed', grade: 'P' }, // earns credit, no GPA
      { credits: 3, term: 'Winter 2026', status: 'completed', grade: 'W' }, // neither
      { credits: 4, term: 'Fall 2026', status: 'in-progress', grade: null },
      { credits: 3, term: 'Winter 2027', status: 'planned', grade: null },
    ]);
    expect(s.cgpa).toBe(3.5);
    expect([s.creditsEarned, s.creditsInProgress, s.creditsPlanned]).toEqual([9, 4, 3]);
    expect(s.terms.map((t) => t.term)).toEqual(['Fall 2025', 'Winter 2026', 'Fall 2026', 'Winter 2027']);
  });

  it('orders terms Winter, Summer, Fall', () => {
    expect(['Fall 2026', 'Winter 2027', 'Summer 2026'].sort((a, b) => termOrder(a) - termOrder(b))).toEqual([
      'Summer 2026',
      'Fall 2026',
      'Winter 2027',
    ]);
  });
});

describe('transcript import (A1)', () => {
  it('reads courses, credits and grades under each term heading', () => {
    const transcript = `McGill University unofficial transcript
Fall 2025
COMP 202  001  Foundations of Programming   3.000  A   B+
MATH 133  Linear Algebra and Geometry  A-  3.00
Term GPA 3.85   Cumulative GPA 3.85
Winter 2026
COMP 206 Software Systems: Programming in C 3 B+ B
PSYC 100 Introduction to Psychology 3.00 W
MATH 222 Calculus 3 3 B+ B
Hiver 2027
COMP 251 Algorithms and Data Structures`;
    expect(parseTranscript(transcript).map((c) => [c.code, c.title, c.credits, c.grade, c.term])).toEqual([
      ['COMP 202', 'Foundations of Programming', 3, 'A', 'Fall 2025'],
      ['MATH 133', 'Linear Algebra and Geometry', 3, 'A-', 'Fall 2025'],
      ['COMP 206', 'Software Systems: Programming in C', 3, 'B+', 'Winter 2026'],
      ['PSYC 100', 'Introduction to Psychology', 3, 'W', 'Winter 2026'],
      ['MATH 222', 'Calculus 3', 3, 'B+', 'Winter 2026'],
      ['COMP 251', 'Algorithms and Data Structures', 3, null, 'Winter 2027'],
    ]);
    expect(parseTranscript(transcript).at(-1)!.creditsGuessed).toBe(true);
  });
});

describe('degree planning (A2)', () => {
  const program: Program = {
    id: 'p',
    name: 'Test program',
    degree: 'B.Sc.',
    totalCredits: 15,
    minProgramGrade: 'C',
    groups: [
      { id: 'core', name: 'Required', kind: 'required', courses: ['COMP 250', 'COMP 251'] },
      { id: 'comp', name: 'Complementary', kind: 'choose', credits: 3, courses: ['COMP 421', 'COMP 424'] },
    ],
  };
  const credits = () => 3;

  it('covers requirements across completed, current and planned courses', () => {
    const e = evaluateDegree(
      program,
      [
        { code: 'COMP 250', credits: 3, status: 'completed', grade: 'A-' },
        { code: 'COMP 251', credits: 3, status: 'in-progress', grade: null },
        { code: 'COMP 424', credits: 3, status: 'planned', grade: null },
        { code: 'PSYC 100', credits: 3, status: 'completed', grade: 'B' },
        { code: 'ECON 208', credits: 3, status: 'planned', grade: null },
      ],
      credits,
    );
    expect(e.groups.map((g) => g.coveredByPlan)).toEqual([true, true]);
    expect(e.electiveCredits).toBe(6);
    expect(e.missingCredits).toBe(0);
    expect(e.planComplete).toBe(true);
    expect(e.graduated).toBe(false);
  });

  it('flags program courses below the minimum grade and missing credits', () => {
    const e = evaluateDegree(
      program,
      [
        { code: 'COMP 250', credits: 3, status: 'completed', grade: 'D' },
        { code: 'COMP 251', credits: 3, status: 'completed', grade: 'F' },
      ],
      credits,
    );
    expect(e.groups[0].courses.map((c) => c.state)).toEqual(['below-minimum', 'missing']);
    expect(e.groups[1].coveredByPlan).toBe(false);
    // The D still earns degree credit as an elective; the F earns nothing.
    expect(e.electiveCredits).toBe(3);
    expect(e.missingCredits).toBe(12);
    expect(e.planComplete).toBe(false);
  });
});

describe('study mode (ST1)', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 5, h, m);
  const windows: FocusWindow[] = [
    { start: at(10, 5), end: at(11, 25), reason: 'class', label: 'COMP 251' },
    { start: at(18), end: at(20), reason: 'session', label: 'Review' },
  ];

  it('turns on during class times and study sessions', () => {
    expect(studyModeStatus({ windows, manualUntil: null, pausedUntil: null, now: at(9) })).toMatchObject({
      active: false,
      next: { label: 'COMP 251' },
    });
    expect(studyModeStatus({ windows, manualUntil: null, pausedUntil: null, now: at(10, 30) })).toMatchObject({
      active: true,
      reason: 'class',
      until: at(11, 25),
    });
  });

  it('respects focus sessions started by hand and windows switched off by hand', () => {
    expect(studyModeStatus({ windows, manualUntil: at(9, 50), pausedUntil: null, now: at(9) }).reason).toBe('manual');
    const paused = studyModeStatus({ windows, manualUntil: null, pausedUntil: at(11, 25), now: at(10, 30) });
    expect(paused.active).toBe(false);
    expect(paused.pausedWindow?.label).toBe('COMP 251');
  });
});

describe('syllabus import (A3)', () => {
  const syllabus = `Course schedule
Week 1 (Sep 1): Introduction. Readings: chapter 1
Assignment 1 (10%) due Sept. 22 at 11:59 pm
- Quiz 2 on myCourses: Thursday, October 8, 2026
Midterm exam – Oct 22, 6:30pm–8:30pm, Leacock 132 (25%)
Mini-project report due 2026-11-20
Thanksgiving, no class (Oct 12)
Assignment 3 : 5 décembre à 23h59 (5 %)
Final exam: during the exam period (40%)`;

  it('finds the dated work in a pasted schedule, with times and weights', () => {
    const items = parseSyllabus(syllabus, 'Fall 2026');
    expect(items.map((i) => [i.title, i.kind, i.dueAt, i.weight])).toEqual([
      ['Assignment 1', 'assignment', new Date(2026, 8, 22, 23, 59), 10],
      ['Quiz 2 on myCourses', 'quiz', new Date(2026, 9, 8, 23, 59), null],
      ['Midterm exam Leacock 132', 'exam', new Date(2026, 9, 22, 18, 30), 25],
      ['Mini-project report', 'assignment', new Date(2026, 10, 20, 23, 59), null],
      ['Assignment 3', 'assignment', new Date(2026, 11, 5, 23, 59), 5],
    ]);
  });

  it('puts January to May of a fall syllabus in the next year', () => {
    expect(parseSyllabus('Take-home exam due January 8', 'Fall 2026')[0].dueAt).toEqual(new Date(2027, 0, 8, 23, 59));
    expect(parseSyllabus('Lab 4 due Feb 30', 'Winter 2027')).toEqual([]);
  });
});
