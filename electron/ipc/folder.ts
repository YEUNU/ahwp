import {
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import type { FolderChangeEvent, FolderEntry } from '../../shared/api';

/**
 * Folder tree IPC.
 *
 * - `folder:pick` shows the native folder dialog
 * - `folder:list` returns immediate children only (lazy expand model in
 *   the renderer)
 * - `folder:watch` starts a chokidar watcher rooted at the given path
 *   and pushes events to the calling window via `folder:changed`
 *
 * Single active watcher per process. Picking a new root or calling
 * `folder:unwatch` tears down the previous one.
 */

let activeWatcher: FSWatcher | null = null;
let watcherWindow: BrowserWindow | null = null;

async function listChildren(folderPath: string): Promise<FolderEntry[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(folderPath, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FolderEntry[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue; // skip dotfiles
    const full = path.join(folderPath, e.name);
    let isDirectory: boolean;
    if (e.isSymbolicLink()) {
      // Resolve symlinks so the tree shows folder/file behavior correctly,
      // but swallow stat errors (dangling links) — drop the entry.
      try {
        const stat = await fs.stat(full);
        isDirectory = stat.isDirectory();
      } catch {
        continue;
      }
    } else {
      isDirectory = e.isDirectory();
    }
    out.push({ name: e.name, path: full, isDirectory });
  }
  // Folders first, then files, both alphabetically (locale-aware Korean).
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko');
  });
  return out;
}

function teardownWatcher(): Promise<void> {
  const w = activeWatcher;
  activeWatcher = null;
  watcherWindow = null;
  return w ? w.close() : Promise.resolve();
}

export function registerFolderIpc(): void {
  ipcMain.handle('folder:pick', async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(
      window ?? new BrowserWindow({ show: false }),
      {
        title: '폴더 열기',
        properties: ['openDirectory'],
      },
    );
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  ipcMain.handle(
    'folder:list',
    async (_event, folderPath: string): Promise<FolderEntry[]> => {
      if (typeof folderPath !== 'string' || !folderPath) return [];
      return listChildren(folderPath);
    },
  );

  ipcMain.handle(
    'folder:watch',
    async (event: IpcMainInvokeEvent, rootPath: string): Promise<void> => {
      if (typeof rootPath !== 'string' || !rootPath) return;
      await teardownWatcher();
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) return;
      watcherWindow = window;
      // Watch the whole tree but lightly: ignore dotfiles, don't fire
      // initial scan events (would flood the renderer for big trees),
      // tighten depth to the OS limit chokidar picks.
      const w = chokidar.watch(rootPath, {
        ignored: /(^|[\\/])\../,
        ignoreInitial: true,
        persistent: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });
      const emit = (
        type: FolderChangeEvent['type'],
        changedPath: string,
      ): void => {
        if (!watcherWindow || watcherWindow.isDestroyed()) return;
        const parent = path.dirname(changedPath);
        const evt: FolderChangeEvent = { type, path: changedPath, parent };
        watcherWindow.webContents.send('folder:changed', evt);
      };
      w.on('add', (p) => emit('add', p));
      w.on('addDir', (p) => emit('addDir', p));
      w.on('unlink', (p) => emit('unlink', p));
      w.on('unlinkDir', (p) => emit('unlinkDir', p));
      w.on('change', (p) => emit('change', p));
      activeWatcher = w;
    },
  );

  ipcMain.handle('folder:unwatch', async (): Promise<void> => {
    await teardownWatcher();
  });

  ipcMain.handle(
    'folder:create-file',
    async (_event, parentPath: string, name: string): Promise<string> => {
      validateNameOrThrow(name);
      const target = path.join(parentPath, name);
      // 'wx' = write, fail if exists. Defends against races + accidental
      // overwrites.
      const fh = await fs.open(target, 'wx');
      await fh.close();
      return target;
    },
  );

  ipcMain.handle(
    'folder:create-folder',
    async (_event, parentPath: string, name: string): Promise<string> => {
      validateNameOrThrow(name);
      const target = path.join(parentPath, name);
      // mkdir without recursive — fails if exists, which is what we want.
      await fs.mkdir(target);
      return target;
    },
  );

  ipcMain.handle(
    'folder:rename',
    async (_event, oldPath: string, newPath: string): Promise<void> => {
      // Defend against accidental overwrite — only call rename when the
      // destination doesn't already exist. fs.rename overwrites silently
      // on macOS/Linux which would clobber a same-named file.
      try {
        await fs.access(newPath);
        throw new Error(`destination already exists: ${newPath}`);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
      await fs.rename(oldPath, newPath);
    },
  );

  ipcMain.handle(
    'folder:trash',
    async (_event, target: string): Promise<void> => {
      // Electron's shell.trashItem moves to OS trash; recoverable.
      await shell.trashItem(target);
    },
  );

  ipcMain.handle(
    'folder:reveal',
    async (_event, target: string): Promise<void> => {
      // showItemInFolder opens the parent and highlights the item.
      shell.showItemInFolder(target);
    },
  );

  ipcMain.handle(
    'folder:copy',
    async (_event, src: string, destDir: string): Promise<string> => {
      if (typeof src !== 'string' || !src)
        throw new Error('copy: src required');
      if (typeof destDir !== 'string' || !destDir)
        throw new Error('copy: destDir required');
      // Disallow copying a folder into itself / a descendant of itself.
      const srcSep = src.includes('\\') ? '\\' : '/';
      if (destDir === src || destDir.startsWith(src + srcSep)) {
        throw new Error('copy: destination is inside source');
      }
      const base = path.basename(src);
      // Disambiguate name if it would collide. " (1)", " (2)", … before the
      // extension for files; appended at the end for directories.
      const target = await uniquePath(destDir, base);
      // fs.cp is recursive when src is a directory; for files it falls
      // back to a regular copyFile. errorOnExist=false because we already
      // resolved the unique path above, but we keep `force: false` so a
      // race that creates the file mid-call still bubbles up.
      await fs.cp(src, target, { recursive: true, force: false });
      return target;
    },
  );
}

/** Resolve a non-colliding path under `dir` based on `name`. */
async function uniquePath(dir: string, name: string): Promise<string> {
  const target = path.join(dir, name);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let attempt = 0;
  let candidate = target;
  // We assume access throws ENOENT for "doesn't exist". Other errors
  // (EACCES) propagate.
  for (;;) {
    try {
      await fs.access(candidate);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return candidate;
      throw err;
    }
    attempt += 1;
    candidate = path.join(dir, `${stem} (${attempt})${ext}`);
    if (attempt > 999) throw new Error('uniquePath: too many collisions');
  }
}

/**
 * Allow user-typed names that fs accepts. Reject empties, separators,
 * and reserved names like "." / ".."
 */
function validateNameOrThrow(name: string): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('name must be a non-empty string');
  }
  if (name === '.' || name === '..') {
    throw new Error(`reserved name: ${name}`);
  }
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`name must not contain path separators: ${name}`);
  }
}

/**
 * Called from main during shutdown to release native watchers.
 */
export async function shutdownFolderIpc(): Promise<void> {
  await teardownWatcher();
}
