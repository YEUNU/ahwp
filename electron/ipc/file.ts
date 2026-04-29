import { BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  FileOpenResult,
  FileSaveAsRequest,
  FileSaveRequest,
  RecentFile,
} from '../../shared/api';
import { detectHwpFormat } from '../../shared/format';
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

  ipcMain.handle(
    'file:save',
    async (_event, req: FileSaveRequest): Promise<FileOpenResult> => {
      if (!req || typeof req.path !== 'string' || !req.path) {
        throw new Error('file:save requires { path, bytes }');
      }
      if (!isAllowed(req.path)) {
        throw new Error(`Unsupported extension: ${path.extname(req.path)}`);
      }
      const data = toUint8(req.bytes);
      assertFormatMatchesPath(req.path, data);
      await writeAtomic(req.path, data);
      await addRecent(req.path);
      return { path: req.path };
    },
  );

  ipcMain.handle(
    'file:save-as',
    async (event, req: FileSaveAsRequest): Promise<FileOpenResult | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(
        window ?? new BrowserWindow({ show: false }),
        {
          title: '다른 이름으로 저장',
          defaultPath: req.defaultPath,
          filters: [
            { name: '한글 문서 (HWPX)', extensions: ['hwpx'] },
            { name: '한글 문서 (HWP)', extensions: ['hwp'] },
          ],
        },
      );
      if (result.canceled || !result.filePath) return null;
      const target = result.filePath;
      if (!isAllowed(target)) {
        throw new Error(`Unsupported extension: ${path.extname(target)}`);
      }
      const data = toUint8(req.bytes);
      assertFormatMatchesPath(target, data);
      await writeAtomic(target, data);
      await addRecent(target);
      return { path: target };
    },
  );
}

function assertFormatMatchesPath(filePath: string, data: Uint8Array): void {
  const format = detectHwpFormat(data);
  const ext = path.extname(filePath).toLowerCase();
  if (format === 'hwpx' && ext === '.hwp') {
    throw new Error(
      'Format mismatch: bytes are HWPX (zip) but path has .hwp extension. ' +
        'The renderer should auto-route to .hwpx — please re-save.',
    );
  }
  if (format === 'hwp' && ext === '.hwpx') {
    throw new Error(
      'Format mismatch: bytes are HWP (CFB) but path has .hwpx extension. ' +
        'The renderer should auto-route to .hwp — please re-save.',
    );
  }
  // unknown format: be lenient (could be a future format / edge case).
}

function toUint8(input: ArrayBuffer | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

async function writeAtomic(target: string, data: Uint8Array): Promise<void> {
  // tmp + rename so a crash mid-write doesn't corrupt the target.
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, target);
}
