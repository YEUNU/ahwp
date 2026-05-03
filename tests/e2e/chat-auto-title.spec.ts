/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * chunk 31 — 자동 제목 요약 회귀 가드.
 *
 * 4 메시지 (= 2 user + 2 assistant turns) 누적 후 1회 한정 background
 * AI 호출로 짧은 제목 생성 → renameConversation. fake provider는 ECHO:
 * 프리픽스 첫 인스턴스 뒤를 echo하므로, 두 번째 ECHO 후 transcript에
 * "ECHO:hello-suffix" 포함 → fake provider가 "hello-suffix\n..."을 echo
 * → 첫 줄 → 30자 trim → 새 제목.
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
  await launched.page.evaluate(async () => {
    await window.api.secrets.set('openai', 'test-key');
  });
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await launched.close();
});

async function sendEcho(payload: string): Promise<void> {
  const { page } = launched;
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  // chat-send 가 다시 보이면 stream 종료된 것 — onEvent 의 done handler
  // 가 maybeAutoTitle 을 호출하는 시점이 이 이후.
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

test.describe('chat — chunk 31 자동 제목 요약', () => {
  test('first turn: title = first user message slice (60자)', async () => {
    const { page } = launched;
    await sendEcho('hello');
    await page.getByTestId('chat-history-toggle').click();
    const items = page.getByTestId('chat-history-item');
    await expect(items).toHaveCount(1);
    // 첫 turn 직후엔 auto-title 트리거 안 됨 (4 메시지 미만).
    await expect(items.first()).toContainText('ECHO:hello');
  });

  test('after 2 turns (4 messages): auto-title rename fires', async () => {
    const { page } = launched;
    await sendEcho('first-payload');
    await sendEcho('second-payload');
    // auto-title은 background ai:chat 후 chatHistory.rename → refresh
    // 이라 약간의 비동기 기다림 필요.
    await page.waitForTimeout(800);
    await page.getByTestId('chat-history-toggle').click();
    const items = page.getByTestId('chat-history-item');
    await expect(items).toHaveCount(1);
    // 새 title 은 60자 truncated 첫 user 메시지 ("ECHO:first-payload") 가
    // 아닌, fake provider의 auto-title 응답으로 갱신됨.
    // 정확한 매칭 대신 "원래 title 이 변경됐다" 를 검증.
    const titleText = await items.first().textContent();
    expect(titleText).not.toBeNull();
    // ECHO:first-payload (원래 60자 truncated title) 와 동일하지 않아야 함.
    expect(titleText).not.toContain('ECHO:first-payload');
  });
});
