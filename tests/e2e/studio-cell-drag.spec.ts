/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * 표 셀 mouse drag 회귀 가드.
 *
 * 0.2.89 회귀 케이스:
 *  - mouseup 시 selection이 "empty" 판단 (paragraphIndex/charOffset만 보고)
 *    되어 cell-block highlight가 통째로 wipe되던 버그.
 *  - cross-cell drag (anchor.cell ≠ focus.cell)일 때 paragraphIndex가
 *    같아도 셀이 다르면 비어있지 않음.
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
    sec: number,
    parentParaIndex: number,
    controlIndex: number,
    cellIndex: number,
    cellParaIndex: number,
    charOffset?: number,
  ): void;
  exitCell(): void;
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

test.describe('Cell drag debug — text-filled cells', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('insert 1x3 table at top of doc + dump cell bboxes', async () => {
    const { page } = launched;
    // Place caret at para 5 first (stress fixture pattern).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="1"][data-cols="3"]',
      )
      .first()
      .click();
    await page.waitForTimeout(200);

    const tableParaIdx = 5;
    for (let cellIdx = 0; cellIdx < 3; cellIdx++) {
      await page.evaluate(
        ({ ci, p }) => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          dbg.enterCell(0, p, 0, ci, 0, 0);
          dbg.focusViewer();
        },
        { ci: cellIdx, p: tableParaIdx },
      );
      await page.keyboard.type(`Text${cellIdx + 1}`);
      await page.waitForTimeout(80);
    }

    // F5×3 to highlight whole table → dump bbox positions.
    await page.evaluate(
      ({ p }) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.enterCell(0, p, 0, 0, 0, 0);
        dbg.focusViewer();
      },
      { p: tableParaIdx },
    );
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.waitForTimeout(150);

    const rects = await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    expect(rects.length).toBe(3);
  });

  test('real mouse drag from cell 2 to cell 3 in 1x3 table with text', async () => {
    const { page } = launched;

    // Anchor at para 5 of stress fixture, then insert table.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="1"][data-cols="3"]',
      )
      .first()
      .click();
    await page.waitForTimeout(200);

    const tableParaIdx = 5;

    for (let cellIdx = 0; cellIdx < 3; cellIdx++) {
      await page.evaluate(
        ({ ci, p }) => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          dbg.enterCell(0, p, 0, ci, 0, 0);
          dbg.focusViewer();
        },
        { ci: cellIdx, p: tableParaIdx },
      );
      await page.keyboard.type(`Text${cellIdx + 1}`);
      await page.waitForTimeout(80);
    }

    // Use F5×3 first to render highlights, then scroll the highlight into
    // view via the rendered DOM element.
    await page.evaluate(
      ({ p }) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.enterCell(0, p, 0, 0, 0, 0);
        dbg.focusViewer();
      },
      { p: tableParaIdx },
    );
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.waitForTimeout(150);
    await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .first()
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const allCellRects = await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    expect(allCellRects.length).toBe(3);

    // Sort by x to identify cells 1, 2, 3 left-to-right.
    allCellRects.sort((a, b) => a.x - b.x);
    const cell2 = allCellRects[1];
    const cell3 = allCellRects[2];

    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    expect(cell2.y).toBeLessThan(vp.height);
    expect(cell2.y).toBeGreaterThan(0);

    // Clear selection.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.exitCell();
      dbg.focusViewer();
    });
    await page.waitForTimeout(80);

    // Drag from middle of cell 2 to middle of cell 3.
    const startX = cell2.x + cell2.w / 2;
    const startY = cell2.y + cell2.h / 2;
    const endX = cell3.x + cell3.w / 2;
    const endY = cell3.y + cell3.h / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(80);
    await page.mouse.move(endX, endY, { steps: 8 });
    await page.waitForTimeout(80);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const dragRects = await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    expect(dragRects.length).toBe(2);

    // 회귀 가드 — drag end가 selection을 wipe하던 0.2.89 버그 재발 방지.
    // 셀 컨텍스트가 다르면 paragraphIndex/charOffset 같아도 비어있지 않음.
    const caretCell = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaretCell(),
    );
    expect(caretCell?.cellIndex).toBe(2);
  });

  test('sticky mode — drag with backward overshoot keeps cell-block', async () => {
    const { page } = launched;

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="1"][data-cols="3"]',
      )
      .first()
      .click();
    await page.waitForTimeout(200);

    const tableParaIdx = 5;
    for (let cellIdx = 0; cellIdx < 3; cellIdx++) {
      await page.evaluate(
        ({ ci, p }) => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          dbg.enterCell(0, p, 0, ci, 0, 0);
          dbg.focusViewer();
        },
        { ci: cellIdx, p: tableParaIdx },
      );
      await page.keyboard.type(`Text${cellIdx + 1}`);
      await page.waitForTimeout(80);
    }

    await page.evaluate(
      ({ p }) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.enterCell(0, p, 0, 0, 0, 0);
        dbg.focusViewer();
      },
      { p: tableParaIdx },
    );
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.keyboard.press('F5');
    await page.waitForTimeout(150);
    await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .first()
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);

    const cellRects = await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = (n as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
    cellRects.sort((a, b) => a.x - b.x);
    const cell2 = cellRects[1];
    const cell3 = cellRects[2];

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.exitCell();
      dbg.focusViewer();
    });
    await page.waitForTimeout(80);

    // Drag pattern: cell 2 → cell 3 → 복귀 cell 2 → cell 3 mouseup.
    // Sticky 동작 시 mouseup 시점 cell-block 유지 (highlight 2개).
    const startX = cell2.x + cell2.w / 2;
    const startY = cell2.y + cell2.h / 2;
    const cell3X = cell3.x + cell3.w / 2;
    const cell3Y = cell3.y + cell3.h / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.waitForTimeout(50);
    await page.mouse.move(cell3X, cell3Y, { steps: 5 });
    await page.waitForTimeout(50);
    // 잠깐 anchor cell로 복귀.
    await page.mouse.move(startX, startY, { steps: 5 });
    await page.waitForTimeout(50);
    // 다시 cell 3로 종료.
    await page.mouse.move(cell3X, cell3Y, { steps: 5 });
    await page.waitForTimeout(50);
    await page.mouse.up();
    await page.waitForTimeout(300);

    const finalCount = await page
      .locator('[data-testid="studio-cell-block-rect"]')
      .count();
    expect(finalCount).toBe(2);
  });
});
