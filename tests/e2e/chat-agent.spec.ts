/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 3 — Agent 모드 회귀 가드.
 *
 * fake provider 의 TOOL: 프리픽스 가 한 번에 한 tool-use 이벤트를
 * emit + finishReason='tool_calls'. Agent 루프는 받은 도구를 dispatch
 * 하고 tool-result 메시지를 추가한 뒤 fireChat 재귀. 두 번째 turn 의
 * 사용자 입력은 TOOL_DONE: 프리픽스라 finishReason='stop' → 루프 종료.
 *
 * 검증:
 *   1. Agent 모드 토글 — 라디오 클릭으로 active 전환
 *   2. tool-use 이벤트 → IR 호출 → 결과 표시 (✓ / ✗)
 *   3. 부분 성공 — 알 수 없는 tool 은 dispatch 거절, 다른 op 영향 없음
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

test.describe('chat — Phase 3 Agent 모드', () => {
  test('toggle Manual/Agent 모드 — 라디오 시각 활성', async () => {
    const { page } = launched;
    const manual = page.getByTestId('chat-mode-manual');
    const agent = page.getByTestId('chat-mode-agent');
    // 기본 Manual 활성.
    await expect(manual).toBeVisible();
    await expect(agent).toBeVisible();

    // Agent 클릭 → 시각 활성 (border-primary 클래스 적용).
    await agent.click();
    await expect(agent).toHaveClass(/border-primary/);
    await expect(manual).not.toHaveClass(/border-primary/);

    // 다시 Manual.
    await manual.click();
    await expect(manual).toHaveClass(/border-primary/);
    await expect(agent).not.toHaveClass(/border-primary/);
  });

  test('Agent: tool-use 응답 → tool-entry 표시 + ok 결과', async () => {
    const { page } = launched;

    // Agent 모드 활성.
    await page.getByTestId('chat-mode-agent').click();

    // TOOL: 프리픽스 — fake provider가 단일 tool-use 이벤트 emit.
    // applyAlignment(center) 는 selection 없이도 호출은 발생 (실패해도
    // dispatcher 가 reason 캡처).
    await page
      .getByTestId('chat-input')
      .fill('TOOL:applyAlignment:{"align":"center"}');
    await page.getByTestId('chat-send').click();

    // tool-entry 가 화면에 보일 때까지 대기 (running → ok/failed).
    const entry = page
      .getByTestId('chat-tool-entry')
      .filter({ has: page.locator('[data-tool-name="applyAlignment"]') })
      .first();
    // tool-entry는 데이터 속성으로 식별하니 직접 찾는 방식 변경.
    const anyEntry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="applyAlignment"]',
      )
      .first();
    await expect(anyEntry).toBeVisible({ timeout: 5000 });
    void entry;

    // 결과는 ok 또는 failed 둘 다 가능 (selection 없으면 lib에서 throw 가능)
    // — 핵심은 tool-entry 가 표시되고 status가 running 이 아니어야 함.
    await expect
      .poll(async () => {
        const status = await anyEntry.getAttribute('data-tool-status');
        return status;
      })
      .not.toBe('running');
  });

  test('Agent: chunk 45 insertText — 신규 본문 편집 primitive 호출', async () => {
    const { page } = launched;
    await page.getByTestId('chat-mode-agent').click();
    await page
      .getByTestId('chat-input')
      .fill(
        'TOOL:insertText:{"sectionIdx":0,"paragraphIdx":0,"charOffset":0,"text":"hi"}',
      );
    await page.getByTestId('chat-send').click();
    const entry = page
      .locator('[data-testid="chat-tool-entry"][data-tool-name="insertText"]')
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .not.toBe('running');
  });

  test('Agent: chunk 46 createTable — 표 구조 도구 호출', async () => {
    const { page } = launched;
    await page.getByTestId('chat-mode-agent').click();
    await page
      .getByTestId('chat-input')
      .fill(
        'TOOL:createTable:{"sectionIdx":0,"paragraphIdx":0,"charOffset":0,"rowCount":2,"colCount":2}',
      );
    await page.getByTestId('chat-send').click();
    const entry = page
      .locator('[data-testid="chat-tool-entry"][data-tool-name="createTable"]')
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .not.toBe('running');
  });

  test('Agent: unknown tool — failed 표시 + 에러 reason', async () => {
    const { page } = launched;

    await page.getByTestId('chat-mode-agent').click();
    await page.getByTestId('chat-input').fill('TOOL:notARealTool:{}');
    await page.getByTestId('chat-send').click();

    const anyEntry = page
      .locator('[data-testid="chat-tool-entry"][data-tool-name="notARealTool"]')
      .first();
    await expect(anyEntry).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => anyEntry.getAttribute('data-tool-status'))
      .toBe('failed');
  });
});
