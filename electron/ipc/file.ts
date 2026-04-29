import { BrowserWindow, dialog, ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  FileOpenResult,
  FileSaveAsRequest,
  FileSaveRequest,
  RecentFile,
} from '../../shared/api';
import { correctExtension } from '../../shared/format';
import { ensureHwpxBytes, normalizeToHwp } from '../hwp/converter';
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
      const raw = await fs.readFile(filePath);
      // Always hand HWPX bytes back to the renderer — converts HWP via
      // @rhwp/core if needed. ARCHITECTURE.md §B: canonical internal = HWPX.
      const hwpxBytes = await ensureHwpxBytes(
        new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
      );
      // Hand off as a fresh ArrayBuffer (renderer expects ArrayBuffer).
      return hwpxBytes.buffer.slice(
        hwpxBytes.byteOffset,
        hwpxBytes.byteOffset + hwpxBytes.byteLength,
      ) as ArrayBuffer;
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
      // Normalize to HWP (CFB). HWPX round-trip drops images in @rhwp/core
      // v0.7.8 — see electron/hwp/converter.ts.
      const normalized = await normalizeToHwp(toUint8(req.bytes));
      // Output is always HWP; route the path's extension to match. Caller's
      // requested .hwpx path becomes the sibling .hwp; .hwp passes through.
      const target = correctExtension(req.path, 'hwp');
      if (target !== req.path) {
        console.info(
          `[file:save] auto-routing extension ${req.path} → ${target}`,
        );
      }
      await writeAtomic(target, normalized);
      await addRecent(target);
      return { path: target };
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
          // HWP-only filter — HWPX disabled until @rhwp/core fixes the image
          // round-trip (KNOWN_ISSUES). Re-enable HWPX option once upstream
          // ships the fix.
          filters: [{ name: '한글 문서 (HWP)', extensions: ['hwp'] }],
        },
      );
      if (result.canceled || !result.filePath) return null;
      const picked = result.filePath;
      if (!isAllowed(picked)) {
        throw new Error(`Unsupported extension: ${path.extname(picked)}`);
      }
      const normalized = await normalizeToHwp(toUint8(req.bytes));
      const target = correctExtension(picked, 'hwp');
      if (target !== picked) {
        console.info(
          `[file:save-as] auto-routing extension ${picked} → ${target}`,
        );
      }
      await writeAtomic(target, normalized);
      await addRecent(target);
      return { path: target };
    },
  );
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
