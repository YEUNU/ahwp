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

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
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
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'right' });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
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
  Menu.setApplicationMenu(buildAppMenu(() => mainWindow));
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
