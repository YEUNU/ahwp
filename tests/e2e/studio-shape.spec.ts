/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Shapes — chunk 15. Wraps `createShapeControl` /
 * `getShapeProperties` / `setShapeProperties` / `deleteShapeControl` /
 * `changeShapeZOrder` from @rhwp/core.
 *
 * MVP scope: rectangle shape at caret. Lines / arrows / curves / shape
 * grouping land in follow-ups (additional shape-type fields the lib
 * doesn't surface in the createShapeControl JSON yet).
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
  createRectShapeAtCaret(
    widthHwpunit: number,
    heightHwpunit: number,
    opts?: { treatAsChar?: boolean },
  ): { paraIdx: number; controlIdx: number } | null;
  getShapeProps(
    sec: number,
    parentPara: number,
    ctrl: number,
  ): Record<string, unknown> | null;
  setShapeProps(
    sec: number,
    parentPara: number,
    ctrl: number,
    props: Record<string, unknown>,
  ): void;
  deleteShape(sec: number, parentPara: number, ctrl: number): void;
  changeShapeZOrderAt(
    sec: number,
    parentPara: number,
    ctrl: number,
    op: 'front' | 'back' | 'forward' | 'backward',
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

test.describe('studio shapes — chunk 15', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('createRectShapeAtCaret returns {paraIdx, controlIdx}', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.createRectShapeAtCaret(28350, 17010); // 100mm × 60mm
    });
    expect(r).not.toBeNull();
    expect(typeof r!.paraIdx).toBe('number');
    expect(typeof r!.controlIdx).toBe('number');
    expect(r!.controlIdx).toBeGreaterThanOrEqual(0);
  });

  test('getShapeProps round-trips after create', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const created = dbg.createRectShapeAtCaret(20000, 10000)!;
      return dbg.getShapeProps(0, created.paraIdx, created.controlIdx);
    });
    expect(r).not.toBeNull();
    const props = r as Record<string, number | boolean>;
    expect(typeof props.width).toBe('number');
    expect(typeof props.height).toBe('number');
    expect(typeof props.treatAsChar).toBe('boolean');
  });

  test('setShapeProps round-trips width', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const created = dbg.createRectShapeAtCaret(20000, 10000)!;
      const before = dbg.getShapeProps(0, created.paraIdx, created.controlIdx)!;
      dbg.setShapeProps(0, created.paraIdx, created.controlIdx, {
        ...before,
        width: 30000,
      });
      const after = dbg.getShapeProps(0, created.paraIdx, created.controlIdx)!;
      return { beforeWidth: before.width, afterWidth: after.width };
    });
    expect(r.beforeWidth).toBe(20000);
    expect(r.afterWidth).toBe(30000);
  });

  test('deleteShape removes the control (getShapeProps returns null)', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const created = dbg.createRectShapeAtCaret(15000, 10000)!;
      const before = dbg.getShapeProps(0, created.paraIdx, created.controlIdx);
      dbg.deleteShape(0, created.paraIdx, created.controlIdx);
      const after = dbg.getShapeProps(0, created.paraIdx, created.controlIdx);
      return { hadBefore: !!before, hasAfter: !!after };
    });
    expect(r.hadBefore).toBe(true);
    // After delete the control is gone — getShapeProps either returns null
    // or throws (caught by our wrapper). Either way !after === true.
    expect(r.hasAfter).toBe(false);
  });

  test('UI: insert:shape IPC opens dialog with default 50×30mm + insert', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'insert:shape');
    });
    await expect(page.getByTestId('shape-dialog')).toBeVisible();
    await expect(page.getByTestId('shape-width')).toHaveValue('50');
    await expect(page.getByTestId('shape-height')).toHaveValue('30');
    await page.getByTestId('shape-insert').click();
    await expect(page.getByTestId('shape-dialog')).toHaveCount(0);
  });
});
