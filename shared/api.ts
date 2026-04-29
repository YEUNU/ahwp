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

export interface AhwpApi {
  ping: (req: PingRequest) => Promise<PingResponse>;
}

declare global {
  interface Window {
    api: AhwpApi;
  }
}

export {};
