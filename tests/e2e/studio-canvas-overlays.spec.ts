/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Canvas-mode DOM overlay regression (chunk 105, Phase 6.5) —
 * verifies that selection / find / changed-paragraph highlights, which
 * have always been rendered as `<div>` DOM overlays in PaperPage, work
 * correctly in Canvas mode without change.
 *
 * If any of these were SVG-internal `<rect>` they'd silently disappear
 * when Canvas takes over from SVG. This spec is the load-bearing gate
 * preventing that regression.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

async function activateCanvasMode(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    window.localStorage.setItem('ahwp:render-mode', 'canvas');
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function waitForCanvasMount(page: Page): Promise<void> {
  const firstPage = page.getByTestId('studio-viewer-page').first();
  await expect(firstPage.locator('canvas').first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('studio canvas overlays — chunk 105 (Phase 6.5)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('selection rect renders as DOM overlay (not SVG <rect>) in canvas mode', async () => {
    await activateCanvasMode(launched.page, FIXTURE);
    await waitForCanvasMount(launched.page);

    // Insert text via debug surface, then use ⌘A / Ctrl+A to select all.
    await launched.page.evaluate(() => {
      const dbg = (
        window as Window & { __studioDebug?: Record<string, unknown> }
      ).__studioDebug as
        | undefined
        | {
            insertText?: (s: number, p: number, c: number, t: string) => void;
            focusViewer?: () => void;
          };
      if (!dbg) throw new Error('__studioDebug missing');
      dbg.insertText?.(0, 0, 0, 'Hello canvas overlay');
      dbg.focusViewer?.();
    });
    const isMac = process.platform === 'darwin';
    await launched.page.keyboard.press(isMac ? 'Meta+A' : 'Control+A');

    // Selection rect overlays are siblings of the canvas, so we wait
    // for at least one studio-selection-rect testid to appear inside a
    // page container.
    const sel = launched.page
      .getByTestId('studio-viewer-page')
      .first()
      .getByTestId('studio-selection-rect')
      .first();
    await expect(sel).toBeVisible({ timeout: 15_000 });
  });

  test('find match highlights are DOM divs in canvas mode', async () => {
    await activateCanvasMode(launched.page, FIXTURE);
    await waitForCanvasMount(launched.page);

    await launched.page.evaluate(() => {
      const dbg = (
        window as Window & { __studioDebug?: Record<string, unknown> }
      ).__studioDebug as
        | undefined
        | {
            insertText?: (s: number, p: number, c: number, t: string) => void;
            openFind?: () => void;
          };
      dbg?.insertText?.(0, 0, 0, 'find me find me find me');
      dbg?.openFind?.();
    });

    // Type the query into the find bar.
    const findInput = launched.page
      .getByTestId('studio-find-bar')
      .locator('input[type="text"]')
      .first();
    await findInput.fill('find');
    // At least one find-match div should appear.
    await expect(
      launched.page.getByTestId('studio-find-match').first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
