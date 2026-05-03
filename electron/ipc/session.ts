import { ipcMain } from 'electron';
import type { SessionState } from '../../shared/api';
import { getSession, setSession } from '../store/session';

export function registerSessionIpc(): void {
  ipcMain.handle('session:get', () => getSession());
  ipcMain.handle('session:set', (_event, state: SessionState) =>
    setSession(state),
  );
}
