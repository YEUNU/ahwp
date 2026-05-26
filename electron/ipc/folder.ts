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
  ReadParagraphRequest,
  ReadParagraphResult,
  WorkspaceOutlineEntry,
  WorkspaceOutlineResult,
} from '../../shared/api';
import { loadRhwpCore } from '../hwp/converter';
import {
  extractText as extractReadableText,
  isReadable,
  type ExtractedText,
} from '../files/readable-formats';
import { app } from 'electron';

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

// chunk 96 — outline extraction (mirrors `useViewerHandle.getOutline`
// in the renderer but operates on the main-process @rhwp/core instance).
// `WorkspaceOutlineEntry.outline` semantically equivalent to what the
// active-doc `getDocumentOutline` tool returns — the model can treat
// both surfaces identically.
type RhwpDoc = {
  getSectionCount(): number;
  getParagraphCount(s: number): number;
  getStyleAt(s: number, p: number): string;
  getStyleList(): string;
  getParagraphLength(s: number, p: number): number;
  getTextRange(s: number, p: number, start: number, end: number): string;
  free(): void;
};

interface OutlineItem {
  paragraphIndex: number;
  level: number;
  text: string;
}

/**
 * Non-HWP outline derivation — 0.6.0. ExtractedText 의 headings 를
 * OutlineItem[] 로 변환. paragraphIndex 는 chunk index — readParagraphByPath
 * 가 같은 chunks 로 재추출해서 (sectionIdx=0, paragraphIdx=i) 좌표로
 * `chunks[i]` 를 반환하므로 의미적으로 일치.
 *
 * headings 가 없는 포맷 (TXT, JSON 등) 은 각 chunk 의 첫 80자를 fallback
 * heading 으로 노출 — AI 가 "어느 chunk 에 어떤 내용이 있는지" 를 파악하기
 * 위한 최소한의 시그널.
 */
function outlineFromExtracted(extracted: ExtractedText): OutlineItem[] {
  const items: OutlineItem[] = [];
  if (extracted.headings.length > 0) {
    // headings → chunks 중 substring match 로 paragraphIndex 추론.
    // No match 면 0 으로 fallback (AI 는 적어도 heading text 는 활용 가능).
    for (const h of extracted.headings) {
      const idx = extracted.chunks.findIndex((c) => c.includes(h));
      items.push({
        paragraphIndex: idx >= 0 ? idx : 0,
        level: 1,
        text: h.length > 200 ? h.slice(0, 200) : h,
      });
      if (items.length >= 200) break;
    }
    return items;
  }
  // Fallback — chunks 의 첫 80자를 heading 처럼 노출.
  for (let i = 0; i < Math.min(extracted.chunks.length, 50); i++) {
    const first = extracted.chunks[i].split(/\n/)[0].trim();
    if (!first) continue;
    items.push({
      paragraphIndex: i,
      level: 1,
      text: first.length > 80 ? first.slice(0, 80) + '…' : first,
    });
  }
  return items;
}

function extractOutline(doc: RhwpDoc): OutlineItem[] {
  let styles: { id: number; name: string; englishName?: string }[] = [];
  try {
    styles = JSON.parse(doc.getStyleList()) as typeof styles;
  } catch {
    return [];
  }
  const headingByStyleId = new Map<number, number>();
  for (const s of styles) {
    // "제목 N" / "Heading N" — 표준 한컴 / 워드 호환. "개요 N" — 한컴
    // 한국어 outline 스타일 (사업계획서 / 보고서 양식 다수 채용).
    // 셋 다 picked up — 매칭은 number prefix 만 비교라 false positive
    // 위험 미미. (`useViewerHandle.ts:getOutline` 와 동일 정합)
    const koMatch = s.name?.match(/^제목\s*(\d+)?/);
    const koOutline = s.name?.match(/^개요\s*(\d+)?/);
    const enMatch = s.englishName?.match(/^Heading\s*(\d+)?/i);
    const m = koMatch ?? koOutline ?? enMatch;
    if (m) {
      const level = m[1] ? Math.min(6, parseInt(m[1], 10)) : 1;
      headingByStyleId.set(s.id, level);
    }
  }
  if (headingByStyleId.size === 0) return [];
  const SECTION = 0;
  const items: OutlineItem[] = [];
  try {
    const paraCount = doc.getParagraphCount(SECTION);
    const cap = Math.min(paraCount, 1000);
    for (let p = 0; p < cap; p++) {
      let at: { id?: number };
      try {
        at = JSON.parse(doc.getStyleAt(SECTION, p)) as { id?: number };
      } catch {
        continue;
      }
      if (typeof at.id !== 'number') continue;
      const level = headingByStyleId.get(at.id);
      if (!level) continue;
      const len = doc.getParagraphLength(SECTION, p);
      const text =
        len > 0 ? doc.getTextRange(SECTION, p, 0, Math.min(len, 200)) : '';
      items.push({
        paragraphIndex: p,
        level,
        text: text.trim() || '(제목 없음)',
      });
      if (items.length >= 200) break;
    }
  } catch {
    /* swallow — partial outline is fine */
  }
  return items;
}

type OutlineCacheEntries = Record<
  string,
  { mtime: number; outline: OutlineItem[] }
>;

interface OutlineCacheFile {
  /** Cache schema version. Bump when the heading-detection rules in
   *  `extractOutline` change so stale entries get re-parsed. */
  version: number;
  entries: OutlineCacheEntries;
}

// v1: original (제목 / Heading only)
// v2: added 개요 style match — 0.4.4 fix for AI cross-doc read failure
//     on Korean 사업계획서 양식 (uses 개요 N styles, not 제목 N).
const OUTLINE_CACHE_VERSION = 2;

function outlineCachePath(): string {
  return path.join(app.getPath('userData'), 'outline-cache.json');
}

async function loadOutlineCache(): Promise<OutlineCacheEntries> {
  try {
    const txt = await fs.readFile(outlineCachePath(), 'utf8');
    const parsed = JSON.parse(txt) as Partial<OutlineCacheFile>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.version === OUTLINE_CACHE_VERSION &&
      parsed.entries &&
      typeof parsed.entries === 'object'
    ) {
      return parsed.entries;
    }
    // Mismatched / missing version — treat as empty so the next scan
    // re-extracts every doc with the current rules.
  } catch {
    /* missing or corrupt — start fresh */
  }
  return {};
}

async function saveOutlineCache(entries: OutlineCacheEntries): Promise<void> {
  const dir = app.getPath('userData');
  await fs.mkdir(dir, { recursive: true });
  const wrapped: OutlineCacheFile = {
    version: OUTLINE_CACHE_VERSION,
    entries,
  };
  await fs.writeFile(outlineCachePath(), JSON.stringify(wrapped), 'utf8');
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

  // chunk 96 — outline-as-router. The Agent's `searchWorkspaceOutlines`
  // tool wraps this. Walks `rootPath` BFS (max depth 5, max docs 200),
  // parses each .hwp/.hwpx with @rhwp/core, and extracts heading-styled
  // paragraphs (`제목 N` / `Heading N`) of section 0. Cached per file by
  // `path + mtime` in `userData/outline-cache.json` — unchanged files
  // skip parse on subsequent calls.
  ipcMain.handle(
    'folder:list-outlines',
    async (
      _event,
      req: { rootPath?: unknown; maxDocs?: unknown },
    ): Promise<WorkspaceOutlineResult> => {
      const rootPath = typeof req?.rootPath === 'string' ? req.rootPath : '';
      const requestedMax =
        typeof req?.maxDocs === 'number' && Number.isInteger(req.maxDocs)
          ? Math.max(1, Math.min(200, req.maxDocs))
          : 50;
      if (!rootPath)
        return { status: 'no-root', entries: [], scanned: 0, skipped: 0 };

      const MAX_DEPTH = 5;
      const MAX_FILE_BYTES = 5 * 1024 * 1024;

      const queue: { dir: string; depth: number }[] = [
        { dir: rootPath, depth: 0 },
      ];
      const candidates: string[] = [];
      while (queue.length > 0 && candidates.length < requestedMax) {
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
          } else if (e.isFile() && isReadable(e.name)) {
            candidates.push(full);
            if (candidates.length >= requestedMax) break;
          }
        }
      }

      const cache = await loadOutlineCache();
      const out: WorkspaceOutlineEntry[] = [];
      let scanned = 0;
      let skipped = 0;
      let parseFailed = false;
      const { HwpDocument } = await loadRhwpCore();

      for (const filePath of candidates) {
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
        const mtime = stat.mtimeMs;
        const cached = cache[filePath];
        if (cached && cached.mtime === mtime) {
          out.push({
            path: filePath,
            filename: path.basename(filePath),
            mtime,
            outline: cached.outline,
          });
          scanned += 1;
          continue;
        }
        // Cache miss — parse + extract. HWP/HWPX 는 @rhwp/core, 그 외는
        // readable-formats 의 extractText (PDF/DOCX/Excel/...) 로 dispatch.
        const lower = filePath.toLowerCase();
        const isHwp = lower.endsWith('.hwp') || lower.endsWith('.hwpx');
        if (!isHwp) {
          // 0.6.0 — non-HWP 포맷 (PDF/DOCX/Excel/CSV/TXT/MD/JSON/XML/HTML)
          // 의 outline 은 extractText.headings → outlineFromExtracted 변환.
          // 큰 binary (PDF/DOCX) 추출은 main process 메모리에 부담이므로
          // 5MB 상한 (extractText 가 자체 체크).
          try {
            const extracted = await extractReadableText(filePath);
            const outline = outlineFromExtracted(extracted);
            out.push({
              path: filePath,
              filename: path.basename(filePath),
              mtime,
              outline,
            });
            cache[filePath] = { mtime, outline };
            scanned += 1;
          } catch (err) {
            // 추출 실패는 partial — 사용자에게 모두-실패 만 noise. 빈
            // outline 으로라도 entry 유지하면 AI 가 적어도 파일 존재
            // 인식 가능.
            console.warn('[outlines] extract failed:', filePath, err);
            out.push({
              path: filePath,
              filename: path.basename(filePath),
              mtime,
              outline: [],
            });
            scanned += 1;
            parseFailed = true;
          }
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
          parseFailed = true;
          continue;
        }
        try {
          const outline = extractOutline(doc);
          out.push({
            path: filePath,
            filename: path.basename(filePath),
            mtime,
            outline,
          });
          cache[filePath] = { mtime, outline };
          scanned += 1;
        } finally {
          try {
            doc.free();
          } catch {
            /* ignore */
          }
        }
      }

      // Persist cache (best-effort, swallow errors). Drop entries for
      // paths that no longer appeared this scan to keep the cache from
      // growing unbounded across moved/deleted files.
      const trimmed: OutlineCacheEntries = {};
      for (const e of out)
        trimmed[e.path] = { mtime: e.mtime, outline: e.outline };
      await saveOutlineCache(trimmed).catch(() => {});

      const status: WorkspaceOutlineResult['status'] =
        candidates.length >= requestedMax
          ? 'limit-reached'
          : parseFailed
            ? 'partial'
            : 'ok';
      return { status, entries: out, scanned, skipped };
    },
  );

  // chunk 96 — read a paragraph (+ optional surrounding context) from
  // an arbitrary .hwp/.hwpx without mounting it as a tab. Used by the
  // Agent's `readParagraphByPath` tool after `searchWorkspaceOutlines`
  // identifies a candidate. Strictly read-only — no IR mutation, no
  // caret movement, no .bak side-effect.
  ipcMain.handle(
    'folder:read-paragraph',
    async (_event, req: ReadParagraphRequest): Promise<ReadParagraphResult> => {
      if (
        !req ||
        typeof req.path !== 'string' ||
        typeof req.sectionIdx !== 'number' ||
        typeof req.paragraphIdx !== 'number' ||
        !Number.isInteger(req.sectionIdx) ||
        !Number.isInteger(req.paragraphIdx) ||
        req.sectionIdx < 0 ||
        req.paragraphIdx < 0
      ) {
        return { ok: false, reason: 'invalid-args' };
      }
      const ctx =
        typeof req.contextParagraphs === 'number' &&
        Number.isInteger(req.contextParagraphs) &&
        req.contextParagraphs >= 0
          ? Math.min(10, req.contextParagraphs)
          : 2;
      const lower = req.path.toLowerCase();
      if (!isReadable(lower)) {
        return { ok: false, reason: 'unsupported-extension' };
      }
      // Non-HWP 포맷: extractText + chunk index lookup. sectionIdx 는 항상
      // 0 (HWP 외엔 section 개념 X), paragraphIdx 는 chunks[i] 직접 매핑.
      const isHwp = lower.endsWith('.hwp') || lower.endsWith('.hwpx');
      if (!isHwp) {
        if (req.sectionIdx !== 0) {
          return { ok: false, reason: 'out-of-range' };
        }
        try {
          const extracted = await extractReadableText(req.path);
          if (req.paragraphIdx >= extracted.chunks.length) {
            return { ok: false, reason: 'out-of-range' };
          }
          const text = extracted.chunks[req.paragraphIdx];
          const context: { paragraphIdx: number; text: string }[] = [];
          if (ctx > 0) {
            for (
              let p = req.paragraphIdx - ctx;
              p <= req.paragraphIdx + ctx;
              p++
            ) {
              if (p === req.paragraphIdx) continue;
              if (p < 0 || p >= extracted.chunks.length) continue;
              context.push({ paragraphIdx: p, text: extracted.chunks[p] });
            }
          }
          // 너무 큰 chunk 는 4KB 로 trim (HWP 경로와 동일 정책).
          const capped = text.length > 4096 ? text.slice(0, 4096) : text;
          return { ok: true, text: capped, context };
        } catch (err) {
          console.warn('[read-paragraph] extract failed:', req.path, err);
          return { ok: false, reason: 'parse-error' };
        }
      }
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(req.path);
      } catch {
        return { ok: false, reason: 'read-failed' };
      }
      const { HwpDocument } = await loadRhwpCore();
      let doc: InstanceType<typeof HwpDocument>;
      try {
        doc = new HwpDocument(new Uint8Array(bytes));
      } catch {
        return { ok: false, reason: 'parse-error' };
      }
      try {
        const sectionCount = doc.getSectionCount();
        if (req.sectionIdx >= sectionCount) {
          return { ok: false, reason: 'out-of-range' };
        }
        const paraCount = doc.getParagraphCount(req.sectionIdx);
        if (req.paragraphIdx >= paraCount) {
          return { ok: false, reason: 'out-of-range' };
        }
        const readPara = (p: number): string => {
          if (p < 0 || p >= paraCount) return '';
          const len = doc.getParagraphLength(req.sectionIdx, p);
          if (len === 0) return '';
          try {
            const raw = doc.getTextRange(req.sectionIdx, p, 0, len);
            // Cap each paragraph at 4KB so the model context doesn't
            // explode on a giant single paragraph.
            return raw.length > 4096 ? raw.slice(0, 4096) : raw;
          } catch {
            return '';
          }
        };
        const text = readPara(req.paragraphIdx);
        const context: { paragraphIdx: number; text: string }[] = [];
        if (ctx > 0) {
          for (
            let p = req.paragraphIdx - ctx;
            p <= req.paragraphIdx + ctx;
            p++
          ) {
            if (p === req.paragraphIdx) continue;
            if (p < 0 || p >= paraCount) continue;
            context.push({ paragraphIdx: p, text: readPara(p) });
          }
        }
        return { ok: true, text, context };
      } finally {
        try {
          doc.free();
        } catch {
          /* ignore */
        }
      }
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

  // 0.4.25 — HWP3 외부 이미지 inject 용. 사용자가 폴더 선택 → 그 폴더
  // (재귀 X) 안에서 basenames 와 매칭되는 파일들의 bytes 를 일괄 읽어
  // 반환. 매칭되지 않은 basename 은 결과에 없음.
  ipcMain.handle(
    'folder:resolve-external-images',
    async (
      event,
      basenames: string[],
    ): Promise<{ basename: string; bytes: Uint8Array; fullPath: string }[]> => {
      if (!Array.isArray(basenames) || basenames.length === 0) return [];
      const window = BrowserWindow.fromWebContents(event.sender);
      const result = await dialog.showOpenDialog(
        window ?? new BrowserWindow({ show: false }),
        {
          title: '이미지 폴더 선택',
          properties: ['openDirectory'],
        },
      );
      if (result.canceled || result.filePaths.length === 0) return [];
      const folder = result.filePaths[0];
      const wanted = new Set(basenames.map((b) => b.toLowerCase()));
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(folder, { withFileTypes: true });
      } catch {
        return [];
      }
      const out: {
        basename: string;
        bytes: Uint8Array;
        fullPath: string;
      }[] = [];
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (!wanted.has(lower)) continue;
        // basenames 원본 case 로 매칭 (lib 가 case-sensitive 일 수 있음).
        const original = basenames.find((b) => b.toLowerCase() === lower);
        if (!original) continue;
        const full = path.join(folder, entry.name);
        try {
          const buf = await fs.readFile(full);
          out.push({ basename: original, bytes: buf, fullPath: full });
        } catch {
          /* skip unreadable */
        }
      }
      return out;
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
