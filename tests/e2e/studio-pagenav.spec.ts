/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 12 — page navigation.
 *
 * - PageUp / PageDown scroll the viewer by one viewport height
 * - Cmd/Ctrl + Home → jump caret + scroll to the start of the doc
 * - Cmd/Ctrl + End → jump caret + scroll to the end of the doc
 * - Shift modifier extends the current selection
 *
 * Uses the 144-page big-doc fixture for meaningful scroll behavior.
 */

const BIG_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '★2026년 스마트공장 보급확산사업 세부관리기준 개정(전문)_260327.hwpx',
);

interface Caret {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
}

interface StudioDebug {
  focusViewer(): void;
  getCaret(): Caret;
  getSelection(): {
    startPara: number;
    startOffset: number;
    endPara: number;
    endOffset: number;
    empty: boolean;
  } | null;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  clearSelection(): void;
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

async function getScrollTop(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="studio-scroll"]',
    ) as HTMLElement | null;
    return el?.scrollTop ?? -1;
  });
}

test.describe('studio page nav — chunk 12', () => {
  test.skip(
    !existsSync(BIG_FIXTURE),
    'examples/★2026년 ... .hwpx fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, BIG_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('PageDown scrolls down by ~one viewport', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    expect(await getScrollTop(page)).toBe(0);
    await page.keyboard.press('PageDown');
    // Smooth scroll — wait for movement.
    await expect.poll(() => getScrollTop(page)).toBeGreaterThan(100);
  });

  test('PageUp from a scrolled position scrolls back', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    await page.keyboard.press('PageDown');
    await expect.poll(() => getScrollTop(page)).toBeGreaterThan(100);
    const after = await getScrollTop(page);
    await page.keyboard.press('PageUp');
    await expect.poll(() => getScrollTop(page)).toBeLessThan(after);
  });

  test('Cmd/Ctrl+End jumps caret to last paragraph + scrolls', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    expect(await getScrollTop(page)).toBe(0);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+End`);
    await expect.poll(() => getScrollTop(page)).toBeGreaterThan(1000);
    const caret = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );
    // Last paragraph should be > 100 in the 144-page doc.
    expect(caret.paragraphIndex).toBeGreaterThan(100);
  });

  test('Cmd/Ctrl+Home from middle returns to (0,0,0) and scrollTop 0', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+End`);
    await expect.poll(() => getScrollTop(page)).toBeGreaterThan(1000);
    await page.keyboard.press(`${mod}+Home`);
    await expect.poll(() => getScrollTop(page)).toBe(0);
    const caret = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );
    expect(caret).toEqual({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
  });

  test('Shift+Cmd/Ctrl+End extends selection from caret to doc end', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Place caret somewhere mid-document and clear any selection.
      dbg.setSelection(5, 0, 5, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`Shift+${mod}+End`);
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.empty).toBe(false);
    expect(sel!.startPara).toBe(5);
    expect(sel!.endPara).toBeGreaterThan(100);
  });

  test('Plain End jumps to end of current paragraph', async () => {
    const { page } = launched;
    // Pick the first paragraph past para 0 that has non-zero length —
    // not all paragraphs in this fixture have content.
    const target = await page.evaluate(() => {
      // Walk paragraphs via the debug API. We don't expose getParagraphLength
      // directly, but selectParagraph + getSelection gives us the length.
      const dbg = (
        window as Window & {
          __studioDebug?: StudioDebug & {
            selectParagraph?: (s: number, p: number) => void;
          };
        }
      ).__studioDebug!;
      for (let p = 1; p < 200; p++) {
        dbg.selectParagraph?.(0, p);
        const sel = dbg.getSelection();
        if (sel && sel.endOffset > 0) return { para: p, len: sel.endOffset };
      }
      return null;
    });
    expect(target).not.toBeNull();
    await page.evaluate((t) => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(t!.para, 0, t!.para, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    }, target);
    await page.keyboard.press('End');
    const caret = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );
    expect(caret.paragraphIndex).toBe(target!.para);
    expect(caret.charOffset).toBe(target!.len);
  });
});
