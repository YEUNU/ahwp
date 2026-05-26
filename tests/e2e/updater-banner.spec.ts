/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Auto-updater UI 회귀 — 0.6.2.
 *
 * 실제 GitHub Releases 통신은 packaged 빌드 + 사용자 머신에서만 검증 가능.
 * 본 spec 은 `AHWP_UPDATER_FAKE` env 로 main 의 fake event sequence 를
 * inject 한 뒤 UI 가 3 state 를 정확히 렌더하는지 확인.
 *
 * scenario:
 * - `available` — 마운트 직후 update-available 만 fire. 사용자가 "지금 받기"
 *   클릭 → fake downloadUpdate 가 즉시 downloaded 로 점프.
 * - `full` — available → downloading(50%) → downloaded 자동 진행.
 */

test.describe('Auto-updater banner — fake event injection', () => {
  let launched: LaunchedApp;

  test.afterEach(async () => {
    await launched.close();
  });

  test('available — 사용자가 "지금 받기" 클릭 시 downloaded 로 전환', async () => {
    launched = await launchApp({ env: { AHWP_UPDATER_FAKE: 'available' } });
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');

    // 마운트 후 main 의 setTimeout(400ms) 가 fire 되면 banner 렌더.
    const banner = page.getByTestId('updater-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await expect(banner).toHaveAttribute('data-status', 'available');
    await expect(banner).toContainText('99.0.0');

    // 사용자 클릭 → fake 로직이 즉시 downloading → downloaded 로 점프.
    await page.getByTestId('updater-download').click();
    await expect(banner).toHaveAttribute('data-status', 'downloaded', {
      timeout: 3_000,
    });
    // install 버튼 노출.
    await expect(page.getByTestId('updater-install')).toBeVisible();
  });

  test('full — available → downloading → downloaded 자동 전환', async () => {
    launched = await launchApp({ env: { AHWP_UPDATER_FAKE: 'full' } });
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');

    const banner = page.getByTestId('updater-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    // 400ms 단위 transition. polling 으로 각 state 통과 확인.
    await expect(banner).toHaveAttribute('data-status', 'available');
    await expect(banner).toHaveAttribute('data-status', 'downloading', {
      timeout: 3_000,
    });
    await expect(banner).toHaveAttribute('data-status', 'downloaded', {
      timeout: 3_000,
    });
  });

  test('dismiss 버튼 — banner 숨김', async () => {
    launched = await launchApp({ env: { AHWP_UPDATER_FAKE: 'available' } });
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');

    const banner = page.getByTestId('updater-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('updater-dismiss').click();
    await expect(banner).toBeHidden();
  });

  test('Settings 정보 탭의 "지금 확인" 버튼이 fake check 트리거', async () => {
    launched = await launchApp({ env: { AHWP_UPDATER_FAKE: 'available' } });
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');

    // banner dismiss 해서 settings 안 동작만 확인.
    await expect(page.getByTestId('updater-banner')).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId('updater-dismiss').click();

    // Settings 열기 → 정보 탭 → 지금 확인.
    await page.getByTestId('titlebar-settings').click();
    await page.getByTestId('settings-tab-about').click();
    await expect(page.getByTestId('settings-updater')).toBeVisible();
    await page.getByTestId('updater-check-now').click();

    // fake script 가 다시 fire → banner 가 다시 나타남.
    await expect(page.getByTestId('updater-banner')).toBeVisible({
      timeout: 5_000,
    });
  });

  test('dev 모드 (FAKE env 미설정) — banner 안 보임', async () => {
    launched = await launchApp(); // env 없음 → enabled=false
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    // 500ms 정도 기다려도 banner 안 나타나야.
    await page.waitForTimeout(500);
    await expect(page.getByTestId('updater-banner')).toBeHidden();
    // Settings 의 "지금 확인" 도 disabled.
    await page.getByTestId('titlebar-settings').click();
    await page.getByTestId('settings-tab-about').click();
    await expect(page.getByTestId('updater-check-now')).toBeDisabled();
    await expect(page.getByTestId('updater-status-text')).toContainText(
      /개발 빌드/,
    );
  });
});
