// Everything the web build keeps between visits, in one IndexedDB store: the SQLite
// file under "db" and planner attachments under their /attachments/… paths.
// Private windows or blocked site data can make IndexedDB fail; then the app still
// works, it just forgets everything when the tab closes.

// Its own name, so version B never reads or overwrites the original's data on the same site.
const DB_NAME = 'unilink-b';
const STORE = 'files';

// The one promise of an opened database, shared by every caller, so IndexedDB is opened only once.
let opening: Promise<IDBDatabase | null> | null = null;
// Where values go when IndexedDB is unavailable. Everything
// still works, but it's lost when the tab closes.
const memory = new Map<string, unknown>();

function open() {
  // `??=` assigns only when `opening` is null or undefined, so the first call
  // opens the database and later calls reuse the same promise. IndexedDB
  // reports results through events, so they're wrapped in a promise here.
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      // Runs when the database is new or its version number
      // goes up: the only time object stores can be created.
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  }).then((db) => {
    if (!db) console.warn('[storage] IndexedDB is unavailable; nothing will be saved after this tab closes.');
    return db;
  });
  return opening;
}

// A generic helper: runs one request in a transaction and turns its success and error events
// into a promise. <T> is the type of the request's result, passed through to the caller.
async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Whether anything saved here outlasts this tab.
// `!= null` (loose, with one =) is true for both null and undefined.
export const available = async () => (await open()) != null;

// Asks the browser not to clear this site's data to free up space. It's only a request; some
// browsers grant it silently, and some ask the person.
export async function askToKeep() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Nothing more to do: this is what the backup reminder is for.
  }
}

// Checks the memory fallback first, then IndexedDB. `?? undefined` turns a missing value
// (null) into undefined, and `as T` tells TypeScript what the caller expects to get.
export async function load<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  return ((await request('readonly', (s) => s.get(key))) ?? undefined) as T | undefined;
}

export async function save(key: string, value: unknown) {
  // Values go to memory only when IndexedDB is unavailable.
  if ((await open()) == null) memory.set(key, value);
  else await request('readwrite', (s) => s.put(value, key));
}

export async function remove(key: string) {
  memory.delete(key);
  await request('readwrite', (s) => s.delete(key));
}

// Every saved key from both places. Spreading into a Set removes
// duplicates, and spreading the Set into [] turns it back into an array.
export async function keys() {
  const saved = (await request('readonly', (s) => s.getAllKeys())) ?? [];
  return [...new Set([...saved.map(String), ...memory.keys()])];
}

export async function clearAll() {
  memory.clear();
  await request('readwrite', (s) => s.clear());
}
