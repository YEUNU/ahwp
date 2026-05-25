/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Regression coverage for the 0.4.29 migration: useFindReplace.runFindSearch
 * now calls `@rhwp/core` 0.7.12's native `doc.searchAllText(...)` instead of
 * the in-memory paragraph cache + manual indexOf loop.
 *
 * The original `studio-find.spec.ts` references a fixture that was removed
 * from git (`4. [사업계획서] ... 데이터수집검증 중복화.hwp`); this spec uses
 * the public `2026년도 ... 공고.hwp` so it actually runs in CI / new clones.
 * Coverage focuses on properties of the new code path:
 *   - native search returns matches for a known term (vs. the now-gone cache
 *     priming path)
 *   - case insensitivity (manual `.toLowerCase()` was deleted — the lib's
 *     `case_sensitive=false` flag must do the work)
 *   - post-mutation re-search reflects new content (we removed the
 *     `findTextCacheRef` invalidation hook — verifies the lib reads live IR)
 *   - replaceAll feedback still parses `{count}` from the lib response
 */

const PUBLIC_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
);

interface StudioDebug {
  focusViewer(): void;
  openFind(initialQuery?: string): void;
  closeFind(): void;
  findNext(): void;
  findPrev(): void;
  getFindState(): {
    open: boolean;
    query: string;
    matchCount: number;
    activeIndex: number;
    replaceQuery: string;
    replaceFeedback: string | null;
  };
  insertText(
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
    text: string,
  ): string;
  setReplaceQuery(text: string): void;
  replaceAll(override?: string): void;
}

type DbgWindow = Window & { __studioDebug?: StudioDebug };

async function activateStudio(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () => Boolean((window as DbgWindow).__studioDebug),
    { timeout: 30_000 },
  );
}

async function pollMatchCount(page: Page): Promise<number> {
  return await page.evaluate(
    () => (window as DbgWindow).__studioDebug!.getFindState().matchCount,
  );
}

test.describe('studio find — native searchAllText (0.4.29)', () => {
  test.skip(
    !existsSync(PUBLIC_FIXTURE),
    'examples/2026년도 ... 공고.hwp fixture missing',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, PUBLIC_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('native search returns matches for a known term', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (window as DbgWindow).__studioDebug!.openFind('사업');
    });
    // Native probe confirmed ≥ 12 top-level matches (cellContext filtered);
    // assert a generous floor so minor fixture revisions don't break us.
    await expect.poll(() => pollMatchCount(page)).toBeGreaterThanOrEqual(12);
  });

  test('search is case-insensitive (no manual toLowerCase)', async () => {
    const { page } = launched;
    // Lowercase query against mixed-case "AI" occurrences in the doc.
    await page.evaluate(() => {
      (window as DbgWindow).__studioDebug!.openFind('ai');
    });
    const lowerCount = await expect
      .poll(() => pollMatchCount(page))
      .toBeGreaterThan(0)
      .then(() => pollMatchCount(page));
    // Close, re-open with uppercase — should yield identical count.
    await page.evaluate(() => {
      (window as DbgWindow).__studioDebug!.closeFind();
      (window as DbgWindow).__studioDebug!.openFind('AI');
    });
    await expect.poll(() => pollMatchCount(page)).toBe(lowerCount);
  });

  test('post-mutation re-search reflects new content (no stale cache)', async () => {
    const { page } = launched;
    const sentinel = 'ZZ-AHWP-MIGRATE-' + Date.now().toString(36);

    // Open find for the sentinel — should be absent initially.
    await page.evaluate((q) => {
      (window as DbgWindow).__studioDebug!.openFind(q);
    }, sentinel);
    await expect.poll(() => pollMatchCount(page)).toBe(0);

    // Insert the sentinel at the doc start, then re-open find for the same
    // term. If the old cache logic were still in place (and not invalidated),
    // the second search would still return 0.
    await page.evaluate((q) => {
      (window as DbgWindow).__studioDebug!.closeFind();
      (window as DbgWindow).__studioDebug!.insertText(0, 0, 0, q);
      (window as DbgWindow).__studioDebug!.openFind(q);
    }, sentinel);
    await expect.poll(() => pollMatchCount(page)).toBeGreaterThanOrEqual(1);
  });

  test('replaceAll feedback parses {count} from lib response', async () => {
    const { page } = launched;
    // Insert a unique marker N times so replaceAll has a known target without
    // depending on the fixture's existing word counts.
    const marker = 'QQ' + Date.now().toString(36);
    await page.evaluate((q) => {
      const dbg = (window as DbgWindow).__studioDebug!;
      for (let i = 0; i < 3; i++) {
        dbg.insertText(0, 0, 0, q);
      }
    }, marker);

    // Open find for the marker; wait for matchCount + findQuery to commit
    // (otherwise the debug-surface closure for `replaceAll` would still see
    // the old empty `findQuery` and early-return).
    await page.evaluate((q) => {
      (window as DbgWindow).__studioDebug!.openFind(q);
    }, marker);
    await expect.poll(() => pollMatchCount(page)).toBe(3);

    // Drive replaceAll with replacement-override = '' (delete the marker).
    await page.evaluate(() => {
      (window as DbgWindow).__studioDebug!.replaceAll('');
    });

    // Feedback string from useFindReplace.applyReplace is `${count}건 바꿈`
    // when the lib returns `{ok:true, count:N}` — verifies the shape we
    // verified at migration time still holds.
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as DbgWindow).__studioDebug!.getFindState().replaceFeedback,
        ),
      )
      .toMatch(/^3건 바꿈$/);
  });
});
