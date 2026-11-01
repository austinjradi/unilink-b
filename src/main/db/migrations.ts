import type { MigrationMeta } from 'drizzle-orm/migrator';
import { sha256Hex } from '../crypto';
import journal from '../../../drizzle/meta/_journal.json';

// The drizzle/ migrations, bundled in at build time. This is what drizzle's file-based
// migrator reads from disk, so saved browser databases upgrade the same way the desktop's do.
const files = import.meta.glob<string>('../../../drizzle/*.sql', { query: '?raw', import: 'default', eager: true });

export const MIGRATIONS: MigrationMeta[] = journal.entries.map((entry) => {
  const sql = files[`../../../drizzle/${entry.tag}.sql`];
  if (sql == null) throw new Error(`Missing migration drizzle/${entry.tag}.sql`);
  return { sql: sql.split('--> statement-breakpoint'), bps: entry.breakpoints, folderMillis: entry.when, hash: sha256Hex(sql) };
});
