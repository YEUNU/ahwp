/// <reference lib="dom" />
import { existsSync, readFileSync } from 'node:fs';
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

  test('exportHwp round-trip — bytes from bridge can be re-loaded (Phase D3)', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as DbgWindow).__rhwpDebug),
      { timeout: 30_000 },
    );

    const FIXTURE = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
    );
    if (!existsSync(FIXTURE)) {
      test.skip();
      return;
    }
    const bytes = readFileSync(FIXTURE);

    // load fixture → insert sentinel → export → unmount → re-mount → reload
    // → search sentinel. AppShell 의 file:save → file:open round-trip 의
    // bridge 측 동작 흐름과 동일.
    const result = await page.evaluate(
      async ({ data }) => {
        const dbg = (
          window as Window & {
            __rhwpDebug?: {
              mount(): Promise<{
                invoke(
                  m: string,
                  p?: Record<string, unknown>,
                  t?: number,
                ): Promise<unknown>;
                invokeWasm(
                  fn: string,
                  args?: unknown[],
                  t?: number,
                ): Promise<unknown>;
                loadFile(
                  data: number[] | Uint8Array | ArrayBuffer,
                  name?: string,
                  skip?: boolean,
                ): Promise<{ pageCount: number }>;
              }>;
              unmount(): void;
            };
          }
        ).__rhwpDebug!;

        const bridge = await dbg.mount();
        await bridge.loadFile(data, 'src.hwp', true);

        const sentinel = 'D3-' + Date.now().toString(36);
        await bridge.invokeWasm('insertText', [0, 0, 0, sentinel]);

        // exportHwp 의 named case 는 Array.from(...) 으로 number[] 반환.
        const exported = (await bridge.invoke(
          'exportHwp',
          undefined,
          60_000,
        )) as number[];
        const len1 = exported.length;

        // 다시 마운트 + 새 bridge 에서 export bytes reload → sentinel 검색.
        dbg.unmount();
        const b2 = await dbg.mount();
        await b2.loadFile(exported, 'roundtrip.hwp', true);
        const hits = (await b2.invokeWasm('searchAllText', [
          sentinel,
          false,
          false,
        ])) as unknown[];

        dbg.unmount();
        return { len1, hitCount: hits.length };
      },
      { data: Array.from(bytes) },
    );

    expect(result.len1).toBeGreaterThan(0);
    expect(result.hitCount).toBeGreaterThanOrEqual(1);
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
