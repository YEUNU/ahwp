/**
 * IPC contract shared between Electron main and renderer.
 * Renderer accesses these as window.api.*
 */

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
  | 'edit:undo'
  | 'edit:redo'
  | 'edit:copy'
  | 'edit:cut'
  | 'edit:paste'
  | 'edit:find'
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

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  file: FileApi;
  session: SessionApi;
  clipboard: ClipboardApi;
  folder: FolderApi;
}

declare global {
  interface Window {
    api: AhwpApi;
  }
}

export {};
