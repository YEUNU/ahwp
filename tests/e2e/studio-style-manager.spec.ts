/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Style manager — chunk 14. Wraps `createStyle` / `updateStyle` /
 * `deleteStyle` / `getStyleList` from @rhwp/core.
 *
 *   getStyleList → [{id, name, englishName, type, paraShapeId, charShapeId}]
 *   createStyle({name, englishName, type, nextStyleId}) → number
 *   updateStyle(id, {name, englishName, nextStyleId}) → boolean
 *   deleteStyle(id) → boolean (paragraphs using it fall back to id 0)
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  createNamedStyle(name: string, englishName?: string): number | null;
  renameStyle(id: number, name: string, englishName?: string): boolean;
  deleteStyleById(id: number): boolean;
  getStyleListJson(): Array<Record<string, unknown>> | null;
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

test.describe('studio style manager — chunk 14', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('default doc exposes a non-empty style list with id 0 (바탕글)', async () => {
    const list = await launched.page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getStyleListJson(),
    );
    expect(list).not.toBeNull();
    expect(list!.length).toBeGreaterThan(0);
    const ids = list!.map((s) => s.id as number);
    expect(ids).toContain(0);
  });

  test('createNamedStyle adds an entry and returns a fresh id', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const beforeIds = (dbg.getStyleListJson() ?? []).map(
        (s) => s.id as number,
      );
      const newId = dbg.createNamedStyle('테스트 스타일');
      const afterIds = (dbg.getStyleListJson() ?? []).map(
        (s) => s.id as number,
      );
      return { beforeIds, afterIds, newId };
    });
    expect(typeof r.newId).toBe('number');
    expect(r.beforeIds).not.toContain(r.newId);
    expect(r.afterIds).toContain(r.newId);
  });

  test('renameStyle updates the name in place', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const id = dbg.createNamedStyle('초기 이름')!;
      const ok = dbg.renameStyle(id, '변경된 이름');
      const list = dbg.getStyleListJson() ?? [];
      const found = list.find((s) => s.id === id);
      return { ok, name: found?.name };
    });
    expect(r.ok).toBe(true);
    expect(r.name).toBe('변경된 이름');
  });

  test('deleteStyleById removes the style', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const id = dbg.createNamedStyle('지울 스타일')!;
      const beforeHas = (dbg.getStyleListJson() ?? []).some((s) => s.id === id);
      const ok = dbg.deleteStyleById(id);
      const afterHas = (dbg.getStyleListJson() ?? []).some((s) => s.id === id);
      return { ok, beforeHas, afterHas };
    });
    expect(r.beforeHas).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.afterHas).toBe(false);
  });

  test('UI: view:style-manager IPC opens dialog with the style list', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'view:style-manager');
    });
    await expect(page.getByTestId('style-manager-dialog')).toBeVisible();
    // The default 바탕글 (id 0) row should be there.
    await expect(
      page.locator('[data-testid="style-row"][data-style-id="0"]'),
    ).toBeVisible();
    // Its delete button is disabled (id 0 = fallback target).
    await expect(
      page
        .locator('[data-testid="style-row"][data-style-id="0"]')
        .getByTestId('style-delete'),
    ).toBeDisabled();
  });

  test('UI: add new style via form, then delete via row button', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'view:style-manager');
    });
    await page.getByTestId('style-new-name').fill('UI 스타일');
    await page.getByTestId('style-add').click();
    const row = page.locator(
      '[data-testid="style-row"][data-style-name="UI 스타일"]',
    );
    await expect(row).toBeVisible();
    await row.getByTestId('style-delete').click();
    await expect(row).toHaveCount(0);
  });
});
