import { inArray } from 'drizzle-orm';
import type { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sql-js';
import type { Database } from 'sql.js';
import { TERMS } from '@shared/dates';
import { CATALOGUE, sectionsFor } from './catalogue';
import { MIGRATIONS } from './migrations';
import * as schema from './schema';

export type DB = ReturnType<typeof openDatabase>;

type Migratable = { dialect: SQLiteSyncDialect; session: Parameters<SQLiteSyncDialect['migrate']>[1] };

// SQLite compiled to WebAssembly (sql.js) instead of better-sqlite3. It's synchronous
// too, so the services run unchanged. The database lives in memory; web/storage.ts
// saves a copy of the whole file in the browser.
export function openDatabase(sqlite: Database) {
  sqlite.run('PRAGMA foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  // What drizzle's migrate() does, minus reading the files from disk.
  const { dialect, session } = db as unknown as Migratable;
  dialect.migrate(MIGRATIONS, session);
  seedCatalogue(db);
  return db;
}

// The full catalogue is too big to make rows for each time the database opens, so a course
// gets its row and sections the first time someone could see it.
const stocked = new WeakMap<DB, Set<string>>();

export function stockCourses(db: DB, wantedRows: { subject: string; number: string; title: string; credits: number; sections: { term: string; section: string }[] }[]) {
  const codeOf = (c: { subject: string; number: string }) => `${c.subject} ${c.number}`;
  // Scrolling asks for the courses above it again, so those don't go back to the database.
  const done = stocked.get(db) ?? new Set<string>();
  stocked.set(db, done);
  const keysOf = (row: (typeof wantedRows)[number]) => row.sections.map((s) => `${codeOf(row)}|${s.term}|${s.section}`);
  const rows = wantedRows.filter((row) => keysOf(row).some((key) => !done.has(key)));
  if (!rows.length) return;
  const known = new Set(db.select({ subject: schema.courses.subject, number: schema.courses.number }).from(schema.courses).all().map(codeOf));
  const wanted = new Set(rows.map(codeOf));
  db.transaction((tx) => {
    const missing = rows.filter((row) => !known.has(codeOf(row)));
    if (missing.length) tx.insert(schema.courses).values(missing.map(({ subject, number, title, credits }) => ({ subject, number, title, credits }))).onConflictDoNothing().run();
    const courses = tx.select({ id: schema.courses.id, subject: schema.courses.subject, number: schema.courses.number }).from(schema.courses).all().filter((c) => wanted.has(codeOf(c)));
    const sections = tx.select({ courseId: schema.classes.courseId, term: schema.classes.term, section: schema.classes.section }).from(schema.classes).where(inArray(schema.classes.courseId, courses.map((c) => c.id))).all();
    const have = new Set(sections.map((c) => `${c.courseId}|${c.term}|${c.section}`));
    const sectionsOf = new Map(rows.map((row) => [codeOf(row), row.sections]));
    const added = courses.flatMap((c) => (sectionsOf.get(codeOf(c)) ?? []).map(({ term, section }) => ({ courseId: c.id, term, section }))).filter((c) => !have.has(`${c.courseId}|${c.term}|${c.section}`));
    if (added.length) tx.insert(schema.classes).values(added).onConflictDoNothing().run();
  });
  for (const row of rows) for (const key of keysOf(row)) done.add(key);
}

// Idempotent, so new courses or terms added to the catalogue appear on next launch.
function seedCatalogue(db: ReturnType<typeof drizzle<typeof schema>>) {
  db.transaction((tx) => {
    tx.insert(schema.courses)
      .values(CATALOGUE.map(([subject, number, title, credits]) => ({ subject, number, title, credits })))
      .onConflictDoNothing()
      .run();
    const courses = tx.select({ id: schema.courses.id, number: schema.courses.number }).from(schema.courses).all();
    tx.insert(schema.classes)
      .values(courses.flatMap((c) => TERMS.flatMap((term) => sectionsFor(c.number).map((section) => ({ courseId: c.id, term, section })))))
      .onConflictDoNothing()
      .run();
  });
}
