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
import type {
  FolderChangeEvent,
  FolderEntry,
  FolderSearchHit,
  FolderSearchResult,
} from '../../shared/api';
import { loadRhwpCore } from '../hwp/converter';

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

  // chunk 60 — cross-file text search. Bounded walk + IR parse per file.
  // Knobs are conservative for the first iteration — a 50-file folder
  // with mid-sized .hwp documents settles in ~1s on M-class hardware,
  // a 200-file project trends toward ~3-4s. We can revisit with a
  // streaming results channel if folks bump into the cap.
  ipcMain.handle(
    'folder:search-text',
    async (
      _event,
      req: { rootPath?: unknown; query?: unknown },
    ): Promise<FolderSearchResult> => {
      const rootPath = typeof req?.rootPath === 'string' ? req.rootPath : '';
      const query = typeof req?.query === 'string' ? req.query.trim() : '';
      if (!rootPath)
        return { status: 'no-root', hits: [], scanned: 0, skipped: 0 };
      if (query.length === 0)
        return { status: 'ok', hits: [], scanned: 0, skipped: 0 };

      const MAX_DEPTH = 5;
      const MAX_FILES = 200;
      const MAX_FILE_BYTES = 5 * 1024 * 1024;
      const MAX_HITS = 50;
      const PER_FILE_SNIPPETS = 5;

      const queue: { dir: string; depth: number }[] = [
        { dir: rootPath, depth: 0 },
      ];
      const candidates: string[] = [];
      while (queue.length > 0 && candidates.length < MAX_FILES) {
        const cur = queue.shift()!;
        let entries: import('node:fs').Dirent[];
        try {
          entries = await fs.readdir(cur.dir, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const full = path.join(cur.dir, e.name);
          if (e.isDirectory()) {
            if (cur.depth + 1 < MAX_DEPTH) {
              queue.push({ dir: full, depth: cur.depth + 1 });
            }
          } else if (
            e.isFile() &&
            (e.name.toLowerCase().endsWith('.hwp') ||
              e.name.toLowerCase().endsWith('.hwpx'))
          ) {
            candidates.push(full);
            if (candidates.length >= MAX_FILES) break;
          }
        }
      }

      const { HwpDocument } = await loadRhwpCore();
      const hits: FolderSearchHit[] = [];
      const q = query.toLowerCase();
      let scanned = 0;
      let skipped = 0;
      for (const filePath of candidates) {
        if (hits.length >= MAX_HITS) break;
        let stat: import('node:fs').Stats;
        try {
          stat = await fs.stat(filePath);
        } catch {
          skipped += 1;
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) {
          skipped += 1;
          continue;
        }
        let bytes: Buffer;
        try {
          bytes = await fs.readFile(filePath);
        } catch {
          skipped += 1;
          continue;
        }
        let doc: InstanceType<typeof HwpDocument>;
        try {
          doc = new HwpDocument(new Uint8Array(bytes));
        } catch {
          skipped += 1;
          continue;
        }
        try {
          const snippets: FolderSearchHit['snippets'] = [];
          let total = 0;
          const sectionCount = doc.getSectionCount();
          outer: for (let s = 0; s < sectionCount; s++) {
            const paraCount = doc.getParagraphCount(s);
            for (let p = 0; p < paraCount; p++) {
              const len = doc.getParagraphLength(s, p);
              if (len === 0) continue;
              let text: string;
              try {
                text = doc.getTextRange(s, p, 0, len);
              } catch {
                continue;
              }
              const idx = text.toLowerCase().indexOf(q);
              if (idx >= 0) {
                total += 1;
                if (snippets.length < PER_FILE_SNIPPETS) {
                  const start = Math.max(0, idx - 30);
                  const end = Math.min(text.length, idx + query.length + 30);
                  snippets.push({
                    sectionIndex: s,
                    paragraphIndex: p,
                    preview: text.slice(start, end),
                    matchOffset: idx - start,
                    matchLength: query.length,
                  });
                }
                if (
                  snippets.length >= PER_FILE_SNIPPETS &&
                  total > snippets.length * 4
                ) {
                  break outer;
                }
              }
            }
          }
          scanned += 1;
          if (snippets.length > 0) {
            hits.push({
              path: filePath,
              filename: path.basename(filePath),
              matchCount: total,
              snippets,
            });
          }
        } finally {
          try {
            doc.free();
          } catch {
            /* ignore */
          }
        }
      }

      const status: FolderSearchResult['status'] =
        hits.length >= MAX_HITS || candidates.length >= MAX_FILES
          ? 'limit-reached'
          : 'ok';
      return { status, hits, scanned, skipped };
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
