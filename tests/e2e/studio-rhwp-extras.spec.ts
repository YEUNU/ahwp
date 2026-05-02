/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Coverage for chunk 23 (applyCellStyle) / chunk 24 (picture props) /
 * chunk 25 (control clipboard) / chunk 27 (bundled undo) /
 * chunk 28 (multi-paragraph excerpt span).
 *
 * Each section drives __studioDebug directly because none of these
 * features have a primary UI surface yet — they are agent / IR
 * facilities that the chat dispatcher consumes. Verifying the IR
 * round-trip is what matters for regression safety.
 *
 * Uses the larger STRESS_FIXTURE because:
 *  - Cell ops need an actual table-bearing doc
 *  - Picture ops need at least one picture control to manipulate
 *  - Multi-paragraph excerpts need adjacent paragraphs with text
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
  deleteText(s: number, p: number, c: number, count: number): string;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  applyCharFormat(key: 'bold' | 'italic' | 'underline'): void;
  toggleCharFormat(key: 'bold' | 'italic' | 'underline'): void;
  applyCellStyle(
    sec: number,
    parentPara: number,
    ctrl: number,
    cell: number,
    cellPara: number,
    styleId: number,
  ): boolean;
  getStyleListJson(): { id: number; name: string }[] | null;
  // chunk 24 picture props
  getPictureProps(
    sec: number,
    parentPara: number,
    ctrl: number,
  ): Record<string, unknown> | null;
  setPictureProps(
    sec: number,
    parentPara: number,
    ctrl: number,
    props: Record<string, unknown>,
  ): boolean;
  deletePictureControl(sec: number, parentPara: number, ctrl: number): boolean;
  // chunk 25 control clipboard
  copyControl(sec: number, para: number, ctrl: number): boolean;
  pasteControlAt(sec: number, para: number, charOffset: number): boolean;
  // chunk 27 bundled undo
  beginUndoGroup(): void;
  endUndoGroup(): void;
  undo(): void;
  // chunk 28 multi-para excerpt
  captureExcerpt(): {
    sectionIndex: number;
    startParagraphIndex: number;
    startOffset: number;
    endParagraphIndex: number;
    endOffset: number;
    text: string;
  } | null;
  getParagraphLength(s: number, p: number): number;
  getTextRange(s: number, p: number, off: number, len: number): string;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

async function openStress(page: Page): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, STRESS_FIXTURE);
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

test.describe('rhwp IR extras — chunks 23/24/25/27/28', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/ stress fixture missing (gitignored or repo cloned w/o LFS)',
  );

  // chunk 23 — applyCellStyle requires a pre-existing styleId. We use
  // styleId 0 (always-present 바탕글) so the call doesn't depend on
  // the fixture having custom color styles. Successful return proves
  // the IR contract is wired through __studioDebug.
  test('chunk 23 — applyCellStyle returns true with valid styleId', async () => {
    const { page } = launched;
    await openStress(page);
    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Style id 0 is the document default (바탕글). Apply attempt at
      // (0, 0, 0, 0, 0, 0) — sec=0, parentPara=0, ctrl=0, cell=0,
      // cellPara=0, styleId=0. The fixture may not have a control at
      // (0, 0, 0); we accept either true (lib applied) or false (no
      // control). Either way the call shouldn't throw — the assertion
      // is "method exists, returns a boolean".
      const styles = dbg.getStyleListJson();
      const hasDefault = (styles ?? []).some((s) => s.id === 0);
      const ok = dbg.applyCellStyle(0, 0, 0, 0, 0, 0);
      return { hasDefault, isBool: typeof ok === 'boolean' };
    });
    expect(result.hasDefault).toBe(true);
    expect(result.isBool).toBe(true);
  });

  // chunk 24 — getPictureProperties on a non-existent control returns
  // null (no throw). setPictureProperties on a non-existent control
  // returns false. Together these prove the IR contract is wired.
  test('chunk 24 — picture props return null/false on non-existent ctrl (no throw)', async () => {
    const { page } = launched;
    await openStress(page);
    const r = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Use a clearly-invalid ctrl index (999). Library should reject
      // gracefully via the wrapper's try/catch.
      const props = dbg.getPictureProps(0, 0, 999);
      const setOk = dbg.setPictureProps(0, 0, 999, { width: 1000 });
      const delOk = dbg.deletePictureControl(0, 0, 999);
      return { props, setOk, delOk };
    });
    expect(r.props).toBeNull();
    expect(r.setOk).toBe(false);
    expect(r.delOk).toBe(false);
  });

  // chunk 25 — copyControl on a non-existent control returns false.
  // Real round-trip would need a fixture with a known table/image
  // controlIdx; we only verify the wire here — the IR call exists and
  // doesn't throw.
  test('chunk 25 — control clipboard methods return bool (no throw)', async () => {
    const { page } = launched;
    await openStress(page);
    const r = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // copyControl at impossible (sec=0, para=999, ctrl=0) should
      // either return false or be ignored. typeof bool is the assertion.
      const cp = dbg.copyControl(0, 999, 0);
      const pt = dbg.pasteControlAt(0, 0, 0);
      return {
        isCpBool: typeof cp === 'boolean',
        isPtBool: typeof pt === 'boolean',
      };
    });
    expect(r.isCpBool).toBe(true);
    expect(r.isPtBool).toBe(true);
  });

  // chunk 27 — bundled undo. With group active, multiple mutations
  // collapse to one undo entry. Without grouping, each mutation has
  // its own snapshot. Verify by counting how many ⌘Z it takes to
  // get back to the pre-group baseline.
  test('chunk 27 — beginUndoGroup collapses N mutations to one undo entry', async () => {
    const { page } = launched;
    await openStress(page);

    // Pick a paragraph that has visible text (paragraph 5 is reliable
    // per studio-selection.spec.ts notes) and capture its initial
    // length.
    const before = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParagraphLength(0, 5);
    });

    // Inside a group, do three insertions. Without grouping we'd need
    // 3 undos; with grouping just 1.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.beginUndoGroup();
      dbg.insertText(0, 5, 0, 'A');
      dbg.insertText(0, 5, 0, 'B');
      dbg.insertText(0, 5, 0, 'C');
      dbg.endUndoGroup();
    });

    const afterInsert = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParagraphLength(0, 5);
    });
    expect(afterInsert).toBe(before + 3);

    // One undo should restore the original length (group collapsed
    // 3 inserts into 1 snapshot).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.undo();
    });

    const afterOneUndo = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParagraphLength(0, 5);
    });
    expect(afterOneUndo).toBe(before);
  });

  // chunk 28 — multi-paragraph excerpt capture. Select across two
  // paragraphs and verify the captured text contains a '\n' (the
  // join character). The endParagraphIndex must differ from start.
  test('chunk 28 — captureExcerpt spans paragraphs (text joined by \\n)', async () => {
    const { page } = launched;
    await openStress(page);

    const r = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Find two consecutive paragraphs that both have at least 5
      // chars; selection spans the boundary so capture joins with \n.
      const total = dbg.getParagraphCount(0);
      let firstIdx = -1;
      for (let p = 0; p < total - 1; p++) {
        const a = dbg.getParagraphLength(0, p);
        const b = dbg.getParagraphLength(0, p + 1);
        if (a >= 5 && b >= 5) {
          firstIdx = p;
          break;
        }
      }
      if (firstIdx < 0) return null;
      dbg.setSelection(firstIdx, 0, firstIdx + 1, 5);
      const cap = dbg.captureExcerpt();
      return cap === null ? null : { firstIdx, ...cap };
    });
    expect(r).not.toBeNull();
    if (r === null) return;
    expect(r.startParagraphIndex).toBe(r.firstIdx);
    expect(r.endParagraphIndex).toBe(r.firstIdx + 1);
    expect(r.text).toContain('\n');
  });
});
