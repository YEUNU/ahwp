/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 E2c follow-up — useRhwpEditor 모드에서 chat 의 fake-AI 기본
 * 흐름 (입력 → 응답 stream → 메시지 렌더) 이 깨지지 않는지 회귀.
 *
 * AI tool 호출이 실제로 bridge 로 라우팅되는지는 다른 spec 들
 * (bridge-ir-helper / rhwp-studio-debug-mount) 이 검증. 본 spec 은
 * rhwp-mode 의 AppShell wiring 이 ChatPanel mount / submit 자체를
 * 깨뜨리지 않는지만 확인.
 */

const STUDIO_DIST = path.resolve(
  __dirname,
  '..',
  '..',
  'vendor',
  'rhwp',
  'rhwp-studio',
  'dist',
  'index.html',
);
const FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
);

test.describe('Phase E2c — chat regression in rhwp-mode', () => {
  test.skip(
    !existsSync(STUDIO_DIST),
    'vendor/rhwp/rhwp-studio/dist missing — run `npm run vendor:rhwp:build`',
  );
  test.skip(!existsSync(FIXTURE), 'examples/2026년도 ... 공고.hwp missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('chat input + submit still works in rhwp-mode (fake-AI)', async () => {
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');

    // rhwp-mode 활성 + fake-AI 셋업 + fixture 자동 열기.
    await page.evaluate(
      async ({ p }) => {
        window.localStorage.setItem('ahwp:use-rhwp-editor', '1');
        // ChatPanel 의 send 버튼 활성화에 provider key 필요 — fake 어댑터도 동일.
        await window.api.secrets.set('openai', 'test-key');
        // plan-mode default off — fake stream 후 plan buttons 안 렌더되도록.
        window.localStorage.setItem('ahwp:chat:plan-mode-default', '0');
        await window.api.session.set({ lastActivePath: p });
      },
      { p: FIXTURE },
    );
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // RhwpEditor 가 마운트됐는지 확인.
    await expect(page.getByTestId('rhwp-editor-iframe').first()).toBeAttached({
      timeout: 30_000,
    });

    // ChatPanel 의 입력 박스가 존재하는지 — chat-actions spec 등이 사용하는
    // 'chat-input' testid.
    await expect(page.getByTestId('chat-input').first()).toBeVisible({
      timeout: 15_000,
    });

    // 간단한 fake-AI 메시지 보내기 — fake provider 의 ECHO 모드.
    await page.getByTestId('chat-input').first().fill('ECHO:hello');
    await page.getByTestId('chat-send').first().click();

    // Stream 종료 — chat-send 가 다시 visible.
    await expect(page.getByTestId('chat-send')).toBeVisible();

    // assistant 버블이 'hello' 포함.
    const lastAssistant = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last();
    await expect(lastAssistant).toContainText(/hello/);
  });
});
