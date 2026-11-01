import { execFile, execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import { openDatabase } from './db/client';
import { seedDemoData } from './db/demo';
import { type Context, dispatch, type Platform } from './rpc/core';
import { appRouter } from './rpc/router';
import { backgroundTick, initialTickState } from './services/studyMode';

const execFileAsync = promisify(execFile);

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    title: 'UniLink',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.on('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => (mainWindow = null));

  // Group chat links and other external URLs open in the default browser (S2.3).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) event.preventDefault();
  });

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
}

const platform: Platform = {
  async chooseFile({ title, filters }) {
    const options = { title, filters, properties: ['openFile' as const] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  async chooseSaveLocation({ title, defaultPath, filters }) {
    const options = { title, defaultPath, filters };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    return result.canceled ? null : (result.filePath ?? null);
  },
  async openPath(path) {
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  },
  showNotification({ title, body, link }) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      if (link) mainWindow.webContents.send('navigate', link);
    });
    n.show();
  },
  systemDndSupported: () => GNOME,
  async setSystemDnd(on) {
    if (!GNOME) return false;
    try {
      if (on) {
        bannersBefore ??= (await execFileAsync('gsettings', ['get', DND_SCHEMA, 'show-banners'])).stdout.trim();
        await execFileAsync('gsettings', ['set', DND_SCHEMA, 'show-banners', 'false']);
      } else if (bannersBefore != null) {
        await execFileAsync('gsettings', ['set', DND_SCHEMA, 'show-banners', bannersBefore]);
        bannersBefore = null;
      }
      return true;
    } catch (err) {
      console.error('[study mode] could not change Do Not Disturb:', err);
      return false;
    }
  },
};

// ST1: GNOME's Do Not Disturb is the "show-banners" setting. Other desktops don't offer an API.
const GNOME = process.platform === 'linux' && /gnome/i.test(process.env.XDG_CURRENT_DESKTOP ?? '');
const DND_SCHEMA = 'org.gnome.desktop.notifications';
let bannersBefore: string | null = null;

app.whenReady().then(() => {
  // Packaged builds ship migrations as an extra resource; from source they sit in the repo root.
  const migrations = app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(__dirname, '../../drizzle');
  const db = openDatabase(join(app.getPath('userData'), 'unilink.db'), migrations);
  if (!app.isPackaged) seedDemoData(db);

  const ctx: Context = {
    db,
    session: { userId: null },
    platform,
    isDev: !app.isPackaged,
    filesDir: join(app.getPath('userData'), 'attachments'),
    now: () => new Date(),
  };

  ipcMain.handle('rpc', (event, path: unknown, input: unknown) => {
    // Only our own window may call into the main process.
    if (event.sender !== mainWindow?.webContents || typeof path !== 'string') {
      return { ok: false, error: { code: 'FORBIDDEN', message: 'Not allowed' } };
    }
    return dispatch(appRouter, path, input, ctx);
  });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // G3 reminders, ST1 study mode switching and desktop notifications.
  const tickState = initialTickState();
  const tick = () => backgroundTick(ctx, tickState).catch((err) => console.error('[tick] failed:', err));
  setTimeout(tick, 3_000);
  setInterval(tick, 30_000);
});

// Never leave Do Not Disturb switched on after UniLink quits.
app.on('will-quit', () => {
  if (bannersBefore == null) return;
  try {
    execFileSync('gsettings', ['set', DND_SCHEMA, 'show-banners', bannersBefore]);
  } catch (err) {
    console.error('[study mode] could not restore Do Not Disturb:', err);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
