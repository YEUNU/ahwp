/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 5b — selection model + range-aware ops.
 *
 * - Visual highlight via getSelectionRects
 * - shift+arrow extends selection; plain arrow collapses it
 * - Backspace/Delete with selection deletes the range
 * - Typing with selection replaces it
 * - applyCharFormat with selection applies to range only
 *
 * Uses the larger fixture (gitignored) because blank.hwpx's seed paragraph
 * has no rendered layout (lib quirk — see studio-format.spec.ts), so
 * getSelectionRects returns [] for selections inside it. The big fixture
 * has real paragraphs with text where selection rects compute correctly.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface Range {
  startPara: number;
  startOffset: number;
  endPara: number;
  endOffset: number;
  empty: boolean;
}

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
  focusViewer(): void;
  toggleCharFormat(key: 'bold' | 'italic' | 'underline'): void;
  getActiveFormat(): {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    styleId: number;
  };
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  getSelection(): Range | null;
  clearSelection(): void;
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

test.describe('studio selection — chunk 5b (range model)', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('setSelection populates highlight rects on the visible page', async () => {
    const { page } = launched;
    // Pick a paragraph that we know has rendered text — for this fixture
    // paragraph 5 has content in scripts/check-charformat probe.
    // Scroll the relevant page into view first so the SVG is rendered.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 10);
    });
    // Highlight overlay should have at least one rect.
    await expect
      .poll(async () => page.getByTestId('studio-selection-rect').count())
      .toBeGreaterThan(0);

    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.empty).toBe(false);
    expect(sel!.startPara).toBe(5);
    expect(sel!.startOffset).toBe(0);
    expect(sel!.endOffset).toBe(10);
  });

  test('clearSelection removes highlight + getSelection returns null', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.setSelection(5, 0, 5, 5);
    });
    await expect
      .poll(async () => page.getByTestId('studio-selection-rect').count())
      .toBeGreaterThan(0);

    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.clearSelection();
    });
    await expect(page.getByTestId('studio-selection-rect')).toHaveCount(0);

    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).toBeNull();
  });

  test('typing with selection replaces the selected range', async () => {
    const { page } = launched;
    // Select 3 chars in para 5; focus the viewer; type a char → selection
    // is deleted, char inserted at the start of the (now empty) range.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 2, 5, 5);
      dbg.focusViewer();
    });
    await page.keyboard.type('X');
    // Selection should be cleared after the replace; doc dirty.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.isDirty(),
        ),
      )
      .toBe(true);
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).toBeNull();
  });

  test('Backspace with selection deletes the range (no surrounding char)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 4);
      dbg.focusViewer();
    });
    await page.keyboard.press('Backspace');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.isDirty(),
        ),
      )
      .toBe(true);
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).toBeNull();
  });

  test('toggleCharFormat with selection applies to range only', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.setSelection(5, 0, 5, 4);
    });
    // The selection should still be visible after the format applies
    // (refreshAfterMutation re-projects rects against new layout).
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.toggleCharFormat('bold');
    });
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.startOffset).toBe(0);
    expect(sel!.endOffset).toBe(4);
    // Dirty indicator visible.
    await expect(page.getByTestId('studio-dirty-indicator')).toBeVisible();
  });

  test('shift+ArrowRight extends selection from caret', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Place caret at (5, 0) by setting an empty selection there.
      dbg.setSelection(5, 0, 5, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    });
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.startPara).toBe(5);
    expect(sel!.startOffset).toBe(0);
    expect(sel!.endOffset).toBe(3);
  });

  test('plain ArrowLeft with active selection collapses it', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 5);
      dbg.focusViewer();
    });
    await page.keyboard.press('ArrowLeft');
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).toBeNull();
  });
});
