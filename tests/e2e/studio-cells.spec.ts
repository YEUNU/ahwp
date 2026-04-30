/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Table cell editing v1 — caret enters a cell, keyboard typing routes
 * to insertTextInCell, backspace routes to deleteTextInCell. Selection
 * across cells and cell-level formatting are out of scope for v1.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  exportBytes(): Uint8Array;
  isDirty(): boolean;
  focusViewer(): void;
  enterCell(
    sec: number,
    parentParaIndex: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
    charOffset?: number,
  ): void;
  exitCell(): void;
  getCellText(
    sec: number,
    parentParaIndex: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
  ): string;
  getCaretCell(): {
    parentParaIndex: number;
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
  } | null;
}

async function activate(page: Page, fixture: string): Promise<void> {
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

test.describe('table cell editing — v1', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
    // Insert a 2×2 table at para 5 via the UI so we have a known cell to
    // type into. The picker is in the toolbar's expanded row.
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    // Place caret at para 5 first by inserting a no-op outside (the
    // existing typing already makes para 5 the caret).
    await page.evaluate(() => {
      // Position caret at start of para 5 of the section.
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="2"][data-cols="2"]',
      )
      .first()
      .click();
    // Wait for table to settle.
    await page.waitForTimeout(150);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('enterCell sets caret.cell; typing inserts into the cell', async () => {
    const { page } = launched;
    // The just-inserted table is at para 5 (where we positioned caret),
    // controlIndex 0 (first table in that paragraph). 2×2 → cells 0..3.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0);
      dbg.focusViewer();
    });
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCaretCell(),
      ),
    ).not.toBeNull();
    await page.keyboard.type('HELLO');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.getCellText(0, 5, 0, 0, 0),
        ),
      )
      .toBe('HELLO');
  });

  test('Backspace in a cell deletes the previous char', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0);
      dbg.focusViewer();
    });
    await page.keyboard.type('ABC');
    await page.keyboard.press('Backspace');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.getCellText(0, 5, 0, 0, 0),
        ),
      )
      .toBe('AB');
  });

  test('different cells receive their own text independently', async () => {
    const { page } = launched;
    // Type into cell 0
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0);
      dbg.focusViewer();
    });
    await page.keyboard.type('ALPHA');
    // Move to cell 3 (last cell of 2×2)
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 3, 0);
      dbg.focusViewer();
    });
    await page.keyboard.type('OMEGA');
    // Both cells have the right text.
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCellText(0, 5, 0, 0, 0),
      ),
    ).toBe('ALPHA');
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCellText(0, 5, 0, 3, 0),
      ),
    ).toBe('OMEGA');
  });

  test('Tab from cell 0 lands in cell 1 (and Shift+Tab returns)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0);
      dbg.focusViewer();
    });
    // Type something to disambiguate which cell we land on after Tab.
    await page.keyboard.type('A');
    await page.keyboard.press('Tab');
    await page.keyboard.type('B');
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCellText(0, 5, 0, 0, 0),
      ),
    ).toBe('A');
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCellText(0, 5, 0, 1, 0),
      ),
    ).toBe('B');
    // Shift+Tab back to cell 0.
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('X');
    // Cell 0 now starts with 'X' (caret was at position 0 after Tab back).
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCellText(0, 5, 0, 0, 0),
      ),
    ).toBe('XA');
  });

  test('B/I/U in cell renders bold via SVG (applyCharFormatInCell)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0);
      dbg.focusViewer();
    });
    await page.keyboard.type('BOLDTEST');
    // ⌘B in a cell should call applyCharFormatInCell on the cell's
    // paragraph. Verify by checking the rendered SVG contains
    // font-weight="bold" somewhere on the page.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+b`);
    // The cell is on page index from getTableBBox; for our fixture it's
    // page 1 or 2 depending on flow. Scan all mounted pages.
    await expect
      .poll(async () =>
        page
          .locator(
            '[data-testid="studio-viewer-page"] svg [font-weight="bold"]',
          )
          .count(),
      )
      .toBeGreaterThan(0);
  });

  test('exitCell drops cell from caret; subsequent typing goes outside', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0);
      dbg.focusViewer();
    });
    await page.keyboard.type('IN');
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.exitCell();
      dbg.focusViewer();
    });
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getCaretCell(),
      ),
    ).toBeNull();
    // Typing now goes outside; cell text doesn't grow further.
    await page.keyboard.type('OUT');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.getCellText(0, 5, 0, 0, 0),
        ),
      )
      .toBe('IN');
  });
});
