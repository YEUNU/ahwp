/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Table / cell properties — chunk 17. Wraps `getTableProperties` /
 * `setTableProperties` / `getCellProperties` / `setCellProperties`
 * from @rhwp/core.
 *
 * IR shapes (rhwp.d.ts):
 *   table: { cellSpacing, paddingLeft/Right/Top/Bottom, pageBreak,
 *            repeatHeader }
 *   cell:  { width, height, paddingLeft/Right/Top/Bottom,
 *            verticalAlign, textDirection, isHeader }
 *
 * Cell background color / borders use a separate `applyCellStyle` API
 * — out of scope for this MVP. UI dialog is also deferred; this spec
 * exercises the IR contract via __studioDebug.
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
  getTableProps(
    sec: number,
    parentPara: number,
    ctrl: number,
  ): Record<string, unknown> | null;
  setTableProps(
    sec: number,
    parentPara: number,
    ctrl: number,
    props: Record<string, unknown>,
  ): void;
  getCellProps(
    sec: number,
    parentPara: number,
    ctrl: number,
    cellIdx: number,
  ): Record<string, unknown> | null;
  setCellProps(
    sec: number,
    parentPara: number,
    ctrl: number,
    cellIdx: number,
    props: Record<string, unknown>,
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

test.describe('studio table/cell properties — chunk 17', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
    // Plant a 3×3 table at para 5 (same setup as cells specs).
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 5, 0, '');
    });
    await page.getByTestId('studio-insert-table').click();
    await page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="3"][data-cols="3"]',
      )
      .first()
      .click();
    await page.waitForTimeout(150);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('getTableProps returns the documented shape', async () => {
    const r = await launched.page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getTableProps(0, 5, 0),
    );
    expect(r).not.toBeNull();
    const props = r as Record<string, number | boolean>;
    expect(typeof props.paddingLeft).toBe('number');
    expect(typeof props.paddingRight).toBe('number');
    expect(typeof props.paddingTop).toBe('number');
    expect(typeof props.paddingBottom).toBe('number');
    expect(typeof props.cellSpacing).toBe('number');
    expect(typeof props.repeatHeader).toBe('boolean');
  });

  test('setTableProps round-trips paddingLeft', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getTableProps(0, 5, 0)!;
      const newPadding =
        ((before.paddingLeft as number) ?? 0) + 1000; /* +1000 HWPUNIT */
      dbg.setTableProps(0, 5, 0, {
        ...before,
        paddingLeft: newPadding,
      });
      return {
        before: before.paddingLeft as number,
        after: (dbg.getTableProps(0, 5, 0) as { paddingLeft: number })
          .paddingLeft,
      };
    });
    expect(r.after).toBe(r.before + 1000);
  });

  test('getCellProps returns the documented shape', async () => {
    const r = await launched.page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCellProps(0, 5, 0, 0),
    );
    expect(r).not.toBeNull();
    const props = r as Record<string, number | boolean>;
    expect(typeof props.width).toBe('number');
    expect(typeof props.height).toBe('number');
    expect(typeof props.paddingLeft).toBe('number');
    expect(typeof props.verticalAlign).toBe('number');
    expect(typeof props.isHeader).toBe('boolean');
  });

  test('setCellProps round-trips paddingTop on a single cell', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getCellProps(0, 5, 0, 0)!;
      dbg.setCellProps(0, 5, 0, 0, {
        ...before,
        paddingTop: 567 /* 1mm in HWPUNIT */,
      });
      return {
        before: before.paddingTop as number,
        after: (dbg.getCellProps(0, 5, 0, 0) as { paddingTop: number })
          .paddingTop,
      };
    });
    expect(r.after).toBe(567);
    expect(r.before).not.toBe(r.after);
  });
});
