/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 Phase D1 — `window.__rhwpDebug.mount()` 가 실제 ahwp Electron
 * 안에서 React 의 lifecycle 을 거쳐 `RhwpEditor` 컴포넌트를 portal 로
 * 마운트하고, 그 iframe 의 RhwpBridge 가 ready 상태로 노출되는지 검증.
 *
 * 이전 `rhwp-studio-electron.spec.ts` 는 page.evaluate 로 iframe 을 DOM
 * 에 직접 만들었다 (React 우회). 본 spec 은 React + RhwpEditor + bridge
 * 자동 wiring 의 통합 동작을 확인 — Phase D 후반 / E 에서 viewer 자체를
 * RhwpEditor 로 교체하기 전 단계 검증.
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

interface RhwpDebugApi {
  mount(opts?: { hidden?: boolean }): Promise<{ ok: true }>;
  unmount(): void;
  getBridge(): unknown;
}

type DbgWindow = Window & { __rhwpDebug?: RhwpDebugApi };

test.describe('Phase D1 — __rhwpDebug.mount + RhwpBridge round-trip', () => {
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

  test('__rhwpDebug.mount returns ready bridge and round-trips invokeWasm', async () => {
    const { page } = launched;

    // installRhwpDebugSurface() 가 main.tsx 의 top-level 에서 호출되므로
    // App render 이전에 이미 window.__rhwpDebug 가 노출. 그래도 안전하게
    // 한 번 polling.
    await page.waitForFunction(
      () => Boolean((window as DbgWindow).__rhwpDebug),
      { timeout: 30_000 },
    );

    // page.evaluate 의 캐스트는 main world 의 RhwpBridge 인스턴스 — 우리는
    // shape 만 확인 (typeof / 호출 결과). 실제 invokeWasm 결과로 정합성 확인.
    const result = await page.evaluate(async () => {
      const dbg = (
        window as Window & {
          __rhwpDebug?: {
            mount(): Promise<{
              invokeWasm(fn: string, args?: unknown[]): Promise<unknown>;
              ready(): Promise<true>;
              pendingCount: number;
            }>;
            unmount(): void;
          };
        }
      ).__rhwpDebug;
      if (!dbg) throw new Error('__rhwpDebug missing');

      const bridge = await dbg.mount();
      // ready 가 mount 안에서 이미 await 됐지만 한 번 더 호출해서 fresh 응답 확인.
      const ready = await bridge.ready();
      const sc = await bridge.invokeWasm('getSectionCount', []);
      const pc = await bridge.invokeWasm('pageCount', []);

      // cleanup
      dbg.unmount();

      return {
        ready,
        sc,
        pc,
        scIsNumber: typeof sc === 'number',
        pcIsNumber: typeof pc === 'number',
      };
    });

    expect(result.ready).toBe(true);
    expect(result.scIsNumber).toBe(true);
    expect(result.pcIsNumber).toBe(true);
    // 도큐먼트 미로드 상태라 0 이지만 음수는 아님.
    expect(result.sc as number).toBeGreaterThanOrEqual(0);
  });

  test('unmount destroys bridge — getBridge returns null afterward', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as DbgWindow).__rhwpDebug),
      { timeout: 30_000 },
    );

    const beforeAndAfter = await page.evaluate(async () => {
      const dbg = (
        window as Window & {
          __rhwpDebug?: {
            mount(): Promise<unknown>;
            unmount(): void;
            getBridge(): unknown;
          };
        }
      ).__rhwpDebug!;
      await dbg.mount();
      const before = dbg.getBridge() !== null;
      dbg.unmount();
      const after = dbg.getBridge() === null;
      return { before, after };
    });

    expect(beforeAndAfter.before).toBe(true);
    expect(beforeAndAfter.after).toBe(true);
  });
});
