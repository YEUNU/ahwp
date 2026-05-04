/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 4 chunk 52 — About 회귀 가드 (UI/UX align: Settings 의 정보 탭으로
 * 통합).
 *
 * 메뉴 "ahwp 정보" + 명령 팔레트 "도움말 → ahwp 정보" 둘 다 Settings
 * dialog 의 `정보` 탭을 연다. 버전 + 라이선스 + GitHub 링크 표시.
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

test.describe('About — chunk 52 (Settings 정보 탭)', () => {
  test('command palette → about → Settings 정보 탭 + 버전 표시', async () => {
    const { page } = launched;
    await page.keyboard.press('Meta+k');
    await page.getByTestId('command-palette-input').fill('정보');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const dialog = page.getByTestId('settings-dialog');
    await expect(dialog).toBeVisible();
    // about 탭이 활성화돼야 함
    await expect(page.getByTestId('settings-pane-body')).toContainText('버전');
    // 버전 노출 (v0.x.y 형식)
    const ver = page.getByTestId('about-app-version');
    await expect(ver).toHaveText(/v\d+\.\d+\.\d+/);
    // 외부 링크 버튼 3개
    await expect(page.getByTestId('about-github')).toBeVisible();
    await expect(page.getByTestId('about-releases')).toBeVisible();
    await expect(page.getByTestId('about-issues')).toBeVisible();
    // 다이얼로그 닫기 — Esc
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });
});
