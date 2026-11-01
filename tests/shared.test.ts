import { describe, expect, it } from 'vitest';
import { letterFor, summarize } from '@shared/grades';
import { buildCalendar, parseCalendar } from '@shared/ics';
import { parseChatLink } from '@shared/links';
import { planTasks, type PlannableTask } from '@shared/planner';
import { passwordProblems } from '@shared/validation';

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

  it('scales schemes whose weights do not add up to 100', () => {
    expect(summarize([{ weight: 50, score: 80 }]).worstFinal).toBe(80);
  });
});

describe('assignment planner (ST2)', () => {
  const tasks = (n: number, minutes = 60): PlannableTask[] =>
    Array.from({ length: n }, (_, i) => ({ id: i + 1, minutes, scheduledFor: '2026-10-05', pinned: false, done: false }));
  const base = { today: '2026-10-05', dueDate: '2026-10-08', bufferDays: 1, capacity: () => 120 };

  it('spreads 3 problems over 3 days with a spare day before the deadline', () => {
    const plan = planTasks({ ...base, tasks: tasks(3) });
    expect([...plan.dates.values()]).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(plan.lastWorkDay).toBe('2026-10-07');
    expect(plan.tight || plan.overloaded).toBe(false);
  });

  it('doubles up when there are more tasks than days', () => {
    const plan = planTasks({ ...base, tasks: tasks(6) });
    expect([...plan.dates.values()]).toEqual([
      '2026-10-05',
      '2026-10-05',
      '2026-10-06',
      '2026-10-06',
      '2026-10-07',
      '2026-10-07',
    ]);
  });

  it('skips days without free time', () => {
    const plan = planTasks({ ...base, tasks: tasks(2), capacity: (d) => (d === '2026-10-05' ? 0 : 120) });
    expect([...plan.dates.values()]).toEqual(['2026-10-06', '2026-10-06']);
  });

  it('keeps hand-placed tasks but moves missed ones', () => {
    const plan = planTasks({
      ...base,
      tasks: [
        { id: 1, minutes: 60, scheduledFor: '2026-10-07', pinned: true, done: false },
        { id: 2, minutes: 60, scheduledFor: '2026-10-01', pinned: true, done: false },
        { id: 3, minutes: 60, scheduledFor: '2026-10-01', pinned: false, done: true },
      ],
    });
    expect(plan.dates.get(1)).toBe('2026-10-07');
    expect(plan.dates.get(2)).toBe('2026-10-05');
    expect(plan.dates.has(3)).toBe(false);
  });

  it('reports when the buffer or the daily study time cannot be respected', () => {
    expect(planTasks({ ...base, dueDate: '2026-10-05', tasks: tasks(1) }).tight).toBe(true);
    expect(planTasks({ ...base, tasks: tasks(3), capacity: () => 30 }).overloaded).toBe(true);
  });
});

describe('group chat links (S2)', () => {
  it('detects the platform and normalizes the URL', () => {
    expect(parseChatLink('http://chat.whatsapp.com/AbC123/')).toEqual({
      url: 'https://chat.whatsapp.com/AbC123',
      platform: 'WhatsApp',
    });
    expect(parseChatLink(' https://discord.gg/xyz#intro ')?.platform).toBe('Discord');
    expect(parseChatLink('https://www.example.com/group')?.platform).toBe('Other');
  });

  it('rejects things that are not web links', () => {
    for (const bad of ['discord group', 'javascript:alert(1)', 'https://localhost/x', 'ftp://files.example.com']) {
      expect(parseChatLink(bad)).toBeNull();
    }
  });
});

describe('accounts (G4)', () => {
  it('lists missing password requirements', () => {
    expect(passwordProblems('short1')).toEqual(['At least 8 characters']);
    expect(passwordProblems('longenough')).toEqual(['At least one number']);
    expect(passwordProblems('longenough1')).toEqual([]);
  });
});

describe('iCalendar (G2)', () => {
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
