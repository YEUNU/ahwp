/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 Phase E2a — AppShell 의 `ahwp:use-rhwp-editor` localStorage
 * flag 가 '1' 이면 활성 탭의 StudioViewer 자리에 RhwpEditor 가 마운트
 * 되고, 탭의 doc 가 자동 로드되는지 검증.
 *
 * flag OFF 검증은 기존 모든 e2e (studio-* spec 들) 가 담당.
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

test.describe('Phase E2a — AppShell rhwp-mode RhwpEditor mount', () => {
  test.skip(
    !existsSync(STUDIO_DIST),
    'vendor/rhwp/rhwp-studio/dist missing — run `npm run vendor:rhwp:build`',
  );
  test.skip(!existsSync(FIXTURE), 'examples/2026년도 ... 공고.hwp missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('flag enables RhwpEditor — iframe mounted with ahwp-studio:// src', async () => {
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');

    // flag 세팅 + session.lastActivePath 로 fixture 가 자동 열리도록 한 뒤 reload.
    await page.evaluate(
      async ({ p }) => {
        window.localStorage.setItem('ahwp:use-rhwp-editor', '1');
        await window.api.session.set({ lastActivePath: p });
      },
      { p: FIXTURE },
    );
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // RhwpEditor 가 마운트되면 iframe with testid 'rhwp-editor-iframe' 존재.
    const iframe = page.getByTestId('rhwp-editor-iframe').first();
    await expect(iframe).toBeAttached({ timeout: 30_000 });

    // iframe.src 는 ahwp-studio:// 프로토콜 (StudioViewer 가 아니라
    // RhwpEditor 가 렌더 됐다는 결정적 증거).
    const src = await iframe.getAttribute('src');
    expect(src).toBe('ahwp-studio://main/index.html');

    // bridge round-trip 자체는 다른 spec (rhwp-bridge-events, ir-helper,
    // debug-mount) 가 이미 검증. AppShell 의 onReady 콜백이 file:read 후
    // bridge.loadFile 을 fire 하지만 — file:read IPC 자체는 이미 회귀
    // 테스트가 있고, RhwpEditor 의 onReady 흐름은 unit/e2e 가 있음.
    // 본 spec 은 마운트 + src 만 확인. 통합 시나리오는 D5 회귀가 담당.
  });
});
