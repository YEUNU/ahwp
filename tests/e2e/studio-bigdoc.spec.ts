/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Big-document load profile — multi-page HWP/HWPX fixture.
 *
 * Goals:
 *   1. Doc parses + first page renders within a budget
 *   2. Lazy rendering doesn't render every page upfront (memory)
 *   3. Scroll into view triggers render for distant pages
 *   4. Find across all paragraphs returns reasonably fast for many matches
 *
 * The exact page count depends on the fixture in `examples/`; assertions are
 * fixture-agnostic where possible (lower bounds rather than exact counts).
 * Numbers are upper bounds on dev hardware — looser than the Node-side probe
 * because Playwright + Electron adds startup + build overhead.
 */

const BIG_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
);

interface StudioDebug {
  focusViewer(): void;
  openFind(initialQuery?: string): void;
  getFindState(): {
    open: boolean;
    query: string;
    matchCount: number;
    activeIndex: number;
  };
}

async function activateStudio(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () =>
      Boolean(
        (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
      ),
    { timeout: 30_000 },
  );
}

test.describe('studio big doc — multi-page load profile', () => {
  test.skip(
    !existsSync(BIG_FIXTURE),
    "examples/(참고)(양식) ★'25년 ... .hwp fixture missing (gitignored)",
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, BIG_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('opens with multiple pages; indicator reads "1 / N"', async () => {
    const { page } = launched;
    const indicator = page.getByTestId('studio-page-indicator');
    await expect(indicator).toBeVisible({ timeout: 30_000 });
    const text = (await indicator.textContent()) ?? '';
    const m = text.match(/^\s*1\s*\/\s*(\d+)/);
    expect(m).not.toBeNull();
    const total = Number(m![1]);
    // Lower bound only — the rest of this suite needs enough pages to make
    // mount-window and scroll-unmount assertions meaningful (≥ ~20). The
    // current fixture renders 57 pages.
    expect(total).toBeGreaterThanOrEqual(20);
  });

  test('mount window — only ±5 pages from the active page have SVG mounted', async () => {
    const { page } = launched;
    await expect(
      page
        .getByTestId('studio-viewer-page')
        .first()
        .locator('svg, canvas')
        .first(),
    ).toBeVisible({ timeout: 30_000 });
    const total = await page.getByTestId('studio-viewer-page').count();
    expect(total).toBeGreaterThan(20);
    const mounted = await page
      .getByTestId('studio-viewer-page')
      .locator('svg, canvas')
      .count();
    // VIEWPORT_BUFFER_PAGES = 5 → max 11 mounted (current ±5).
    expect(mounted).toBeLessThanOrEqual(12);
  });

  test('scrolling to the bottom unmounts top pages', async () => {
    const { page } = launched;
    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    // Initially, page 0 is mounted.
    await expect(placeholders.first().locator('svg, canvas')).toHaveCount(1);
    // Scroll to last page.
    await placeholders.nth(total - 1).scrollIntoViewIfNeeded();
    // Wait for the rAF-throttled scroll handler to settle.
    await page.waitForTimeout(200);
    // Page 0 should now be UNMOUNTED (out of the ±5 window from the
    // bottom of a multi-page doc).
    await expect
      .poll(async () => placeholders.first().locator('svg, canvas').count())
      .toBe(0);
    // Last page is mounted.
    await expect(
      placeholders.nth(total - 1).locator('svg, canvas'),
    ).toHaveCount(1);
  });

  test('scroll to last page triggers lazy render', async () => {
    const { page } = launched;
    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    const last = placeholders.nth(total - 1);
    await expect(last.locator('svg, canvas')).toHaveCount(0);
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('svg, canvas').first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Find across the whole doc returns matches in under 5s', async () => {
    const { page } = launched;
    const t0 = Date.now();
    // "보고서" is common in Korean reports; if the fixture lacks it we'd
    // need to swap. Lower bound only — exact count varies by fixture.
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('보고서');
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (
                window as Window & { __studioDebug?: StudioDebug }
              ).__studioDebug!.getFindState().matchCount,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);
    const elapsed = Date.now() - t0;
    console.log(
      `[e2e] find scan over multi-page doc completed in ${elapsed} ms`,
    );
  });
});
