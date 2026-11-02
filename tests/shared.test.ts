import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cgpaWith, finalIfRemainingAverages, letterFor, parseMark, summarize, termGpa } from '@shared/grades';
import { buildCalendar, parseCalendar } from '@shared/ics';
import { noClassesOn } from '@shared/keyDates';
import { isHidden, parseChatLink } from '@shared/links';
import { DEFAULT_WEEKLY_MINUTES, minutesAroundClasses, minutesOn, planTasks, type PlannableTask, weeklyMinutes } from '@shared/planner';
import { passwordProblems } from '@shared/validation';
import { parseCourseQuery, parseSchedule } from '@shared/courseQuery';
import { goalOutlook, summarizeRecord, termOrder } from '@shared/academics';
import { evaluateDegree, type Program } from '@shared/degree';
import { type FocusWindow, studyModeStatus } from '@shared/studyMode';
import { parseSyllabus } from '@shared/syllabus';
import { findParts, minutesForParts } from '@shared/assignment';
import { clashes, groupMeetings } from '@shared/meetings';
import { BACKUP_APP, readBackup, writeBackup } from '@shared/backup';
import { docxText, docxXmlToText } from '@shared/docx';
import { parsePost } from '@shared/postText';
import { parseTaskDate } from '@shared/taskDate';
import { keywords, similarity } from '@shared/similar';
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
    expect(s.requirements.find((r) => r.letter === 'A')).toEqual({ letter: 'A', needed: 86, status: 'possible', scheme: 0 });
    expect(s.requirements.find((r) => r.letter === 'D')?.needed).toBe(16);
  });

  it('flags grades that are secured or out of reach', () => {
    const s = summarize([
      { weight: 60, score: 95 },
      { weight: 40, score: null },
    ]);
    // 57 points banked: a C (55) is guaranteed even with 0% on the rest.
    expect(s.requirements.find((r) => r.letter === 'C')?.status).toBe('secured');
    expect(s.requirements.find((r) => r.letter === 'B')).toEqual({ letter: 'B', needed: 32.5, status: 'possible', scheme: 0 });
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
    expect(s.requirements.find((r) => r.letter === 'A')).toEqual({ letter: 'A', needed: 90, status: 'possible', scheme: 0 });
  });

  it('reads marks however they were handed back', () => {
    expect(parseMark('88')).toBe(88);
    expect(parseMark(' 88.5% ')).toBe(88.5);
    expect(parseMark('44/50')).toBe(88);
    expect(parseMark('44 / 50')).toBe(88);
    expect(parseMark('8,5/10')).toBe(85);
    expect(parseMark('2/3')).toBe(66.67);
    expect(parseMark('55/50')).toBe(110); // bonus marks
    expect(parseMark('')).toBeNull();
    for (const bad of ['A-', '5/0', '-3', '88/', '/50', '200', '1/2/3', 'n/a']) expect(parseMark(bad)).toBeUndefined();
  });

  it('projects a term GPA on the McGill scale, weighted by credits', () => {
    // A (4.0) over 3 credits and B (3.0) over 1 credit; the class with no marks doesn't count.
    expect(termGpa([{ credits: 3, percent: 90 }, { credits: 1, percent: 72 }, { credits: 3, percent: null }])).toBe(3.75);
    expect(termGpa([{ credits: 3, percent: null }])).toBeNull();
    expect(cgpaWith({ gpa: 3, credits: 30 }, { gpa: 4, credits: 10 })).toBe(3.25);
    expect(cgpaWith({ gpa: null, credits: 0 }, { gpa: 3.5, credits: 12 })).toBe(3.5);
    expect(cgpaWith({ gpa: 3.2, credits: 30 }, { gpa: null, credits: 0 })).toBe(3.2);
  });

  it('takes whichever of two schemes is higher', () => {
    // Scheme 1: assignments 30%, midterm 20%, final 50%. Scheme 2: the final replaces the midterm.
    const items = [
      { weight: 30, altWeight: 30, score: 90 },
      { weight: 20, altWeight: 0, score: 50 },
      { weight: 50, altWeight: 70, score: null },
    ];
    const s = summarize(items);
    expect(s.schemes.map((x) => x.worstFinal)).toEqual([37, 27]);
    expect([s.worstFinal, s.bestFinal, s.currentAverage]).toEqual([37, 97, 90]);
    // An A needs 96% on the final under scheme 1 but 82.9% under scheme 2; a D is easier under scheme 1.
    expect(s.requirements.find((r) => r.letter === 'A')).toEqual({ letter: 'A', needed: 82.9, status: 'possible', scheme: 1 });
    expect(s.requirements.find((r) => r.letter === 'D')).toEqual({ letter: 'D', needed: 26, status: 'possible', scheme: 0 });
    expect(finalIfRemainingAverages(items, 100)).toEqual({ final: 97, scheme: 1 });
    expect(finalIfRemainingAverages(items, 0)).toEqual({ final: 37, scheme: 0 });
    // One scheme: nothing changes.
    expect(summarize(items.map(({ altWeight: _, ...i }) => i)).schemes).toEqual([]);
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

  it('leaves breaks out of weekly class times', () => {
    const start = new Date(2026, 8, 2, 10, 5);
    const ics = buildCalendar(
      [{ uid: 'c@unilink', title: 'COMP 251-001', start, end: new Date(2026, 8, 2, 11, 25), weekly: { until: new Date(2026, 11, 4, 23, 59), except: [new Date(2026, 9, 14, 10, 5)] } }],
      'America/Toronto',
    );
    expect(ics).toContain('RRULE:FREQ=WEEKLY;UNTIL=');
    expect(ics).toContain('EXDATE;TZID=America/Toronto:20261014T100500');
    expect(noClassesOn('2026-10-12')?.title).toBe('Fall reading break');
    expect(noClassesOn('2026-09-07')?.title).toBe('Labour Day, no classes');
    expect(noClassesOn('2026-09-08')).toBeNull();
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

  it('leaves out sessions that only mention an exam', () => {
    const lines = 'Review session for the final: Dec 3, no hand-in\nTutorial on the midterm, Oct 20\nMidterm exam Oct 22\nTutorial report due Oct 30';
    expect(parseSyllabus(lines, 'Fall 2026').map((i) => i.title)).toEqual(['Midterm exam', 'Tutorial report']);
  });

  it('puts January to May of a fall syllabus in the next year', () => {
    expect(parseSyllabus('Take-home exam due January 8', 'Fall 2026')[0].dueAt).toEqual(new Date(2027, 0, 8, 23, 59));
    expect(parseSyllabus('Lab 4 due Feb 30', 'Winter 2027')).toEqual([]);
  });
});

describe('problems in an assignment file (ST2)', () => {
  const handout = `COMP 251 Assignment 3
Due Friday. Answer every question; see Question 2 of Assignment 1 for the notation.

Question 1: Recurrences (20 points)
Solve the recurrences below.
Question 2 [30 pts]
1.2 Prove that the greedy choice is safe. Problem 1.2 in the textbook is similar.
**Question 3.** Give an O(n log n) algorithm that finds the closest pair of points in the plane and prove it correct (25 marks)
Question 4 - Dynamic programming (25 points)

Solutions
Question 1: Recurrences`;

  it('finds each numbered question once, with its name and points', () => {
    expect(findParts(handout)).toEqual([
      { title: 'Question 1: Recurrences', points: 20 },
      { title: 'Question 2', points: 30 },
      { title: 'Question 3', points: 25 },
      { title: 'Question 4: Dynamic programming', points: 25 },
    ]);
  });

  it('reads other headings, in French too, and ignores sub-parts', () => {
    expect(findParts('Q1) warm-up\nQ2. graphs\nProblem 2.1 sub-part').map((p) => p.title)).toEqual(['Q1: warm-up', 'Q2: graphs']);
    expect(findParts('Exercice 1 (10 pts)\nExercice 2 (5 pts)').map((p) => [p.title, p.points])).toEqual([['Exercice 1', 10], ['Exercice 2', 5]]);
    expect(findParts('Read chapter 3 and write a one-page summary.')).toEqual([]);
  });

  it('shares time out by points when every part has them', () => {
    expect(minutesForParts(findParts(handout), 60)).toEqual([45, 75, 60, 60]);
    expect(minutesForParts([{ title: 'Q1', points: 10 }, { title: 'Q2', points: null }], 60)).toEqual([60, 60]);
  });
});

describe('class time clashes (S1)', () => {
  const at = (weekday: number, startTime: string, endTime: string) => ({ weekday, startTime, endTime });

  it('clashes only on the same day with overlapping times', () => {
    expect(clashes([at(1, '10:05', '11:25')], [at(1, '11:00', '12:00')])).toBe(true);
    // Back to back isn't a clash.
    expect(clashes([at(1, '10:05', '11:25')], [at(1, '11:25', '12:00')])).toBe(false);
    expect(clashes([at(1, '10:05', '11:25')], [at(2, '10:05', '11:25')])).toBe(false);
    expect(clashes([], [at(2, '10:05', '11:25')])).toBe(false);
  });

  it('groups days that share a time, Monday first', () => {
    expect(groupMeetings([at(3, '10:05', '11:25'), at(5, '13:35', '14:25'), at(1, '10:05', '11:25'), at(0, '9:00', '10:00')])).toEqual([
      { weekdays: [1, 3], startTime: '10:05', endTime: '11:25' },
      { weekdays: [5], startTime: '13:35', endTime: '14:25' },
      { weekdays: [0], startTime: '9:00', endTime: '10:00' },
    ]);
  });
});

describe('similar posts (S4)', () => {
  const query = (title: string) => keywords(title);

  it('reads keywords without stopwords, accents or plurals', () => {
    expect([...keywords('Can we assume the edge weights are distinct? (A2 Q3)')]).toEqual(['assume', 'edge', 'weight', 'distinct', 'a2', 'q3']);
    expect([...keywords('Est-ce que l’examen est cumulatif?')]).toEqual(['examen', 'cumulatif']);
  });

  it('matches posts that cover most of a new title', () => {
    const q = query('A2 Q3 distinct edge weights?');
    expect(similarity(q, 'A2 Q3: can we assume edge weights are distinct?', '')).toBe(1);
    // Words only in the body count half.
    expect(similarity(q, 'Question about A2', 'For Q3, are the edge weights distinct?')).toBe(0.6);
    expect(similarity(q, 'Midterm room?', 'Which room is the midterm in?')).toBe(0);
    // A single shared word isn't enough.
    expect(similarity(query('midterm room'), 'Midterm grades out?', '')).toBe(0);
  });
});

describe('post formatting (S4)', () => {
  it('finds inline code and links, leaving a sentence\'s punctuation out of them', () => {
    expect(parsePost('Use `lw $t0` first, see https://mcgill.ca/x?y=1. Thanks!')).toEqual([
      { kind: 'text', text: 'Use ' },
      { kind: 'code', text: 'lw $t0' },
      { kind: 'text', text: ' first, see ' },
      { kind: 'link', text: 'https://mcgill.ca/x?y=1' },
      { kind: 'text', text: '. Thanks!' },
    ]);
  });

  it('keeps fenced blocks whole, with nothing inside them formatted', () => {
    expect(parsePost('My loop:\n```python\nfor i in `xs`:\n  print("https://a.b")\n```\nWhy?')).toEqual([
      { kind: 'text', text: 'My loop:' },
      { kind: 'block', text: 'for i in `xs`:\n  print("https://a.b")' },
      { kind: 'text', text: 'Why?' },
    ]);
  });

  it('shows what it can\'t read as typed, and only links http(s)', () => {
    expect(parsePost('```\nnever closed')).toEqual([{ kind: 'text', text: '```\nnever closed' }]);
    expect(parsePost('javascript:alert(1) and ftp://a.b')).toEqual([{ kind: 'text', text: 'javascript:alert(1) and ftp://a.b' }]);
    expect(parsePost('')).toEqual([]);
  });
});

describe('pasted schedules (S1)', () => {
  it('reads sections however Minerva or a student writes them', () => {
    const schedule = `Fall 2026 schedule
COMP 251 001  Algorithms and Data Structures  Lec  3.0 credits
MATH-240-002  Discrete Structures
ECSE202 Sec. 003
PHYS 142
in room 101, CRN 12345, Leacock 132
COMP 251 Tutorial`;
    expect(parseSchedule(schedule)).toEqual([
      { subject: 'COMP', number: '251', section: '001' },
      { subject: 'MATH', number: '240', section: '002' },
      { subject: 'ECSE', number: '202', section: '003' },
      { subject: 'PHYS', number: '142', section: null },
    ]);
    // Minerva's own headings.
    expect(parseSchedule('Algorithms and Data Structures - COMP 251 - 001\nDiscrete Structures - MATH 240 - 002')).toEqual([
      { subject: 'COMP', number: '251', section: '001' },
      { subject: 'MATH', number: '240', section: '002' },
    ]);
    // A year or a CRN after the code isn't a section.
    expect(parseSchedule('COMP 251 2026\nMATH 240 12345')).toEqual([
      { subject: 'COMP', number: '251', section: null },
      { subject: 'MATH', number: '240', section: null },
    ]);
  });
});

describe('backups', () => {
  const sqlite = new TextEncoder().encode('SQLite format 3\0 and the rest of the file');
  const file = { path: '/attachments/a-handout.pdf', type: 'application/pdf', bytes: new Uint8Array([0, 1, 2, 255]) };
  const edited = (change: (raw: Record<string, unknown>) => void) => {
    const raw = JSON.parse(writeBackup({ db: sqlite, files: [file] }, new Date(2026, 10, 2)));
    change(raw);
    return JSON.stringify(raw);
  };

  it('round-trips the database and files, byte for byte', () => {
    const large = new Uint8Array(300_000).map((_, i) => i % 251);
    const back = readBackup(writeBackup({ db: sqlite, files: [file, { ...file, path: '/attachments/big.png', type: 'image/png', bytes: large }] }, new Date()));
    expect(back?.db).toEqual(sqlite);
    expect(back?.files.map((f) => [f.path, f.type])).toEqual([['/attachments/a-handout.pdf', 'application/pdf'], ['/attachments/big.png', 'image/png']]);
    expect(back?.files[1].bytes).toEqual(large);
  });

  it('refuses anything that is not a UniLink backup', () => {
    expect(readBackup('not json')).toBeNull();
    expect(readBackup('{"app":"something-else"}')).toBeNull();
    expect(readBackup(edited((raw) => (raw.app = 'other')))).toBeNull();
    expect(readBackup(edited((raw) => (raw.version = 2)))).toBeNull();
    expect(readBackup(edited((raw) => (raw.db = btoa('not a database'))))).toBeNull();
    expect(readBackup(edited((raw) => (raw.files = 'nope')))).toBeNull();
    expect(edited(() => {})).toContain(BACKUP_APP);
  });

  it('only puts files where attachments belong, and never as something that runs', () => {
    const withFile = (f: object) => edited((raw) => (raw.files = [{ data: btoa('x'), type: 'text/plain', ...f }]));
    expect(readBackup(withFile({ path: 'db' }))).toBeNull();
    expect(readBackup(withFile({ path: '/attachments/../db' }))).toBeNull();
    expect(readBackup(withFile({ path: '/attachments/x.txt' }))?.files[0].type).toBe('text/plain');
    expect(readBackup(withFile({ path: '/attachments/x.svg', type: 'image/svg+xml' }))?.files[0].type).toBe('application/octet-stream');
    expect(readBackup(withFile({ path: '/attachments/x.html', type: 'text/html' }))?.files[0].type).toBe('application/octet-stream');
  });
});

describe('dates typed in a to-do (ST3)', () => {
  const today = '2026-11-02'; // a Monday
  const read = (text: string) => parseTaskDate(text, today);

  it('reads days, in English and French', () => {
    expect(read('Email the TA tomorrow')).toEqual({ title: 'Email the TA', dueDate: '2026-11-03' });
    expect(read('Print notes today')).toEqual({ title: 'Print notes', dueDate: today });
    expect(read('Read chapter 3 friday')).toEqual({ title: 'Read chapter 3', dueDate: '2026-11-06' });
    expect(read('Read chapter 3 by fri')).toEqual({ title: 'Read chapter 3', dueDate: '2026-11-06' });
    expect(read('Lire le chapitre 3 demain')).toEqual({ title: 'Lire le chapitre 3', dueDate: '2026-11-03' });
    expect(read('Payer les frais vendredi')).toEqual({ title: 'Payer les frais', dueDate: '2026-11-06' });
    // On a Monday, "monday" means next week.
    expect(read('Call home monday')).toEqual({ title: 'Call home', dueDate: '2026-11-09' });
    expect(read('Renew books in 3 days')).toEqual({ title: 'Renew books', dueDate: '2026-11-05' });
  });

  it('reads dates, moving to next year once they have gone by', () => {
    expect(read('Pay fees nov 5')).toEqual({ title: 'Pay fees', dueDate: '2026-11-05' });
    expect(read('Pay fees by November 5th')).toEqual({ title: 'Pay fees', dueDate: '2026-11-05' });
    expect(read('Payer le 5 novembre')).toEqual({ title: 'Payer', dueDate: '2026-11-05' });
    expect(read('Register jan 10')).toEqual({ title: 'Register', dueDate: '2027-01-10' });
    expect(read('Reminder 2026-12-01')).toEqual({ title: 'Reminder', dueDate: '2026-12-01' });
  });

  it('leaves everything else as typed', () => {
    for (const text of ['Renew library books', "Ask about Monday's class", 'Friday', 'Read chapter 3', 'Pay fees feb 31', 'Meet at 5 pm', 'Buy a mar bar', 'Call Sam', 'Swim in the sun', 'Get wed', 'Vue sur la mer', 'Text Dim', 'Mon']) {
      expect(read(text)).toEqual({ title: text, dueDate: null });
    }
  });
});

describe('Word documents', () => {
  // A minimal zip with one file in it, as a .docx is.
  function zip(name: string, content: string, compressed = true) {
    const data = compressed ? deflateRawSync(Buffer.from(content)) : Buffer.from(content);
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(compressed ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(compressed ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt16LE(nameBytes.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(30 + nameBytes.length + data.length, 16);
    return new Uint8Array(Buffer.concat([local, nameBytes, data, central, nameBytes, end]));
  }
  const document = '<w:document><w:body><w:p><w:r><w:t>Question 1: Sorting &amp; searching (20 points)</w:t></w:r></w:p><w:p><w:r><w:t>Question 2</w:t><w:tab/><w:t>Graphs</w:t></w:r></w:p></w:body></w:document>';

  it('reads the paragraphs out of a .docx, compressed or not', async () => {
    const text = 'Question 1: Sorting & searching (20 points)\nQuestion 2\tGraphs\n';
    expect(await docxText(zip('word/document.xml', document))).toBe(text);
    expect(await docxText(zip('word/document.xml', document, false))).toBe(text);
    // So the planner can find its problems, like in a PDF.
    expect(findParts(text).map((p) => p.title)).toEqual(['Question 1: Sorting & searching', 'Question 2: Graphs']);
  });

  it('turns Word markup into plain text', () => {
    expect(docxXmlToText('<w:p><w:t>a &lt; b &#233; &#xe9; &nope;</w:t><w:br/><w:t>c</w:t></w:p>')).toBe('a < b é é &nope;\nc\n');
  });

  it('says so when it is not a readable document', async () => {
    expect(await docxText(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await docxText(new TextEncoder().encode('not a zip at all, just some long enough text to look at'))).toBeNull();
    expect(await docxText(zip('something/else.xml', document))).toBeNull();
  });
});

describe('A1 CGPA goal', () => {
  const record = { cgpaPoints: 90, cgpaCredits: 30 }; // 3.00 over 30 credits

  it('says what the next credits have to average, and the lowest letter that gets there', () => {
    expect(goalOutlook(record, 3.3, 30)).toEqual({ kind: 'reach', average: 3.6, grade: 'A-' });
    expect(goalOutlook(record, 3.5, 30)).toEqual({ kind: 'reach', average: 4, grade: 'A' });
    // Rounded up, so that getting exactly that is enough, but not up from floating-point noise.
    expect(goalOutlook(record, 3.25, 40)).toEqual({ kind: 'reach', average: 3.44, grade: 'A-' });
    expect(goalOutlook({ cgpaPoints: 99, cgpaCredits: 30 }, 3.3, 30)).toEqual({ kind: 'keep', average: 3.3, grade: 'B+' });
    // Nothing graded yet.
    expect(goalOutlook({ cgpaPoints: 0, cgpaCredits: 0 }, 3.7, 15)).toEqual({ kind: 'reach', average: 3.7, grade: 'A-' });
  });

  it('tells someone already there what keeps them there', () => {
    expect(goalOutlook(record, 3, 30)).toEqual({ kind: 'keep', average: 3, grade: 'B' });
    expect(goalOutlook(record, 2, 30)).toEqual({ kind: 'keep', average: 1, grade: 'D' });
    expect(goalOutlook(record, 1, 10)).toEqual({ kind: 'safe' });
  });

  it('says so when straight As would not be enough', () => {
    expect(goalOutlook(record, 3.9, 15)).toEqual({ kind: 'out-of-reach', best: 3.33, creditsOfAs: 270 });
    expect(goalOutlook(record, 4, 15)).toEqual({ kind: 'out-of-reach', best: 3.33, creditsOfAs: null });
  });
});

describe('ST2 free time around classes', () => {
  it('takes class time off a four-hour day, down to an hour, rounded to a quarter hour', () => {
    const minutes = minutesAroundClasses([
      { weekday: 1, startTime: '10:05', endTime: '11:25' },
      { weekday: 1, startTime: '13:35', endTime: '14:55' },
      { weekday: 3, startTime: '08:30', endTime: '13:30' },
    ]);
    expect(minutes).toEqual([240, 75, 240, 60, 240, 240, 240]);
  });
});
