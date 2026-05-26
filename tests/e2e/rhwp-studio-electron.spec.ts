/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 Phase C — Electron 안에서 `ahwp-studio://` 프로토콜이 실제로
 * 응답하고, CSP `frame-src` 가 iframe 마운트를 허용하며, 임베드된
 * rhwp-studio 가 postMessage bridge 로 ready 응답까지 보내는지 검증.
 *
 * launchApp 은 빌드된 `dist-electron/main.js` 를 실행하므로 protocol
 * 등록 / extraResources / CSP 변경이 실제 패키징 흐름대로 작동한다.
 * 단, dist 자산은 `vendor/rhwp/rhwp-studio/dist` 에서 직접 (dev path)
 * 로드 — packaged 빌드는 main 의 `studioRoot()` 가 처리.
 *
 * Phase D 이전이라 RhwpEditor 컴포넌트가 아직 UI 에 마운트되지 않았다.
 * 본 spec 은 page.evaluate 로 iframe 을 직접 만들어 protocol + bridge
 * round-trip 만 확인. RhwpEditor 의 React lifecycle 은 별도 e2e 가
 * Phase D 에서 추가 예정.
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

test.describe('Phase C — ahwp-studio:// protocol in Electron', () => {
  test.skip(
    !existsSync(STUDIO_DIST),
    'vendor/rhwp/rhwp-studio/dist missing — run `npm run vendor:rhwp:build`',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('protocol serves index.html + CSP allows iframe + bridge.ready resolves', async () => {
    const { page } = launched;

    // page.evaluate 의 main world 에서 iframe 을 만들고 ready postMessage
    // 를 보낸다. bridge 구현은 inline TestBridge — RhwpBridge 의 단위
    // 동작은 vitest 가 검증했으므로 여기선 wire format 만 확인.
    const result = await page.evaluate(async () => {
      type Resp = {
        type: string;
        id: string;
        result?: unknown;
        error?: string;
      };

      // iframe 생성. body 끝에 hidden 으로 붙임 — CSS visibility 무관,
      // postMessage 는 layout 과 무관하게 작동.
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '-9999px';
      iframe.style.width = '800px';
      iframe.style.height = '600px';
      iframe.src = 'ahwp-studio://main/index.html';
      document.body.appendChild(iframe);

      // iframe.load 대기. 30s timeout — vite build 의 cold rhwp-studio
      // 가 wasm 컴파일에 수 초 걸릴 수 있음.
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(
          () => reject(new Error('iframe.load timeout')),
          30_000,
        );
        iframe.addEventListener(
          'load',
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
      });

      // postMessage round-trip — ready 호출.
      const invoke = (method: string, params?: Record<string, unknown>) =>
        new Promise<Resp>((resolve, reject) => {
          const id = `ec-${Math.random().toString(36).slice(2)}`;
          const timer = window.setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error(`bridge timeout: ${method}`));
          }, 30_000);
          const handler = (e: MessageEvent) => {
            const d = e.data as Resp | undefined;
            if (!d || d.type !== 'rhwp-response' || d.id !== id) return;
            if (e.source !== iframe.contentWindow) return;
            window.clearTimeout(timer);
            window.removeEventListener('message', handler);
            resolve(d);
          };
          window.addEventListener('message', handler);
          iframe.contentWindow?.postMessage(
            { type: 'rhwp-request', id, method, params },
            '*',
          );
        });

      const ready = await invoke('ready');
      // Generic wasm dispatcher 도 한 번. 부수 검증.
      const sc = await invoke('wasm', { fn: 'getSectionCount', args: [] });

      iframe.remove();

      return {
        readyOk: ready.result === true && ready.error === undefined,
        scOk: typeof sc.result === 'number' && sc.error === undefined,
      };
    });

    expect(result.readyOk).toBe(true);
    expect(result.scOk).toBe(true);
  });

  test('protocol returns 404 for missing assets', async () => {
    const { page } = launched;
    const status = await page.evaluate(async () => {
      try {
        const r = await fetch('ahwp-studio://main/definitely-not-a-file.txt');
        return r.status;
      } catch (err) {
        return `err: ${(err as Error).message}`;
      }
    });
    expect(status).toBe(404);
  });

  test('protocol blocks path traversal', async () => {
    const { page } = launched;
    const status = await page.evaluate(async () => {
      try {
        // `..` 두 단계 위는 vendor/rhwp/rhwp-studio. dist 바깥 — 차단되어야.
        const r = await fetch('ahwp-studio://main/../../../../../etc/hosts');
        return r.status;
      } catch (err) {
        return `err: ${(err as Error).message}`;
      }
    });
    // Chromium 의 URL parser 가 '..' 를 정규화해서 401/403 또는 404 둘 다 OK.
    // 우리 handler 는 normalize 후 root 바깥이면 403, 존재 안 하면 404.
    expect([403, 404]).toContain(status as number);
  });
});
