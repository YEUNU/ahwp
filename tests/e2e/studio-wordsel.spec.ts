/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 11 — word / line selection.
 *
 * - Double click → select the word at click position (debug helper
 *   `selectWordAt` exercises the same path; mouse.dblclick is hard to
 *   simulate reliably in Electron headless).
 * - Triple click → select the entire paragraph (debug `selectParagraph`).
 * - Cmd/Ctrl+Shift+Arrow → extend selection to next/prev word boundary.
 *
 * Word boundaries: contiguous runs of non-whitespace, non-punctuation,
 * non-symbol chars (Unicode \p{P}\p{S}\s) — works for Korean/CJK.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface StudioDebug {
  focusViewer(): void;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  getSelection(): {
    startPara: number;
    startOffset: number;
    endPara: number;
    endOffset: number;
    empty: boolean;
  } | null;
  clearSelection(): void;
  selectWordAt(sec: number, para: number, offset: number): void;
  selectParagraph(sec: number, para: number): void;
  stepWordOffset(
    sec: number,
    para: number,
    offset: number,
    dir: -1 | 1,
  ): number;
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

test.describe('studio word/line selection — chunk 11', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('selectWordAt expands to a non-empty range around the offset', async () => {
    const { page } = launched;
    // Para 5 has rendered text — pick a position likely inside a word.
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.selectWordAt(0, 5, 5);
    });
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.empty).toBe(false);
    // The word containing offset 5 should at least span a few chars.
    expect(sel!.endOffset - sel!.startOffset).toBeGreaterThan(0);
  });

  test('selectParagraph spans 0 → paragraph length', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.selectParagraph(0, 5);
    });
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.startOffset).toBe(0);
    expect(sel!.endOffset).toBeGreaterThan(0);
  });

  test('stepWordOffset forward then backward returns to a word boundary', async () => {
    const { page } = launched;
    // Forward step from 0 should advance past at least one word.
    const fwd = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.stepWordOffset(0, 5, 0, 1),
    );
    expect(fwd).toBeGreaterThan(0);
    // Backward from `fwd` should not go past 0.
    const back = await page.evaluate(
      ([f]) =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.stepWordOffset(0, 5, f, -1),
      [fwd],
    );
    expect(back).toBeGreaterThanOrEqual(0);
    expect(back).toBeLessThan(fwd);
  });

  test('Cmd/Ctrl+Shift+ArrowRight extends selection by a word', async () => {
    const { page } = launched;
    // Place caret at start of para 5 with no selection.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Shift+ArrowRight`);
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    expect(sel!.empty).toBe(false);
    expect(sel!.startOffset).toBe(0);
    // Word step should be more than 1 char.
    expect(sel!.endOffset).toBeGreaterThan(1);
  });

  test('Plain Cmd/Ctrl+ArrowRight (no shift) collapses selection at next word', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 5);
      dbg.focusViewer();
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+ArrowRight`);
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).toBeNull();
  });

  test('Word at empty paragraph offset 0 returns empty range without crashing', async () => {
    const { page } = launched;
    // Paragraph 0 of the stress fixture has length 0 (verified upstream).
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.selectWordAt(0, 0, 0);
    });
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    // Selection should be cleared / empty since no real word exists.
    expect(sel).toBeNull();
  });
});
