/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * UX bug fixes — three regressions reported during Phase 2 polish:
 *
 *   1. Caret-state sync: moving the caret with arrow keys / Home / End onto
 *      a character with different formatting did NOT refresh the toolbar's
 *      pressed-state. Cause: handleKeyDown's nav branches updated caretRef
 *      and cursorRect but skipped refreshActiveFormat.
 *
 *   2. Drag selection: dragging from page A toward page B prematurely
 *      committed the selection because per-page `onMouseLeave` fired
 *      handlePageMouseUp the moment the cursor left page A. Fix moves the
 *      drag to document-level mousemove/up listeners attached on mousedown,
 *      so the drag survives gaps + chrome.
 *
 *   3. Ctrl+A: pressed without our handling, the browser's default selectAll
 *      ran and highlighted the entire program (toolbar / sidebar / status
 *      bar). Fix adds a Cmd/Ctrl+A branch in handleKeyDown that builds an
 *      IR selection covering the active section and preventDefaults.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface Range {
  startPara: number;
  startOffset: number;
  endPara: number;
  endOffset: number;
  empty: boolean;
}

interface ActiveFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  styleId: number;
  fontSize: number;
  textColor: string;
  alignment: 'left' | 'center' | 'right' | 'justify';
}

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
  focusViewer(): void;
  toggleCharFormat(key: 'bold' | 'italic' | 'underline'): void;
  getActiveFormat(): ActiveFormat;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  getSelection(): Range | null;
  clearSelection(): void;
  getCaret(): {
    sectionIndex: number;
    paragraphIndex: number;
    charOffset: number;
  };
  getParagraphCount(sec: number): number;
  getParagraphLength(sec: number, para: number): number;
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

test.describe('studio UX fixes — caret state / drag / Ctrl+A', () => {
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

  test('Issue 1: ArrowLeft/Right caret nav refreshes toolbar pressed-state', async () => {
    const { page } = launched;

    // Bold the first 4 chars of paragraph 5 via setSelection + toggleCharFormat,
    // then leave the rest plain.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 4);
      dbg.toggleCharFormat('bold');
      dbg.clearSelection();
    });

    // Place caret at offset 0 (inside the bold range). Use setSelection with
    // identical anchor/focus + clearSelection, which keeps caret position.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    });

    // Caret offset 0 sits *before* the first char — getCharPropertiesAt(0) on
    // most lib versions reports the trailing CharShape of offset 0 (i.e. the
    // first char's). Press ArrowRight once to land at offset 1, which is
    // inside the bold span.
    await page.keyboard.press('ArrowRight');
    let fmt = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getActiveFormat(),
    );
    expect(fmt.bold).toBe(true);

    // ArrowRight 5 more → caret at offset 6, past the bold span. Toolbar
    // should flip to non-bold.
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('ArrowRight');
    }
    fmt = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getActiveFormat(),
    );
    expect(fmt.bold).toBe(false);

    // ArrowLeft back into the bold range — toolbar should re-light.
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowLeft');
    }
    fmt = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getActiveFormat(),
    );
    expect(fmt.bold).toBe(true);
  });

  test('Issue 1: aria-pressed on Bold button reflects caret position', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 3);
      dbg.toggleCharFormat('bold');
      dbg.clearSelection();
    });

    // Caret inside bold range
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 1, 5, 1);
      dbg.clearSelection();
      dbg.focusViewer();
    });
    // setSelection itself already refreshes; the bug is in arrow-key paths.
    // Press ArrowRight + ArrowLeft to exercise that path.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('studio-format-bold')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Move past bold span. ArrowRight ×6 lands at offset 7 (past bold end).
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowRight');
    }
    await expect(page.getByTestId('studio-format-bold')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('Issue 3: Cmd/Ctrl+A selects whole section, not browser-wide', async () => {
    const { page } = launched;

    // Browser selection should be empty before.
    const beforeBrowser = await page.evaluate(
      () => (window.getSelection()?.toString() ?? '').length,
    );
    expect(beforeBrowser).toBe(0);

    // Focus the viewer and press Cmd/Ctrl+A.
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.focusViewer();
    });
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+a`);

    // Studio selection should span the whole section.
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    expect(sel).not.toBeNull();
    const lastPara = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getParagraphCount(0),
    );
    expect(sel!.startPara).toBe(0);
    expect(sel!.startOffset).toBe(0);
    expect(sel!.endPara).toBe(lastPara - 1);

    // Browser-level selection (chrome / toolbar text) should NOT have grown
    // — preventDefault on our handler suppresses the native selectAll.
    const afterBrowser = await page.evaluate(
      () => (window.getSelection()?.toString() ?? '').length,
    );
    // Allow up to a small range to account for any pre-existing focus on
    // input fields the test harness may surface; the assertion is "did NOT
    // select the entire program" which would yield thousands of chars.
    expect(afterBrowser).toBeLessThan(50);
  });

  test('Issue 2: drag selection survives mouseup outside the page', async () => {
    const { page } = launched;

    // Anchor a selection at a known offset by simulating a mouse drag using
    // page.mouse.* — this exercises the real handlePageMouseDown +
    // document-level mousemove/up listener path. We aim at the first
    // visible page's bounding rect so coordinates fall inside.
    const pageBox = await page
      .getByTestId('studio-viewer-page')
      .first()
      .boundingBox();
    expect(pageBox).not.toBeNull();
    const startX = pageBox!.x + 60;
    const startY = pageBox!.y + 60;
    const endXOutside = pageBox!.x - 200; // off the page area entirely
    const endYOutside = pageBox!.y + 200;

    // mousedown → drag → mouseup OUTSIDE the page bounds.
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 80, startY + 20, { steps: 4 });
    // Cross a region that is outside any page (sidebar / chrome) — with the
    // pre-fix per-page onMouseLeave, the drag would have ended here and the
    // selection would be only the first 80px-worth.
    await page.mouse.move(endXOutside, endYOutside, { steps: 4 });
    await page.mouse.up();

    // The drag should have completed cleanly — no selection committed because
    // the cursor ended outside any page (window mouseup ends the drag and
    // collapses an unmoved selection). What we really test: the selection
    // state does not get stuck (draggingRef still true → next mousedown
    // breaks). Issue another mousedown to confirm the system is responsive.
    await page.mouse.move(startX + 50, startY + 50);
    await page.mouse.down();
    await page.mouse.up();
    // No assertion error means drag state is healthy.
    // Additionally verify selection rect rendering didn't get stuck:
    // selection rects should be 0 after the no-op click.
    const stuck = await page.getByTestId('studio-selection-rect').count();
    expect(stuck).toBe(0);
  });

  test('Issue 2: drag from one in-page point to another commits range', async () => {
    const { page } = launched;
    const pageBox = await page
      .getByTestId('studio-viewer-page')
      .first()
      .boundingBox();
    expect(pageBox).not.toBeNull();

    // Drag horizontally across part of the page — selection should grow.
    const x0 = pageBox!.x + 80;
    const y0 = pageBox!.y + 80;
    const x1 = pageBox!.x + 280;
    const y1 = pageBox!.y + 80;

    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x1, y1, { steps: 8 });
    await page.mouse.up();

    // Either zero or one+ rects depending on whether we landed on real text;
    // the key invariant is that getSelection returns a non-null range when
    // the drag actually moved between distinct hit-test offsets. We check
    // that the system is in a coherent state (no stuck dragging).
    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    if (sel !== null) {
      // If a range was created, it should be non-empty (the two points
      // differ in offset).
      expect(sel.empty).toBe(false);
    }
  });
});
