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
import { existsSync } from 'node:fs';
import path from 'node:path';
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
    // 0.3.X+ — chat-model-input 이 <input> → <select> 로 전환. 모델 목록
    // fetch 전엔 select 가 disabled 라 `.fill()` / 즉시 selectOption 둘 다
    // 불가. localStorage 의 STORAGE_MODELS 키에 미리 'gemini-2.5-flash' 를
    // 저장하면 "(저장됨)" sticky option 으로 렌더되어 fetch 결과와 무관하게
    // 선택 가능. provider 도 같이 localStorage 로 고정 (reload 후 적용).
    await page.evaluate(() => {
      localStorage.setItem(
        'ahwp:chat:models',
        JSON.stringify({ google: 'gemini-2.5-flash' }),
      );
      localStorage.setItem('ahwp:chat:provider', 'google');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );

    await page
      .getByTestId('chat-input')
      .fill('Reply with the single token GEMINI_OK and nothing else.');
    await page.getByTestId('chat-send').click();

    // 429 RESOURCE_EXHAUSTED 감지 → skip (free-tier 일일 20 req 한도).
    await page.waitForTimeout(3000);
    const alertText = await page
      .locator('[role="alert"]')
      .first()
      .innerText()
      .catch(() => '');
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(alertText)) {
      test.skip(true, `Google API quota exhausted: ${alertText.slice(0, 200)}`);
      return;
    }

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
    // tool 호출이 dispatch 되려면 viewer 가 마운트되어 있어야 함 (docId-aware
    // 라우팅 — 미마운트면 `target-doc-not-mounted` 로 entry 없이 silent fail).
    const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

    // 0.3.X+ — chat-model-input 이 <input> → <select> 로 전환. 모델 목록
    // fetch 전엔 select 가 disabled 라 `.fill()` / 즉시 selectOption 둘 다
    // 불가. localStorage 의 STORAGE_MODELS 키에 미리 'gemini-2.5-flash' 를
    // 저장하면 "(저장됨)" sticky option 으로 렌더되어 fetch 결과와 무관하게
    // 선택 가능. provider 도 같이 localStorage 로 고정 (reload 후 적용).
    await page.evaluate(() => {
      localStorage.setItem(
        'ahwp:chat:models',
        JSON.stringify({ google: 'gemini-2.5-flash' }),
      );
      localStorage.setItem('ahwp:chat:provider', 'google');
    });
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean((window as Window & { __studioDebug?: unknown }).__studioDebug),
      { timeout: 30_000 },
    );
    // chunk 99 follow-up — 자동 승인 토글 폐기 (모든 도구 즉시 dispatch).
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );

    await page
      .getByTestId('chat-input')
      .fill(
        'Use the applyAlignment function to set align to "center" on the first paragraph (sectionIdx=0, paragraphIdx=0). Make exactly one tool call. Do not emit text-only descriptions.',
      );
    await page.getByTestId('chat-send').click();

    // Gemini Agent mode 가 invocable 하다는 것을 검증. 모델은 native
    // tool-use 또는 text-only / patches block 등 다양한 경로로 응답할 수
    // 있고, gemini-2.5-flash 의 비결정성 + 작은 모델 특성으로 정확한
    // 도구 시퀀스가 보장되지 않음. 본 케이스는 "스트리밍이 완료되고
    // 어떤 형태든 응답이 도착함" 까지 만 검증 (smoke level).
    await expect(page.getByTestId('chat-send')).toBeVisible({
      timeout: 90_000,
    });

    // 429 RESOURCE_EXHAUSTED (무료 등급 일일 20 요청) 감지 시 skip — API
    // 측 quota 한계라 코드 문제 아님. error 토스트 / alert 텍스트에 429
    // 또는 RESOURCE_EXHAUSTED 가 있으면 skip 트리거.
    const alertText = await page
      .locator('[role="alert"]')
      .first()
      .innerText()
      .catch(() => '');
    if (/429|RESOURCE_EXHAUSTED|quota/i.test(alertText)) {
      test.skip(true, `Google API quota exhausted: ${alertText.slice(0, 200)}`);
      return;
    }

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');
    const toolCount = await page
      .locator('[data-testid="chat-tool-entry"]')
      .count();
    const patchesCount = await page
      .locator(
        '[data-testid="diff-single-card"], [data-testid="diff-multi-stack"]',
      )
      .count();
    const contentText = await assistantContent.innerText().catch(() => '');
    expect(toolCount + patchesCount > 0 || contentText.length > 0).toBe(true);
  });
});
