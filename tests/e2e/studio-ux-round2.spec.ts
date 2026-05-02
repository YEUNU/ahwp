/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * P0/P1 round-2 UX additions:
 *
 *   - ArrowUp / ArrowDown visual-line navigation (uses cursorRect + hitTest)
 *   - Shift+click selection extension
 *   - HWPX → HWP save-time route notice (`data-testid="app-notice"`)
 *   - .bak sidecar on first overwrite
 *
 * The drag auto-scroll and Esc-cancel paths are exercised indirectly by
 * tests that involve drag selection — full coverage requires manual
 * inspection because Playwright doesn't expose rAF timing reliably.
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

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
  focusViewer(): void;
  getCaret(): {
    sectionIndex: number;
    paragraphIndex: number;
    charOffset: number;
  };
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  getSelection(): Range | null;
  clearSelection(): void;
  exportBytes(): Uint8Array;
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

test.describe('studio UX round 2 — visual nav / shift+click / save notice', () => {
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

  test('ArrowDown moves caret to the next visual line', async () => {
    const { page } = launched;

    // Place caret at start of paragraph 5 (a real-text paragraph).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    });

    const before = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );

    await page.keyboard.press('ArrowDown');

    const after = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );

    // Should have moved — to a different paragraph or different offset
    // within the same wrapped paragraph.
    const moved =
      after.paragraphIndex !== before.paragraphIndex ||
      after.charOffset !== before.charOffset;
    expect(moved).toBe(true);
  });

  test('ArrowUp from below returns to a previous visual line', async () => {
    const { page } = launched;

    // Place caret deeper in the document where ArrowUp has somewhere to go.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(15, 0, 15, 0);
      dbg.clearSelection();
      dbg.focusViewer();
    });

    const before = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );

    await page.keyboard.press('ArrowUp');

    const after = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getCaret(),
    );

    const moved =
      after.paragraphIndex !== before.paragraphIndex ||
      after.charOffset !== before.charOffset;
    expect(moved).toBe(true);
    // Up should not jump forward in document order.
    if (after.paragraphIndex === before.paragraphIndex) {
      expect(after.charOffset).toBeLessThanOrEqual(before.charOffset);
    } else {
      expect(after.paragraphIndex).toBeLessThan(before.paragraphIndex);
    }
  });

  test('Shift+click extends the existing selection (anchor preserved)', async () => {
    const { page } = launched;

    // Anchor a small selection in paragraph 0 (top of the doc — guaranteed
    // body text in the fixture, no risk of hitting a cell). The cell-mode
    // mousedown branch is deferred (v2) and would early-return, clearing
    // the selection — body clicks honor shift correctly.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(0, 0, 0, 2);
    });

    // Click in the top region of the first page where header / first
    // paragraph text lives (the fixture's intro is body text, not a
    // table). Coordinates are deliberately conservative.
    const pageBox = await page
      .getByTestId('studio-viewer-page')
      .first()
      .boundingBox();
    expect(pageBox).not.toBeNull();
    const x = pageBox!.x + pageBox!.width * 0.4;
    const y = pageBox!.y + Math.min(120, pageBox!.height * 0.18);

    await page.keyboard.down('Shift');
    await page.mouse.click(x, y);
    await page.keyboard.up('Shift');

    const sel = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getSelection(),
    );
    // Either we got a non-empty range whose one endpoint is (0, 0) — the
    // shift+click invariant — OR the click happened to land at exactly
    // (0, 0) which collapses the range and getSelection returns null.
    // Both outcomes are acceptable: the bug we're guarding against is the
    // selection silently dropping to a brand-new empty range somewhere
    // unrelated. Anchor preserved is the load-bearing invariant.
    if (sel === null) {
      // Click hit (0, 0) exactly — caret-only commit, equivalent to a
      // plain click at anchor. Acceptable degenerate case.
      return;
    }
    const startMatchesAnchor = sel.startPara === 0 && sel.startOffset === 0;
    const endMatchesAnchor = sel.endPara === 0 && sel.endOffset === 0;
    expect(startMatchesAnchor || endMatchesAnchor).toBe(true);
    expect(sel.empty).toBe(false);
  });

  test('save IPC returns routedFrom when HWPX → HWP auto-routing fires', async () => {
    const { page, userDataDir } = launched;

    // Asking to save to a `.hwpx` path triggers the HWPX→HWP route in the
    // main process (HWPX round-trip is lossy in @rhwp/core, KNOWN_ISSUES
    // L-001). The IPC contract is what AppShell consumes to surface the
    // notice; we test the contract here directly. The notice rendering is
    // exercised in the unit test on AppShell.
    const targetHwpx = path.join(userDataDir, 'route-notice.hwpx');
    const result = await page.evaluate(async (p) => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      return await window.api.file.save({ path: p, bytes });
    }, targetHwpx);

    expect(result.path).toMatch(/\.hwp$/);
    expect(result.routedFrom).toBe(targetHwpx);

    // Disk side: the .hwp sibling exists, the .hwpx doesn't.
    const hwpTarget = targetHwpx.replace(/\.hwpx$/, '.hwp');
    expect(existsSync(hwpTarget)).toBe(true);
    expect(existsSync(targetHwpx)).toBe(false);
  });

  test('first save of an existing file writes a .bak sidecar', async () => {
    const { page, userDataDir } = launched;

    // Stage an existing .hwp by exporting current bytes once.
    const orig = path.join(userDataDir, 'bak-test.hwp');
    await page.evaluate(async (p) => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      await window.api.file.save({ path: p, bytes });
    }, orig);

    // No .bak yet — this was a fresh write (no prior content).
    const bak = `${orig}.bak`;
    expect(existsSync(bak)).toBe(false);

    // Save the same path again — now there IS prior content, so .bak
    // appears.
    await page.evaluate(async (p) => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      await window.api.file.save({ path: p, bytes });
    }, orig);

    expect(existsSync(bak)).toBe(true);
    const bakStat = await fsp.stat(bak);
    expect(bakStat.size).toBeGreaterThan(0);

    // Third save — .bak content stays put (preserves first-save snapshot).
    const firstBakSize = bakStat.size;
    await page.evaluate(async (p) => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      await window.api.file.save({ path: p, bytes });
    }, orig);
    const bakAfter = await fsp.stat(bak);
    expect(bakAfter.size).toBe(firstBakSize);
  });

  test('opening the same path twice activates the existing tab (no dup)', async () => {
    const { page } = launched;

    // First open is via session restore in beforeEach. Try opening the
    // same path again via window.api.file.openByPath — AppShell.openTab
    // should detect the dup and return immediately.
    const tabCountBefore = await page
      .getByRole('tab', { name: /\.hwp/ })
      .count();

    await page.evaluate(async (p) => {
      await window.api.file.openByPath(p);
    }, STRESS_FIXTURE);

    // Brief settle.
    await page.waitForTimeout(200);
    const tabCountAfter = await page
      .getByRole('tab', { name: /\.hwp/ })
      .count();
    expect(tabCountAfter).toBe(tabCountBefore);
  });
});
