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

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
  onMenuAction: (handler: (action: MenuAction) => void) => () => void;
}

declare global {
  interface Window {
    api: AhwpApi;
  }
}

export {};
