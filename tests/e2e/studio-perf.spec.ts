/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Performance smoke — chunk 64. Records timing for the three flows
 * that get noticeably slow on 50p+ docs:
 *
 *   1. Initial load (file:read → @rhwp/core parse → first
 *      __studioDebug ready).
 *   2. Cmd/Ctrl+End jump (caret traversal + scroll).
 *   3. 10× PageDown (incremental scroll w/ off-viewport unmount).
 *
 * The thresholds are loose CI-friendly ceilings. They are NOT
 * benchmarks — they catch order-of-magnitude regressions (e.g. 300ms
 * → 5s when someone breaks lazy mount). Tighter perf budgets belong
 * in a dedicated perf harness if/when we have CI metrics infra.
 *
 * The fixture is a 144-page doc shipped under `examples/`. CI without
 * the fixture skips the spec.
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
  getPageCount(): number;
}

async function getScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="studio-scroll"]',
    ) as HTMLElement | null;
    return el?.scrollTop ?? -1;
  });
}

test.describe('studio perf — chunk 64', () => {
  test.skip(
    !existsSync(BIG_FIXTURE),
    "examples/(참고)(양식) ★'25년 ... .hwp fixture missing (gitignored)",
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('initial load (144p doc) reaches __studioDebug under threshold', async () => {
    const { page } = launched;
    const t0 = Date.now();
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BIG_FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    const elapsed = Date.now() - t0;
    // Loose ceiling — CI variance is 3-5×. Real measurement on dev
    // box is ~1-2s. A regression that doubles this needs attention.
    expect(elapsed).toBeLessThan(15_000);
    // Sanity: parse succeeded.
    const pageCount = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getPageCount(),
    );
    expect(pageCount).toBeGreaterThan(50);
    // Telemetry — surfaced in playwright report stdout.
    console.log(`[perf] initial load: ${elapsed}ms (pages=${pageCount})`);
  });

  test('cmd+End on 144p doc completes scroll within budget', async () => {
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BIG_FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    expect(await getScrollTop(page)).toBe(0);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    const t0 = Date.now();
    await page.keyboard.press(`${mod}+End`);
    await expect
      .poll(() => getScrollTop(page), { timeout: 10_000 })
      .toBeGreaterThan(1000);
    const elapsed = Date.now() - t0;
    // 10s ceiling = catastrophic regression. Real value on dev box
    // is sub-second.
    expect(elapsed).toBeLessThan(10_000);
    console.log(`[perf] cmd+End: ${elapsed}ms`);
  });

  test('10× PageDown sequence keeps each press under budget', async () => {
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BIG_FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    const t0 = Date.now();
    let prev = 0;
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('PageDown');
      await expect
        .poll(() => getScrollTop(page), { timeout: 5_000 })
        .toBeGreaterThan(prev);
      prev = await getScrollTop(page);
    }
    const elapsed = Date.now() - t0;
    // 10 page-downs in under 15s = ~1.5s per step ceiling. Real
    // value on dev is ~100-200ms per step.
    expect(elapsed).toBeLessThan(15_000);
    console.log(
      `[perf] 10× PageDown: ${elapsed}ms (avg ${(elapsed / 10).toFixed(0)}ms/press)`,
    );
  });
});
