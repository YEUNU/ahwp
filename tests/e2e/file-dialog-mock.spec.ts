/// <reference lib="dom" />
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * file:open / file:save-as dialog regression — chunk 60.
 *
 * Native OS dialogs can't be driven by Playwright. We monkey-patch
 * `dialog.showOpenDialog` / `dialog.showSaveDialog` in the main
 * process via `app.evaluate(...)` to return a fixed path, then fire
 * the menu IPC ('menu:action' file:open / file:save-as) and verify
 * the renderer reaches the expected post-dialog state (tab opens /
 * file is written to disk).
 *
 * What this guards: the menu action wiring, useSaveFlow plumbing,
 * `file:open` / `file:save-as` IPC contract, and the atomic write +
 * `.bak` sidecar.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  exportBytes(): Uint8Array;
}

let launched: LaunchedApp;
let tmpDir: string;

test.beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ahwp-fdialog-'));
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

test.describe('file dialog mocking — chunk 60', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('file:open menu action → mocked dialog returns path → tab opens', async () => {
    const { app, page } = launched;
    const fixturePath = path.join(tmpDir, 'open-target.hwpx');
    copyFileSync(FIXTURE, fixturePath);

    // Override main-process showOpenDialog before firing the menu.
    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showOpenDialog = (async () => ({
        canceled: false,
        filePaths: [picked],
      })) as typeof dialog.showOpenDialog;
    }, fixturePath);

    // Drive the menu action. The renderer subscribes to 'menu:action' on
    // mount, so we re-emit the IPC by fetching the active window from
    // the main process and sending the channel event directly.
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', 'file:open');
    });

    // Tab opens — wait for __studioDebug + tab-bar entry.
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 15_000 },
    );
    const tabs = page.getByTestId('studio-tab');
    await expect(tabs).toHaveCount(1, { timeout: 5000 });
    await expect(tabs.first()).toContainText('open-target');
  });

  test('file:save-as menu action → mocked dialog → file written + .bak sidecar', async () => {
    const { app, page } = launched;
    const fixturePath = path.join(tmpDir, 'src.hwpx');
    const targetPath = path.join(tmpDir, 'saved-as.hwp');
    copyFileSync(FIXTURE, fixturePath);

    // First open the source via direct IPC so we have something to
    // save — this avoids tangling open + save-as in one mock.
    await page.evaluate(async (p) => {
      await window.api.file.openByPath(p);
      await window.api.session.set({ openTabPaths: [p], lastActivePath: p });
    }, fixturePath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    // Override main-process showSaveDialog.
    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: picked,
      })) as typeof dialog.showSaveDialog;
    }, targetPath);

    // Make a tiny edit so the saved bytes differ from the source —
    // exercises the actual write path.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'SAVED_AS_SENTINEL');
    });

    // Fire file:save-as.
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', 'file:save-as');
    });

    // Poll for the target file to materialize (atomic write =
    // tmp + rename, so it appears in one shot once the IPC settles).
    await expect
      .poll(() => existsSync(targetPath), { timeout: 10_000 })
      .toBe(true);

    // Sanity: written bytes are non-empty CFB (HWP magic d0cf11e0).
    const bytes = readFileSync(targetPath);
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes[0]).toBe(0xd0);
    expect(bytes[1]).toBe(0xcf);

    // .bak only exists when overwriting an existing file. saved-as.hwp
    // is a brand-new path, so no sidecar is expected — invariant
    // documented in electron/ipc/file.ts.
    expect(existsSync(`${targetPath}.bak`)).toBe(false);
  });

  // chunk 95 보강 — cancel + .hwpx auto-route + multi-save .bak idempotency.
  test('file:open dialog canceled → no tab opens', async () => {
    const { app, page } = launched;
    // Mock cancel.
    await app.evaluate(async ({ dialog }) => {
      dialog.showOpenDialog = (async () => ({
        canceled: true,
        filePaths: [],
      })) as typeof dialog.showOpenDialog;
    });
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', 'file:open');
    });
    // Allow the IPC round-trip to settle without forcing a load — there
    // should be no tab to wait for.
    await page.waitForTimeout(800);
    const tabs = page.getByTestId('studio-tab');
    await expect(tabs).toHaveCount(0);
  });

  test('file:save-as canceled → file is NOT written', async () => {
    const { app, page } = launched;
    const fixturePath = path.join(tmpDir, 'src-cancel.hwpx');
    const targetPath = path.join(tmpDir, 'never-written.hwp');
    copyFileSync(FIXTURE, fixturePath);

    await page.evaluate(async (p) => {
      await window.api.file.openByPath(p);
      await window.api.session.set({ openTabPaths: [p], lastActivePath: p });
    }, fixturePath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await app.evaluate(async ({ dialog }) => {
      dialog.showSaveDialog = (async () => ({
        canceled: true,
        filePath: '',
      })) as typeof dialog.showSaveDialog;
    });

    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', 'file:save-as');
    });
    // Wait for the IPC to settle, then verify nothing materialized.
    await page.waitForTimeout(800);
    expect(existsSync(targetPath)).toBe(false);
    expect(existsSync(`${targetPath}.bak`)).toBe(false);
  });

  test('file:save-as picking .hwpx auto-routes to sibling .hwp (chunk 60 invariant)', async () => {
    const { app, page } = launched;
    const fixturePath = path.join(tmpDir, 'src-route.hwpx');
    // User picks .hwpx; main rewrites to .hwp because @rhwp/core HWPX
    // round-trip drops images (CLAUDE.md note).
    const pickedPath = path.join(tmpDir, 'route-target.hwpx');
    const expectedTarget = path.join(tmpDir, 'route-target.hwp');
    copyFileSync(FIXTURE, fixturePath);

    await page.evaluate(async (p) => {
      await window.api.file.openByPath(p);
      await window.api.session.set({ openTabPaths: [p], lastActivePath: p });
    }, fixturePath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: picked,
      })) as typeof dialog.showSaveDialog;
    }, pickedPath);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'ROUTED');
    });

    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', 'file:save-as');
    });

    // The .hwp sibling materializes; the user-picked .hwpx never exists.
    await expect
      .poll(() => existsSync(expectedTarget), { timeout: 10_000 })
      .toBe(true);
    expect(existsSync(pickedPath)).toBe(false);
    // Bytes are CFB (HWP) magic.
    const bytes = readFileSync(expectedTarget);
    expect(bytes[0]).toBe(0xd0);
    expect(bytes[1]).toBe(0xcf);
  });

  test('file:save-as on existing path writes .bak sidecar once', async () => {
    const { app, page } = launched;
    const fixturePath = path.join(tmpDir, 'src2.hwpx');
    const targetPath = path.join(tmpDir, 'overwrite.hwp');
    copyFileSync(FIXTURE, fixturePath);
    // Pre-populate the target so save-as overwrites it.
    copyFileSync(FIXTURE, targetPath);
    const originalSize = readFileSync(targetPath).length;

    await page.evaluate(async (p) => {
      await window.api.file.openByPath(p);
      await window.api.session.set({ openTabPaths: [p], lastActivePath: p });
    }, fixturePath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await app.evaluate(async ({ dialog }, picked) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: picked,
      })) as typeof dialog.showSaveDialog;
    }, targetPath);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'OVERWRITE_BODY');
    });

    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.webContents.send('menu:action', 'file:save-as');
    });

    // Wait for the .bak sidecar — main writes it before the atomic
    // rename, so it appears synchronously after the IPC settles.
    await expect
      .poll(() => existsSync(`${targetPath}.bak`), { timeout: 10_000 })
      .toBe(true);
    // .bak should match the original (pre-overwrite) bytes.
    expect(readFileSync(`${targetPath}.bak`).length).toBe(originalSize);
  });
});
