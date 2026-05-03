import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { PingRequest, PingResponse } from '../shared/api';
import { registerAiIpc } from './ipc/ai';
import { registerChatHistoryIpc } from './ipc/chat-history';
import { registerClipboardIpc } from './ipc/clipboard';
import { registerFileIpc, teardownTabsWatcher } from './ipc/file';
import { registerFolderIpc, shutdownFolderIpc } from './ipc/folder';
import { registerSecretsIpc } from './ipc/secrets';
import { registerSessionIpc } from './ipc/session';
import { buildAppMenu } from './menu';

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// chunk 65 — multi-window. We no longer treat any single window as
// "the" main window. The `mainWindow` ref is kept for activate
// fallback (clicking the dock icon reopens a window when none is
// open); menu actions and watcher channels target the focused window
// at the moment of dispatch instead.
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'ahwp',
    // Custom titlebar — UI/UX revamp. macOS keeps the traffic-light
    // controls but hides the OS title strip; Win/Linux remove the OS
    // chrome entirely so our renderer-side bar paints edge-to-edge.
    // The renderer's TitleBar honors `paddingLeft:78` on macOS to make
    // room for the traffic lights.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: '#efece5', symbolColor: '#1c1a16', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'right' });
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // First-created window seeds the dock-activate fallback; later
  // windows don't need to.
  if (mainWindow === null) mainWindow = win;
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('ipc:ping', (_event, req: PingRequest): PingResponse => {
    return {
      pong: req.message,
      at: Date.now(),
      platform: process.platform,
      electron: process.versions.electron,
    };
  });
  // chunk 65 — open a new window. Each window is a fresh React app
  // instance with its own session restore + chat history connection.
  ipcMain.handle('app:new-window', (): void => {
    createWindow();
  });
  registerFileIpc();
  registerSessionIpc();
  registerClipboardIpc();
  registerFolderIpc();
  registerSecretsIpc();
  registerAiIpc();
  registerChatHistoryIpc();
}

void app.whenReady().then(() => {
  registerIpcHandlers();
  // Menu actions target the currently-focused window (chunk 65 —
  // multi-window). Falls back to the most recent window when nothing
  // has focus (e.g. after the user clicked outside the app).
  Menu.setApplicationMenu(
    buildAppMenu(
      () =>
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().at(-1) ??
        mainWindow,
    ),
  );
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', (e) => {
  // Release the chokidar watcher before exit. This is async so we
  // gate the quit with `e.preventDefault()` and re-call `app.quit()`
  // once teardown finishes. Also clear the userData/temp dir — file:new
  // creates `new-<timestamp>.hwp` files there as scratch buffers; the
  // user only persists them via Save As, after which the temp copy is
  // unreferenced.
  e.preventDefault();
  const tempDir = path.join(app.getPath('userData'), 'temp');
  void Promise.allSettled([
    shutdownFolderIpc(),
    teardownTabsWatcher(),
    rm(tempDir, { recursive: true, force: true }),
  ]).finally(() => {
    app.exit(0);
  });
});
