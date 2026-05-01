/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * HTML paste with paragraph-shape decomposition — chunk 18.
 *
 * Probe (commit log) showed `pasteHtml` alone preserves char-level
 * styles (bold, italic, underline, color, font-size) but drops
 * `text-align`, `margin-*`, `text-indent`, `line-height`.
 * `applyHtmlAtCaret` walks the source HTML and re-applies those via
 * `applyParaFormat` IR calls.
 *
 * Unit conversions used by the helper:
 *   1pt → 100 HWPUNIT
 *   1px → 75 HWPUNIT (96 DPI)
 *   line-height "1.5" → lineSpacing 150 (Percent)
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  applyHtmlAtCaret(html: string): void;
  pasteHtmlAt(s: number, p: number, c: number, html: string): void;
  exportSelectionHtmlAt(
    s: number,
    sp: number,
    so: number,
    ep: number,
    eo: number,
  ): string;
  getParaProps(s: number, p: number): Record<string, unknown>;
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

test.describe('studio html paste — chunk 18', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('pasteHtml alone — char styles ✅, paragraph-level styles ❌', async () => {
    // Sanity check: confirm the lib's behavior we're working around.
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.pasteHtmlAt(
        0,
        0,
        0,
        '<p style="text-align:center;margin-left:30px;line-height:2;">CENTER</p>',
      );
      return dbg.getParaProps(0, 0);
    });
    // text-align ignored → still default justify, marginLeft 0,
    // lineSpacing the doc default 160.
    expect(r.alignment).toBe('justify');
    expect(r.marginLeft).toBe(0);
    expect(r.lineSpacing).toBe(160);
  });

  test('applyHtmlAtCaret restores text-align', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.applyHtmlAtCaret('<p style="text-align:center;">CENTER</p>');
      return dbg.getParaProps(0, 0);
    });
    expect(r.alignment).toBe('center');
  });

  test('applyHtmlAtCaret restores line-height (1.5 → 150% Percent)', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.applyHtmlAtCaret('<p style="line-height:1.5;">SPACED</p>');
      return dbg.getParaProps(0, 0);
    });
    expect(r.lineSpacing).toBe(150);
    expect(r.lineSpacingType).toBe('Percent');
  });

  test('applyHtmlAtCaret restores margin-left (input takes effect)', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getParaProps(0, 0).marginLeft as number;
      dbg.applyHtmlAtCaret('<p style="margin-left:40px;">INDENTED</p>');
      const after = dbg.getParaProps(0, 0).marginLeft as number;
      // 40px × 75 = 3000 HWPUNIT input. The lib unit-converts spacing
      // values (verified ~74.6× compression in chunk 8 probe), so we
      // assert "non-zero, larger than before" rather than absolute.
      return { before, after };
    });
    expect(r.before).toBe(0);
    expect(r.after).toBeGreaterThan(0);
  });

  test('applyHtmlAtCaret restores margin-top/bottom as paragraph spacing', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getParaProps(0, 0);
      dbg.applyHtmlAtCaret(
        '<p style="margin-top:12px;margin-bottom:6px;">SPACED</p>',
      );
      const after = dbg.getParaProps(0, 0);
      return {
        beforeSpacingBefore: before.spacingBefore as number,
        beforeSpacingAfter: before.spacingAfter as number,
        afterSpacingBefore: after.spacingBefore as number,
        afterSpacingAfter: after.spacingAfter as number,
      };
    });
    expect(r.beforeSpacingBefore).toBe(0);
    expect(r.beforeSpacingAfter).toBe(0);
    expect(r.afterSpacingBefore).toBeGreaterThan(0);
    expect(r.afterSpacingAfter).toBeGreaterThan(0);
  });

  test('applyHtmlAtCaret preserves char-level styles via pasteHtml', async () => {
    // Char styles still go through native pasteHtml — verify the export
    // contains font-weight/style/decoration markers.
    const html = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.applyHtmlAtCaret(
        '<p><strong>BOLD</strong> <em>ITALIC</em> <u>UNDER</u></p>',
      );
      return dbg.exportSelectionHtmlAt(0, 0, 0, 0, 100);
    });
    expect(html).toContain('font-weight:bold');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('text-decoration:underline');
  });

  test('applyHtmlAtCaret applies pt-based indent', async () => {
    const r = await launched.page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getParaProps(0, 0).indent as number;
      dbg.applyHtmlAtCaret('<p style="text-indent:20pt;">FIRST LINE</p>');
      const after = dbg.getParaProps(0, 0).indent as number;
      return { before, after };
    });
    expect(r.before).toBe(0);
    expect(r.after).toBeGreaterThan(0);
  });
});
