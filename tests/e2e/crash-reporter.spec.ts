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

  // chunk 95 보강 — multi-error append, default origin, malformed input.
  test('multiple errors append rather than overwrite', async () => {
    const { app, page } = launched;
    await page.evaluate(async () => {
      await window.api.logError({
        origin: 'e2e:test',
        message: 'first-entry',
      });
      await window.api.logError({
        origin: 'e2e:test',
        message: 'second-entry',
      });
      await window.api.logError({
        origin: 'e2e:other',
        message: 'third-entry',
      });
    });

    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const logPath = path.join(userDataDir, 'error.log');
    await expect
      .poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''), {
        timeout: 5_000,
      })
      .toContain('third-entry');

    const text = readFileSync(logPath, 'utf8');
    // All three entries present in order.
    expect(text).toContain('first-entry');
    expect(text).toContain('second-entry');
    expect(text).toContain('third-entry');
    expect(text.indexOf('first-entry')).toBeLessThan(
      text.indexOf('second-entry'),
    );
    expect(text.indexOf('second-entry')).toBeLessThan(
      text.indexOf('third-entry'),
    );
    // Each entry on its own line with timestamp+origin prefix.
    const lines = text.trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines.slice(-3)) {
      expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] \[e2e:.*\] /);
    }
  });

  test('logError without origin defaults to "renderer"', async () => {
    const { app, page } = launched;
    await page.evaluate(async () => {
      await window.api.logError({
        message: 'sentinel-no-origin-95',
      });
    });
    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const logPath = path.join(userDataDir, 'error.log');
    await expect
      .poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''), {
        timeout: 5_000,
      })
      .toContain('sentinel-no-origin-95');
    const text = readFileSync(logPath, 'utf8');
    expect(text).toMatch(/\[renderer\] sentinel-no-origin-95/);
  });

  test('multi-line stack body is preserved as-is', async () => {
    const { app, page } = launched;
    const stack =
      'Error: stack-test-95\n    at fn1 (a.ts:1:1)\n    at fn2 (b.ts:2:2)';
    await page.evaluate(async (s) => {
      await window.api.logError({
        origin: 'e2e:stack',
        message: s,
      });
    }, stack);
    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const logPath = path.join(userDataDir, 'error.log');
    await expect
      .poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''), {
        timeout: 5_000,
      })
      .toContain('stack-test-95');
    const text = readFileSync(logPath, 'utf8');
    // Stack body kept verbatim — multi-line preserved.
    expect(text).toContain('at fn1 (a.ts:1:1)');
    expect(text).toContain('at fn2 (b.ts:2:2)');
  });

  test('malformed payload (missing message) is silently ignored', async () => {
    const { app, page } = launched;
    // Send a valid entry first as a baseline.
    await page.evaluate(async () => {
      await window.api.logError({
        origin: 'e2e:test',
        message: 'baseline-95',
      });
    });
    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const logPath = path.join(userDataDir, 'error.log');
    await expect
      .poll(() => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : ''), {
        timeout: 5_000,
      })
      .toContain('baseline-95');
    const before = readFileSync(logPath, 'utf8');

    // Now send malformed payloads — should silently no-op (handler
    // returns early on `typeof req.message !== 'string'`).
    await page.evaluate(async () => {
      type Bad = Parameters<typeof window.api.logError>[0];
      await window.api.logError({ origin: 'x' } as unknown as Bad);
      await window.api.logError({
        origin: 'x',
        message: 123,
      } as unknown as Bad);
      await window.api.logError(null as unknown as Bad);
    });
    // Give the handler time to NOT write — small wait window.
    await page.waitForTimeout(300);
    const after = readFileSync(logPath, 'utf8');
    // No new content appended.
    expect(after).toBe(before);
  });
});
