import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import path from 'node:path';
import type { PingRequest, PingResponse } from '../shared/api';
import { registerFileIpc } from './ipc/file';
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
