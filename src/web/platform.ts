import { notifications } from '@mantine/notifications';
import type { Platform } from '../main/rpc/core';
import { addPickedFile, download, readBlob } from './node/fs';
import { basename } from './node/path';

// The browser's versions of the native features the desktop app gets from Electron.

const navigateListeners = new Set<(link: string) => void>();

// Clicking a notification opens what it's about (Layout.tsx subscribes).
export function onNavigate(callback: (link: string) => void) {
  navigateListeners.add(callback);
  return () => void navigateListeners.delete(callback);
}

// Attachments are stored as "<uuid>-<name>" (services/planner.ts).
const originalName = (path: string) => basename(path).replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}-/, '');

// Types a browser tab can show itself; anything else is downloaded.
const VIEWABLE = /^(image\/|text\/plain$|application\/pdf$)/;

export const platform: Platform = {
  // The RPC call starts from a click, and the browser still counts the user's
  // activation when this runs a moment later, so the picker is allowed to open.
  chooseFile({ filters }) {
    return new Promise((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file' });
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

  async openPath(path) {
    const blob = await readBlob(path);
    const tab = VIEWABLE.test(blob.type) ? window.open(URL.createObjectURL(blob), '_blank') : null;
    if (!tab) download(blob, originalName(path));
  },

  // A system notification while the tab is in the background (if the site has been
  // allowed to show them), otherwise a toast in the page.
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
  systemDndSupported: () => false,
  setSystemDnd: async () => false,
};
