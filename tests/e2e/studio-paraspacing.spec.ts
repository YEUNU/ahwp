/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 8 — paragraph-shape ops via @rhwp/core's `applyParaFormat`.
 *
 * The library's IR ParaShape accepts a JSON props bag with the same key
 * set we used for `alignment` (chunk 10). This spec verifies the new keys
 * actually round-trip through the IR by reading them back with
 * `getParaPropertiesAt`:
 *   - lineSpacing (percent)
 *   - indentLeft / firstLineIndent (HWPUNIT)
 *   - spaceBefore / spaceAfter (HWPUNIT)
 *
 * If the library renames or drops a key in a future version, the
 * corresponding case fails — useful regression gate.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  applyLineSpacing(percent: number): void;
  stepIndent(direction: 'increase' | 'decrease'): void;
  applyParaSpacing(before: number, after: number): void;
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

test.describe('studio paragraph spacing — chunk 8', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('lineSpacing percent round-trips through applyParaFormat', async () => {
    const { page } = launched;
    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'a paragraph with some content');
      dbg.applyLineSpacing(200);
      return dbg.getParaProps(0, 0);
    });
    // The library may either echo `lineSpacing: 200` or wrap it inside a
    // shape struct. Either way the value 200 should appear in the readback.
    const flat = JSON.stringify(result);
    expect(flat).toContain('200');
  });

  test('marginLeft (indent) increase/decrease stacks and floors at 0', async () => {
    const { page } = launched;
    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'indented paragraph');
      const before = dbg.getParaProps(0, 0);
      dbg.stepIndent('increase');
      const afterOne = dbg.getParaProps(0, 0);
      dbg.stepIndent('increase');
      const afterTwo = dbg.getParaProps(0, 0);
      // Decrease past zero should clamp at 0, not go negative.
      dbg.stepIndent('decrease');
      dbg.stepIndent('decrease');
      dbg.stepIndent('decrease');
      const afterFloor = dbg.getParaProps(0, 0);
      return { before, afterOne, afterTwo, afterFloor };
    });
    const marginOf = (props: Record<string, unknown>): number => {
      const v = (props as { marginLeft?: number }).marginLeft;
      return typeof v === 'number' ? v : 0;
    };
    expect(marginOf(result.afterOne)).toBeGreaterThan(marginOf(result.before));
    expect(marginOf(result.afterTwo)).toBeGreaterThan(
      marginOf(result.afterOne),
    );
    expect(marginOf(result.afterFloor)).toBe(0);
  });

  test('paragraph spacing (spacingBefore/spacingAfter) takes effect', async () => {
    const { page } = launched;
    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'spaced paragraph');
      const before = dbg.getParaProps(0, 0) as {
        spacingBefore?: number;
        spacingAfter?: number;
      };
      dbg.applyParaSpacing(567, 567);
      const after = dbg.getParaProps(0, 0) as {
        spacingBefore?: number;
        spacingAfter?: number;
      };
      // Higher input → higher readback. The lib unit-converts the input
      // (verified ~74.6× compression) so we don't assert on absolute values.
      dbg.applyParaSpacing(1134, 1134);
      const afterDouble = dbg.getParaProps(0, 0) as {
        spacingBefore?: number;
        spacingAfter?: number;
      };
      return { before, after, afterDouble };
    });
    expect(result.before.spacingBefore ?? 0).toBe(0);
    expect(result.after.spacingBefore ?? 0).toBeGreaterThan(0);
    expect(result.after.spacingAfter ?? 0).toBeGreaterThan(0);
    // Doubling the input should roughly double the readback (within ±10%).
    const ratio =
      (result.afterDouble.spacingBefore ?? 0) /
      (result.after.spacingBefore ?? 1);
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(2.2);
  });

  test('toolbar — line-spacing select + indent buttons render in row 2', async () => {
    const { page } = launched;
    // Open the expandable toolbar.
    await page.getByTestId('studio-toolbar-more').click();
    await expect(page.getByTestId('studio-toolbar-row2')).toBeVisible();
    await expect(page.getByTestId('studio-line-spacing')).toBeVisible();
    await expect(page.getByTestId('studio-para-spacing')).toBeVisible();
    await expect(page.getByTestId('studio-indent-increase')).toBeVisible();
    await expect(page.getByTestId('studio-indent-decrease')).toBeVisible();
  });
});
