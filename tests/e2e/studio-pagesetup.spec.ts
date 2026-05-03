/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Page setup — chunk 10. Wraps `setPageDef` / `getPageDef` from
 * @rhwp/core. Verifies:
 *   1. IR round-trip: applyPageDef writes new margins / orientation /
 *      paper size that getPageDef reads back unchanged
 *   2. UI: PageSetupDialog opens via menu IPC, seeds form from PageDef,
 *      and writes back on submit
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  getPageDef(sectionIdx?: number): Record<string, number | boolean> | null;
  applyPageDef(
    props: Record<string, number | boolean>,
    sectionIdx?: number,
  ): void;
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

test.describe('studio page setup — chunk 10', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('default PageDef matches A4 portrait (~59528 × 84186 HWPUNIT)', async () => {
    const def = await launched.page.evaluate(() => {
      return (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getPageDef(0);
    });
    expect(def).not.toBeNull();
    const d = def as Record<string, number | boolean>;
    expect(d.width).toBe(59528);
    expect(d.height).toBe(84186);
    expect(d.landscape).toBe(false);
  });

  test('applyPageDef changes margins and re-paginates', async () => {
    const result = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getPageDef(0)!;
      // Bump every margin to 30mm = 30 * 283.5 ≈ 8505 HWPUNIT.
      dbg.applyPageDef({
        width: before.width as number,
        height: before.height as number,
        landscape: before.landscape as boolean,
        marginLeft: 8505,
        marginRight: 8505,
        marginTop: 8505,
        marginBottom: 8505,
      });
      return dbg.getPageDef(0);
    });
    const d = result as Record<string, number>;
    expect(d.marginLeft).toBe(8505);
    expect(d.marginRight).toBe(8505);
    expect(d.marginTop).toBe(8505);
    expect(d.marginBottom).toBe(8505);
  });

  test('applyPageDef can switch to landscape', async () => {
    const after = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getPageDef(0)!;
      dbg.applyPageDef({
        width: before.width as number,
        height: before.height as number,
        landscape: true,
        marginLeft: before.marginLeft as number,
        marginRight: before.marginRight as number,
        marginTop: before.marginTop as number,
        marginBottom: before.marginBottom as number,
      });
      return dbg.getPageDef(0);
    });
    expect((after as Record<string, boolean>).landscape).toBe(true);
  });

  test('UI: view:page-setup IPC opens the dialog seeded from current PageDef', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'view:page-setup');
    });
    await expect(page.getByTestId('page-setup-dialog')).toBeVisible();
    // A4 portrait → preset selector reads "A4".
    await expect(page.getByTestId('page-setup-preset')).toHaveValue('A4');
    // Default margins from blank.hwpx are 30mm / 30mm / 20mm / 15mm.
    await expect(page.getByTestId('page-setup-margin-left')).toHaveValue('30');
  });

  test('UI: changing margins via the form writes back to PageDef', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'view:page-setup');
    });
    await expect(page.getByTestId('page-setup-dialog')).toBeVisible();
    await page.getByTestId('page-setup-margin-top').fill('50');
    await page.getByTestId('page-setup-apply').click();
    await expect(page.getByTestId('page-setup-dialog')).toHaveCount(0);
    // Read back via debug surface.
    const def = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getPageDef(0),
    );
    // 50mm × 283.5 ≈ 14175 HWPUNIT (rounding tolerance ±1).
    expect((def as { marginTop: number }).marginTop).toBeGreaterThanOrEqual(
      14174,
    );
    expect((def as { marginTop: number }).marginTop).toBeLessThanOrEqual(14176);
  });
});
