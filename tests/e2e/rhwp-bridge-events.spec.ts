/// <reference lib="dom" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 Phase D4 — `rhwp-event` channel. rhwp-studio main.ts 가 250ms
 * 주기로 wasm.getCaretPosition() polling 해 변동 시 `caret-changed`
 * 이벤트를 parent 로 broadcast. RhwpBridge.on('caret-changed', ...) 이
 * 받는다.
 *
 * 본 spec 은 실제 ahwp Electron 안에서:
 *   1. __rhwpDebug.mount → bridge.ready
 *   2. bridge.on('caret-changed', fn) 으로 listener 등록
 *   3. fixture 로드 → caret 위치가 초기화되며 event 1회 이상 fire 예상
 *   4. insertText 후 또 caret 변동 → event 추가 fire
 * 검증.
 *
 * polling 기반이라 약간의 지연 (≤ 500ms). expect.poll 로 흡수.
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
    invoke(
      method: string,
      params?: Record<string, unknown>,
      t?: number,
    ): Promise<unknown>;
    invokeWasm(fn: string, args?: unknown[], t?: number): Promise<unknown>;
    loadFile(
      data: number[] | Uint8Array | ArrayBuffer,
      name?: string,
      skip?: boolean,
    ): Promise<{ pageCount: number }>;
    on(name: string, fn: (data: unknown) => void): () => void;
  }>;
  unmount(): void;
}

test.describe('Phase D4 — RhwpBridge caret-changed event', () => {
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

  test('caret-changed fires after loadFile + insertText', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    // listener 를 main world 에 설치하고 카운터를 window 에 노출.
    const bytes = readFileSync(FIXTURE);
    const setup = await page.evaluate(
      async ({ data }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();

        const w = window as unknown as {
          __caretEvents?: unknown[];
          __caretBridge?: typeof bridge;
        };
        w.__caretEvents = [];
        w.__caretBridge = bridge;
        bridge.on('caret-changed', (pos) => {
          w.__caretEvents!.push(pos);
        });

        // 로드 → caret 초기화 → 이벤트 1회 이상 기대.
        await bridge.loadFile(data, 'src.hwp', true);
        return { ok: true };
      },
      { data: Array.from(bytes) },
    );
    expect(setup.ok).toBe(true);

    // polling 주기 300ms 이상 대기 — caret 초기화 이벤트가 들어오는지.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as Window & { __caretEvents?: unknown[] }).__caretEvents
                ?.length ?? 0,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThanOrEqual(1);

    // insertText → caret 이동 → 추가 이벤트.
    const before = await page.evaluate(
      () =>
        (window as Window & { __caretEvents?: unknown[] }).__caretEvents
          ?.length ?? 0,
    );
    await page.evaluate(async () => {
      const bridge = (
        window as unknown as {
          __caretBridge?: {
            invokeWasm(fn: string, args?: unknown[]): Promise<unknown>;
          };
        }
      ).__caretBridge!;
      await bridge.invokeWasm('insertText', [0, 0, 0, 'CARET-EVT']);
    });

    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as Window & { __caretEvents?: unknown[] }).__caretEvents
                ?.length ?? 0,
          ),
        { timeout: 5_000 },
      )
      .toBeGreaterThan(before);

    // listener 가 받은 마지막 이벤트는 caret position shape.
    const last = await page.evaluate(() => {
      const arr = (window as Window & { __caretEvents?: unknown[] })
        .__caretEvents;
      return arr && arr.length > 0 ? arr[arr.length - 1] : null;
    });
    expect(last).not.toBeNull();
    if (last && typeof last === 'object') {
      const pos = last as Record<string, unknown>;
      expect(typeof pos.sectionIndex).toBe('number');
      expect(typeof pos.paragraphIndex).toBe('number');
      expect(typeof pos.charOffset).toBe('number');
    }

    await page.evaluate(() =>
      (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!.unmount(),
    );
  });
});
