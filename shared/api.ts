/**
 * IPC contract shared between Electron main and renderer.
 * Renderer accesses these as window.api.*
 */

import type { ChatRequest, ChatStreamEvent, ProviderId } from './ai';

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
  | 'view:settings';

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
   * Reconfigure the external-change watcher to track exactly the paths
   * passed in. Pass `[]` to stop watching all files. The previous set is
   * always replaced — the renderer just resends the full path list when
   * tabs open/close. Idempotent.
   */
  watchPaths: (paths: string[]) => Promise<void>;
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

export interface FolderApi {
  /** Native dialog → returns absolute path or null on cancel. */
  pick: () => Promise<string | null>;
  /** List immediate children of `path`, sorted: folders first, alphabetical. */
  list: (path: string) => Promise<FolderEntry[]>;
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
  /** Override the provider's default base URL (e.g. self-hosted Ollama / NIM). */
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

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
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
