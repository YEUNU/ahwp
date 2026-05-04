/**
 * Live smoke test against a self-hosted Ollama (OpenAI-compat /v1 shim).
 *
 * Skips silently unless the AHWP_TEST_OLLAMA_URL env (e.g.
 * http://localhost:11434/v1) is set AND `AHWP_TEST_OLLAMA_MODEL` is set
 * (the local model name pulled in Ollama). Both are read from .env via
 * playwright.config.ts.
 *
 * The test stores the baseUrl + (dummy) API key, selects the `custom`
 * provider, sends a deterministic prompt, and asserts the streamed reply
 * contains a sentinel. Tool calling is also verified if the model
 * supports it (gemma4 / llama3.1+ etc.).
 *
 * Run locally with Ollama running:
 *   AHWP_TEST_OLLAMA_URL=http://localhost:11434/v1 \
 *   AHWP_TEST_OLLAMA_MODEL=gemma4:e2b \
 *   npx playwright test tests/e2e/ollama-live.spec.ts --workers=1
 */
/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

const OLLAMA_URL = process.env.AHWP_TEST_OLLAMA_URL;
const OLLAMA_MODEL = process.env.AHWP_TEST_OLLAMA_MODEL;

test.describe('Ollama (Custom OpenAI-compat) — live smoke', () => {
  test.skip(
    !OLLAMA_URL || !OLLAMA_MODEL,
    'AHWP_TEST_OLLAMA_URL / AHWP_TEST_OLLAMA_MODEL env not set',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await launched.page.evaluate(
      async ({ url }: { url: string }) => {
        // Ollama 의 /v1 shim 은 "Bearer" 검증 안 함 — 빈 키로 OK.
        // 그래도 우리 secrets check 가 통과하려면 뭐든 set.
        await window.api.secrets.set('custom', 'ollama-local');
        await window.api.ai.setProviderConfig({
          providerId: 'custom',
          baseUrl: url,
          supportsTools: true,
        });
      },
      { url: OLLAMA_URL! },
    );
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('Custom provider streams a real reply containing the sentinel', async () => {
    const { page } = launched;
    await page.getByTestId('chat-provider-select').selectOption('custom');
    await page.getByTestId('chat-model-input').fill(OLLAMA_MODEL!);
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page
      .getByTestId('chat-input')
      .fill('Reply with the single token OLLAMA_OK and nothing else.');
    await page.getByTestId('chat-send').click();

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');
    await expect(assistantContent).toContainText('OLLAMA_OK', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  // Agent 모드 라이브 검증 — 모델이 tool calling 을 지원하고 충분히
  // 크면 동작. 작은 모델 (e.g. gemma4:e2b 5.1B) + 54 tools 카탈로그
  // 조합은 모델이 혼란을 일으켜 tool_calls 대신 명료성 질문 으로
  // 응답할 수 있음. AHWP_TEST_OLLAMA_AGENT=1 명시 시에만 실행.
  test('Agent mode — Ollama calls applyAlignment tool', async () => {
    test.skip(
      process.env.AHWP_TEST_OLLAMA_AGENT !== '1',
      'AHWP_TEST_OLLAMA_AGENT=1 로 명시 시 실행 — 작은 모델은 54-tool 카탈로그 처리 불안정',
    );
    const { page } = launched;
    await page.getByTestId('chat-provider-select').selectOption('custom');
    await page.getByTestId('chat-model-input').fill(OLLAMA_MODEL!);
    await page.getByTestId('chat-mode-agent').click();

    await page
      .getByTestId('chat-input')
      .fill(
        'Call applyAlignment with align="center". Do not include any other text.',
      );
    await page.getByTestId('chat-send').click();

    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="applyAlignment"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 120_000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'), {
        timeout: 60_000,
      })
      .not.toBe('running');
  });
});
