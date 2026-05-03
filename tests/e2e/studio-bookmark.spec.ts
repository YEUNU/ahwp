/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Bookmarks — chunk 12. Wraps `addBookmark` / `getBookmarks` /
 * `deleteBookmark` / `renameBookmark` from @rhwp/core. The IR returns
 * bookmarks as `[{name, sec, para, ctrlIdx, charPos}]` (probe-verified).
 *
 * MVP scope: add at caret, list, delete by IR coords. "Jump to bookmark"
 * (caret + scroll) is deferred to a follow-up.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface Bookmark {
  name: string;
  sec: number;
  para: number;
  ctrlIdx: number;
  charPos: number;
}

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  addBookmarkAtCaret(name: string): void;
  getBookmarks(): Bookmark[] | null;
  deleteBookmarkAt(sec: number, para: number, ctrlIdx: number): void;
  renameBookmarkAt(
    sec: number,
    para: number,
    ctrlIdx: number,
    newName: string,
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

test.describe('studio bookmarks — chunk 12', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('blank doc has no bookmarks', async () => {
    const r = await launched.page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getBookmarks(),
    );
    expect(r).toEqual([]);
  });

  test('addBookmarkAtCaret round-trips through getBookmarks', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'hello world');
      dbg.addBookmarkAtCaret('first');
      return dbg.getBookmarks();
    });
    expect(r).toHaveLength(1);
    expect(r![0].name).toBe('first');
    expect(r![0].sec).toBe(0);
    expect(r![0].para).toBe(0);
    // Bookmarks are stored as control nodes — the IR allocates ctrlIdx ≥ 1.
    expect(r![0].ctrlIdx).toBeGreaterThan(0);
  });

  test('multiple bookmarks coexist; delete removes by ctrlIdx', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'doc body');
      dbg.addBookmarkAtCaret('alpha');
      dbg.addBookmarkAtCaret('beta');
      const both = dbg.getBookmarks()!;
      // Drop the first one.
      dbg.deleteBookmarkAt(both[0].sec, both[0].para, both[0].ctrlIdx);
      return { both, after: dbg.getBookmarks() };
    });
    expect(r.both).toHaveLength(2);
    expect(r.after).toHaveLength(1);
    // The remaining bookmark should be the one we didn't delete.
    expect(r.after![0].name).not.toBe(r.both[0].name);
  });

  test('renameBookmarkAt updates the name in place', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'doc');
      dbg.addBookmarkAtCaret('old-name');
      const before = dbg.getBookmarks()![0];
      dbg.renameBookmarkAt(before.sec, before.para, before.ctrlIdx, 'new-name');
      return dbg.getBookmarks();
    });
    expect(r).toHaveLength(1);
    expect(r![0].name).toBe('new-name');
  });

  test('UI: insert:bookmark IPC opens dialog, add + delete via form', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'insert:bookmark');
    });
    await expect(page.getByTestId('bookmark-dialog')).toBeVisible();
    // Initially empty.
    await expect(page.getByTestId('bookmark-empty')).toBeVisible();

    await page.getByTestId('bookmark-name-input').fill('ui-bookmark');
    await page.getByTestId('bookmark-add').click();
    // Row appears with the right name + dataset attribute.
    await expect(
      page.locator(
        '[data-testid="bookmark-row"][data-bookmark-name="ui-bookmark"]',
      ),
    ).toBeVisible();

    // Delete via the row's trash button.
    await page
      .locator('[data-testid="bookmark-row"][data-bookmark-name="ui-bookmark"]')
      .getByTestId('bookmark-delete')
      .click();
    await expect(page.getByTestId('bookmark-empty')).toBeVisible();
  });
});
