/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 10 — paragraph alignment + font size + text color.
 *
 * All three route through @rhwp/core directly:
 *   - applyParaFormat(s, p, JSON({alignment}))
 *   - applyCharFormat(... JSON({fontSize: HWPUNIT}))
 *   - applyCharFormat(... JSON({textColor: '#hex'}))
 *
 * Active state read via getParaPropertiesAt + getCharPropertiesAt
 * (NOT getStyleDetail — that returns the static style template).
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
  isDirty(): boolean;
  exportBytes(): Uint8Array;
  focusViewer(): void;
  applyAlignment(a: 'left' | 'center' | 'right' | 'justify'): void;
  applyFontSizePt(pt: number): void;
  applyTextColor(hex: string): void;
  getActiveFormat(): {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    styleId: number;
    fontSize: number;
    textColor: string;
    alignment: 'left' | 'center' | 'right' | 'justify';
  };
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
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

test.describe('studio paraformat — chunk 10', () => {
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

  test('alignment buttons toggle activeFormat.alignment + aria-pressed', async () => {
    const { page } = launched;
    await page.getByTestId('studio-align-center').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.getActiveFormat().alignment,
        ),
      )
      .toBe('center');
    await expect(page.getByTestId('studio-align-center')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.getByTestId('studio-align-right').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.getActiveFormat().alignment,
        ),
      )
      .toBe('right');
  });

  test('font size applies fontSize in HWPUNIT (paragraph with content)', async () => {
    const { page } = launched;
    // applyCharFormat silently no-ops on empty paragraphs (verified via
    // scripts/probe-fontsize3.mjs). Place caret in para 5 (real text)
    // before applying.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
      dbg.applyFontSizePt(24);
    });
    // 24pt = 2400 HWPUNIT.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.getActiveFormat().fontSize,
        ),
      )
      .toBe(2400);
    await expect(page.getByTestId('studio-dirty-indicator')).toBeVisible();
  });

  test('text color applies lowercase hex (paragraph with content)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
      dbg.applyTextColor('#ff0000');
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.getActiveFormat().textColor,
        ),
      )
      .toBe('#ff0000');
  });

  test('alignment + fontSize + color survive save → reopen', async () => {
    const { page } = launched;
    // Place caret in para 5 (has content).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
      dbg.applyAlignment('center');
      dbg.applyFontSizePt(20);
      dbg.applyTextColor('#0070c0');
    });
    const beforeReload = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getActiveFormat(),
    );
    expect(beforeReload.alignment).toBe('center');
    expect(beforeReload.fontSize).toBe(2000);
    expect(beforeReload.textColor).toBe('#0070c0');

    // Save to a temp path then re-open it.
    const target = await page.evaluate(async () => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      const tmp = await window.api.file.new();
      // Overwrite the temp blank with our edited bytes.
      const r = await window.api.file.save({ path: tmp.path, bytes });
      return r.path;
    });
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, target);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    // Re-place caret at (5, 0) and read.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.setSelection(5, 0, 5, 0);
    });
    const after = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getActiveFormat(),
    );
    expect(after.alignment).toBe('center');
    expect(after.fontSize).toBe(2000);
    expect(after.textColor).toBe('#0070c0');
  });
});
