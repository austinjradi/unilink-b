import type { SQLiteSyncDialect } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sql-js';
import type { Database } from 'sql.js';
import { TERMS } from '@shared/dates';
import { CATALOGUE } from './catalogue';
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

// Idempotent, so new courses or terms added to the catalogue appear on next launch.
function seedCatalogue(db: ReturnType<typeof drizzle<typeof schema>>) {
  db.transaction((tx) => {
    tx.insert(schema.courses)
      .values(CATALOGUE.map(([subject, number, title, credits]) => ({ subject, number, title, credits })))
      .onConflictDoNothing()
      .run();
    const courses = tx.select({ id: schema.courses.id }).from(schema.courses).all();
    tx.insert(schema.classes)
      .values(courses.flatMap((c) => TERMS.map((term) => ({ courseId: c.id, term }))))
      .onConflictDoNothing()
      .run();
  });
}
