import { contextBridge, ipcRenderer } from 'electron';
import type { AhwpApi, PingRequest } from '../shared/api';

const api: AhwpApi = {
  ping: (req: PingRequest) => ipcRenderer.invoke('ipc:ping', req),
};

contextBridge.exposeInMainWorld('api', api);
