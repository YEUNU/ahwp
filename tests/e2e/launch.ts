import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

/**
 * Launches the built Electron app with an isolated userData directory
 * (so tests don't pollute or read real recent.json / session.json).
 *
 * Returns the app + first window + a cleanup function that closes the app
 * and removes the temp directory.
 */
export interface LaunchedApp {
  app: ElectronApplication;
  page: Page;
  userDataDir: string;
  close: () => Promise<void>;
}

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MAIN_ENTRY = path.join(REPO_ROOT, 'dist-electron', 'main.js');

export async function launchApp(): Promise<LaunchedApp> {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ahwp-e2e-'));
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return {
    app,
    page,
    userDataDir,
    close: async () => {
      await app.close();
      await rm(userDataDir, { recursive: true, force: true });
    },
  };
}
