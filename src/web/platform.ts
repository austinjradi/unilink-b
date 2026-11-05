import { notifications } from '@mantine/notifications';
import type { Platform } from '../main/rpc/core';
import { docxText } from '../shared/docx';
import { addPickedFile, download, readBlob } from './node/fs';
import { basename } from './node/path';

// The browser's versions of the native features the desktop app gets from Electron.

// A Set of callbacks. A Set can't hold the same function twice, and removing one is a single call.
const navigateListeners = new Set<(link: string) => void>();

// Clicking a notification opens what it's about (Layout.tsx subscribes).
// Returns an unsubscribe function. In `() => void navigateListeners.delete(callback)`, `void`
// throws away delete()'s true/false, so the function returns nothing, as an effect cleanup should.
export function onNavigate(callback: (link: string) => void) {
  navigateListeners.add(callback);
  return () => void navigateListeners.delete(callback);
}

// Attachments are stored as "<uuid>-<name>" (services/planner.ts).
// The regex matches a UUID (8-4-4-4-12 hex digits) and
// a dash at the start of the file name, and removes it.
const originalName = (path: string) => basename(path).replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-/, '');

// Types a browser tab can show itself; anything else is downloaded.
// ^( … )$ makes the regex match the whole MIME type, and each | separates one allowed kind.
const VIEWABLE = /^(image\/(png|jpeg|gif|webp)$|text\/plain$|application\/pdf$)/;

// Plain-text handouts that browsers don't always give a text/* type.
const TEXT_FILE = /\.(txt|md|markdown|tex|rst)$/i;

// One object URL per file for as long as the page is open.
// Object URLs (blob:…) point at data held in memory. Keeping one per
// file avoids a new URL, and another live copy, on every render.
const fileUrls = new Map<string, string>();

// One line of text per line in the PDF, so headings like "Question 2" start a line.
// pdf.js is large, so it and its worker are loaded with import() only
// when a PDF is read. The ?url import gives the worker's file URL;
// pdf.js runs it as a Web Worker so parsing doesn't freeze the page.
async function pdfText(blob: Blob) {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
  const pdf = await task.promise;
  try {
    let text = '';
    for (let n = 1; n <= pdf.numPages; n++) {
      const { items } = await (await pdf.getPage(n)).getTextContent();
      // `'str' in item` is a type guard: items can be text or markers, and only
      // text items have str. hasEOL is set on the last piece of each line.
      for (const item of items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : '');
      text += '\n';
    }
    return text;
  // finally runs whether reading worked or not, so the PDF's memory is always released.
  } finally {
    await task.destroy();
  }
}

// The browser's version of the Platform interface from main/rpc/core.ts. Services only ever
// call ctx.platform, so they can't tell whether they run in Electron, a browser tab or a test.
export const platform: Platform = {
  // The RPC call starts from a click, and the browser still counts the user's
  // activation when this runs a moment later, so the picker is allowed to open.
  // Browsers have no file-picker function that returns a promise, so this wraps a hidden <input
  // type="file"> in one: it resolves when the input fires change (a file) or cancel (none).
  chooseFile({ filters }) {
    return new Promise((resolve) => {
      // Object.assign sets properties on the new element and
      // returns it: creating and configuring it in one line.
      const input = Object.assign(document.createElement('input'), { type: 'file' });
      // flatMap maps each filter to its list of extensions and joins
      // the lists into one array. `?? []` covers no filters at all.
      const extensions = filters?.flatMap((f) => f.extensions).filter((e) => e !== '*') ?? [];
      if (extensions.length) input.accept = extensions.map((e) => `.${e}`).join(',');
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        resolve(file ? addPickedFile(file) : null);
      });
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  },

  // There's no save dialog on the web: writing to this "location" downloads the file.
  async chooseSaveLocation({ defaultPath }) {
    return defaultPath;
  },

  // Opens a file in a new tab when the browser can show it. window.open returns
  // null when a popup blocker stops it, and then the file is downloaded instead.
  async openPath(path) {
    const blob = await readBlob(path);
    const tab = VIEWABLE.test(blob.type) ? window.open(URL.createObjectURL(blob), '_blank') : null;
    if (!tab) download(blob, originalName(path));
  },

  async fileUrl(path) {
    const known = fileUrls.get(path);
    if (known) return known;
    const url = URL.createObjectURL(await readBlob(path));
    fileUrls.set(path, url);
    return url;
  },

  // PDFs are read with pdf.js, loaded the first time one is attached.
  // The text of an attachment, for the planner and the syllabus
  // reader. null means this kind of file can't be read.
  async readText(path) {
    const blob = await readBlob(path);
    if (blob.type === 'application/pdf' || /\.pdf$/i.test(path)) return pdfText(blob);
    if (/\.docx$/i.test(path)) return docxText(new Uint8Array(await blob.arrayBuffer()));
    return blob.type.startsWith('text/') || TEXT_FILE.test(path) ? blob.text() : null;
  },

  // A system notification while the tab is in the background (if the site has been
  // allowed to show them), otherwise a toast in the page.
  // document.hidden is true when the tab isn't visible. Only then is a
  // system notification worth it; otherwise a toast in the page is enough.
  showNotification({ title, body, link }) {
    const open = () => {
      if (link) navigateListeners.forEach((cb) => cb(link));
    };
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body });
      n.onclick = () => {
        window.focus();
        open();
        n.close();
      };
      return;
    }
    notifications.show({
      title,
      message: body,
      autoClose: 8_000,
      onClick: link ? open : undefined,
    });
  },

  // ST1: browsers can't touch the system's Do Not Disturb.
  // Do Not Disturb is an operating-system setting that a web
  // page can't reach, so both of these report it as unsupported.
  systemDndSupported: () => false,
  setSystemDnd: async () => false,
};
