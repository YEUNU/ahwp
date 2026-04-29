import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AhwpApi, MenuAction, PingRequest } from '../shared/api';

const api: AhwpApi = {
  ping: (req: PingRequest) => ipcRenderer.invoke('ipc:ping', req),
  onMenuAction: (handler) => {
    const listener = (_event: IpcRendererEvent, action: MenuAction) =>
      handler(action);
    ipcRenderer.on('menu:action', listener);
    return () => {
      ipcRenderer.off('menu:action', listener);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
