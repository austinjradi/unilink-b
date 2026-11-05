import * as storage from '../storage';
import { basename } from './path';

// Stands in for node:fs/promises in the browser build (see vite.config.ts), covering
// only what the services use. There are three kinds of path:
//
//   /picked/…       a file the student just chose (web/platform.ts), kept in memory
//   /attachments/…  files the app owns (ctx.filesDir), saved in IndexedDB
//   anything else   a save location (platform.chooseSaveLocation): writing it downloads the file

// A browser has no real files or folders, so these paths are only names: keys in a Map or in IndexedDB.
export const FILES_DIR = '/attachments';
const PICKED = '/picked/';

// Files picked during this visit. A File object can only
// live in memory, so these are gone after a reload.
const picked = new Map<string, File>();
let pickCount = 0;

// Gives a picked file a made-up path, unique thanks to the
// counter. Services treat that string like a path on disk.
export function addPickedFile(file: File) {
  const path = `${PICKED}${++pickCount}/${file.name}`;
  picked.set(path, file);
  return path;
}

// Whether a path is one the app keeps in IndexedDB.
const owned = (path: string) => path.startsWith(`${FILES_DIR}/`);

// Finds a file by path in either place. A missing file throws an error shaped like
// Node's (with code ENOENT), so code written for Node handles it the same way.
export async function readBlob(path: string): Promise<Blob> {
  const blob = picked.get(path) ?? (owned(path) ? await storage.load<Blob>(path) : undefined);
  if (!blob) throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
  return blob;
}

// The leading underscore marks a parameter that's accepted but unused. It's
// there so calls written for Node, readFile(path, 'utf8'), still type-check.
export async function readFile(path: string, _encoding: 'utf8'): Promise<string> {
  return (await readBlob(path)).text();
}

// Writing inside /attachments saves to IndexedDB. Writing anywhere else means the
// user is exporting something (a calendar file, say), so the browser downloads it.
export async function writeFile(path: string, data: string, _encoding: 'utf8') {
  const blob = new Blob([data], { type: path.endsWith('.ics') ? 'text/calendar' : 'text/plain' });
  if (owned(path)) return storage.save(path, blob);
  download(blob, basename(path));
}

export async function copyFile(source: string, target: string) {
  if (!owned(target)) throw new Error(`Can only copy into ${FILES_DIR}`);
  await storage.save(target, await readBlob(source));
}

export async function stat(path: string) {
  const blob = await readBlob(path);
  return { size: blob.size, isFile: () => true };
}

export async function rm(path: string, _options?: { force?: boolean }) {
  picked.delete(path);
  if (owned(path)) await storage.remove(path);
}

// Folders are implied by paths.
// Does nothing, on purpose.
export async function mkdir(_path: string, _options?: { recursive?: boolean }) {}

// The usual way to start a download from code: a temporary <a download> link to an object
// URL, clicked and removed. The URL is revoked a minute later to free the memory it holds.
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
