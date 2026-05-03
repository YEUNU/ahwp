/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 4 chunk 52 — About 다이얼로그 회귀 가드.
 *
 * Custom dialog 로 native About 패널 대체. 메뉴 "ahwp 정보" + 명령 팔레트
 * "도움말 → ahwp 정보" 둘 다 동일 다이얼로그 호출. 버전 + 라이선스 +
 * GitHub 링크 표시.
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

test.describe('About dialog — chunk 52', () => {
  test('command palette → about → 다이얼로그 열림 + 버전 표시', async () => {
    const { page } = launched;
    // 명령 팔레트 ⌘K (Mac) / Ctrl+K (Win/Linux) — primaryModifier 라
    // OS 따라 다르지만 e2e 환경 (Darwin) 에선 Meta+K.
    await page.keyboard.press('Meta+k');
    await page.getByTestId('command-palette-input').fill('정보');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);

    const dialog = page.getByTestId('about-dialog');
    await expect(dialog).toBeVisible();
    // 버전 노출 (v0.x.y 형식)
    const ver = page.getByTestId('about-app-version');
    await expect(ver).toHaveText(/v\d+\.\d+\.\d+/);
    // 외부 링크 버튼 3개
    await expect(page.getByTestId('about-github')).toBeVisible();
    await expect(page.getByTestId('about-releases')).toBeVisible();
    await expect(page.getByTestId('about-issues')).toBeVisible();
    // 닫기
    await page.getByTestId('about-close').click();
    await expect(dialog).not.toBeVisible();
  });
});
