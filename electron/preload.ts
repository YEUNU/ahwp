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
    new: () => ipcRenderer.invoke('file:new'),
    open: () => ipcRenderer.invoke('file:open'),
    openByPath: (filePath) => ipcRenderer.invoke('file:open-by-path', filePath),
    listRecent: () => ipcRenderer.invoke('file:list-recent'),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    save: (req) => ipcRenderer.invoke('file:save', req),
    saveAs: (req) => ipcRenderer.invoke('file:save-as', req),
    getPathForFile: (file) => webUtils.getPathForFile(file),
  },
  session: {
    get: () => ipcRenderer.invoke('session:get'),
    set: (state) => ipcRenderer.invoke('session:set', state),
  },
};

contextBridge.exposeInMainWorld('api', api);
