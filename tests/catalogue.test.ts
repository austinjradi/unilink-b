import { describe, expect, it } from 'vitest';
import { courseParts, dateOrder, degreeLabel, loadAwards, loadContents, loadCourses, loadGuide, loadIndex, loadPrograms, parseCatalogueDate, toDegreeProgram } from '@shared/catalogue';
import { evaluateDegree } from '@shared/degree';

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
