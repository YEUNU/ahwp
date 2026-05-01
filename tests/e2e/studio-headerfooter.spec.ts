/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Header / footer — chunk 11. Wraps `createHeaderFooter` /
 * `getHeaderFooter` / `insertTextInHeaderFooter` / `deleteHeaderFooter`
 * from @rhwp/core. The IR's `getHeaderFooter` echoes the slot's text in
 * its response (verified by probe), so round-trip checks stay simple.
 *
 * `applyTo=0` means "양 쪽" — applied to all pages. Per-page templates
 * (홀수/짝수) are deferred to a follow-up.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  setHeaderFooterText(
    sec: number,
    isHeader: boolean,
    applyTo: number,
    text: string,
  ): void;
  getHeaderFooter(
    sec: number,
    isHeader: boolean,
    applyTo: number,
  ): Record<string, unknown> | null;
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

test.describe('studio header/footer — chunk 11', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('blank doc has no header / no footer', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return {
        header: dbg.getHeaderFooter(0, true, 0),
        footer: dbg.getHeaderFooter(0, false, 0),
      };
    });
    expect((r.header as { exists?: boolean }).exists).toBe(false);
    expect((r.footer as { exists?: boolean }).exists).toBe(false);
  });

  test('setHeaderFooterText creates a header and round-trips text', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setHeaderFooterText(0, true, 0, 'My Header');
      return dbg.getHeaderFooter(0, true, 0);
    });
    expect((r as { exists?: boolean }).exists).toBe(true);
    expect((r as { kind?: string }).kind).toBe('header');
    expect((r as { applyTo?: number }).applyTo).toBe(0);
    expect((r as { text?: string }).text).toBe('My Header');
  });

  test('setHeaderFooterText with footer kind is independent of header', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setHeaderFooterText(0, true, 0, 'HEADER');
      dbg.setHeaderFooterText(0, false, 0, 'FOOTER');
      return {
        header: dbg.getHeaderFooter(0, true, 0),
        footer: dbg.getHeaderFooter(0, false, 0),
      };
    });
    expect((r.header as { text?: string }).text).toBe('HEADER');
    expect((r.footer as { text?: string }).text).toBe('FOOTER');
  });

  test('overwriting replaces (not appends)', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setHeaderFooterText(0, true, 0, 'first');
      dbg.setHeaderFooterText(0, true, 0, 'second');
      return dbg.getHeaderFooter(0, true, 0);
    });
    expect((r as { text?: string }).text).toBe('second');
  });

  test('empty text removes the slot', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setHeaderFooterText(0, true, 0, 'will go away');
      dbg.setHeaderFooterText(0, true, 0, '');
      return dbg.getHeaderFooter(0, true, 0);
    });
    expect((r as { exists?: boolean }).exists).toBe(false);
  });

  test('UI: insert:header-footer IPC opens dialog and applies text', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'insert:header-footer');
    });
    await expect(page.getByTestId('header-footer-dialog')).toBeVisible();
    await page.getByTestId('hf-text-input').fill('UI Header');
    await page.getByTestId('hf-apply').click();
    await expect(page.getByTestId('header-footer-dialog')).toHaveCount(0);
    const r = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getHeaderFooter(0, true, 0),
    );
    expect((r as { text?: string }).text).toBe('UI Header');
  });
});
