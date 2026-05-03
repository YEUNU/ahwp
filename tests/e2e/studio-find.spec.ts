/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 9 — Find (⌘F).
 *
 * Iterates section/paragraph text and indexOf-searches the query. Matches
 * are highlighted via getSelectionRects-derived overlays; the active match
 * is colored differently. Uses the stress fixture so paragraphs have the
 * lineseg layout needed for getSelectionRects to return non-empty results.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
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

test.describe('studio find — chunk 9', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, STRESS_FIXTURE);
    // Force every page to render — getSelectionRects needs lineseg.
    const placeholders = launched.page.getByTestId('studio-viewer-page');
    const total = await placeholders.count();
    for (let i = 0; i < total; i++) {
      await placeholders.nth(i).scrollIntoViewIfNeeded();
    }
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('Find bar opens via the debug API and shows the input', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind();
    });
    await expect(page.getByTestId('studio-find-bar')).toBeVisible();
    await expect(page.getByTestId('studio-find-input')).toBeFocused();
  });

  test('searching a known term produces highlight rects', async () => {
    const { page } = launched;
    // The fixture has many "사업" occurrences. Open with seed query.
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('사업');
    });
    // Match count should be > 0 in the find bar.
    await expect
      .poll(async () => {
        const txt =
          (await page.getByTestId('studio-find-count').textContent()) ?? '';
        const m = txt.match(/^\s*(\d+)\s*\/\s*(\d+)\s*$/);
        return m ? Number(m[2]) : 0;
      })
      .toBeGreaterThan(0);
    // At least one highlight overlay rendered (active or normal).
    await expect
      .poll(
        async () =>
          (await page.getByTestId('studio-find-match').count()) +
          (await page.getByTestId('studio-find-match-active').count()),
      )
      .toBeGreaterThan(0);
  });

  test('Next button advances active index, Prev wraps backward', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('사업');
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.getFindState().matchCount,
        ),
      )
      .toBeGreaterThan(1);

    const start = await page.evaluate(
      () =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getFindState().activeIndex,
    );
    await page.getByTestId('studio-find-next').click();
    const afterNext = await page.evaluate(
      () =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getFindState().activeIndex,
    );
    expect(afterNext).toBe(start + 1);

    await page.getByTestId('studio-find-prev').click();
    const afterPrev = await page.evaluate(
      () =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getFindState().activeIndex,
    );
    expect(afterPrev).toBe(start);
  });

  test('Next from the last match wraps back to 0', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('사업');
    });
    // matchCount is React state — wait for it to populate.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.getFindState().matchCount,
        ),
      )
      .toBeGreaterThan(0);
    const total = await page.evaluate(
      () =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getFindState().matchCount,
    );
    // Click Next (total) times — should land back at 0.
    for (let i = 0; i < total; i++) {
      await page.getByTestId('studio-find-next').click();
    }
    const idx = await page.evaluate(
      () =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getFindState().activeIndex,
    );
    expect(idx).toBe(0);
  });

  test('Esc inside the find input closes the bar', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('사업');
    });
    await expect(page.getByTestId('studio-find-bar')).toBeVisible();
    await page.getByTestId('studio-find-input').press('Escape');
    await expect(page.getByTestId('studio-find-bar')).toBeHidden();
  });

  test('No matches → "0 / 0" in the count', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openFind('definitely-not-in-the-doc-XYZ-9999');
    });
    await expect(page.getByTestId('studio-find-count')).toHaveText('0 / 0');
    await expect(page.getByTestId('studio-find-next')).toBeDisabled();
    await expect(page.getByTestId('studio-find-prev')).toBeDisabled();
  });

  test('Cmd/Ctrl+F shortcut opens the find bar', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+f`);
    await expect(page.getByTestId('studio-find-bar')).toBeVisible();
  });
});
