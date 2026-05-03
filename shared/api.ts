/**
 * IPC contract shared between Electron main and renderer.
 * Renderer accesses these as window.api.*
 */

import type {
  ChatRequest,
  ChatStreamEvent,
  ModelListResult,
  ProviderId,
} from './ai';

export interface PingRequest {
  message: string;
}

export interface PingResponse {
  pong: string;
  at: number;
  platform: NodeJS.Platform;
  electron: string;
}

/**
 * Menu actions emitted by the native application menu.
 * Renderer subscribes via window.api.onMenuAction(...).
 * Concrete handlers are wired in later phases (1-B file ops, 1-C editor commands).
 */
export type MenuAction =
  | 'file:new'
  | 'file:open'
  | 'file:save'
  | 'file:save-as'
  | 'file:export-html'
  | 'file:export-pdf'
  | 'view:toggle-ruler'
  | 'view:version-history'
  | 'app:new-window'
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:copy'
  | 'edit:cut'
  | 'edit:paste'
  | 'edit:find'
  | 'edit:replace'
  | 'edit:copy-control'
  | 'edit:paste-control'
  | 'view:page-setup'
  | 'insert:header-footer'
  | 'insert:bookmark'
  | 'insert:footnote'
  | 'view:style-manager'
  | 'view:picture-props'
  | 'insert:equation'
  | 'insert:shape'
  | 'format:bold'
  | 'format:italic'
  | 'format:underline'
  | 'view:settings'
  | 'view:about';

export interface RecentFile {
  path: string;
  lastOpenedAt: number;
}

export interface FileOpenResult {
  path: string;
  /**
   * When the main process auto-routed the requested path's extension to a
   * different one (e.g. `.hwpx` → `.hwp` because of the HWPX round-trip
   * limitation in `@rhwp/core`), this holds the original requested path so
   * the renderer can surface a notice. Undefined when no rerouting happened.
   */
  routedFrom?: string;
  /**
   * Sidecar `.bak` path written before the save replaced the original.
   * Undefined for new files (no original existed). Used by the renderer to
   * tell the user a backup is available if they need to recover.
   */
  backupPath?: string;
}

export interface FileSaveRequest {
  path: string;
  bytes: ArrayBuffer | Uint8Array;
}

export interface FileSaveAsRequest {
  bytes: ArrayBuffer | Uint8Array;
  defaultPath?: string;
}

export interface FileApi {
  /**
   * Create a blank HWP document and write it to a per-session temp path.
   * Returns the path so the viewer can open it like any other file. The
   * temp file is excluded from the Recent list until the user runs Save As.
   */
  new: () => Promise<FileOpenResult>;
  /** Show native open dialog. Returns null when the user cancels. */
  open: () => Promise<FileOpenResult | null>;
  /** Open a specific path (drag-drop, recent-list click). Returns null if rejected (e.g. wrong extension). */
  openByPath: (path: string) => Promise<FileOpenResult | null>;
  /** Most-recent-first list, capped to N entries. */
  listRecent: () => Promise<RecentFile[]>;
  /** Read raw bytes for a path. Throws if extension is not allowed or file is missing. */
  read: (path: string) => Promise<ArrayBuffer>;
  /** Write bytes to an existing path. Atomic via tmp + rename. Updates recent. */
  save: (req: FileSaveRequest) => Promise<FileOpenResult>;
  /** Show native save dialog, write bytes, return chosen path. null if user cancels. */
  saveAs: (req: FileSaveAsRequest) => Promise<FileOpenResult | null>;
  /**
   * Show native save dialog and write an HTML export of the active doc.
   * Wraps the body HTML in a minimal `<!DOCTYPE html>` shell. chunk 41.
   */
  exportHtml: (req: {
    html: string;
    defaultPath?: string;
  }) => Promise<FileOpenResult | null>;
  /**
   * Export the active document as PDF — chunk 59. The renderer hands
   * the body HTML over and main runs it through Chrome's `printToPDF`
   * in a hidden BrowserWindow. Quality matches "Save as PDF" from a
   * standard browser print — fine for review/share flows.
   */
  exportPdf: (req: {
    html: string;
    defaultPath?: string;
  }) => Promise<FileOpenResult | null>;
  /**
   * Reconfigure the external-change watcher to track exactly the paths
   * passed in. Pass `[]` to stop watching all files. The previous set is
   * always replaced — the renderer just resends the full path list when
   * tabs open/close. Idempotent.
   */
  watchPaths: (paths: string[]) => Promise<void>;
  /**
   * chunk 52 — auto-save draft sidecar. The renderer dumps each dirty
   * tab to `<path>.ahwp-draft` every minute; on next launch
   * `hasDraft(path)` lets us surface a recovery toast and `loadDraft`
   * pulls the bytes back when the user chooses to restore.
   */
  saveDraft: (req: {
    path: string;
    bytes: ArrayBuffer | Uint8Array;
  }) => Promise<void>;
  hasDraft: (path: string) => Promise<boolean>;
  loadDraft: (path: string) => Promise<ArrayBuffer | null>;
  clearDraft: (path: string) => Promise<void>;
  /**
   * chunk 62 — version history. Each successful explicit save writes
   * a versioned snapshot under `userData/versions/<hash>/<ISO>.hwp`.
   * `listVersions` returns latest 50; `readVersion` reads bytes; the
   * renderer pipes a chosen version through `save()` to commit a
   * restore (so `.bak`, atomic write, watcher suppression all apply).
   */
  createVersion: (req: {
    path: string;
    bytes: ArrayBuffer | Uint8Array;
  }) => Promise<void>;
  listVersions: (
    path: string,
  ) => Promise<{ filename: string; size: number; createdAt: number }[]>;
  readVersion: (req: {
    path: string;
    filename: string;
  }) => Promise<ArrayBuffer | null>;
  /**
   * Subscribe to external (off-app) modifications of the watched files.
   * Returns an unsubscriber. Fires once per change event from chokidar.
   */
  onExternalChange: (
    handler: (event: ExternalFileChangeEvent) => void,
  ) => () => void;
  /**
   * Resolve a renderer-side File object to its absolute disk path.
   * Wraps Electron's webUtils.getPathForFile (replacement for the removed File.path).
   */
  getPathForFile: (file: File) => string;
}

export interface ClipboardApi {
  /** Read plain text from the system clipboard. Returns '' when empty. */
  readText: () => Promise<string>;
  /** Write plain text to the system clipboard. */
  writeText: (text: string) => Promise<void>;
}

/**
 * One immediate child of a folder. Returned by `folder:list`. Stat errors
 * (permission denied, dangling symlink) are silently dropped — the user
 * shouldn't see broken entries in the tree.
 */
export interface FolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/**
 * Push event fired when chokidar notices a change inside the watched
 * root. The renderer uses `parent` to decide which already-expanded
 * folder to refresh; full-tree refetch is unnecessary.
 */
export interface FolderChangeEvent {
  type: 'add' | 'addDir' | 'unlink' | 'unlinkDir' | 'change';
  path: string;
  parent: string;
}

/**
 * Push event fired when a file the renderer asked to watch (open tab
 * paths) was modified by an external process. The renderer compares to
 * the active tabs' dirty state and decides whether to silently reload
 * (`!dirty`) or surface a conflict notice (`dirty`).
 */
export interface ExternalFileChangeEvent {
  type: 'change' | 'unlink';
  path: string;
}

/**
 * Cross-file text search result — chunk 60. Each match carries the
 * source file + a lightweight snippet so the result panel can render
 * "filename: …<match>… preview" rows. The renderer uses (path,
 * sectionIndex, paragraphIndex) to open the file and scroll to the hit.
 */
export interface FolderSearchHit {
  path: string;
  filename: string;
  /** Total non-zero matches found in the file (capped per-file by main). */
  matchCount: number;
  /** Up to 5 preview snippets per file. */
  snippets: {
    sectionIndex: number;
    paragraphIndex: number;
    /** ~60 chars of context around the match. */
    preview: string;
    /** Match offset within `preview`. */
    matchOffset: number;
    matchLength: number;
  }[];
}

export type FolderSearchStatus = 'ok' | 'limit-reached' | 'aborted' | 'no-root';

export interface FolderSearchResult {
  status: FolderSearchStatus;
  hits: FolderSearchHit[];
  scanned: number;
  /** Files skipped (too large / parse error / extension filter). */
  skipped: number;
}

export interface FolderApi {
  /** Native dialog → returns absolute path or null on cancel. */
  pick: () => Promise<string | null>;
  /** List immediate children of `path`, sorted: folders first, alphabetical. */
  list: (path: string) => Promise<FolderEntry[]>;
  /**
   * Cross-file text search — chunk 60. Walks `rootPath` recursively (max
   * depth + file-count caps applied in main), parses each `.hwp` /
   * `.hwpx`, and greps the body text. Case-insensitive substring match.
   * Returns up to ~50 hits across all files; the renderer paginates if
   * needed.
   */
  searchText: (req: {
    rootPath: string;
    query: string;
  }) => Promise<FolderSearchResult>;
  /** Start chokidar watcher on a root. Replaces any existing watcher. */
  watch: (rootPath: string) => Promise<void>;
  /** Stop the active watcher. No-op if none. */
  unwatch: () => Promise<void>;
  /** Subscribe to change events from the watcher. Returns an unsubscriber. */
  onChange: (handler: (event: FolderChangeEvent) => void) => () => void;
  /**
   * Create an empty file at `parentPath/name`. Throws if a file already
   * exists at the target path. Returns the resulting absolute path.
   */
  createFile: (parentPath: string, name: string) => Promise<string>;
  /**
   * Create a directory at `parentPath/name`. Throws on collision.
   */
  createFolder: (parentPath: string, name: string) => Promise<string>;
  /**
   * fs.rename — also handles move-to-different-parent. Throws if the
   * destination already exists.
   */
  rename: (oldPath: string, newPath: string) => Promise<void>;
  /**
   * Move to OS trash (Electron `shell.trashItem`). Recoverable; does not
   * permanently delete. Throws if the path can't be reached.
   */
  trash: (path: string) => Promise<void>;
  /** Open the OS file manager with `path` selected. */
  reveal: (path: string) => Promise<void>;
  /**
   * Recursive copy from `src` into `destDir`. The new path is the dir +
   * the source's basename. If a file/folder of that name already exists,
   * the IPC appends " (1)", " (2)", … to disambiguate. Returns the
   * resulting absolute path.
   */
  copy: (src: string, destDir: string) => Promise<string>;
}

export interface SessionState {
  /** Path of the folder the user has open in the left panel. */
  lastFolderPath?: string | null;
  /** Path of the document active when the renderer last persisted state. */
  lastActivePath?: string | null;
  /**
   * Paths of all open tabs in display order (chunk: tabs). On restore the
   * shell mounts a viewer for each and activates `lastActivePath`.
   */
  openTabPaths?: string[];
}

export interface SessionApi {
  get: () => Promise<SessionState>;
  set: (state: SessionState) => Promise<void>;
}

/**
 * BYOK secret storage. Plaintext keys never leave the main process —
 * the renderer can write a key, ask whether one exists, list providers,
 * and delete, but cannot read. AI requests go through a separate IPC
 * (Phase 2-B) that injects the secret in main.
 */
export interface SecretsApi {
  /** Persist an API key for a provider (encrypted via Electron safeStorage). */
  set: (providerId: ProviderId, key: string) => Promise<void>;
  /** Remove a stored key. No-op if not set. */
  delete: (providerId: ProviderId) => Promise<void>;
  /** Whether a key is currently stored for the provider. */
  has: (providerId: ProviderId) => Promise<boolean>;
  /** Providers with stored keys, in insertion order. */
  list: () => Promise<ProviderId[]>;
}

export interface AiChatHandle {
  /**
   * Cancel the in-flight stream. Safe to call after the stream has already
   * completed; subsequent events for this id are ignored.
   */
  abort: () => void;
}

export interface AiChatCallbacks {
  /**
   * Invoked for every event emitted by the provider. The stream always ends
   * with exactly one `done` or `error` event; once one of those is delivered
   * no further events arrive for this handle.
   */
  onEvent: (event: ChatStreamEvent) => void;
}

export interface AiPingOptions {
  /**
   * Transient API key supplied by a Settings form *before* the user has saved.
   * If omitted, the main process falls back to the stored secret for this
   * provider. The transient key is never persisted.
   */
  apiKey?: string;
  /** Override the provider's default base URL (e.g. on-prem LLM
   * gateway, self-hosted /v1-compatible endpoint, NIM cluster). */
  baseUrl?: string;
}

/**
 * AI chat over IPC. The renderer never sees the API key — main loads it from
 * encrypted storage and runs the adapter. Returns synchronously with a handle
 * for cancellation; events arrive asynchronously via `callbacks.onEvent`.
 */
export interface AiApi {
  chat: (req: ChatRequest, callbacks: AiChatCallbacks) => AiChatHandle;
  /** Reachability check. Resolves on success, rejects with the error message. */
  ping: (providerId: ProviderId, opts?: AiPingOptions) => Promise<void>;
  /**
   * Fetch the list of model IDs available for `providerId` — chunk 48.
   * Served from a 24h cache when fresh; main refetches and updates the
   * cache when stale. Pass `force: true` to bypass the cache after a
   * key rotation. Always resolves (never throws); the union shape lets
   * the UI distinguish fresh / stale / unknown.
   */
  listModels: (
    providerId: ProviderId,
    opts?: { baseUrl?: string; force?: boolean },
  ) => Promise<ModelListResult>;
  /** Drop the on-disk cache entry for `providerId`. Used by Settings'
   * 새로고침 button when the user wants a hard refresh. */
  clearModelsCache: (providerId: ProviderId) => Promise<void>;
  /** Phase 3 chunk 44 — read per-provider config (baseUrl, supportsTools). */
  getProviderConfig: (
    providerId: ProviderId,
  ) => Promise<{ baseUrl?: string; supportsTools?: boolean }>;
  /** Phase 3 chunk 44 — write per-provider config. Pass only the keys you
   * want to update (existing keys preserved). */
  setProviderConfig: (params: {
    providerId: ProviderId;
    baseUrl?: string;
    supportsTools?: boolean;
  }) => Promise<{ ok: true }>;
}

/** Chat history persistence — chunk 26. SQLite-backed conversations
 * and messages keyed by document path. The renderer never sees DB
 * internals; everything flows through these IPC channels. */
export interface ChatHistoryConversation {
  id: number;
  docPath: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatHistoryMessage {
  id: number;
  conversationId: number;
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ChatHistoryApi {
  /** List conversations, optionally filtered by doc path. Most-recently
   * updated first. Pass `null` to get every conversation. */
  list: (docPath: string | null) => Promise<ChatHistoryConversation[]>;
  /** Read all messages of a conversation in chronological order. */
  get: (conversationId: number) => Promise<{ messages: ChatHistoryMessage[] }>;
  /** Start a new conversation. Returns the new id so the caller can
   * append messages to it immediately. */
  create: (docPath: string | null, title: string) => Promise<{ id: number }>;
  /** Append a message. Bumps the conversation's `updatedAt`. */
  append: (
    conversationId: number,
    role: 'system' | 'user' | 'assistant',
    content: string,
  ) => Promise<{ id: number }>;
  rename: (id: number, title: string) => Promise<{ ok: true }>;
  delete: (id: number) => Promise<{ ok: true }>;
}

export interface AppVersions {
  app: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  arch: string;
}

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  /** chunk 65 — open a fresh BrowserWindow with the same React app. */
  newWindow: () => Promise<void>;
  /** chunk 52 — About 창에서 사용. app/electron/chrome/node 버전 +
   * platform/arch 일괄 조회. package.json version 은 app.getVersion(). */
  getVersions: () => Promise<AppVersions>;
  /** chunk 63 — renderer-side global error bridge. Append to
   * `userData/error.log` (local-only sink — no upload). */
  logError: (req: { origin?: string; message: string }) => Promise<void>;
  file: FileApi;
  session: SessionApi;
  clipboard: ClipboardApi;
  folder: FolderApi;
  secrets: SecretsApi;
  ai: AiApi;
  chatHistory: ChatHistoryApi;
}

declare global {
  interface Window {
    api: AhwpApi;
  }
}

export {};
