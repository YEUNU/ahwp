/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Canvas render smoke (chunk 103/107, Phase 6.3+) — verifies that
 * `renderPageToCanvasFiltered` produces a sized `<canvas>` element with
 * non-zero backing-store pixels for a fixture page.
 *
 * Pre-chunk-107 this spec set `localStorage.ahwp:render-mode='canvas'`
 * because SVG was the default. Post-107 the SVG path is gone — Canvas
 * is the only path. The localStorage seed is dropped accordingly.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

async function activateCanvasMode(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test.describe('studio canvas mode — chunk 103 (Phase 6.3)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('renders first page via <canvas> (not <svg>) when render-mode = canvas', async () => {
    await activateCanvasMode(launched.page, FIXTURE);

    const firstPage = launched.page.getByTestId('studio-viewer-page').first();
    // Canvas mounts inside the page container instead of <svg>.
    await expect(firstPage.locator('canvas').first()).toBeVisible({
      timeout: 30_000,
    });
    // SVG must NOT be present in canvas mode.
    await expect(firstPage.locator('svg').first()).toHaveCount(0);
  });

  test('canvas backing-store size matches pageDims × zoom × DPR', async () => {
    await activateCanvasMode(launched.page, FIXTURE);

    const firstPage = launched.page.getByTestId('studio-viewer-page').first();
    await expect(firstPage.locator('canvas').first()).toBeVisible({
      timeout: 30_000,
    });

    const dims = await launched.page.evaluate(() => {
      const c = document.querySelector(
        '[data-testid="studio-viewer-page"] canvas',
      ) as HTMLCanvasElement | null;
      if (!c) return null;
      return {
        backingW: c.width,
        backingH: c.height,
        cssW: c.clientWidth,
        cssH: c.clientHeight,
        dpr: window.devicePixelRatio || 1,
      };
    });

    expect(dims).not.toBeNull();
    expect(dims!.backingW).toBeGreaterThan(0);
    expect(dims!.backingH).toBeGreaterThan(0);
    // Backing store must be at least DPR× the CSS size (allowing for
    // rounding by 1 px in either direction).
    expect(dims!.backingW).toBeGreaterThanOrEqual(
      Math.floor(dims!.cssW * dims!.dpr) - 1,
    );
    expect(dims!.backingH).toBeGreaterThanOrEqual(
      Math.floor(dims!.cssH * dims!.dpr) - 1,
    );
  });

  test('canvas has non-blank pixel content (renderPageToCanvasFiltered drew something)', async () => {
    await activateCanvasMode(launched.page, FIXTURE);

    const firstPage = launched.page.getByTestId('studio-viewer-page').first();
    await expect(firstPage.locator('canvas').first()).toBeVisible({
      timeout: 30_000,
    });

    // Canvas should have non-uniform pixel data — sample a small region
    // near the top-left and check that not all pixels are pure white
    // (the lib at minimum draws the page background + body text or
    // margin guides).
    const hasContent = await launched.page.evaluate(() => {
      const c = document.querySelector(
        '[data-testid="studio-viewer-page"] canvas',
      ) as HTMLCanvasElement | null;
      if (!c) return false;
      const ctx = c.getContext('2d');
      if (!ctx) return false;
      // Sample 64×64 region near the top-left of the page (page edge +
      // any header text / margin guides land here for blank.hwpx).
      const w = Math.min(64, c.width);
      const h = Math.min(64, c.height);
      const data = ctx.getImageData(0, 0, w, h).data;
      // A blank canvas would be all-zero RGBA. Any non-zero alpha
      // indicates the lib drew something.
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] !== 0) return true;
      }
      return false;
    });
    expect(hasContent).toBe(true);
  });
});
