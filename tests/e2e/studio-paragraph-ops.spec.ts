/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * @rhwp/core 0.7.9 added paragraph-level IR ops:
 *   insertParagraph(sec, paraIdx)
 *   deleteParagraph(sec, paraIdx)
 *
 * These are distinct from the text-level insertText/deleteText we already
 * exposed: they add or remove an entire paragraph node, shifting the indices
 * of subsequent paragraphs by 1.
 *
 * UI surfaces (toolbar buttons / shortcuts) are not added in this chunk —
 * Enter/Backspace already covers the user-facing flows. The IR ops are
 * gated for future Phase 3 (Agent tool) and Phase 2-E (Manual diff)
 * consumption. This spec ensures the round-trip stays sound across versions.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  insertParagraph(s: number, paraIdx: number): string;
  deleteParagraph(s: number, paraIdx: number): string;
  getParagraphCount(s: number): number;
  getTextRange(s: number, p: number, start: number, end: number): string;
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

test.describe('studio paragraph ops — @rhwp/core 0.7.9', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('insertParagraph creates a new paragraph and bumps the count', async () => {
    const { page } = launched;
    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const before = dbg.getParagraphCount(0);
      dbg.insertText(0, 0, 0, 'ALPHA');
      dbg.insertParagraph(0, 1);
      // Type into the new paragraph to confirm it's a real, addressable node.
      dbg.insertText(0, 1, 0, 'BETA');
      return {
        before,
        after: dbg.getParagraphCount(0),
        para0: dbg.getTextRange(0, 0, 0, 100),
        para1: dbg.getTextRange(0, 1, 0, 100),
      };
    });
    expect(result.after).toBe(result.before + 1);
    // ALPHA stays on paragraph 0; BETA lives on the freshly inserted one.
    expect(result.para0).toContain('ALPHA');
    expect(result.para1).toContain('BETA');
  });

  test('deleteParagraph removes a paragraph and shifts the rest up', async () => {
    const { page } = launched;
    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Build a 2-paragraph state.
      dbg.insertText(0, 0, 0, 'FIRST');
      dbg.insertParagraph(0, 1);
      dbg.insertText(0, 1, 0, 'SECOND');
      const beforeDelete = dbg.getParagraphCount(0);

      // Drop paragraph 0 — paragraph 1 should slide up to index 0.
      dbg.deleteParagraph(0, 0);

      return {
        beforeDelete,
        afterDelete: dbg.getParagraphCount(0),
        para0AfterDelete: dbg.getTextRange(0, 0, 0, 100),
      };
    });
    expect(result.afterDelete).toBe(result.beforeDelete - 1);
    // SECOND was at index 1 before delete; it's now at index 0.
    expect(result.para0AfterDelete).toContain('SECOND');
    expect(result.para0AfterDelete).not.toContain('FIRST');
  });
});
