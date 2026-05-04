/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Plan mode (chunk 99 follow-up) — Claude Code 식 dry-run.
 *
 * 사용자가 큰 / 위험한 / 모호한 변경을 실제 적용 전에 검토하기 위한
 * 토글. on=read tool 만 호출, write 차단, 응답은 bullet plan. 사용자가
 * "이 계획대로 실행" 클릭 → off + 동일 prompt 재발사 → 정상 흐름.
 *
 * 검증 묶음:
 *  1. Toggle 이 localStorage 영속 + checkbox state.
 *  2. Plan mode 응답에 "이 계획대로 실행" 버튼 노출.
 *  3. 일반 모드 응답엔 plan execute 버튼 미노출.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, t: string): string;
}

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

async function openFixture(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () =>
      Boolean(
        (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
      ),
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

  test('Plan mode toggle 이 localStorage 에 영속 + checkbox state 동기화', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    const toggle = page.getByTestId('chat-plan-mode-toggle');
    await expect(toggle).toBeVisible();
    // 기본 off.
    await expect(toggle).not.toBeChecked();
    const before = await page.evaluate(() =>
      localStorage.getItem('ahwp:chat:plan-mode'),
    );
    expect(before === null || before === '0').toBe(true);

    // on.
    await toggle.click();
    await expect(toggle).toBeChecked();
    const after = await page.evaluate(() =>
      localStorage.getItem('ahwp:chat:plan-mode'),
    );
    expect(after).toBe('1');

    // off.
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    const off = await page.evaluate(() =>
      localStorage.getItem('ahwp:chat:plan-mode'),
    );
    expect(off).toBe('0');
  });

  test('Plan mode on 상태에서 응답은 "이 계획대로 실행" 버튼 노출', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    // plan mode on.
    await page.getByTestId('chat-plan-mode-toggle').click();
    // ECHO fake 으로 텍스트 응답 가짜 발사.
    await sendEcho(page, '계획:\n- 단계 1\n- 단계 2');
    // 응답 메시지 옆에 execute plan 버튼 visible.
    const executeBtn = page.getByTestId('chat-action-execute-plan');
    await expect(executeBtn).toBeVisible();
    await expect(executeBtn).toContainText('이 계획대로 실행');
  });

  test('Plan mode off (기본) 상태에선 plan execute 버튼 미노출 (회귀 가드)', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    // 기본 off — toggle 건드리지 않고 그대로.
    await sendEcho(page, '안녕 그냥 인사할게');
    // plan execute 버튼 미존재.
    await expect(page.getByTestId('chat-action-execute-plan')).toHaveCount(0);
  });
});
