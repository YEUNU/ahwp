/**
 * Live smoke test against Google Gemini's hosted endpoint
 * (https://generativelanguage.googleapis.com/v1beta).
 *
 * Skips silently unless `AHWP_TEST_GOOGLE_KEY` is in the environment so this
 * never runs in CI by default and never blocks contributors who don't have a
 * Gemini key.
 *
 * The test exercises the *real* adapter path:
 *   1. Stores the key via secrets IPC (safeStorage encrypted under userData)
 *   2. Selects the Google provider in ChatPanel
 *   3. Sends a deterministic prompt; asserts streamed reply contains a
 *      sentinel ("GEMINI_OK")
 *   4. Agent-mode round-trip: asks Gemini to call `applyAlignment` tool with
 *      `{align:'center'}` — verifies tool-use event arrives + entry renders
 *
 * Run locally:
 *   AHWP_TEST_GOOGLE_KEY='AIza...' npx playwright test tests/e2e/gemini-live.spec.ts --workers=1
 *
 * Or via .env (gitignored): the test runner reads .env at module load time.
 *
 * The key is only ever passed to the launched Electron via secrets.set; it is
 * never written to disk in plaintext (safeStorage encrypts it under userData).
 * The launched app uses an isolated `--user-data-dir` so the key does not
 * persist beyond the test.
 */
/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

// .env loader is in playwright.config.ts so any process.env.* read here
// already includes .env-sourced values.
const GOOGLE_KEY = process.env.AHWP_TEST_GOOGLE_KEY;

test.describe('Google Gemini — live smoke', () => {
  test.skip(
    !GOOGLE_KEY,
    'AHWP_TEST_GOOGLE_KEY env not set — skipping live test',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await launched.page.evaluate(async (key: string) => {
      await window.api.secrets.set('google', key);
    }, GOOGLE_KEY!);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('Gemini provider streams a real reply containing the sentinel', async () => {
    const { page } = launched;
    await page.getByTestId('chat-provider-select').selectOption('google');
    await page.getByTestId('chat-model-input').fill('gemini-2.5-flash');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page
      .getByTestId('chat-input')
      .fill('Reply with the single token GEMINI_OK and nothing else.');
    await page.getByTestId('chat-send').click();

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');

    // Real network — give it up to 30s. Most replies arrive in <3s.
    await expect(assistantContent).toContainText('GEMINI_OK', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  test('Agent mode — Gemini calls applyAlignment tool', async () => {
    const { page } = launched;
    await page.getByTestId('chat-provider-select').selectOption('google');
    await page.getByTestId('chat-model-input').fill('gemini-2.5-flash');
    await page.getByTestId('chat-auto-approve-toggle').check();
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page
      .getByTestId('chat-input')
      .fill(
        'Call applyAlignment with align="center". Do not include any other text.',
      );
    await page.getByTestId('chat-send').click();

    // tool-entry 가 화면에 나타날 때까지 대기 — applyAlignment 호출 확인.
    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="applyAlignment"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 30_000 });
    // 결과 (ok 또는 failed) 까지 대기 — 핵심은 호출 자체가 발생했다는 것.
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'), {
        timeout: 30_000,
      })
      .not.toBe('running');
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });
});
