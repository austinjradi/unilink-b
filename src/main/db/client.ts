import { inArray } from 'drizzle-orm';
import type { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sql-js';
import type { Database } from 'sql.js';
import { TERMS } from '@shared/dates';
import { CATALOGUE, sectionsFor } from './catalogue';
import { MIGRATIONS } from './migrations';
import * as schema from './schema';

// ReturnType<typeof fn> is the type of whatever a function returns: here, Drizzle's
// database object for this schema. Deriving it means it can't drift out of date.
export type DB = ReturnType<typeof openDatabase>;

// Drizzle's migrator normally reads files from disk. These internals are typed by hand
// so openDatabase can call them with migrations bundled into the JavaScript instead.
type Migratable = { dialect: SQLiteSyncDialect; session: Parameters<SQLiteSyncDialect['migrate']>[1] };

// SQLite compiled to WebAssembly (sql.js) instead of better-sqlite3. It's synchronous
// too, so the services run unchanged. The database lives in memory; web/storage.ts
// saves a copy of the whole file in the browser.
// Runs each time a database is opened or swapped in: enforce foreign keys, wrap it
// in Drizzle, run any migrations it hasn't had yet, and add the sample courses.
export function openDatabase(sqlite: Database) {
  // SQLite ignores REFERENCES and ON DELETE CASCADE unless
  // this is on, and it starts off on every new connection.
  sqlite.run('PRAGMA foreign_keys = ON');
  // `import * as schema` collected every table into one object. Passing
  // it here lets Drizzle know all the tables and their relations.
  const db = drizzle(sqlite, { schema });
  // What drizzle's migrate() does, minus reading the files from disk.
  // `as unknown as X` is a double cast: it tells TypeScript to trust us about
  // a type it can't check, here to reach fields Drizzle doesn't publish.
  const { dialect, session } = db as unknown as Migratable;
  dialect.migrate(MIGRATIONS, session);
  seedCatalogue(db);
  return db;
}

// The full catalogue is too big to make rows for each time the database opens, so a course
// gets its row and sections the first time someone could see it.
// A WeakMap keyed by the database object: when a database is closed and dropped, its entry
// can be garbage-collected with it. Each Set records which course sections already have rows.
const stocked = new WeakMap<DB, Set<string>>();

// Makes sure database rows exist for catalogue courses about to be shown. Cheap to call
// again and again, because anything done already is skipped before the database is touched.
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
  // A transaction: every insert lands together or none do, and SQLite does many
  // inserts much faster inside one. Inside the callback, use tx rather than db.
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
// onConflictDoNothing relies on the unique indexes in schema.ts (subject
// and number; course, term and section) to skip rows that already exist.
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
