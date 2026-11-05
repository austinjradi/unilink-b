// `type Database` inside the braces imports only a
// TypeScript type. It disappears from the built JavaScript.
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
// The ?url suffix is a Vite feature: instead of the file's contents, the import gives
// the URL the built file will be served from, including the hash Vite adds to its name.
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { openDatabase } from '../main/db/client';
import { DEMO_HANDOUTS, seedDemoData } from '../main/db/demo';
import { type Context, dispatch, type RpcResult } from '../main/rpc/core';
import { appRouter } from '../main/rpc/router';
import { isSealed, openSealed, readBackup, sealBackup, writeBackup } from '../shared/backup';
import { isOn, subscribeVariants } from '../shared/variants';
import { backgroundTick, initialTickState } from '../main/services/studyMode';
import { FILES_DIR, addPickedFile, download } from './node/fs';
import { onNavigate, platform } from './platform';
import * as storage from './storage';
import { LAST_BACKUP_KEY } from '../main/services/notifications';

// What the desktop app's Electron main process and preload do, done inside the page:
// the same services and router run here against SQLite in WebAssembly, and
// window.unilink.call() dispatches to them directly instead of over IPC.

// 'empty-start' keeps its own database, so what was here is still there on switching back.
// Which IndexedDB key holds the database. It's a function
// because a switch can change while the page is open.
const dbKey = () => (isOn('empty-start') ? 'db-empty' : 'db');
// The key this page started with, fixed for the life of the page.
const DB_KEY = dbKey();
// When a switch change would mean a different key, reload,
// so the page opens the other database from scratch.
subscribeVariants(() => {
  if (dbKey() !== DB_KEY) location.reload();
});

// Other tabs on this site have their own copy of the database. Each saved copy is
// sent to them, so the newest state wins everywhere (open two tabs to be two classmates).
// A BroadcastChannel delivers messages to every other tab of this site
// that opened a channel with the same name. Very old browsers lack it,
// hence the check and the null, and `channel?.` wherever it's used.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('unilink-b') : null;

// The sql.js library once loaded (SQL), and the open database (sqlite).
// Declared without a value: start() assigns both before anything reads them.
let SQL: SqlJsStatic;
let sqlite: Database;
// True while wiping or restoring, so no save can write the old data back afterwards.
let resetting = false;

// Swaps in a database: closes the old one, wraps the new one in Drizzle
// (openDatabase also migrates it), and points the shared ctx at it so
// later procedure calls use it. `ctx?:` makes the parameter optional.
function use(next: Database, ctx?: Context) {
  // `?.` calls close() only if there's an old database.
  // On the very first call, sqlite is still undefined.
  sqlite?.close();
  sqlite = next;
  const db = openDatabase(sqlite);
  if (ctx) ctx.db = db;
  return db;
}

// Told when saving stops working, and when it works again, so nobody keeps working on what won't last.
let saveProblem = false;
const saveListeners = new Set<(problem: boolean) => void>();
function setSaveProblem(problem: boolean) {
  saveProblem = problem;
  for (const listener of saveListeners) listener(problem);
}

// Saves the whole database file whenever something in it changed.
// A chain of saves. Each new save is attached with .then() to the end of the chain, so
// saves reach IndexedDB in the order they were made, even though each one is asynchronous.
let saving = Promise.resolve();
function persist() {
  if (resetting) return;
  // exec() returns a list of results shaped { columns, values }. The `?.` chain digs
  // out the single number, or gives undefined if there's none. total_changes() counts
  // rows changed since the connection opened, so 0 means there's nothing to save.
  const changes = sqlite.exec('SELECT total_changes()')[0]?.values[0]?.[0];
  if (!changes) return;
  // export() reopens the connection, which also resets total_changes() and pragmas.
  const bytes = sqlite.export();
  sqlite.run('PRAGMA foreign_keys = ON');
  // Other tabs get the raw bytes. postMessage copies the data
  // (a structured clone), so each tab owns its own copy.
  channel?.postMessage({ type: 'saved', key: DB_KEY, bytes });
  // Reassigning `saving` to the longer chain is what queues this save behind any still running.
  saving = saving
    .then(async () => {
      await storage.save(DB_KEY, bytes);
      setSaveProblem(!(await storage.available()));
    })
    .catch((err) => {
      console.error('[storage] could not save the database:', err);
      setSaveProblem(true);
    });
}

// Startup: everything that has to happen before the first procedure
// call. It resolves to the ctx object that every procedure receives.
async function start(): Promise<Context> {
  // Promise.all runs both at once (loading the WebAssembly, and reading the saved database)
  // and waits for both. The array destructuring takes the two results in the same order.
  const [sqlJs, saved] = await Promise.all([
    // locateFile tells sql.js where its .wasm file is, since Vite gave it a new name.
    initSqlJs({ locateFile: () => wasmUrl }),
    // <Uint8Array> tells TypeScript what kind of value comes
    // back. A failed read counts as no saved database.
    storage.load<Uint8Array>(DB_KEY).catch(() => undefined),
  ]);
  SQL = sqlJs;
  setSaveProblem(!(await storage.available()));
  // new SQL.Database(undefined) creates an empty database. Given bytes, it opens that file instead.
  const db = use(new SQL.Database(saved));
  // Like a desktop dev build: demo classmates to interact with, and reset codes shown on screen.
  // Adds the demo classmates, or upgrades an older demo. It does
  // nothing when this database already has the current demo.
  if (!isOn('empty-start')) seedDemoData(db);
  persist();
  // Demo attachments are files, not rows, so they're stored in IndexedDB separately, and only
  // if they aren't there yet. `{ path, text }` destructures each handout in the loop header.
  for (const { path, text } of DEMO_HANDOUTS) {
    if (!(await storage.load<Blob>(path).catch(() => undefined))) await storage.save(path, new Blob([text], { type: 'text/plain' }));
  }

  // The one context object for this tab. dispatch() copies it for each call and adds userId. `session`
  // is changed in place by sign-in and sign-out, so it's how the tab remembers who is signed in.
  const ctx: Context = { db, session: { userId: null }, platform, isDev: true, filesDir: FILES_DIR, now: () => new Date() };

  // `({ data })` destructures the MessageEvent. Another tab saved: open its
  // bytes as this tab's database. Another tab reset everything: reload.
  channel?.addEventListener('message', ({ data }) => {
    if (data?.type === 'saved' && data.key === DB_KEY) use(new SQL.Database(data.bytes), ctx);
    else if (data?.type === 'reset') location.reload();
  });

  // G3 reminders and ST1 study mode switching, as long as the tab is open.
  // Remembers between ticks what was last done (study mode on
  // or off, which user), so each tick acts only on changes.
  const tickState = initialTickState();
  // Runs the background work, logs a failure instead of letting it
  // escape, and saves whatever it changed. .finally() runs either way.
  const tick = () =>
    backgroundTick(ctx, tickState)
      .catch((err) => console.error('[tick] failed:', err))
      .finally(persist);
  // The first tick comes 3 seconds after startup, then one every 30 seconds
  // while the tab is open. The underscore in 3_000 is only a digit separator.
  setTimeout(tick, 3_000);
  setInterval(tick, 30_000);

  return ctx;
}

// Not awaited here: start() runs in the background, and `ready` is the promise of its
// result. Each call below awaits it, so calls made during startup just wait their turn.
const ready = start();
// Logs a failed startup. Without a catch, the rejection would also be reported as unhandled.
ready.catch((err) => console.error('[unilink] could not start:', err));

// The object the React app talks to. Its shape is declared in api.d.ts, so a missing or
// misspelled method here fails typecheck. Method shorthand like `async call(path,
// input) { … }` is the same as `call: async (path, input) => { … }`, apart from `this`.
window.unilink = {
  // Every rpc.x.y() call from React ends up here, with a path like 'classes.join'.
  async call(path, input): Promise<RpcResult> {
    // If startup failed, awaiting `ready` throws. The catch then answers with an
    // error result instead of throwing, in the same shape a failed procedure returns.
    let ctx: Context;
    try {
      ctx = await ready;
    } catch {
      const failed = { code: 'INTERNAL', message: 'UniLink could not start in this browser. Try reloading the page.' } as const;
      return { ok: false, error: { ...failed, key: failed.message } };
    }
    // Runs the procedure: finds it in the router, checks sign-in,
    // validates the input and calls the handler (see main/rpc/core.ts).
    const result = await dispatch(appRouter, path, input, ctx);
    // A search only adds catalogue rows it can add again, so those wait for the next save.
    if (path !== 'catalogue.search') persist();
    return result;
  },
  // Shorthand for `onNavigate: onNavigate`.
  onNavigate,
  // A file the page already has (a pasted screenshot), usable like one from chooseFile.
  addFile: addPickedFile,
  // A subscribe-style API: it adds the listener, tells it the current state straight away, and
  // returns a function that unsubscribes. A useEffect can return that function as its cleanup.
  onSaveProblem(listener) {
    saveListeners.add(listener);
    listener(saveProblem);
    return () => saveListeners.delete(listener);
  },
  keepData: () => storage.askToKeep(),
  // Builds a backup: the database without anyone's sign-in, plus every
  // attachment, as one JSON file, sealed with a passphrase if one is given.
  async downloadBackup(passphrase) {
    await ready;
    sqlite.run('INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)', [LAST_BACKUP_KEY, String(Date.now())]);
    persist();
    await saving;
    // Without anyone's sign-in: whoever restores it signs in again with their password.
    // Works on a copy, so deleting the sign-in rows never touches the live database.
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
    const text = writeBackup({ db, files }, new Date());
    download(new Blob([passphrase ? await sealBackup(text, passphrase) : text], { type: 'application/json' }), 'my-unilink-backup.unilink');
  },
  // Replaces everything with a backup, but only after checking
  // it. Resolves to false for a file that isn't a backup.
  async restoreBackup(file, passphrase) {
    await ready;
    const text = await file.text();
    const opened = isSealed(text) ? await openSealed(text, passphrase ?? '') : text;
    const backup = opened == null ? null : readBackup(opened);
    if (!backup) return false;
    // It has to open as a database with accounts in it before anything here is replaced.
    try {
      const check = new SQL.Database(backup.db);
      check.exec('SELECT count(*) FROM users');
      check.close();
    } catch {
      return false;
    }
    // From here on no save may run, or the old data could be written back over the restored copy.
    resetting = true;
    await saving;
    await storage.clearAll();
    await storage.save(DB_KEY, backup.db);
    for (const f of backup.files) await storage.save(f.path, new Blob([f.bytes as BlobPart], { type: f.type }));
    channel?.postMessage({ type: 'reset' });
    location.reload();
    return true;
  },
  // Wipes IndexedDB and this app's localStorage keys,
  // tells the other tabs, and reloads into a fresh demo.
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
