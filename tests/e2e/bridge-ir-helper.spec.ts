/// <reference lib="dom" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 Phase D2a — `BridgeIrHelper` 가 실제 ahwp Electron 안에서
 * RhwpBridge 와 함께 작동하는지 검증.
 *
 * __rhwpDebug.mount() 로 RhwpEditor 마운트 + bridge 획득 → main world
 * 에서 BridgeIrHelper 직접 사용 (helper class 를 page 안으로 inject
 * 하는 대신 동일 wire 호출을 inline 으로 재현). HelperClass 자체의
 * 로직은 unit test (`bridge-ir-helper.test.ts`) 가 mock 으로 검증했고
 * 본 e2e 는 main world 의 bridge 와 wire format 호환만 확인.
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

interface DbgApi {
  mount(): Promise<{
    invokeWasm(fn: string, args?: unknown[]): Promise<unknown>;
    invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  }>;
  unmount(): void;
}

test.describe('Phase D2a — BridgeIrHelper × real iframe', () => {
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

  test('insertText → getTextRange round-trip via bridge wasm dispatcher', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    const bytes = readFileSync(FIXTURE);
    const sentinel = 'DD-' + Date.now().toString(36);

    const result = await page.evaluate(
      async ({ data, name, sentinel }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();

        // loadFile via named method
        const loaded = await bridge.invoke(
          'loadFile',
          { data, fileName: name, skipUnsavedGuard: true },
          // 60s timeout matches RhwpBridge.loadFile convenience.
          // page.evaluate JS shape doesn't accept the 3rd arg via this
          // call form, but invoke 시그너처 자체는 t? 받음. 무시되면 default.
        );
        const pageCount = (loaded as { pageCount: number }).pageCount;

        // 1) Insert sentinel at (0, 0, 0). BridgeIrHelper.insertText 와
        // 동등 — invokeWasm('insertText', [s,p,off,text]) + JSON parse.
        const insRaw = (await bridge.invokeWasm('insertText', [
          0,
          0,
          0,
          sentinel,
        ])) as string;
        let insOk = true;
        try {
          insOk = (JSON.parse(insRaw) as { ok?: boolean }).ok !== false;
        } catch {
          /* non-JSON treated as ok */
        }

        // 2) Read back via getTextRange — single-paragraph mode.
        // helper 의 cross-para 분기는 unit test 가 검증.
        const txt = (await bridge.invokeWasm('getTextRange', [
          0,
          0,
          0,
          sentinel.length,
        ])) as string;

        // 3) Verify with searchAllText too.
        const hits = (await bridge.invokeWasm('searchAllText', [
          sentinel,
          false,
          false,
        ])) as unknown[];

        dbg.unmount();
        return { pageCount, insOk, txt, hitCount: hits.length };
      },
      { data: Array.from(bytes), name: '2026.hwp', sentinel },
    );

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.insOk).toBe(true);
    expect(result.txt).toBe(sentinel);
    expect(result.hitCount).toBeGreaterThanOrEqual(1);
  });

  test('deleteText reverses an insertText — bridge writes are observable', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    const bytes = readFileSync(FIXTURE);
    const marker = 'EE' + Date.now().toString(36);

    const result = await page.evaluate(
      async ({ data, name, marker }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();
        await bridge.invoke('loadFile', {
          data,
          fileName: name,
          skipUnsavedGuard: true,
        });

        // insert marker at (0,0,0), then delete it back.
        await bridge.invokeWasm('insertText', [0, 0, 0, marker]);
        const afterIns = (await bridge.invokeWasm('getTextRange', [
          0,
          0,
          0,
          marker.length,
        ])) as string;

        await bridge.invokeWasm('deleteText', [0, 0, 0, marker.length]);
        const afterDel = (await bridge.invokeWasm('getTextRange', [
          0,
          0,
          0,
          marker.length,
        ])) as string;

        dbg.unmount();
        return { afterIns, afterDel };
      },
      { data: Array.from(bytes), name: '2026.hwp', marker },
    );

    expect(result.afterIns).toBe(marker);
    expect(result.afterDel).not.toBe(marker);
  });
});
