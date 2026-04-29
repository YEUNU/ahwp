import { BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { FileOpenResult, RecentFile } from '../../shared/api';
import { addRecent, listRecent } from '../store/recent';

const ALLOWED_EXTENSIONS = ['.hwp', '.hwpx'] as const;

function isAllowed(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export function registerFileIpc(): void {
  ipcMain.handle('file:open', async (event): Promise<FileOpenResult | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(
      window ?? new BrowserWindow({ show: false }),
      {
        title: '한글 문서 열기',
        properties: ['openFile'],
        filters: [
          { name: '한글 문서', extensions: ['hwp', 'hwpx'] },
          { name: '모든 파일', extensions: ['*'] },
        ],
      },
    );
    if (result.canceled || result.filePaths.length === 0) return null;
    const picked = result.filePaths[0];
    if (!isAllowed(picked)) return null;
    await addRecent(picked);
    return { path: picked };
  });

  ipcMain.handle(
    'file:open-by-path',
    async (_event, filePath: string): Promise<FileOpenResult | null> => {
      if (typeof filePath !== 'string' || !filePath) return null;
      if (!isAllowed(filePath)) return null;
      if (!(await exists(filePath))) return null;
      await addRecent(filePath);
      return { path: filePath };
    },
  );

  ipcMain.handle('file:list-recent', async (): Promise<RecentFile[]> => {
    return listRecent();
  });

  ipcMain.handle(
    'file:read',
    async (_event, filePath: string): Promise<ArrayBuffer> => {
      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('file:read requires a path');
      }
      if (!isAllowed(filePath)) {
        throw new Error(`Unsupported extension: ${path.extname(filePath)}`);
      }
      const buffer = await fs.readFile(filePath);
      // Return a fresh ArrayBuffer slice — Buffer's underlying pool may be larger.
      return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    },
  );
}
