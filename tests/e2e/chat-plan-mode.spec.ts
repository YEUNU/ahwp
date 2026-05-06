/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Plan mode (chunk 99 follow-up) — Claude Code 식 dry-run.
 *
 * 큰 / 위험한 / 모호한 변경을 실제 적용 전에 검토하기 위한 모드.
 * 디폴트 ON (안전 우선) — 매 새 prompt 마다 dry-run. 사용자가 검토 후
 * (a) "이 계획대로 실행" 버튼 / (b) "건너뛰기" 인라인 버튼 / (c) 같은
 * prompt 재전송 — 모두 next-send 1회만 plan 우회.
 *
 * 검증 묶음:
 *  1. 기본 indicator 노출 (default ON 이라).
 *  2. Settings 에서 default OFF 시 indicator 사라짐.
 *  3. Plan mode 응답에 "이 계획대로 실행" 버튼 노출.
 *  4. Default OFF + Settings 변경 후 응답엔 execute 버튼 미노출.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
  await launched.page.evaluate(async () => {
    await window.api.secrets.set('openai', 'test-key');
    // chunk 99 follow-up — default OFF 가 새 기본 (자동 적용 흐름이
    // main). plan-mode 검증 spec 은 명시적 ON 으로 시작.
    localStorage.setItem('ahwp:chat:plan-mode-default', '1');
  });
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await launched.close();
});

async function openFixture(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () =>
      Boolean((window as Window & { __studioDebug?: object }).__studioDebug),
    { timeout: 30_000 },
  );
}

async function sendEcho(page: Page, payload: string): Promise<void> {
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

test.describe('chat — plan mode (chunk 99 follow-up)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('명시적 ON — Plan mode indicator + 응답에 "이 계획대로 실행" 버튼 노출', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    // indicator 가 보임 (default ON).
    await expect(page.getByTestId('chat-plan-mode-indicator')).toBeVisible();
    // 응답 발사.
    await sendEcho(page, '계획:\n- 단계 1\n- 단계 2');
    // 응답 메시지 옆에 execute plan 버튼 visible.
    const executeBtn = page.getByTestId('chat-action-execute-plan');
    await expect(executeBtn).toBeVisible();
    await expect(executeBtn).toContainText('이 계획대로 실행');
  });

  test('Settings → "Plan mode 기본 활성화" OFF → indicator 사라짐 + execute 버튼 미노출', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    // indicator 가 일단 보임 (default ON).
    await expect(page.getByTestId('chat-plan-mode-indicator')).toBeVisible();
    // localStorage 직접 변경 + same-tab 이벤트 dispatch (Settings 의
    // savePlanModeDefault 가 하는 일과 동등). UI overlay 클릭이 viewport
    // hit-test 에서 flaky 한 걸 우회.
    await page.evaluate(() => {
      localStorage.setItem('ahwp:chat:plan-mode-default', '0');
      window.dispatchEvent(new Event('ahwp:plan-mode-default-changed'));
    });
    // ChatPanel re-render → indicator 사라짐.
    await expect(page.getByTestId('chat-plan-mode-indicator')).toHaveCount(0);
    // 응답 발사 후 execute 버튼 미노출.
    await sendEcho(page, '안녕 그냥 인사할게');
    await expect(page.getByTestId('chat-action-execute-plan')).toHaveCount(0);
  });

  test('"건너뛰기" 인라인 버튼이 next send 1회만 plan 우회', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    const skipBtn = page.getByTestId('chat-plan-mode-skip');
    await expect(skipBtn).toBeVisible();
    await skipBtn.click();
    // ECHO 응답 — 이 turn 은 plan skip 이므로 message.planMode=undefined →
    // execute 버튼 미노출.
    await sendEcho(page, '간단한 문의');
    await expect(page.getByTestId('chat-action-execute-plan')).toHaveCount(0);
    // 다음 prompt 는 다시 default ON 적용.
    await expect(page.getByTestId('chat-plan-mode-indicator')).toBeVisible();
  });
});
