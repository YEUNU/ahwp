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
  | 'view:settings';

export interface RecentFile {
  path: string;
  lastOpenedAt: number;
}

export interface FileOpenResult {
  path: string;
}

export interface FileApi {
  /** Show native open dialog. Returns null when the user cancels. */
  open: () => Promise<FileOpenResult | null>;
  /** Open a specific path (drag-drop, recent-list click). Returns null if rejected (e.g. wrong extension). */
  openByPath: (path: string) => Promise<FileOpenResult | null>;
  /** Most-recent-first list, capped to N entries. */
  listRecent: () => Promise<RecentFile[]>;
  /**
   * Resolve a renderer-side File object to its absolute disk path.
   * Wraps Electron's webUtils.getPathForFile (replacement for the removed File.path).
   */
  getPathForFile: (file: File) => string;
}

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
  file: FileApi;
}

declare global {
  interface Window {
    api: AhwpApi;
  }
}

export {};
