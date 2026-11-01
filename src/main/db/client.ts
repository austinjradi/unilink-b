import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { TERMS } from '@shared/dates';
import { CATALOGUE } from './catalogue';
import * as schema from './schema';

export type DB = ReturnType<typeof openDatabase>;

export function openDatabase(file: string, migrationsFolder: string) {
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
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
