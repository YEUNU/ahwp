/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * 셀 좌측 경계 hit test 회귀 가드.
 *
 * 0.2.91 버그: lib의 `doc.hitTest`는 x=cellLeftEdge일 때 이전 cell을
 * 돌려줌 (right-inclusive 경계). 텍스트가 셀 좌측에 close한 셀에서
 * 클릭/드래그 시작이 정확히 boundary에 떨어지면 anchor가 한 칸 왼쪽
 * 셀로 잡힘 → cell-block drag 시 추가 셀 highlight.
 *
 * 사용자 보고: "1,2,3,4 / 3,4 드래그 / 2,3,4 선택", "셀 안 글자가
 * 왼쪽에 가까운데서 드래그 시작하면 왼쪽 셀도 선택됨".
 *
 * 수정: hitTestAt에서 x +1 nudge → boundary 모호성 해소.
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

test.describe('Cell edge hit test diagnostic', () => {
  test.skip(!existsSync(STRESS_FIXTURE), 'fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('left-edge click sweep — each x offset → cellIndex', async () => {
    const { page } = launched;

    // 1×4 table with text in each cell.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="1"][data-cols="4"]',
      )
      .first()
      .click();
    await page.waitForTimeout(200);

    const tableParaIdx = 5;
    for (let cellIdx = 0; cellIdx < 4; cellIdx++) {
      await page.evaluate(
        ({ ci, p }) => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          dbg.enterCell(0, p, 0, ci, 0, 0);
          dbg.focusViewer();
        },
        { ci: cellIdx, p: tableParaIdx },
      );
      await page.keyboard.type(`Cell${cellIdx + 1}`);
      await page.waitForTimeout(80);
    }

    // F5×3 → dump cell positions.
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
    expect(cellRects.length).toBe(4);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.exitCell();
      dbg.focusViewer();
    });
    await page.waitForTimeout(80);

    // 각 visual cell의 left-edge에서 offset 별 cellIndex 검증.
    // hitTestAt 의 +1 nudge로 boundary 0px 도 정상 매핑되어야 함.
    const offsetsPx = [0, 1, 2, 5];
    for (let visualPos = 1; visualPos < 4; visualPos++) {
      const r = cellRects[visualPos];
      const cy = r.y + r.h / 2;
      for (const off of offsetsPx) {
        const cx = r.x + off;
        await page.mouse.click(cx, cy);
        await page.waitForTimeout(50);
        const got = await page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.getCaretCell(),
        );
        expect(
          got?.cellIndex,
          `cell ${visualPos + 1} left-edge +${off}px should resolve to cellIndex=${visualPos}`,
        ).toBe(visualPos);
      }
    }
  });
});
