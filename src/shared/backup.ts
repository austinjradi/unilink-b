// A backup of everything UniLink keeps in this browser, as one file, since there's no server to
// keep it on: the database and the attachments. It's checked before anything is replaced.

export const BACKUP_APP = 'unilink-b';
const SQLITE_MAGIC = 'SQLite format 3\0';
// What attachments can be. Anything else comes back as a plain download, never as a page.
const FILE_TYPES = /^(image\/(png|jpeg|gif|webp)|text\/plain|application\/pdf)$/;

export interface BackupFile {
  path: string;
  type: string;
  bytes: Uint8Array;
}

export interface Backup {
  db: Uint8Array;
  files: BackupFile[];
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  // In pieces: String.fromCharCode can't take a whole file's worth of arguments.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function writeBackup({ db, files }: Backup, createdAt: Date) {
  return JSON.stringify({
    app: BACKUP_APP,
    version: 1,
    createdAt: createdAt.toISOString(),
    db: toBase64(db),
    files: files.map((f) => ({ path: f.path, type: f.type, data: toBase64(f.bytes) })),
  });
}

// null when it isn't one of ours, or something in it isn't what it should be.
export function readBackup(text: string): Backup | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed?.app !== BACKUP_APP || parsed.version !== 1 || typeof parsed.db !== 'string' || !Array.isArray(parsed.files)) return null;
    const db = fromBase64(parsed.db);
    if (String.fromCharCode(...db.subarray(0, SQLITE_MAGIC.length)) !== SQLITE_MAGIC) return null;
    const files: BackupFile[] = [];
    for (const f of parsed.files) {
      if (typeof f?.path !== 'string' || typeof f.data !== 'string') return null;
      if (!f.path.startsWith('/attachments/') || f.path.includes('..')) return null;
      files.push({ path: f.path, type: FILE_TYPES.test(f.type) ? f.type : 'application/octet-stream', bytes: fromBase64(f.data) });
    }
    return { db, files };
  } catch {
    return null;
  }
}
