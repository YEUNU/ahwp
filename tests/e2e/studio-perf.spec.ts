/// <reference lib="dom" />
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// chunk 88 — perf metrics 를 jsonl 로 누적해서 CI artifact 로 업로드
// 하기 위한 sink. 환경 변수 `AHWP_PERF_LOG=path` 가 설정되면 거기로,
// 아니면 OS tmpdir 의 ahwp-perf-<runId>.jsonl. 각 측정은 한 줄 JSON
// `{ts, name, elapsedMs, ...meta}` — `jq -s` 로 합집합 가능.
const PERF_LOG = (() => {
  const env = process.env.AHWP_PERF_LOG;
  if (env) return env;
  const dir = path.join(tmpdir(), 'ahwp-perf');
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore */
  }
  return path.join(dir, `run-${Date.now()}.jsonl`);
})();

function recordPerf(
  name: string,
  elapsedMs: number,
  meta: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    name,
    elapsedMs,
    ...meta,
  });
  console.log(`[perf] ${name}: ${elapsedMs}ms`, JSON.stringify(meta));
  try {
    appendFileSync(PERF_LOG, line + '\n', 'utf8');
  } catch {
    /* swallow — perf logging은 best-effort */
  }
}

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
    recordPerf('initial-load', elapsed, { pageCount });
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
    recordPerf('cmd-end', elapsed);
  });

  // chunk 95 보강 — End→Home roundtrip + reload stability.
  test('cmd+End → cmd+Home roundtrip returns scrollTop to 0', async () => {
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

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    // Jump to End first, then back to Home, timing the round trip.
    const t0 = Date.now();
    await page.keyboard.press(`${mod}+End`);
    await expect
      .poll(() => getScrollTop(page), { timeout: 10_000 })
      .toBeGreaterThan(1000);
    await page.keyboard.press(`${mod}+Home`);
    await expect.poll(() => getScrollTop(page), { timeout: 10_000 }).toBe(0);
    const elapsed = Date.now() - t0;
    // Loose ceiling for the full round trip.
    expect(elapsed).toBeLessThan(15_000);
    recordPerf('end-home-roundtrip', elapsed);
  });

  test('reload after deep scroll restores under budget (perf parity)', async () => {
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

    // Force re-parse via reload — should land within the same budget
    // as the initial load (no leak / cache regression that doubles
    // second-load time).
    const t0 = Date.now();
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
    expect(elapsed).toBeLessThan(15_000);
    recordPerf('reload-load', elapsed);
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
    recordPerf('pagedown-x10', elapsed, {
      perPressMs: Math.round(elapsed / 10),
    });
  });
});
