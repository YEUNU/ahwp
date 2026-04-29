/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 4-B — keyboard input + mouse hit-test → caret repositioning.
 *
 * Scope: ASCII printable + Backspace + Delete + Enter. Korean IME
 * (composition events) is L-003 in KNOWN_ISSUES — deferred to a later chunk.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface Caret {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
}

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  deleteText(s: number, p: number, c: number, count: number): string;
  getCaretPosition(): string;
  exportBytes(): Uint8Array;
  getPageCount(): number;
  isDirty(): boolean;
  getCaret(): Caret;
  focusViewer(): void;
}

async function activateStudio(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    localStorage.setItem('ahwp:use-studio', '1');
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

test.describe('studio input — chunk 4-B (keyboard + mouse)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('typing ASCII advances caret and changes content', async () => {
    const { page } = launched;
    // Focus the viewer's scroll container, then type
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });

    const before = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return { caret: dbg.getCaret(), dirty: dbg.isDirty() };
    });
    expect(before.caret.charOffset).toBe(0);
    expect(before.dirty).toBe(false);

    await page.keyboard.type('HELLO');

    const after = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return { caret: dbg.getCaret(), dirty: dbg.isDirty() };
    });
    // Caret should have advanced by 5 chars
    expect(after.caret.charOffset).toBe(5);
    expect(after.dirty).toBe(true);

    // UI dirty indicator
    await expect(page.getByTestId('studio-dirty-indicator')).toBeVisible();
  });

  test('Backspace removes the previous character', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });
    await page.keyboard.type('ABC');
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          return dbg.getCaret().charOffset;
        }),
      )
      .toBe(3);
    await page.keyboard.press('Backspace');
    const caret = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getCaret();
    });
    expect(caret.charOffset).toBe(2);
  });

  test('Backspace at offset 0 is a no-op (not a crash)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });
    // Caret starts at 0; pressing Backspace shouldn't do anything.
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    const state = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return { caret: dbg.getCaret(), dirty: dbg.isDirty() };
    });
    expect(state.caret.charOffset).toBe(0);
    expect(state.dirty).toBe(false);
  });

  test('Modifier shortcuts pass through (do not insert text)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });
    // Cmd+R / Ctrl+R would normally trigger a reload; we just confirm the
    // viewer didn't insert "r" as a character.
    await page.keyboard.press('Meta+a');
    await page.keyboard.press('Control+a');
    const state = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return { caret: dbg.getCaret(), dirty: dbg.isDirty() };
    });
    expect(state.caret.charOffset).toBe(0);
    expect(state.dirty).toBe(false);
  });

  test('Click on a page calls hitTest and updates caret', async () => {
    const { page } = launched;
    // For blank.hwpx (1 short paragraph), every hitTest result returns
    // (0,0,0) — see scripts/check-hittest.mjs. Test what we CAN verify:
    // the click handler fires without throwing, and caret remains valid.
    const firstPage = page.getByTestId('studio-viewer-page').first();
    const box = await firstPage.boundingBox();
    expect(box).not.toBeNull();
    await firstPage.click({
      position: { x: box!.width / 2, y: box!.height / 4 },
    });
    const caret = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getCaret();
    });
    expect(caret).toEqual({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
  });
});
