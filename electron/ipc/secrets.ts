import { ipcMain } from 'electron';
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
    },
  );

  ipcMain.handle('secrets:delete', async (_event, providerId: unknown) => {
    assertProviderId(providerId);
    await deleteSecret(providerId);
  });

  ipcMain.handle('secrets:has', async (_event, providerId: unknown) => {
    assertProviderId(providerId);
    return hasSecret(providerId);
  });

  ipcMain.handle('secrets:list', async () => {
    return listProvidersWithSecret();
  });
}
