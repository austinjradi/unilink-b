import type { MigrationMeta } from 'drizzle-orm/migrator';
import { sha256Hex } from '../crypto';
// Importing a JSON file gives a typed object. tsconfig's resolveJsonModule allows it.
import journal from '../../../drizzle/meta/_journal.json';

// The drizzle/ migrations, bundled in at build time. This is what drizzle's file-based
// migrator reads from disk, so saved browser databases upgrade the same way the desktop's do.
// import.meta.glob is a Vite feature resolved at build time: it finds every matching
// file and returns an object of { path: contents }. `query: '?raw'` imports each file as
// plain text, and `eager: true` includes them directly instead of loading them later.
const files = import.meta.glob<string>('../../../drizzle/*.sql', { query: '?raw', import: 'default', eager: true });

// drizzle-kit writes _journal.json, which lists the migrations in order. Each entry becomes what
// Drizzle's migrator expects: the SQL split into statements, a hash, and a timestamp
// (folderMillis). The migrator runs every migration newer than the last one this database recorded.
export const MIGRATIONS: MigrationMeta[] = journal.entries.map((entry) => {
  const sql = files[`../../../drizzle/${entry.tag}.sql`];
  if (sql == null) throw new Error(`Missing migration drizzle/${entry.tag}.sql`);
  // drizzle-kit separates statements with a `-->
  // statement-breakpoint` line, so each can run on its own.
  return { sql: sql.split('--> statement-breakpoint'), bps: entry.breakpoints, folderMillis: entry.when, hash: sha256Hex(sql) };
});
