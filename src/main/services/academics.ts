import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { RECORD_GRADES, RECORD_STATUSES } from '@shared/academics';
import { evaluateDegree } from '@shared/degree';
import { summarize } from '@shared/grades';
import type { DB } from '../db/client';
import { PROGRAMS } from '../db/programs';
import { classes, courseRecords, courses, enrollments, users } from '../db/schema';
import { AppError, idSchema, procedure } from '../rpc/core';
import { notFound } from './access';
import { gradedItems } from './courses';

// A1: the courses a student has taken, is taking and plans to take, with credits and grades.
// A2: which of them count toward a program, and what's still missing.

const code = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/^([A-Z]{4})\s*-?\s*(\d{3}[A-Z0-9]*)$/, '$1 $2'))
  .refine((s) => /^[A-Z]{4} \d{3}[A-Z0-9]*$/.test(s), 'Use a course code like "COMP 251"');

const recordFields = z
  .object({
    code,
    title: z.string().trim().max(200),
    credits: z.number().min(0).max(12),
    term: z.string().regex(/^(Winter|Summer|Fall) \d{4}$/, 'Pick a term'),
    status: z.enum(RECORD_STATUSES),
    grade: z.enum(RECORD_GRADES as [string, ...string[]]).nullable(),
  })
  .transform((r) => ({ ...r, grade: r.status === 'completed' ? r.grade : null }));

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
  // In-progress courses that match a joined class carry the live A5 estimate.
  list: procedure(z.void(), (_input, ctx) => {
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

  add: procedure(recordFields, (fields, ctx) => {
    const dup = ctx.db
      .select({ id: courseRecords.id })
      .from(courseRecords)
      .where(and(eq(courseRecords.userId, ctx.userId), eq(courseRecords.code, fields.code), eq(courseRecords.term, fields.term)))
      .get();
    if (dup) throw new AppError('{{code}} is already in your record for {{term}}.', 'CONFLICT', { code: fields.code, term: { term: fields.term } });
    ctx.db
      .insert(courseRecords)
      .values({ ...fields, title: fields.title || catalogueTitle(ctx.db, fields.code), userId: ctx.userId })
      .run();
  }),

  update: procedure(z.object({ id: idSchema }).and(recordFields), ({ id, ...fields }, ctx) => {
    ownRecord(ctx.db, ctx.userId, id);
    ctx.db.update(courseRecords).set(fields).where(eq(courseRecords.id, id)).run();
  }),

  remove: procedure(z.object({ id: idSchema }), ({ id }, ctx) => {
    ownRecord(ctx.db, ctx.userId, id);
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
  lookup: procedure(z.object({ code: z.string() }), ({ code: raw }, ctx) => {
    const compact = raw.replace(/\s+/g, '').toUpperCase();
    return (
      ctx.db
        .select({ subject: courses.subject, number: courses.number, title: courses.title, credits: courses.credits })
        .from(courses)
        .where(sql`upper(${courses.subject} || ${courses.number}) = ${compact}`)
        .get() ?? null
    );
  }),
};

export const degreeRouter = {
  programs: procedure(z.void(), () =>
    PROGRAMS.map(({ id, name, degree, totalCredits }) => ({ id, name, degree, totalCredits })),
  ),

  select: procedure(z.object({ programId: z.string().nullable() }), ({ programId }, ctx) => {
    if (programId && !PROGRAMS.some((p) => p.id === programId)) notFound('program');
    ctx.db.update(users).set({ degreeProgramId: programId }).where(eq(users.id, ctx.userId)).run();
  }),

  // A2: the selected program checked against the A1 record.
  evaluate: procedure(z.void(), (_input, ctx) => {
    const programId = ctx.db.select({ id: users.degreeProgramId }).from(users).where(eq(users.id, ctx.userId)).get()?.id;
    const program = PROGRAMS.find((p) => p.id === programId);
    if (!program) return null;
    const records = ctx.db.select().from(courseRecords).where(eq(courseRecords.userId, ctx.userId)).all();
    const creditsOf = catalogueCredits(ctx.db);
    const titles = new Map(
      ctx.db
        .select({ subject: courses.subject, number: courses.number, title: courses.title })
        .from(courses)
        .all()
        .map((c) => [`${c.subject} ${c.number}`, c.title]),
    );
    return {
      program,
      evaluation: evaluateDegree(program, records, creditsOf),
      titles: Object.fromEntries(titles),
    };
  }),
};
