import * as storage from '../storage';
import { basename } from './path';

// Stands in for node:fs/promises in the browser build (see vite.config.ts), covering
// only what the services use. There are three kinds of path:
//
//   /picked/…       a file the student just chose (web/platform.ts), kept in memory
//   /attachments/…  files the app owns (ctx.filesDir), saved in IndexedDB
//   anything else   a save location (platform.chooseSaveLocation): writing it downloads the file

export const FILES_DIR = '/attachments';
const PICKED = '/picked/';

const picked = new Map<string, File>();
let pickCount = 0;

export function addPickedFile(file: File) {
  const path = `${PICKED}${++pickCount}/${file.name}`;
  picked.set(path, file);
  return path;
}

const owned = (path: string) => path.startsWith(`${FILES_DIR}/`);

export async function readBlob(path: string): Promise<Blob> {
  const blob = picked.get(path) ?? (owned(path) ? await storage.load<Blob>(path) : undefined);
  if (!blob) throw Object.assign(new Error(`ENOENT: no such file, open '${path}'`), { code: 'ENOENT' });
  return blob;
}

export async function readFile(path: string, _encoding: 'utf8'): Promise<string> {
  return (await readBlob(path)).text();
}

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
export async function mkdir(_path: string, _options?: { recursive?: boolean }) {}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
