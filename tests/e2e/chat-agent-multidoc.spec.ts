/// <reference lib="dom" />
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 3 chunk 50 — docId-aware Agent dispatch.
 *
 * Two docs open: target.hwpx (active at turn start) + reference.hwpx.
 * Agent submits an `insertText` tool. The dispatcher routes the IR
 * write to the doc that was active at submit time, not the doc that's
 * active when dispatch fires. The simple-case proxy: target receives
 * the inserted text, reference does not.
 *
 * The mid-turn tab switch race (active changes between submit and
 * dispatch) is hard to time deterministically against the fake
 * provider, so this test pins active=target throughout — a behavior
 * regression in `runTools(items, targetPath)` would still surface as
 * the wrong doc receiving the write or as a `target-doc-not-mounted`
 * failure.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  getTextRange(
    s: number,
    p: number,
    startOffset: number,
    endOffset: number,
  ): string;
  getParagraphLength(s: number, p: number): number;
}

let launched: LaunchedApp;
let tmpDir: string;
let docA: string;
let docB: string;

test.beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ahwp-agent-multidoc-'));
  docA = path.join(tmpDir, 'target.hwpx');
  docB = path.join(tmpDir, 'reference.hwpx');
  copyFileSync(FIXTURE, docA);
  copyFileSync(FIXTURE, docB);

  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
  await launched.page.evaluate(async () => {
    await window.api.secrets.set('openai', 'test-key');
  });
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await launched.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function openBoth(page: Page): Promise<void> {
  await page.evaluate(
    async (paths) => {
      await window.api.session.set({
        openTabPaths: paths,
        lastActivePath: paths[0],
      });
    },
    [docA, docB],
  );
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

test.describe('chat — chunk 50 docId-aware Agent dispatch', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('Agent insertText routes to target doc, not reference', async () => {
    const { page } = launched;
    await openBoth(page);

    // Activate Agent and fire a single insertText turn.
    await page.getByTestId('chat-mode-agent').click();
    await page
      .getByTestId('chat-input')
      .fill(
        'TOOL:insertText:{"sectionIdx":0,"paragraphIdx":0,"charOffset":0,"text":"PINNED_TARGET_57"}',
      );
    await page.getByTestId('chat-send').click();

    // Wait for the tool entry to settle (ok or failed — the dispatch
    // path is the regression we care about).
    const entry = page
      .locator('[data-testid="chat-tool-entry"][data-tool-name="insertText"]')
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .not.toBe('running');

    // Active was target.hwpx so __studioDebug points at target. Read
    // its first paragraph — should contain the sentinel.
    const targetText = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const len = dbg.getParagraphLength(0, 0);
      return dbg.getTextRange(0, 0, 0, len);
    });
    expect(targetText).toContain('PINNED_TARGET_57');

    // Switch to reference tab and read its first paragraph — should be
    // empty (no spillover from the Agent dispatch).
    const tabButtons = page
      .getByTestId('studio-tab')
      .locator('button:not([data-testid="studio-tab-close"])');
    await tabButtons.nth(1).click();
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 10_000 },
    );
    const refText = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const len = dbg.getParagraphLength(0, 0);
      return dbg.getTextRange(0, 0, 0, len);
    });
    expect(refText).not.toContain('PINNED_TARGET_57');
  });
});
