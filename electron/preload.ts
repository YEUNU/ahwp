import {
  contextBridge,
  ipcRenderer,
  webUtils,
  type IpcRendererEvent,
} from 'electron';
import type { ChatStreamEvent } from '../shared/ai';
import type {
  AhwpApi,
  ExternalFileChangeEvent,
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
  newWindow: () => ipcRenderer.invoke('app:new-window'),
  file: {
    new: () => ipcRenderer.invoke('file:new'),
    open: () => ipcRenderer.invoke('file:open'),
    openByPath: (filePath) => ipcRenderer.invoke('file:open-by-path', filePath),
    listRecent: () => ipcRenderer.invoke('file:list-recent'),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    save: (req) => ipcRenderer.invoke('file:save', req),
    saveAs: (req) => ipcRenderer.invoke('file:save-as', req),
    exportHtml: (req) => ipcRenderer.invoke('file:export-html', req),
    exportPdf: (req) => ipcRenderer.invoke('file:export-pdf', req),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    watchPaths: (paths) => ipcRenderer.invoke('file:watch-paths', paths),
    saveDraft: (req) => ipcRenderer.invoke('file:save-draft', req),
    hasDraft: (p) => ipcRenderer.invoke('file:has-draft', p),
    loadDraft: (p) => ipcRenderer.invoke('file:load-draft', p),
    clearDraft: (p) => ipcRenderer.invoke('file:clear-draft', p),
    createVersion: (req) => ipcRenderer.invoke('file:create-version', req),
    listVersions: (p) => ipcRenderer.invoke('file:list-versions', p),
    readVersion: (req) => ipcRenderer.invoke('file:read-version', req),
    onExternalChange: (handler) => {
      const listener = (
        _event: IpcRendererEvent,
        event: ExternalFileChangeEvent,
      ) => handler(event);
      ipcRenderer.on('file:external-change', listener);
      return () => {
        ipcRenderer.off('file:external-change', listener);
      };
    },
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
    searchText: (req) => ipcRenderer.invoke('folder:search-text', req),
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
    copy: (src, destDir) => ipcRenderer.invoke('folder:copy', src, destDir),
  },
  secrets: {
    set: (providerId, key) =>
      ipcRenderer.invoke('secrets:set', providerId, key),
    delete: (providerId) => ipcRenderer.invoke('secrets:delete', providerId),
    has: (providerId) => ipcRenderer.invoke('secrets:has', providerId),
    list: () => ipcRenderer.invoke('secrets:list'),
  },
  ai: {
    chat: (request, callbacks) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const channel = `ai:chat-event:${id}`;
      let settled = false;
      const listener = (_event: IpcRendererEvent, evt: ChatStreamEvent) => {
        if (settled) return;
        callbacks.onEvent(evt);
        if (evt.type === 'done' || evt.type === 'error') {
          settled = true;
          ipcRenderer.off(channel, listener);
        }
      };
      ipcRenderer.on(channel, listener);
      void ipcRenderer
        .invoke('ai:chat-start', { id, request })
        .catch((err: unknown) => {
          if (settled) return;
          settled = true;
          ipcRenderer.off(channel, listener);
          callbacks.onEvent({
            type: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        });
      return {
        abort: () => {
          if (settled) return;
          settled = true;
          ipcRenderer.off(channel, listener);
          void ipcRenderer.invoke('ai:chat-abort', id);
        },
      };
    },
    ping: (providerId, opts) =>
      ipcRenderer.invoke('ai:ping', { providerId, ...opts }),
    listModels: (providerId, opts) =>
      ipcRenderer.invoke('ai:list-models', { providerId, ...opts }),
    clearModelsCache: (providerId) =>
      ipcRenderer.invoke('ai:clear-models-cache', { providerId }),
    getProviderConfig: (providerId) =>
      ipcRenderer.invoke('ai:provider-config-get', providerId),
    setProviderConfig: (params) =>
      ipcRenderer.invoke('ai:provider-config-set', params),
  },
  chatHistory: {
    list: (docPath) => ipcRenderer.invoke('chat-history:list', { docPath }),
    get: (conversationId) =>
      ipcRenderer.invoke('chat-history:get', { conversationId }),
    create: (docPath, title) =>
      ipcRenderer.invoke('chat-history:create', { docPath, title }),
    append: (conversationId, role, content) =>
      ipcRenderer.invoke('chat-history:append', {
        conversationId,
        role,
        content,
      }),
    rename: (id, title) =>
      ipcRenderer.invoke('chat-history:rename', { id, title }),
    delete: (id) => ipcRenderer.invoke('chat-history:delete', { id }),
  },
};

contextBridge.exposeInMainWorld('api', api);
