import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { openDatabase } from '../main/db/client';
import { DEMO_HANDOUTS, seedDemoData } from '../main/db/demo';
import { type Context, dispatch, type RpcResult } from '../main/rpc/core';
import { appRouter } from '../main/rpc/router';
import { readBackup, writeBackup } from '../shared/backup';
import { backgroundTick, initialTickState } from '../main/services/studyMode';
import { FILES_DIR, addPickedFile, download } from './node/fs';
import { onNavigate, platform } from './platform';
import * as storage from './storage';

// What the desktop app's Electron main process and preload do, done inside the page:
// the same services and router run here against SQLite in WebAssembly, and
// window.unilink.call() dispatches to them directly instead of over IPC.

const DB_KEY = 'db';

// Other tabs on this site have their own copy of the database. Each saved copy is
// sent to them, so the newest state wins everywhere (open two tabs to be two classmates).
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('unilink-b') : null;

let SQL: SqlJsStatic;
let sqlite: Database;
let resetting = false;

function use(next: Database, ctx?: Context) {
  sqlite?.close();
  sqlite = next;
  const db = openDatabase(sqlite);
  if (ctx) ctx.db = db;
  return db;
}

// Saves the whole database file whenever something in it changed.
let saving = Promise.resolve();
function persist() {
  if (resetting) return;
  const changes = sqlite.exec('SELECT total_changes()')[0]?.values[0]?.[0];
  if (!changes) return;
  // export() reopens the connection, which also resets total_changes() and pragmas.
  const bytes = sqlite.export();
  sqlite.run('PRAGMA foreign_keys = ON');
  channel?.postMessage({ type: 'saved', bytes });
  saving = saving
    .then(() => storage.save(DB_KEY, bytes))
    .catch((err) => console.error('[storage] could not save the database:', err));
}

async function start(): Promise<Context> {
  const [sqlJs, saved] = await Promise.all([
    initSqlJs({ locateFile: () => wasmUrl }),
    storage.load<Uint8Array>(DB_KEY).catch(() => undefined),
  ]);
  SQL = sqlJs;
  const db = use(new SQL.Database(saved));
  // Like a desktop dev build: demo classmates to interact with, and reset codes shown on screen.
  seedDemoData(db);
  persist();
  for (const { path, text } of DEMO_HANDOUTS) {
    if (!(await storage.load<Blob>(path).catch(() => undefined))) await storage.save(path, new Blob([text], { type: 'text/plain' }));
  }

  const ctx: Context = { db, session: { userId: null }, platform, isDev: true, filesDir: FILES_DIR, now: () => new Date() };

  channel?.addEventListener('message', ({ data }) => {
    if (data?.type === 'saved') use(new SQL.Database(data.bytes), ctx);
    else if (data?.type === 'reset') location.reload();
  });

  // G3 reminders and ST1 study mode switching, as long as the tab is open.
  const tickState = initialTickState();
  const tick = () =>
    backgroundTick(ctx, tickState)
      .catch((err) => console.error('[tick] failed:', err))
      .finally(persist);
  setTimeout(tick, 3_000);
  setInterval(tick, 30_000);

  return ctx;
}

const ready = start();
ready.catch((err) => console.error('[unilink] could not start:', err));

window.unilink = {
  async call(path, input): Promise<RpcResult> {
    let ctx: Context;
    try {
      ctx = await ready;
    } catch {
      const failed = { code: 'INTERNAL', message: 'UniLink could not start in this browser. Try reloading the page.' } as const;
      return { ok: false, error: { ...failed, key: failed.message } };
    }
    const result = await dispatch(appRouter, path, input, ctx);
    persist();
    return result;
  },
  onNavigate,
  // A file the page already has (a pasted screenshot), usable like one from chooseFile.
  addFile: addPickedFile,
  async downloadBackup() {
    await ready;
    await saving;
    // Without anyone's sign-in: whoever restores it signs in again with their password.
    const copy = new SQL.Database(sqlite.export());
    sqlite.run('PRAGMA foreign_keys = ON');
    copy.run("DELETE FROM app_state WHERE key = 'session_token'; DELETE FROM auth_sessions;");
    const db = copy.export();
    copy.close();
    const files = [];
    for (const path of await storage.keys()) {
      if (!path.startsWith(`${FILES_DIR}/`)) continue;
      const blob = await storage.load<Blob>(path);
      if (blob) files.push({ path, type: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    download(new Blob([writeBackup({ db, files }, new Date())], { type: 'application/json' }), 'my-unilink-backup.unilink');
  },
  async restoreBackup(file) {
    await ready;
    const backup = readBackup(await file.text());
    if (!backup) return false;
    // It has to open as a database with accounts in it before anything here is replaced.
    try {
      const check = new SQL.Database(backup.db);
      check.exec('SELECT count(*) FROM users');
      check.close();
    } catch {
      return false;
    }
    resetting = true;
    await saving;
    await storage.clearAll();
    await storage.save(DB_KEY, backup.db);
    for (const f of backup.files) await storage.save(f.path, new Blob([f.bytes as BlobPart], { type: f.type }));
    channel?.postMessage({ type: 'reset' });
    location.reload();
    return true;
  },
  async resetDemo() {
    resetting = true;
    await saving;
    await storage.clearAll();
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith('unilink-')) localStorage.removeItem(key);
    } catch {
      // Nothing to forget if storage is off.
    }
    channel?.postMessage({ type: 'reset' });
    location.reload();
  },
};
