/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Big-document load profile — 144-page HWPX.
 *
 * Goals:
 *   1. Doc parses + first page renders within a budget
 *   2. Lazy rendering doesn't render every page upfront (memory)
 *   3. Scroll into view triggers render for distant pages
 *   4. Find across all paragraphs returns reasonably fast for many matches
 *
 * Numbers here are upper bounds on dev hardware — looser than the
 * Node-side probe (scripts/probe-bigdoc.mjs) because Playwright + Electron
 * adds startup + build overhead.
 */

const BIG_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '★2026년 스마트공장 보급확산사업 세부관리기준 개정(전문)_260327.hwpx',
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

test.describe('studio big doc — 144-page load profile', () => {
  test.skip(
    !existsSync(BIG_FIXTURE),
    'examples/★2026년 ... .hwpx fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, BIG_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('opens with ~144 pages and indicator reads "1 / 144"', async () => {
    const { page } = launched;
    const indicator = page.getByTestId('studio-page-indicator');
    await expect(indicator).toBeVisible({ timeout: 30_000 });
    const text = (await indicator.textContent()) ?? '';
    const m = text.match(/^\s*1\s*\/\s*(\d+)/);
    expect(m).not.toBeNull();
    const total = Number(m![1]);
    // We expect 144 but the renderer's text reflow can shift by a small
    // amount (KNOWN_ISSUES L-004); allow ±10.
    expect(total).toBeGreaterThanOrEqual(134);
    expect(total).toBeLessThanOrEqual(154);
  });

  test('mount window — only ±5 pages from the active page have SVG mounted', async () => {
    const { page } = launched;
    await expect(
      page.getByTestId('studio-viewer-page').first().locator('svg').first(),
    ).toBeVisible({ timeout: 30_000 });
    const total = await page.getByTestId('studio-viewer-page').count();
    expect(total).toBeGreaterThan(100);
    const mounted = await page
      .getByTestId('studio-viewer-page')
      .locator('svg')
      .count();
    // VIEWPORT_BUFFER_PAGES = 5 → max 11 mounted (current ±5).
    expect(mounted).toBeLessThanOrEqual(12);
  });

  test('scrolling to the bottom unmounts top pages', async () => {
    const { page } = launched;
    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    // Initially, page 0 is mounted.
    await expect(placeholders.first().locator('svg')).toHaveCount(1);
    // Scroll to last page.
    await placeholders.nth(total - 1).scrollIntoViewIfNeeded();
    // Wait for the rAF-throttled scroll handler to settle.
    await page.waitForTimeout(200);
    // Page 0 should now be UNMOUNTED (out of the ±5 window from the
    // bottom of a 144-page doc).
    await expect
      .poll(async () => placeholders.first().locator('svg').count())
      .toBe(0);
    // Last page is mounted.
    await expect(placeholders.nth(total - 1).locator('svg')).toHaveCount(1);
  });

  test('scroll to last page triggers lazy render', async () => {
    const { page } = launched;
    const placeholders = page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    const last = placeholders.nth(total - 1);
    await expect(last.locator('svg')).toHaveCount(0);
    await last.scrollIntoViewIfNeeded();
    await expect(last.locator('svg').first()).toBeVisible({ timeout: 15_000 });
  });

  test('Find across the whole doc returns many matches in under 5s', async () => {
    const { page } = launched;
    const t0 = Date.now();
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('사업');
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
      .toBeGreaterThan(50);
    const elapsed = Date.now() - t0;
    console.log(`[e2e] find scan over 144-page doc completed in ${elapsed} ms`);
  });
});
