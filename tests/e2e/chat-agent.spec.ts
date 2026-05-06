/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
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
  // chunk 99 follow-up — 자동 승인 토글 폐기 (사용자 요청). 모든 도구
  // 즉시 dispatch. 기존 enableAutoApprove() helper 는 no-op 로 유지해
  // call site 를 단계적으로 정리.
  async function enableAutoApprove(): Promise<void> {
    // no-op: write tools are immediate by default now.
  }

  test.skip('자동 승인 토글 — UI on/off 전환', async () => {
    // chunk 99 follow-up — 자동 승인 토글 폐기 (사용자 요청, 모든 도구
    // 즉시 dispatch). 회귀 가드는 chat-actions / chat-section-replace
    // 등 다른 spec 에서 자동 적용 검증.
  });

  test('Agent: tool-use 응답 → tool-entry 표시 + ok 결과', async () => {
    const { page } = launched;

    // 자동 승인 ON (write tool 즉시 실행).
    await enableAutoApprove();

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
    await enableAutoApprove();
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

  test('Agent: chunk 51 read tool — getCaretPosition 호출 + 결과 회신', async () => {
    const { page } = launched;
    // Load blank fixture so viewer is mounted (read tools need doc).
    const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');
    if (!existsSync(FIXTURE)) {
      test.skip(true, 'blank.hwpx fixture missing');
      return;
    }
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

    await enableAutoApprove();
    await page.getByTestId('chat-input').fill('TOOL:getCaretPosition:{}');
    await page.getByTestId('chat-send').click();
    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="getCaretPosition"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .toBe('ok');
  });

  test('Agent: chunk 46 createTable — 표 구조 도구 호출', async () => {
    const { page } = launched;
    await enableAutoApprove();
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

  // chunk 99 follow-up — 검토 모드 (autoApprove=off) 가 폐기. 모든
  // write tool 즉시 dispatch. 승인/거절 게이트 시나리오 3개 skip.
  test.skip('검토 모드 — write tool pending → 승인 → ok', async () => {
    const { page } = launched;
    // 토글 OFF (기본). 명시적 확인.
    const toggle = page.getByTestId('chat-auto-approve-toggle');
    await expect(toggle).not.toBeChecked();

    await page
      .getByTestId('chat-input')
      .fill('TOOL:applyAlignment:{"align":"center"}');
    await page.getByTestId('chat-send').click();

    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="applyAlignment"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    // pending 상태 + 승인/거절 버튼 가시.
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .toBe('pending');
    await expect(entry.getByTestId('chat-tool-approve')).toBeVisible();
    await expect(entry.getByTestId('chat-tool-reject')).toBeVisible();

    // 승인 클릭 → dispatch → ok (혹은 IR throw 로 failed). 핵심: pending
    // 탈출.
    await entry.getByTestId('chat-tool-approve').click();
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .not.toBe('pending');
  });

  test.skip('검토 모드 — 거절 → rejected (dispatch 안 됨)', async () => {
    const { page } = launched;
    const toggle = page.getByTestId('chat-auto-approve-toggle');
    await expect(toggle).not.toBeChecked();

    await page
      .getByTestId('chat-input')
      .fill(
        'TOOL:insertText:{"sectionIdx":0,"paragraphIdx":0,"charOffset":0,"text":"REJECT_ME"}',
      );
    await page.getByTestId('chat-send').click();

    const entry = page
      .locator('[data-testid="chat-tool-entry"][data-tool-name="insertText"]')
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .toBe('pending');

    await entry.getByTestId('chat-tool-reject').click();
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .toBe('rejected');
  });

  test.skip('검토 모드 — read tool 은 자동 실행 (pending 안 거침)', async () => {
    const { page } = launched;
    const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');
    if (!existsSync(FIXTURE)) {
      test.skip(true, 'blank.hwpx fixture missing');
      return;
    }
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

    // autoApprove off (기본).
    await expect(
      page.getByTestId('chat-auto-approve-toggle'),
    ).not.toBeChecked();

    await page.getByTestId('chat-input').fill('TOOL:getCaretPosition:{}');
    await page.getByTestId('chat-send').click();

    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="getCaretPosition"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 5000 });
    // read tool 은 pending 안 거치고 곧장 ok.
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'))
      .toBe('ok');
  });

  test('Agent: unknown tool — failed 표시 + 에러 reason', async () => {
    const { page } = launched;

    await enableAutoApprove();
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
