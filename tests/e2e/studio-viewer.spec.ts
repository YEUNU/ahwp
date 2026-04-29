/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 2 — read-only StudioViewer (HwpViewer.renderPageSvg(0)).
 *
 * Activates the studio path via localStorage flag + seeds session.lastActivePath
 * so the renderer auto-opens the fixture on reload via the existing workspace
 * restoration. We don't need to drive the FileList UI for this test.
 *
 * Visual snapshot is darwin-only for chunk 2; a Linux baseline lands in a
 * later chunk after we verify renderer determinism on both platforms.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

test.describe('studio viewer (chunk 2 — read-only POC)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    // Seed the renderer for studio mode + auto-open the fixture, then reload
    // so AppShell's session-restoration effect picks it up.
    await launched.page.evaluate(async (p) => {
      localStorage.setItem('ahwp:use-studio', '1');
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('renders first page SVG for blank.hwpx', async () => {
    const { page } = launched;
    const viewerPage = page.getByTestId('studio-viewer-page');
    // Wait for SVG to be injected — generous timeout for first WASM init
    // (~hundreds of ms for 4.5 MB load + parse).
    await expect(viewerPage.locator('svg').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('first-page visual snapshot — blank.hwpx', async () => {
    test.skip(
      process.platform !== 'darwin',
      'visual baseline only committed for darwin in chunk 2; Linux baseline in a later chunk',
    );
    const { page } = launched;
    const viewerPage = page.getByTestId('studio-viewer-page');
    await expect(viewerPage.locator('svg').first()).toBeVisible({
      timeout: 30_000,
    });
    // Extra settle time so any async font fallback fully resolves before the
    // screenshot is taken.
    await page.waitForTimeout(500);
    await expect(viewerPage).toHaveScreenshot('blank-hwpx-page-0.png', {
      maxDiffPixelRatio: 0.05,
    });
  });
});
