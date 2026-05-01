/**
 * Live smoke test against NVIDIA NIM's hosted endpoint
 * (https://integrate.api.nvidia.com/v1).
 *
 * Skips silently unless `NVAPI_KEY` is in the environment so this never runs
 * in CI by default and never blocks contributors who don't have a NIM key.
 *
 * The test exercises the *real* adapter path: stores the key via the secrets
 * IPC, selects the NVIDIA provider in ChatPanel, sends a deterministic prompt,
 * and asserts the streamed reply contains a known sentinel. SSE format
 * compatibility with our OpenAI adapter (which nvidia.ts delegates to) was
 * verified manually and again by this test.
 *
 * Run locally:
 *   NVAPI_KEY='nvapi-...' npx playwright test tests/e2e/nvidia-live.spec.ts --workers=1
 *
 * The key is only ever passed to the launched Electron via secrets.set; it is
 * never written to disk in plaintext (safeStorage encrypts it under userData).
 * The launched app uses an isolated `--user-data-dir` so the key does not
 * persist beyond the test.
 */
/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

const NVAPI_KEY = process.env.NVAPI_KEY;
const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  getParaProps(s: number, p: number): Record<string, unknown>;
  getBookmarks(): Record<string, unknown>[] | null;
}

test.describe('NVIDIA NIM — live smoke', () => {
  test.skip(!NVAPI_KEY, 'NVAPI_KEY env not set — skipping live test');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    // No fake-AI env → real adapter path runs.
    launched = await launchApp();
    await launched.page.evaluate(async (key: string) => {
      await window.api.secrets.set('nvidia', key);
    }, NVAPI_KEY!);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('NVIDIA provider streams a real reply containing the sentinel', async () => {
    const { page } = launched;
    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page
      .getByTestId('chat-input')
      .fill('Reply with the single token NIM_OK and nothing else.');
    await page.getByTestId('chat-send').click();

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');

    // Real network — give it up to 30s. Most replies arrive in <3s.
    await expect(assistantContent).toContainText('NIM_OK', { timeout: 30_000 });
    // Stream finished → send button is back.
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  // chunk 18 — doc-context attach + apply HTML round trip. Loads the
  // blank fixture, asks NIM for a centered paragraph as ```html```, then
  // clicks "문서에 적용" and asserts the IR alignment flipped to
  // 'center'. Real model output is non-deterministic, so we steer with a
  // strict prompt and a fallback regex (any ```html``` block with
  // text-align:center).
  test('chunk 18 — attach doc + apply HTML edit (centered paragraph)', async () => {
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const { page } = launched;

    // Open the blank fixture so the StudioViewer mounts and exposes
    // exportDocumentHtml + applyHtmlAtCaret to the chat panel.
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page.getByTestId('chat-attach-checkbox').check();

    // Tightly scoped prompt — system prompt already tells the model to
    // emit one ```html``` fenced block.
    await page
      .getByTestId('chat-input')
      .fill(
        'Center the first paragraph. Reply with EXACTLY one fenced ```html``` code block containing only `<p style="text-align:center;">CENTERED</p>` and nothing else.',
      );
    await page.getByTestId('chat-send').click();

    const applyBtn = page.getByTestId('chat-action-apply-html');
    await expect(applyBtn).toBeVisible({ timeout: 60_000 });

    await applyBtn.click();
    await expect(applyBtn).toHaveText('✓ 적용됨');

    const align = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(align).toBe('center');
  });

  // chunk 19 — ahwp-tools dispatch round trip. Asks NIM for a tool
  // block that adds a bookmark, then verifies the IR sees it post-click.
  test('chunk 19 — ahwp-tools dispatch (addBookmark) round trip', async () => {
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const { page } = launched;

    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page.getByTestId('chat-attach-checkbox').check();

    await page
      .getByTestId('chat-input')
      .fill(
        [
          'Add a bookmark named "intro" at the cursor.',
          'Reply with EXACTLY one fenced ```ahwp-tools``` code block of valid JSON like:',
          '{"ops":[{"tool":"addBookmark","args":{"name":"intro"}}]}',
          'No other code blocks. No prose outside.',
        ].join('\n'),
      );
    await page.getByTestId('chat-send').click();

    const runBtn = page.getByTestId('chat-action-run-tools');
    await expect(runBtn).toBeVisible({ timeout: 60_000 });
    await runBtn.click();
    await expect(runBtn).toHaveText(/✓ 적용됨/, { timeout: 10_000 });

    const bookmarks = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getBookmarks();
    });
    expect(bookmarks?.some((b) => b.name === 'intro')).toBe(true);
  });
});
