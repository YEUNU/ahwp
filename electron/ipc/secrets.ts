import { BrowserWindow, ipcMain } from 'electron';
import { isProviderId, type ProviderId } from '../../shared/ai';
import {
  deleteSecret,
  hasSecret,
  listProvidersWithSecret,
  setSecret,
} from '../store/secrets';

function assertProviderId(id: unknown): asserts id is ProviderId {
  if (!isProviderId(id)) {
    throw new Error(`Invalid provider id: ${String(id)}`);
  }
}

/**
 * chunk 70 — broadcast a `secrets:changed` event to every renderer
 * window after a set/delete. The renderer (ChatPanel) re-fires its
 * model-list pre-fetch so the dropdown is ready when the user
 * switches providers, instead of only being warm for the active one.
 */
function broadcastSecretsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('secrets:changed');
  }
}

export function registerSecretsIpc(): void {
  ipcMain.handle(
    'secrets:set',
    async (_event, providerId: unknown, key: unknown) => {
      assertProviderId(providerId);
      if (typeof key !== 'string') {
        throw new Error('Key must be a string');
      }
      const trimmed = key.trim();
      if (trimmed.length === 0) {
        throw new Error('Key must be non-empty');
      }
      await setSecret(providerId, trimmed);
      broadcastSecretsChanged();
    },
  );

  ipcMain.handle('secrets:delete', async (_event, providerId: unknown) => {
    assertProviderId(providerId);
    await deleteSecret(providerId);
    broadcastSecretsChanged();
  });

  ipcMain.handle('secrets:has', async (_event, providerId: unknown) => {
    assertProviderId(providerId);
    return hasSecret(providerId);
  });

  ipcMain.handle('secrets:list', async () => {
    return listProvidersWithSecret();
  });
}
