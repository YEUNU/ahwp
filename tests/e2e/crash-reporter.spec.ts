/// <reference lib="dom" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Crash reporter — chunk 63. We can't easily trigger a native crash
 * inside Playwright, but we can verify the JS error sink: the
 * renderer's `window.error` handler bridges via `app:log-error`, and
 * main appends to `userData/error.log`.
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

test.describe('crash reporter — chunk 63', () => {
  test('renderer error → app:log-error → userData/error.log', async () => {
    const { app, page } = launched;
    // Send a synthetic error through the bridge. Going through the
    // public IPC keeps this independent of how `window.onerror` is
    // wired internally.
    await page.evaluate(async () => {
      await window.api.logError({
        origin: 'e2e:test',
        message: 'sentinel-crash-reporter-63',
      });
    });

    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const logPath = path.join(userDataDir, 'error.log');
    await expect.poll(() => existsSync(logPath), { timeout: 5_000 }).toBe(true);

    const text = readFileSync(logPath, 'utf8');
    expect(text).toContain('sentinel-crash-reporter-63');
    expect(text).toContain('[e2e:test]');
    // ISO timestamp prefix.
    expect(text).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/m);
  });

  test('crashReporter is initialized (uploadToServer disabled)', async () => {
    const { app } = launched;
    // crashReporter.getUploadToServer is the cleanest probe — returns
    // the boolean we set at start. Throws if start() never ran.
    const upload = await app.evaluate(({ crashReporter }) =>
      crashReporter.getUploadToServer(),
    );
    expect(upload).toBe(false);
  });
});
