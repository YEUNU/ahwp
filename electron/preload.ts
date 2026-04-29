import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
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
  file: {
    open: () => ipcRenderer.invoke('file:open'),
    openByPath: (filePath) => ipcRenderer.invoke('file:open-by-path', filePath),
    listRecent: () => ipcRenderer.invoke('file:list-recent'),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
};

contextBridge.exposeInMainWorld('api', api);
