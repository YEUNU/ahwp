/// <reference lib="dom" />
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * UI 시각 점검용 스크린샷 캡처 — 버튼/레이아웃 이상 유무를 사람이(그리고
 * 에이전트가) 한 장씩 확인하기 위한 스펙. 단언은 최소(요소 존재만), 핵심은
 * `OUT` 디렉터리에 떨어지는 PNG. `npx playwright test tests/e2e/ui-audit.spec.ts
 * --workers=1` 로 실행.
 */
const OUT = path.resolve(__dirname, '..', '..', '.ui-audit');
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
  "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
);

test.describe('UI audit — 화면 캡처', () => {
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  let launched: LaunchedApp;

  test.beforeAll(() => {
    mkdirSync(OUT, { recursive: true });
  });

  test.afterEach(async () => {
    await launched?.close();
  });

  test('capture all surfaces', async () => {
    test.setTimeout(180_000);
    launched = await launchApp();
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1200);
    const shot = async (name: string) => {
      await page.screenshot({ path: path.join(OUT, name) });
    };

    // 01 — Welcome (빈 세션 시작 화면)
    await expect(page.getByTestId('welcome-pane').first()).toBeVisible({
      timeout: 15_000,
    });
    await shot('01-welcome.png');

    // 02 — Settings: AI 공급자 (기본 탭)
    await page.getByTestId('titlebar-settings').first().click();
    await expect(page.getByTestId('settings-dialog').first()).toBeVisible({
      timeout: 10_000,
    });
    await page.waitForTimeout(400);
    await shot('02-settings-ai.png');

    // 03~05 — Settings 나머지 탭 (general / shortcuts / about)
    const tabs = page.getByRole('tab');
    await tabs.nth(0).click(); // general
    await page.waitForTimeout(300);
    await shot('03-settings-general.png');
    await tabs.nth(2).click(); // shortcuts
    await page.waitForTimeout(300);
    await shot('04-settings-shortcuts.png');
    await tabs.nth(3).click(); // about
    await page.waitForTimeout(300);
    await shot('05-settings-about.png');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // 06 — Command palette (⌘K / Ctrl+K)
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+k`);
    const palette = page.getByTestId('command-palette').first();
    if (await palette.isVisible().catch(() => false)) {
      await page.waitForTimeout(300);
      await shot('06-command-palette.png');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // 07~09 — 문서 열린 상태 (editor + tabs + chat panel)
    if (existsSync(FIXTURE)) {
      await page.evaluate(async (fixture) => {
        await window.api.session.set({ lastActivePath: fixture });
      }, FIXTURE);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await expect(page.getByTestId('rhwp-editor-iframe').first()).toBeAttached(
        { timeout: 30_000 },
      );
      await page.waitForTimeout(3500);
      await shot('07-doc-open.png');

      // tab bar 클로즈업
      const tabbar = page.getByTestId('studio-tabbar').first();
      if (await tabbar.isVisible().catch(() => false)) {
        await tabbar.screenshot({ path: path.join(OUT, '08-tabbar.png') });
      }
      // chat input 영역 클로즈업
      const provider = page.getByTestId('chat-provider-bar').first();
      if (await provider.isVisible().catch(() => false)) {
        await shot('09-chat-panel.png');
      }
    }

    expect(existsSync(path.join(OUT, '01-welcome.png'))).toBe(true);
  });
});
