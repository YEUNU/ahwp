/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Studio migration coverage — chunks 2+ feature tests.
 *
 * Activates the studio path via localStorage flag + seeds
 * session.lastActivePath so the renderer auto-opens the fixture on reload
 * via the existing workspace restoration.
 *
 * Visual snapshot is darwin-only for now; Linux baseline lands in a later
 * chunk after we verify renderer determinism on both platforms.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');
// Stress fixture: user-supplied multi-page HWP. Skipped if absent (CI).
const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

async function activateStudio(page: Page, fixture: string): Promise<void> {
  // Studio is the default viewer (chunk 6 — `@rhwp/editor` iframe removed).
  // We only need to seed the session so AppShell auto-opens the fixture
  // on reload via workspace restoration.
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function waitForFirstPageRender(page: Page): Promise<void> {
  const firstPage = page.getByTestId('studio-viewer-page').first();
  await expect(firstPage.locator('svg').first()).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('studio viewer — chunk 2 (read-only POC)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('renders first page SVG for blank.hwpx', async () => {
    await waitForFirstPageRender(launched.page);
  });

  test('first-page visual snapshot — blank.hwpx', async () => {
    test.skip(
      process.platform !== 'darwin',
      'visual baseline only committed for darwin; Linux baseline lands later',
    );
    const { page } = launched;
    await waitForFirstPageRender(page);
    await page.waitForTimeout(500);
    await expect(
      page.getByTestId('studio-viewer-page').first(),
    ).toHaveScreenshot('blank-hwpx-page-0.png', { maxDiffPixelRatio: 0.05 });
  });
});

test.describe('studio viewer — chunk 3 (multi-page + zoom)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
    await waitForFirstPageRender(launched.page);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('placeholder count matches HwpViewer.pageCount', async () => {
    const { page } = launched;
    const indicator = page.getByTestId('studio-page-indicator');
    await expect(indicator).toBeVisible();
    const text = await indicator.textContent();
    // "1 / N"
    const match = text?.match(/^\s*1\s*\/\s*(\d+)/);
    expect(match).not.toBeNull();
    const expected = Number(match![1]);
    const placeholders = page.getByTestId('studio-viewer-page');
    await expect(placeholders).toHaveCount(expected);
  });

  test('zoom in increases placeholder dimensions; reset returns to 100%', async () => {
    const { page } = launched;
    const firstPage = page.getByTestId('studio-viewer-page').first();
    const baseBox = await firstPage.boundingBox();
    expect(baseBox).not.toBeNull();
    const baseWidth = baseBox!.width;

    await page.getByTestId('studio-zoom-in').click();
    await expect(page.getByTestId('studio-zoom-level')).toHaveText('125%');
    const zoomedBox = await firstPage.boundingBox();
    expect(zoomedBox!.width).toBeGreaterThan(baseWidth);

    await page.getByTestId('studio-zoom-reset').click();
    await expect(page.getByTestId('studio-zoom-level')).toHaveText('100%');
    const resetBox = await firstPage.boundingBox();
    expect(Math.round(resetBox!.width)).toBe(Math.round(baseWidth));
  });

  test('fit-to-width matches scroll container width (within page padding)', async () => {
    const { page } = launched;
    await page.getByTestId('studio-zoom-fit').click();
    const scroll = page.getByTestId('studio-scroll');
    const firstPage = page.getByTestId('studio-viewer-page').first();
    const scrollBox = await scroll.boundingBox();
    const pageBox = await firstPage.boundingBox();
    expect(scrollBox).not.toBeNull();
    expect(pageBox).not.toBeNull();
    // Page width should be close to scroll width minus padding (32px in code).
    const diff = Math.abs(scrollBox!.width - pageBox!.width - 32);
    expect(diff).toBeLessThan(20);
  });
});

test.describe('studio viewer — chunk 3 (multi-page stress)', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, STRESS_FIXTURE);
    await waitForFirstPageRender(launched.page);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('40-page document: scrolling triggers SVG render in later page', async () => {
    const { page } = launched;
    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    expect(total).toBeGreaterThan(5);

    // Last page should NOT yet have SVG (lazy rendering).
    const last = placeholders.nth(total - 1);
    await expect(last.locator('svg')).toHaveCount(0);

    // Scroll into view → IntersectionObserver fires → render.
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('svg').first()).toBeVisible({ timeout: 15_000 });
  });

  test('page indicator tracks the topmost visible page on scroll', async () => {
    const { page } = launched;
    const indicator = page.getByTestId('studio-page-indicator');
    // Starts at "1 / N".
    await expect(indicator).toContainText(/^\s*1\s*\//);

    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    expect(total).toBeGreaterThan(5);

    // Scroll a middle page into view — indicator should update to that page.
    const middleIdx = Math.min(10, total - 1);
    await placeholders.nth(middleIdx).scrollIntoViewIfNeeded();
    // Allow rAF + a render tick to settle.
    await page.waitForTimeout(200);
    await expect
      .poll(async () => {
        const txt = (await indicator.textContent()) ?? '';
        const m = txt.match(/^\s*(\d+)\s*\//);
        return m ? Number(m[1]) : 0;
      })
      .toBeGreaterThan(1);
    // And the indicator number should be near the scrolled page (within ±2).
    const nowText = (await indicator.textContent()) ?? '';
    const now = Number(nowText.match(/^\s*(\d+)\s*\//)?.[1] ?? 0);
    expect(Math.abs(now - (middleIdx + 1))).toBeLessThanOrEqual(2);
  });

  test('embedded images render — at least one page has visible <image> with data: href', async () => {
    const { page } = launched;
    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    expect(total).toBeGreaterThan(5);

    // Force lazy-render of every page by scrolling each into view. The
    // renderer's text reflow can place images on different pages than a
    // bare-bones Node-side inspection (measureTextWidth differs), so we
    // scan instead of guessing a fixed page.
    for (let i = 0; i < total; i++) {
      await placeholders.nth(i).scrollIntoViewIfNeeded();
    }
    // Let the IntersectionObserver + render pass settle.
    await page.waitForTimeout(1500);

    type Diag = Record<
      number,
      { string: number; parsed: number; mounted: number }
    >;
    const diag = (await page.evaluate(
      () => (window as Window & { __studioPageDiag?: Diag }).__studioPageDiag,
    )) as Diag | undefined;
    console.log('[e2e] studio page diag:', JSON.stringify(diag, null, 2));

    const pagesWithImages = Object.entries(diag ?? {}).filter(
      ([, v]) => v.mounted > 0,
    );
    if (pagesWithImages.length === 0) {
      throw new Error(
        `No page rendered any <image>. Per-page string/parsed/mounted:\n${JSON.stringify(diag, null, 2)}`,
      );
    }

    // Verify the first page that has images. The mount window is
    // rAF-throttled, so scrolling to the target page doesn't
    // synchronously remount its SVG — poll instead of single read.
    const [idxStr] = pagesWithImages[0];
    const target = placeholders.nth(Number(idxStr));
    await target.scrollIntoViewIfNeeded();
    const images = target.locator('svg image');
    await expect.poll(async () => images.count()).toBeGreaterThan(0);
    const href =
      (await images.first().getAttribute('href')) ??
      (await images.first().getAttribute('xlink:href'));
    expect(href).toMatch(/^data:image\//);
    const box = await images.first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);
  });
});
