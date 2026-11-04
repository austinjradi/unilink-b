import { describe, expect, it } from 'vitest';
import { courseParts, dateOrder, degreeLabel, loadAwards, loadContents, loadCourses, loadGuide, loadIndex, loadOfferings, loadPrereqs, loadPrograms, parseCatalogueDate, parseOffering, sectionsIn, toDegreeProgram } from '@shared/catalogue';
import { evaluateDegree, type GroupRule } from '@shared/degree';
import { finalExamFor, finalExamsFor } from '@shared/keyDates';
import { prereqOf, unmetPrereq, whyCantPlan } from '@shared/prereqs';

describe('the imported course catalogue', () => {
  it('has the whole catalogue: every program in its contents and the courses they list', async () => {
    const [programs, courses, index] = await Promise.all([loadPrograms(), loadCourses(), loadIndex()]);
    expect(programs.length).toBeGreaterThan(600);
    expect(courses.length).toBeGreaterThan(4400);
    expect(index.parts.map((p) => p.title)).toContain('Physical & Occupational Therapy');
    for (const part of ['Arts', 'Science', 'Engineering', 'Management', 'Music', 'Law']) {
      expect(index.programs.some((p) => p.part === part)).toBe(true);
    }
    const codes = new Set(courses.map((c) => c[0]));
    const listed = programs.flatMap((p) => p.parts.flatMap((part) => part.lists.flatMap((l) => l.courses)));
    expect(listed.length).toBeGreaterThan(30000);
    expect(listed.filter((code) => !codes.has(code))).toEqual([]);
  });

  it('reads letters the PDF stores as special glyphs', async () => {
    const courses = new Map((await loadCourses()).map((c) => [c[0], c]));
    expect(courses.get('COMP 202')?.slice(1)).toEqual(['Foundations of Programming', 3]);
    expect(courses.get('COMP 361D1')?.[1]).toBe('Software Engineering Project');
    expect(courses.get('COMP 551')?.slice(1)).toEqual(['Applied Machine Learning', 4]);
    const everything = JSON.stringify([...courses.values()]);
    expect(everything).not.toMatch(/Sofware|[-]/u);
  });

  it('turns a program into requirements the degree check understands', async () => {
    const programs = await loadPrograms();
    const major = programs.find((p) => p.name === 'Software Engineering Major (B.Sc.)')!;
    expect(major.credits).toBe(63);
    const degree = toDegreeProgram(major);
    expect(degree.degree).toBe('B.Sc.');
    expect(degree.groups.find((g) => g.kind === 'required')?.courses).toContain('COMP 251');
    const choose = degree.groups.find((g) => g.kind === 'choose')!;
    expect(choose.credits).toBe(24);
    expect(choose.courses).toEqual(expect.arrayContaining(['MATH 323', 'COMP 330', 'COMP 421']));

    const record = (code: string) => ({ code, credits: 3, status: 'completed' as const, grade: 'A' });
    const result = evaluateDegree(degree, degree.groups[0].courses.map(record), () => 3);
    expect(result.groups[0].done).toBe(true);
    expect(result.planComplete).toBe(false);
  });

  it('never leaves a section without its catalogue page', async () => {
    const guide = await loadGuide();
    expect(guide.every((s) => s.page >= 1 && s.page <= 1290)).toBe(true);
    expect(new Set(guide.map((s) => s.key)).size).toBe(guide.length);
  });

  it('summarizes every section that has running text', async () => {
    const guide = await loadGuide();
    expect(guide.find((s) => s.key === '1-about-this-publication')?.points?.length).toBeGreaterThan(5);
    expect(guide.find((s) => s.key === '1290-enriched-educational-opportunities-eeo-bursaries')?.points).toBeTruthy();
  });

  it('shows course tables that no program lists', async () => {
    const guide = await loadGuide();
    expect(guide.find((s) => s.key === '369-creative-writing')?.courses).toContain('WCOM 203');
    expect(guide.find((s) => s.key === '1015-small-ensembles')?.courses).toContain('MUEN 540');
  });

  it('keeps the table of contents', async () => {
    const contents = await loadContents();
    expect(contents.length).toBeGreaterThan(1000);
    expect(contents[0]).toEqual({ depth: 0, title: 'University Regulations', page: 20 });
  });

  it('lists loan funds among the awards', async () => {
    const awards = await loadAwards();
    expect(awards.find((a) => a.name === 'Boright Loan Fund')?.kind).toBe('Loan');
  });

  it('keeps the details in the text: dates, emails and links', async () => {
    const guide = await loadGuide();
    expect(guide.flatMap((s) => s.facts?.emails ?? [])).toContain('deanofstudents@mcgill.ca');
    expect(guide.flatMap((s) => s.facts?.dates ?? [])).toContain('September 22, 2026');
    expect(guide.flatMap((s) => s.facts?.links ?? [])).toContain('mcgill.ca/deanofstudents');
  });

  it('understands course codes, degrees and dates', () => {
    expect(courseParts('COMP 361D1')).toEqual({ subject: 'COMP', number: '361D1', level: 300 });
    expect(degreeLabel('Food Science Honours (B.Sc.(F.Sc.))')).toBe('B.Sc.(F.Sc.)');
    const fall = parseCatalogueDate('September 22, 2026')!;
    const winter = parseCatalogueDate('January 26')!;
    expect(dateOrder(fall)).toBeLessThan(dateOrder(winter));
    expect(parseCatalogueDate('Smarch 3')).toBeNull();
  });
});

describe('What the catalogue only implies', () => {
  it('has the real December exams, section by section', () => {
    expect(finalExamsFor('COMP 206', 'Fall 2026')[0]).toMatchObject({ section: '001', date: expect.stringMatching(/^2026-1[12]-/) });
    expect(finalExamsFor('COMP 206', 'Fall 2026')[0].estimated).toBeUndefined();
    // Sections can sit different exams, and a take-home runs over days.
    expect(finalExamsFor('MUSP 123', 'Fall 2026', '002')[0]).toMatchObject({ section: '002', date: '2026-12-11', start: '14:00', end: '17:00' });
    expect(finalExamsFor('ENVR 201', 'Fall 2026', '051')[0]).toMatchObject({ date: '2026-12-07', endDate: '2026-12-10', location: 'Online, take-home, 72 hours' });
    expect(finalExamsFor('ENVR 201', 'Fall 2026', '999')[0].section).toBe('001');
  });

  it('marks finals it had to guess', () => {
    const winter = finalExamFor('COMP 251', 'Winter 2027')!;
    expect(winter.estimated).toBe(true);
    expect(winter.date >= '2027-04-16' && winter.date <= '2027-04-30').toBe(true);
    expect(new Date(`${winter.date}T12:00`).getDay()).not.toBe(0);
    expect(finalExamFor('COMP 251', 'Winter 2027')).toEqual(winter);
    expect(finalExamFor('COMP 251', 'Fall 2026')?.estimated).toBe(true);
    // No sit-down final for a research project, or for most graduate-level courses.
    expect(finalExamFor('COMP 400', 'Winter 2027')).toBeNull();
    expect(finalExamFor('COMP 599', 'Winter 2027')).toBeNull();
  });

  it('knows when every course runs', async () => {
    const [courses, offerings] = await Promise.all([loadCourses(), loadOfferings()]);
    expect(courses.every(([code]) => parseOffering(offerings[code])?.terms.length)).toBe(true);
    const terms = (code: string) => parseOffering(offerings[code])?.terms;
    expect(terms('COMP 361D1')).toEqual(['Fall 2026']);
    expect(terms('COMP 361D2')).toEqual(['Winter 2027']);
    expect(parseOffering(offerings['COMP 206'])?.why).toBe('schedule');
    expect(sectionsIn('211', parseOffering(offerings['MGCR 211']), 'Fall 2026')).toHaveLength(9);
  });

  it('adds the courses only the exam schedule lists', async () => {
    const courses = new Map((await loadCourses()).map((c) => [c[0], c]));
    expect(courses.get('ANTH 432')?.[1]).toBe('The Aztecs');
  });

  it('works out what comes before a course', async () => {
    const data = await loadPrereqs();
    expect(prereqOf('ENVR 400', data)).toMatchObject({ how: 'stated', page: 327, any: [['ENVR 203']] });
    expect(prereqOf('HISP 243', data)?.any).toEqual([['HISP 220D2'], ['HISP 219']]);
    expect(prereqOf('COMP 361D2', data)).toMatchObject({ how: 'two-term', any: [['COMP 361D1']] });
    expect(prereqOf('COMP 251', data)?.any).toEqual([['COMP 250', 'MATH 240']]);
    expect(prereqOf('CHEM 120', data)).toMatchObject({ how: 'title', any: [['CHEM 110']] });
    expect(prereqOf('HIST 491', data)).toMatchObject({ how: 'level' });
    expect(prereqOf('COMP 202', data)).toBeNull();

    const taken = (code: string, term = 'Fall 2026') => ({ code, term });
    expect(unmetPrereq('ENVR 400', 'Winter 2027', [], data)).not.toBeNull();
    expect(unmetPrereq('ENVR 400', 'Winter 2027', [taken('ENVR 203')], data)).toBeNull();
    expect(unmetPrereq('HISP 243', 'Winter 2027', [taken('HISP 219')], data)).toBeNull();
    // Taking it the same term isn't "before", unless the catalogue allows that.
    expect(unmetPrereq('ENVR 400', 'Fall 2026', [taken('ENVR 203')], data)).not.toBeNull();
    expect(unmetPrereq('NSCI 200', 'Fall 2026', [taken('CHEM 212')], data)).toBeNull();
    expect(unmetPrereq('HIST 491', 'Winter 2027', [taken('HIST 214')], data)).toBeNull();
    expect(unmetPrereq('HIST 491', 'Winter 2027', [taken('COMP 202')], data)).not.toBeNull();

    expect(whyCantPlan('ENVR 400', 'Winter 2027', [], data)).toContain('ENVR 203');
    expect(whyCantPlan('COMP 361D2', 'Winter 2027', [], data)).toBeNull();
    expect(whyCantPlan('HIST 491', 'Winter 2027', [], data)).toBeNull();
  });
});

describe('Rules inside a requirement group', () => {
  const record = (code: string, credits = 3, status: 'completed' | 'planned' = 'completed') => ({ code, credits, status, grade: 'A' });
  const evaluate = (rules: GroupRule[], courses: string[], taken: ReturnType<typeof record>[], credits = 9) =>
    evaluateDegree({ id: 'p', name: 'P', degree: 'B.Sc.', totalCredits: 90, minProgramGrade: 'C', groups: [{ id: 'g', name: 'G', kind: 'choose', courses, credits, rules }] }, taken, () => 3);

  it('fills a minimum first, and is not covered until it is met', () => {
    const rules = [{ text: 'At least 3 credits from ATOC', courses: ['ATOC 200', 'ATOC 300'], min: 3 }];
    const pool = ['ATOC 200', 'ATOC 300', 'GEOG 200', 'GEOG 300', 'GEOG 400'];
    const without = evaluate(rules, pool, ['GEOG 200', 'GEOG 300', 'GEOG 400'].map((c) => record(c))).groups[0];
    expect(without.coveredByPlan).toBe(false);
    expect(without.rules[0]).toMatchObject({ checked: true, met: false, have: 0, need: 3 });
    const withIt = evaluate(rules, pool, ['GEOG 200', 'GEOG 300', 'GEOG 400', 'ATOC 300'].map((c) => record(c))).groups[0];
    expect(withIt.coveredByPlan).toBe(true);
    expect(withIt.done).toBe(true);
    expect(withIt.rules[0]).toMatchObject({ met: true, have: 3 });
    expect(withIt.courses.find((c) => c.code === 'ATOC 300')?.state).toBe('completed');
  });

  it("doesn't count what's over a limit, which goes to electives instead", () => {
    const rules = [{ text: 'At most 3 credits at the 200 level', courses: ['A 200', 'B 200', 'C 200'], max: 3 }];
    const result = evaluate(rules, ['A 200', 'B 200', 'C 200', 'D 300'], ['A 200', 'B 200', 'C 200', 'D 300'].map((c) => record(c)), 6);
    expect(result.groups[0].rules[0]).toMatchObject({ met: true, have: 3, limit: 3 });
    expect(result.groups[0].coveredByPlan).toBe(true);
    expect(result.electiveCredits).toBe(6);
    const short = evaluate(rules, ['A 200', 'B 200', 'C 200'], ['A 200', 'B 200', 'C 200'].map((c) => record(c)), 6).groups[0];
    expect(short.coveredByPlan).toBe(false);
  });

  it('counts only one of a "not both" pair', () => {
    const rules = [{ text: 'Only one of MATH 317, COMP 350', courses: ['MATH 317', 'COMP 350'], maxCourses: 1 }];
    const group = evaluate(rules, ['MATH 317', 'COMP 350', 'MATH 340'], ['MATH 317', 'COMP 350', 'MATH 340'].map((c) => record(c)), 9).groups[0];
    expect(group.rules[0]).toMatchObject({ have: 1, limit: 1, unit: 'courses' });
    expect(group.coveredByPlan).toBe(false);
  });

  it('caps each subject and asks for several', () => {
    const rules = [
      { text: 'At most 3 credits from any one subject', courses: ['ANTH 200', 'ANTH 300', 'HIST 200'], max: 3, perSubject: true },
      { text: 'Courses from at least 2 different subjects', courses: ['ANTH 200', 'ANTH 300', 'HIST 200'], minSubjects: 2 },
    ];
    const one = evaluate(rules, ['ANTH 200', 'ANTH 300', 'HIST 200'], [record('ANTH 200'), record('ANTH 300')], 6).groups[0];
    expect(one.credits.completed).toBe(3);
    expect(one.rules[1]).toMatchObject({ met: false, have: 1, need: 2, unit: 'subjects' });
    const two = evaluate(rules, ['ANTH 200', 'ANTH 300', 'HIST 200'], [record('ANTH 200'), record('ANTH 300'), record('HIST 200')], 6).groups[0];
    expect(two.coveredByPlan).toBe(true);
    expect(two.rules[1]).toMatchObject({ met: true, have: 2 });
  });

  it('leaves sentences it cannot check to the student', () => {
    const group = evaluate([{ text: 'At least 3 credits focused on the period before 1800' }], ['A 200'], [record('A 200')], 3).groups[0];
    expect(group.rules[0]).toMatchObject({ checked: false, met: true });
    expect(group.coveredByPlan).toBe(true);
  });

  it('reads rules from the real programs', async () => {
    const programs = await loadPrograms();
    const software = toDegreeProgram(programs.find((p) => p.name === 'Software Engineering Major (B.Sc.)')!);
    const pool = software.groups.find((g) => g.kind === 'choose')!;
    expect(pool.credits).toBe(24);
    expect(pool.rules?.map((r) => r.text)).toEqual(expect.arrayContaining(['At least 9 credits from Group C: Software Engineering Specialization', 'At least 3 credits from Group D: Applications']));
    const rules = programs.flatMap((p) => p.parts.flatMap((part) => part.rules ?? []));
    expect(rules.filter((r) => r.courses).length).toBeGreaterThan(400);
    // Every rule lands in a group.
    for (const program of programs) {
      const inProgram = program.parts.flatMap((part) => (part.lists.length ? (part.rules ?? []) : []));
      const inDegree = toDegreeProgram(program).groups.flatMap((g) => g.rules ?? []).filter((r) => !r.text.includes("doesn't name"));
      expect(inDegree.length).toBe(inProgram.length);
      // A group can always be finished from its own list.
      for (const group of toDegreeProgram(program).groups) {
        if (group.kind === 'choose') expect(group.courses.length * 3).toBeGreaterThanOrEqual(group.credits ?? 0);
      }
    }
    const levels = programs.flatMap((p) => p.parts.flatMap((part) => (part.rules ?? []).filter((r) => r.text === 'At most 6 credits at the 200 level')));
    expect(levels.length).toBeGreaterThan(5);
    expect(levels.every((r) => r.courses!.every((code) => code.split(' ')[1].startsWith('2')))).toBe(true);
  });

  it('keeps the credits above a list\'s minimum', () => {
    const program = toDegreeProgram({
      id: 'x', name: 'X (B.Sc.)', kind: 'Major', faculty: null, unit: null, credits: 15, page: 1, degrees: [], prose: [],
      parts: [{
        title: 'Complementary (15 credits)', credits: [15, 15], kind: 'choose',
        lists: [
          { label: 'A', rule: '3-9 credits from:', page: 1, courses: ['A 100', 'A 200', 'A 300'] },
          { label: 'B', rule: '3-9 credits from:', page: 1, courses: ['B 100', 'B 200', 'B 300'] },
        ],
      }],
    });
    expect(program.groups.map((g) => g.credits)).toEqual([3, 3, 9]);
    expect(program.groups[2].courses).toEqual(['A 100', 'A 200', 'A 300', 'B 100', 'B 200', 'B 300']);
  });

  it("doesn't hold a plan back for courses its lists don't name", () => {
    const program = toDegreeProgram({
      id: 'x', name: 'X (B.Sc.)', kind: 'Major', faculty: null, unit: null, credits: 30, page: 1, degrees: [], prose: [],
      parts: [{ title: 'Complementary (30 credits)', credits: [30, 30], kind: 'choose', lists: [{ label: null, rule: '6 credits from:', page: 1, courses: ['A 100', 'A 200'] }] }],
    });
    expect(program.groups.map((g) => g.credits)).toEqual([6]);
    expect(program.groups[0].rules?.[0].text).toContain("24 credits partly from courses this list doesn't name");
    const result = evaluateDegree(program, ['A 100', 'A 200'].map((code) => ({ code, credits: 3, status: 'completed' as const, grade: 'A' })), () => 3);
    expect(result.groups[0].coveredByPlan).toBe(true);
  });
});
