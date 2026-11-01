import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { openDatabase } from '../main/db/client';
import { seedDemoData } from '../main/db/demo';
import { type Context, dispatch, type RpcResult } from '../main/rpc/core';
import { appRouter } from '../main/rpc/router';
import { backgroundTick, initialTickState } from '../main/services/studyMode';
import { FILES_DIR } from './node/fs';
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
  async resetDemo() {
    resetting = true;
    await saving;
    await storage.clearAll();
    channel?.postMessage({ type: 'reset' });
    location.reload();
  },
};
