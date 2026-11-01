// Everything the web build keeps between visits, in one IndexedDB store: the SQLite
// file under "db" and planner attachments under their /attachments/… paths.
// Private windows or blocked site data can make IndexedDB fail; then the app still
// works, it just forgets everything when the tab closes.

const DB_NAME = 'unilink';
const STORE = 'files';

let opening: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function open() {
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
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

async function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function load<T>(key: string): Promise<T | undefined> {
  if (memory.has(key)) return memory.get(key) as T;
  return ((await request('readonly', (s) => s.get(key))) ?? undefined) as T | undefined;
}

export async function save(key: string, value: unknown) {
  if ((await open()) == null) memory.set(key, value);
  else await request('readwrite', (s) => s.put(value, key));
}

export async function remove(key: string) {
  memory.delete(key);
  await request('readwrite', (s) => s.delete(key));
}

export async function clearAll() {
  memory.clear();
  await request('readwrite', (s) => s.clear());
}
