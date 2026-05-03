/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * chunk 32 — cell-block copy/paste 회귀 가드.
 *
 * - 셀 cross-cell selection (anchor ≠ focus 같은 표) → copy 시 TSV
 *   포맷 (cells \t / rows \n) 으로 clipboard 작성.
 * - cell caret + multi-cell TSV clipboard → paste 시 시작 셀부터
 *   row/col 격자 채움. 표 경계 밖은 무시.
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
  focusViewer(): void;
  enterCell(
    s: number,
    p: number,
    c: number,
    ci: number,
    cp: number,
    co?: number,
  ): void;
  exitCell(): void;
  getCaretCell(): {
    parentParaIndex: number;
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
  } | null;
  getCellText(s: number, p: number, c: number, ci: number): string;
  copy(): Promise<boolean>;
  paste(): Promise<boolean>;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
    opts?: {
      anchorCell?: {
        parentParaIndex: number;
        controlIndex: number;
        cellIndex: number;
        cellParaIndex: number;
      };
      focusCell?: {
        parentParaIndex: number;
        controlIndex: number;
        cellIndex: number;
        cellParaIndex: number;
      };
    },
  ): void;
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

test.describe('Cell-block copy/paste — chunk 32', () => {
  test.skip(!existsSync(STRESS_FIXTURE), 'fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('copy 2x2 cell-block → clipboard contains TSV', async () => {
    const { page } = launched;

    // Insert 2×2 table at para 5 + fill text.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="2"][data-cols="2"]',
      )
      .first()
      .click();
    await page.waitForTimeout(200);

    // Fill cells: (0)A1 (1)B1 (2)A2 (3)B2 — row-major.
    const labels = ['A1', 'B1', 'A2', 'B2'];
    for (let ci = 0; ci < 4; ci++) {
      await page.evaluate(
        ({ ci }) => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          dbg.enterCell(0, 5, 0, ci, 0, 0);
          dbg.focusViewer();
        },
        { ci },
      );
      await page.keyboard.type(labels[ci]);
      await page.waitForTimeout(60);
    }

    // Set cell-block selection: anchor=cell 0, focus=cell 3 (covers all 4).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const baseCell = {
        parentParaIndex: 5,
        controlIndex: 0,
        cellParaIndex: 0,
      };
      dbg.setSelection(5, 0, 5, 0, {
        anchorCell: { ...baseCell, cellIndex: 0 },
        focusCell: { ...baseCell, cellIndex: 3 },
      });
    });
    await page.waitForTimeout(80);

    // Copy.
    const ok = await page.evaluate(async () => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return await dbg.copy();
    });
    expect(ok).toBe(true);

    // Read clipboard.
    const clip = await page.evaluate(() => window.api.clipboard.readText());
    expect(clip).toBe('A1\tB1\nA2\tB2');
  });

  test('paste TSV at cell caret → fills row/col grid', async () => {
    const { page } = launched;

    // Insert 2×2 table.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="2"][data-cols="2"]',
      )
      .first()
      .click();
    await page.waitForTimeout(200);

    // Set TSV in clipboard.
    await page.evaluate(async () => {
      await window.api.clipboard.writeText('X1\tY1\nX2\tY2');
    });

    // Place caret at cell 0 (top-left).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.enterCell(0, 5, 0, 0, 0, 0);
      dbg.focusViewer();
    });
    await page.waitForTimeout(80);

    // Paste.
    const ok = await page.evaluate(async () => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return await dbg.paste();
    });
    expect(ok).toBe(true);
    await page.waitForTimeout(150);

    // Verify each cell text.
    const texts = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return [0, 1, 2, 3].map((ci) => dbg.getCellText(0, 5, 0, ci));
    });
    expect(texts).toEqual(['X1', 'Y1', 'X2', 'Y2']);
  });
});
