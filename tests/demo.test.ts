import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { count, eq } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { beforeAll, describe, expect, it } from 'vitest';
import { type DB, openDatabase } from '../src/main/db/client';
import { seedDemoData } from '../src/main/db/demo';
import { CLASSMATES, QUIET_CLASSMATES, SECTIONS } from '../src/main/db/demoContent';
import * as schema from '../src/main/db/schema';

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs();
});

const rows = (db: DB, table: SQLiteTable) => db.select({ n: count() }).from(table).get()!.n;

describe('demo data', () => {
  it('fills the sections with everything in demoContent.ts, once', () => {
    const db = openDatabase(new SQL.Database());
    seedDemoData(db);

    const seeds = Object.values(SECTIONS);
    const sum = (f: (s: (typeof seeds)[number]) => number) => seeds.reduce((n, s) => n + f(s), 0);
    // Nothing was skipped because its author wasn't in the section (3 more come from the first demo).
    expect(rows(db, schema.users)).toBe(CLASSMATES.length + QUIET_CLASSMATES + 3);
    expect(rows(db, schema.posts)).toBe(sum((s) => s.posts?.length ?? 0) + 3);
    expect(rows(db, schema.replies)).toBe(sum((s) => (s.posts ?? []).reduce((n, p) => n + (p.replies?.length ?? 0), 0)) + 1);
    expect(rows(db, schema.studySessions)).toBe(sum((s) => s.sessions?.length ?? 0) + 2);
    expect(rows(db, schema.chatLinks)).toBe(sum((s) => s.links?.length ?? 0) + 3);
    expect(rows(db, schema.classDetails)).toBe(sum((s) => (s.details ? 1 : 0)) + 1);

    // One section per course and term for everyone.
    const doubled = db
      .select({ userId: schema.enrollments.userId, courseId: schema.classes.courseId, n: count() })
      .from(schema.enrollments)
      .innerJoin(schema.classes, eq(schema.enrollments.classId, schema.classes.id))
      .groupBy(schema.enrollments.userId, schema.classes.courseId, schema.classes.term)
      .all()
      .filter((r) => r.n > 1);
    expect(doubled).toEqual([]);

    // The planner ran for the sign-in accounts, and nothing is added twice.
    expect(rows(db, schema.plannerTasks)).toBeGreaterThan(10);
    const before = rows(db, schema.posts) + rows(db, schema.enrollments) + rows(db, schema.notifications);
    seedDemoData(db);
    expect(rows(db, schema.posts) + rows(db, schema.enrollments) + rows(db, schema.notifications)).toBe(before);
  });
});
