import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { RECORD_GRADES, RECORD_STATUSES } from '@shared/academics';
import { courseParts, degreeLabel, loadCourses, loadIndex, loadPrereqs, loadPrograms, toDegreeProgram } from '@shared/catalogue';
import { evaluateDegree, type Program } from '@shared/degree';
import { summarize } from '@shared/grades';
import { CURRENT_TERM } from '@shared/dates';
import { isOn } from '@shared/variants';
import type { DB } from '../db/client';
import { PROGRAMS } from '../db/programs';
import { classes, courseRecords, courses, enrollments, users } from '../db/schema';
import { whyCantPlan } from '@shared/prereqs';
import { AppError, idSchema, procedure } from '../rpc/core';
import { notFound } from './access';
import { gradedItems } from './courses';

// A1: the courses a student has taken, is taking and plans to take, with credits and grades.
// A2: which of them count toward a program, and what's still missing.

const code = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/^([A-Z]{3}[A-Z0-9])\s*-?\s*(\d{3}[A-Z0-9]*)$/, '$1 $2'))
  .refine((s) => /^[A-Z]{3}[A-Z0-9] \d{3}[A-Z0-9]*$/.test(s), 'Use a course code like "COMP 251"');

const recordFields = z
  .object({
    code,
    title: z.string().trim().max(200),
    credits: z.number().min(0).max(30),
    term: z.string().regex(/^(Winter|Summer|Fall) \d{4}$/, 'Pick a term'),
    status: z.enum(RECORD_STATUSES),
    grade: z.enum(RECORD_GRADES as [string, ...string[]]).nullable(),
  })
  .transform((r) => ({ ...r, grade: r.status === 'completed' ? r.grade : null }));

// 'lock-completed': a finished course stays as it was saved.
const LOCKED = 'A completed course is locked once it’s saved.';
const checkUnlocked = (record: { status: string }) => {
  if (isOn('lock-completed') && record.status === 'completed') throw new AppError(LOCKED, 'FORBIDDEN');
};

// 'check-prereqs': the sample rules stop a plan that can't happen.
async function checkPlan(db: DB, userId: number, fields: { code: string; term: string; status: string }, id?: number) {
  if (!isOn('check-prereqs') || fields.status !== 'planned') return;
  const record = db.select().from(courseRecords).where(eq(courseRecords.userId, userId)).all().filter((r) => r.id !== id);
  const reason = whyCantPlan(fields.code, fields.term, record, await loadPrereqs().catch(() => undefined));
  if (reason) throw new AppError(reason, 'BAD_INPUT');
}

function ownRecord(db: DB, userId: number, id: number) {
  return (
    db
      .select()
      .from(courseRecords)
      .where(and(eq(courseRecords.id, id), eq(courseRecords.userId, userId)))
      .get() ?? notFound('course')
  );
}

function catalogueCredits(db: DB) {
  const rows = db.select({ subject: courses.subject, number: courses.number, credits: courses.credits }).from(courses).all();
  const map = new Map(rows.map((r) => [`${r.subject} ${r.number}`, r.credits]));
  return (c: string) => map.get(c) ?? 3;
}

function catalogueTitle(db: DB, courseCode: string) {
  return (
    db
      .select({ title: courses.title })
      .from(courses)
      .where(sql`${courses.subject} || ' ' || ${courses.number} = ${courseCode}`)
      .get()?.title ?? ''
  );
}

// A course in the full catalogue that nobody has added yet isn't in the database.
const inFullCatalogue = async (compact: string) => (await loadCourses().catch(() => [])).find(([courseCode]) => courseCode.replace(' ', '') === compact);

function myClasses(db: DB, userId: number) {
  return db
    .select({ classId: classes.id, term: classes.term, subject: courses.subject, number: courses.number, title: courses.title, credits: courses.credits })
    .from(enrollments)
    .innerJoin(classes, eq(enrollments.classId, classes.id))
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .where(eq(enrollments.userId, userId))
    .all();
}

export const recordRouter = {
  goal: procedure(z.void(), (_input, ctx) => ({
    goal: ctx.db.select({ goal: users.cgpaGoal }).from(users).where(eq(users.id, ctx.userId)).get()?.goal ?? null,
  })),

  setGoal: procedure(z.object({ goal: z.number().min(0).max(4).nullable() }), ({ goal }, ctx) => {
    ctx.db.update(users).set({ cgpaGoal: goal }).where(eq(users.id, ctx.userId)).run();
  }),

  // In-progress courses that match a joined class carry the live A5 estimate.
  list: procedure(z.void(), (_input, ctx) => {
    // 'record-sync-classes': what's joined this term is on the record without being added.
    if (isOn('record-sync-classes')) {
      const onRecord = ctx.db.select({ code: courseRecords.code, term: courseRecords.term }).from(courseRecords).where(eq(courseRecords.userId, ctx.userId)).all();
      const credits = catalogueCredits(ctx.db);
      for (const c of myClasses(ctx.db, ctx.userId)) {
        const courseCode = `${c.subject} ${c.number}`;
        if (c.term !== CURRENT_TERM || onRecord.some((r) => r.code === courseCode && r.term === c.term)) continue;
        ctx.db.insert(courseRecords).values({ code: courseCode, title: catalogueTitle(ctx.db, courseCode), credits: credits(courseCode), term: c.term, status: 'in-progress', grade: null, userId: ctx.userId }).run();
      }
    }
    const records = ctx.db
      .select()
      .from(courseRecords)
      .where(eq(courseRecords.userId, ctx.userId))
      .orderBy(asc(courseRecords.code))
      .all();
    const joined = new Map(myClasses(ctx.db, ctx.userId).map((c) => [`${c.subject} ${c.number}|${c.term}`, c.classId]));
    return records.map((r) => {
      const classId = r.status === 'in-progress' ? (joined.get(`${r.code}|${r.term}`) ?? null) : null;
      const items = classId ? gradedItems(ctx.db, ctx.userId, classId) : [];
      return { ...r, classId, currentAverage: items.length ? summarize(items).currentAverage : null };
    });
  }),

  add: procedure(recordFields, async (fields, ctx) => {
    await checkPlan(ctx.db, ctx.userId, fields);
    const dup = ctx.db
      .select({ id: courseRecords.id })
      .from(courseRecords)
      .where(and(eq(courseRecords.userId, ctx.userId), eq(courseRecords.code, fields.code), eq(courseRecords.term, fields.term)))
      .get();
    if (dup) throw new AppError('{{code}} is already in your record for {{term}}.', 'CONFLICT', { code: fields.code, term: { term: fields.term } });
    ctx.db
      .insert(courseRecords)
      .values({ ...fields, title: fields.title || catalogueTitle(ctx.db, fields.code) || ((await inFullCatalogue(fields.code.replace(' ', '')))?.[1] ?? ''), userId: ctx.userId })
      .run();
  }),

  update: procedure(z.object({ id: idSchema }).and(recordFields), async ({ id, ...fields }, ctx) => {
    await checkPlan(ctx.db, ctx.userId, fields, id);
    checkUnlocked(ownRecord(ctx.db, ctx.userId, id));
    ctx.db.update(courseRecords).set(fields).where(eq(courseRecords.id, id)).run();
  }),

  remove: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    checkUnlocked(ownRecord(ctx.db, ctx.userId, id));
    ctx.db.delete(courseRecords).where(eq(courseRecords.id, id)).run();
  }),

  // Adds the classes joined on UniLink (S1) as in-progress courses.
  importClasses: procedure(z.void(), (_input, ctx) => {
    let added = 0;
    for (const c of myClasses(ctx.db, ctx.userId)) {
      const courseCode = `${c.subject} ${c.number}`;
      const exists = ctx.db
        .select({ id: courseRecords.id })
        .from(courseRecords)
        .where(and(eq(courseRecords.userId, ctx.userId), eq(courseRecords.code, courseCode), eq(courseRecords.term, c.term)))
        .get();
      if (exists) continue;
      ctx.db
        .insert(courseRecords)
        .values({ userId: ctx.userId, code: courseCode, title: c.title, credits: c.credits, term: c.term, status: 'in-progress' })
        .run();
      added++;
    }
    return { added };
  }),

  // Catalogue lookup for the "add course" form.
  lookup: procedure(z.object({ code: z.string() }), async ({ code: raw }, ctx) => {
    const compact = raw.replace(/[\s-]+/g, '').toUpperCase();
    const added = ctx.db
      .select({ subject: courses.subject, number: courses.number, title: courses.title, credits: courses.credits })
      .from(courses)
      .where(sql`upper(${courses.subject} || ${courses.number}) = ${compact}`)
      .get();
    if (added) return added;
    const row = await inFullCatalogue(compact);
    return row ? { ...courseParts(row[0]), title: row[1], credits: row[2] ?? 3 } : null;
  }),
};

// The degree check works with the full catalogue's programs; the samples stay for accounts using them.
const findProgram = async (programId: string | null | undefined): Promise<Program | null> => {
  const sample = PROGRAMS.find((p) => p.id === programId);
  if (sample || !programId) return sample ?? null;
  const found = (await loadPrograms()).find((p) => p.id === programId);
  if (!found) return null;
  const credits = new Map((await loadCourses()).map(([code, , value]) => [code, value ?? 3]));
  return toDegreeProgram(found, (code) => credits.get(code) ?? 3);
};

export const degreeRouter = {
  // Every program, under the part of the catalogue it's in. A sample only shows for an account using it.
  programs: procedure(z.void(), async (_input, ctx) => {
    const [programs, index] = await Promise.all([loadPrograms(), loadIndex()]);
    const partOf = new Map(index.programs.map((p) => [p.id, p.part]));
    const current = ctx.db.select({ id: users.degreeProgramId }).from(users).where(eq(users.id, ctx.userId)).get()?.id;
    return [
      ...programs.map((p) => ({ id: p.id, name: p.name, degree: degreeLabel(p.name, p.degrees), totalCredits: p.credits ?? 0, group: partOf.get(p.id) ?? null })),
      ...PROGRAMS.filter((p) => p.id === current).map(({ id, name, degree, totalCredits }) => ({ id, name, degree, totalCredits, group: null })),
    ];
  }),

  select: procedure(z.object({ programId: z.string().nullable() }), async ({ programId }, ctx) => {
    if (programId && !(await findProgram(programId))) notFound('program');
    ctx.db.update(users).set({ degreeProgramId: programId }).where(eq(users.id, ctx.userId)).run();
  }),

  // A2: the selected program checked against the A1 record.
  evaluate: procedure(z.void(), async (_input, ctx) => {
    const programId = ctx.db.select({ id: users.degreeProgramId }).from(users).where(eq(users.id, ctx.userId)).get()?.id;
    const program = await findProgram(programId);
    if (!program) return null;
    const records = ctx.db.select().from(courseRecords).where(eq(courseRecords.userId, ctx.userId)).all();
    const rows = await loadCourses();
    const added = catalogueCredits(ctx.db);
    const credits = new Map(rows.map(([code, , value]) => [code, value ?? 3]));
    const creditsOf = (code: string) => credits.get(code) ?? added(code);
    const titles = new Map<string, string>(rows.map(([code, title]) => [code, title]));
    for (const c of ctx.db.select({ subject: courses.subject, number: courses.number, title: courses.title }).from(courses).all()) {
      if (!titles.has(`${c.subject} ${c.number}`)) titles.set(`${c.subject} ${c.number}`, c.title);
    }
    return {
      program,
      evaluation: evaluateDegree(program, records, creditsOf),
      titles: Object.fromEntries(titles),
    };
  }),
};
