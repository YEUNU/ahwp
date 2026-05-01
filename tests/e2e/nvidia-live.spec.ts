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
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

const NVAPI_KEY = process.env.NVAPI_KEY;

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
    // Pick a smaller, fast model so the test runs in a few seconds.
    await page
      .getByTestId('chat-model-input')
      .fill('meta/llama-3.1-8b-instruct');
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
});
