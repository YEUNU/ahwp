import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import chokidar, { type FSWatcher } from 'chokidar';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ExternalFileChangeEvent,
  FileOpenResult,
  FileSaveAsRequest,
  FileSaveRequest,
  RecentFile,
} from '../../shared/api';
import { correctExtension } from '../../shared/format';
import {
  createBlankHwpBytes,
  ensureHwpxBytes,
  normalizeToHwp,
} from '../hwp/converter';
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
  ipcMain.handle('file:new', async (): Promise<FileOpenResult> => {
    // Build a fresh blank HWP via @rhwp/core's createEmpty + exportHwp,
    // write to a per-session temp path, and hand the path back. The
    // viewer treats it like any other open file. Until the user runs
    // Save As, the file lives in `userData/temp` — never added to recent.
    const bytes = await createBlankHwpBytes();
    const dir = path.join(app.getPath('userData'), 'temp');
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `new-${Date.now()}.hwp`);
    await writeAtomic(target, bytes);
    return { path: target };
  });

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
      const routed = target !== req.path;
      if (routed) {
        console.info(
          `[file:save] auto-routing extension ${req.path} → ${target}`,
        );
      }
      // Sidecar `.bak` of the prior on-disk content — written ONCE per
      // path so we don't churn `.bak` on every save. If a `.bak` already
      // exists from an earlier save, it stays put (preserves the
      // pre-edit-session original). New files (no prior content) skip
      // backup entirely.
      const backupPath = await maybeWriteBackup(target);
      await writeAtomic(target, normalized);
      noteOwnWrite(target);
      await addRecent(target);
      const result: FileOpenResult = { path: target };
      if (routed) result.routedFrom = req.path;
      if (backupPath) result.backupPath = backupPath;
      return result;
    },
  );

  ipcMain.handle(
    'file:export-html',
    async (
      event,
      req: { html: string; defaultPath?: string },
    ): Promise<FileOpenResult | null> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showSaveDialog(
        window ?? new BrowserWindow({ show: false }),
        {
          title: 'HTML로 내보내기',
          defaultPath: req.defaultPath
            ? req.defaultPath.replace(/\.hwpx?$/i, '.html')
            : undefined,
          filters: [{ name: 'HTML', extensions: ['html', 'htm'] }],
        },
      );
      if (result.canceled || !result.filePath) return null;
      const picked = result.filePath;
      // Wrap the HTML body in a minimal document shell so the file
      // opens cleanly in a browser. We don't try to inline CSS — the
      // exported HTML is intentionally lossy for AI / paste use cases.
      const wrapped = `<!DOCTYPE html>
<html lang="ko"><head>
<meta charset="utf-8">
<title>${path.basename(picked, path.extname(picked))}</title>
</head><body>
${req.html}
</body></html>`;
      await writeAtomic(picked, new TextEncoder().encode(wrapped));
      return { path: picked };
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
      const routed = target !== picked;
      if (routed) {
        console.info(
          `[file:save-as] auto-routing extension ${picked} → ${target}`,
        );
      }
      const backupPath = await maybeWriteBackup(target);
      await writeAtomic(target, normalized);
      noteOwnWrite(target);
      await addRecent(target);
      const out: FileOpenResult = { path: target };
      if (routed) out.routedFrom = picked;
      if (backupPath) out.backupPath = backupPath;
      return out;
    },
  );

  // chunk 52 — auto-save draft sidecar (`<path>.ahwp-draft`). Each open
  // dirty tab is dumped every 60s by the renderer; on next launch the
  // user gets a recovery toast. Drafts are not read back automatically;
  // restoration is an explicit user choice.
  ipcMain.handle(
    'file:save-draft',
    async (
      _event,
      req: { path: string; bytes: ArrayBuffer | Uint8Array },
    ): Promise<void> => {
      if (!req || typeof req.path !== 'string' || !req.path) return;
      try {
        await writeAtomic(`${req.path}.ahwp-draft`, toUint8(req.bytes));
        noteOwnWrite(`${req.path}.ahwp-draft`);
      } catch (err) {
        console.warn('[file] save-draft failed (non-fatal):', err);
      }
    },
  );

  ipcMain.handle(
    'file:has-draft',
    async (_event, p: unknown): Promise<boolean> => {
      if (typeof p !== 'string' || !p) return false;
      return await exists(`${p}.ahwp-draft`);
    },
  );

  ipcMain.handle(
    'file:load-draft',
    async (_event, p: unknown): Promise<ArrayBuffer | null> => {
      if (typeof p !== 'string' || !p) return null;
      try {
        const buf = await fs.readFile(`${p}.ahwp-draft`);
        return buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        ) as ArrayBuffer;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    'file:clear-draft',
    async (_event, p: unknown): Promise<void> => {
      if (typeof p !== 'string' || !p) return;
      try {
        await fs.unlink(`${p}.ahwp-draft`);
      } catch {
        /* nothing to clear */
      }
    },
  );

  // External file watcher — chokidar instance shared across all open tabs.
  // The renderer resends the full path list whenever its tabs change; we
  // tear down the previous watcher and start a fresh one. Reload-during-
  // save false positives are suppressed by `recentlySavedPaths` (we
  // record each successful write here and ignore the next change event
  // for that path within a short window).
  ipcMain.handle(
    'file:watch-paths',
    async (event, paths: string[]): Promise<void> => {
      const window = BrowserWindow.fromWebContents(event.sender);
      tabsWatcherWindow = window;
      // Always tear down before reconfiguring — chokidar's `.unwatch()` +
      // `.add()` is incremental but tracking incremental state at this
      // small scale is more bug-prone than just rebuilding.
      if (tabsWatcher) {
        await tabsWatcher.close();
        tabsWatcher = null;
      }
      const list = (paths ?? []).filter(
        (p) => typeof p === 'string' && p.length > 0,
      );
      if (list.length === 0) return;
      const w = chokidar.watch(list, {
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });
      const emit = (
        type: ExternalFileChangeEvent['type'],
        changedPath: string,
      ): void => {
        // Suppress events for our own writes.
        const until = recentlySavedPaths.get(changedPath);
        if (until !== undefined && Date.now() < until) return;
        if (!tabsWatcherWindow || tabsWatcherWindow.isDestroyed()) return;
        const evt: ExternalFileChangeEvent = { type, path: changedPath };
        tabsWatcherWindow.webContents.send('file:external-change', evt);
      };
      w.on('change', (p: string) => emit('change', p));
      w.on('unlink', (p: string) => emit('unlink', p));
      tabsWatcher = w;
    },
  );
}

// Module-scope state for the tab-watcher (one per main process; the app
// has a single window in normal use).
let tabsWatcher: FSWatcher | null = null;
let tabsWatcherWindow: BrowserWindow | null = null;
const recentlySavedPaths = new Map<string, number>(); // path → epoch ms

/** Mark a path as recently-saved by us so external-change events for the
 *  next ~1.5s are suppressed. Called from save / save-as / new flows. */
function noteOwnWrite(p: string): void {
  recentlySavedPaths.set(p, Date.now() + 1500);
  // Lazy GC — drop entries older than 5s on each insert.
  const cutoff = Date.now() - 5000;
  for (const [k, v] of recentlySavedPaths) {
    if (v < cutoff) recentlySavedPaths.delete(k);
  }
}

/** Called from main during shutdown to release the tab watcher. */
export async function teardownTabsWatcher(): Promise<void> {
  if (tabsWatcher) {
    await tabsWatcher.close();
    tabsWatcher = null;
  }
  tabsWatcherWindow = null;
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

/**
 * Side-car backup of the prior on-disk content. The first save of an
 * existing file produces `<target>.bak`; subsequent saves of the same path
 * leave the existing `.bak` alone so the pre-edit-session snapshot is
 * preserved across the entire run. New files (no prior content) return
 * null. Failures are non-fatal: a missing `.bak` shouldn't block a save.
 */
async function maybeWriteBackup(target: string): Promise<string | undefined> {
  try {
    if (!(await exists(target))) return undefined;
    const backup = `${target}.bak`;
    if (await exists(backup)) return backup; // keep existing
    await fs.copyFile(target, backup);
    return backup;
  } catch (err) {
    console.warn('[file] backup failed (non-fatal):', err);
    return undefined;
  }
}
