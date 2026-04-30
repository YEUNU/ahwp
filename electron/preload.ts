import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
import type {
  AhwpApi,
  FolderChangeEvent,
  MenuAction,
  PingRequest,
} from '../shared/api';

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
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:read-text'),
    writeText: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  },
  folder: {
    pick: () => ipcRenderer.invoke('folder:pick'),
    list: (path) => ipcRenderer.invoke('folder:list', path),
    watch: (rootPath) => ipcRenderer.invoke('folder:watch', rootPath),
    unwatch: () => ipcRenderer.invoke('folder:unwatch'),
    onChange: (handler) => {
      const listener = (_event: IpcRendererEvent, event: FolderChangeEvent) =>
        handler(event);
      ipcRenderer.on('folder:changed', listener);
      return () => {
        ipcRenderer.off('folder:changed', listener);
      };
    },
    createFile: (parentPath, name) =>
      ipcRenderer.invoke('folder:create-file', parentPath, name),
    createFolder: (parentPath, name) =>
      ipcRenderer.invoke('folder:create-folder', parentPath, name),
    rename: (oldPath, newPath) =>
      ipcRenderer.invoke('folder:rename', oldPath, newPath),
    trash: (path) => ipcRenderer.invoke('folder:trash', path),
    reveal: (path) => ipcRenderer.invoke('folder:reveal', path),
  },
};

contextBridge.exposeInMainWorld('api', api);
