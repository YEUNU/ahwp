/// <reference lib="dom" />
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * LIVE end-to-end form-fill — 실제 OpenAI 로 사용자 dogfooding 시나리오를
 * 그대로 구동: "이즈파크(공급)/다빈치렌스(도입) · AI 예지보전 중간보고서".
 *
 * getEmptyFormFields → fillFormCells agent loop (router + 도구 dispatch +
 * BridgeIrHelper IR 변경) 전체를 라이브 모델로 검증한다. 결정론 fake 버전은
 * chat-rhwp-form-fill.spec.ts (CI). 본 스펙은 `.env` 의 AHWP_TEST_OPENAI_KEY
 * 가 있어야 실행, 없으면 skip.
 *
 * 어설션은 grounding 원칙(0.7.23)의 관찰가능 효과 — 사용자가 **제공한** 두
 * 회사명이 양식에 실제로 들어갔는지. LLM 비결정성 때문에 특정 셀/도구가 아니라
 * "문서 어딘가에 그 값이 생겼다"로 검증.
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
const FORM_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
);
const OPENAI_KEY = process.env.AHWP_TEST_OPENAI_KEY;
// 0.7.36 — 라이브 모델명 외부화(.env 의 AHWP_TEST_OPENAI_MODEL override 가능).
const OPENAI_MODEL =
  process.env.AHWP_TEST_OPENAI_MODEL ?? 'gpt-5.4-mini-2026-03-17';

async function readWasm<T>(
  page: Page,
  fn: string,
  args: unknown[],
): Promise<T> {
  return (await page.evaluate(
    async ({ fn, args }) => {
      const iframe = document.querySelector(
        '[data-testid="rhwp-editor-iframe"]',
      ) as HTMLIFrameElement | null;
      if (!iframe || !iframe.contentWindow) {
        throw new Error('rhwp-editor iframe not mounted');
      }
      return await new Promise<unknown>((resolve, reject) => {
        const id = `verify-${Math.random().toString(36).slice(2)}`;
        const timer = window.setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error(`bridge timeout: ${fn}`));
        }, 15_000);
        const handler = (e: MessageEvent) => {
          const d = e.data as {
            type?: string;
            id?: string;
            result?: unknown;
            error?: string;
          };
          if (!d || d.type !== 'rhwp-response' || d.id !== id) return;
          if (e.source !== iframe.contentWindow) return;
          window.clearTimeout(timer);
          window.removeEventListener('message', handler);
          if (d.error) reject(new Error(d.error));
          else resolve(d.result);
        };
        window.addEventListener('message', handler);
        iframe.contentWindow!.postMessage(
          { type: 'rhwp-request', id, method: 'wasm', params: { fn, args } },
          '*',
        );
      });
    },
    { fn, args },
  )) as T;
}

async function sendChatPrompt(
  page: Page,
  prompt: string,
  timeoutMs = 240_000,
): Promise<void> {
  await page.getByTestId('chat-input').first().fill(prompt);
  await page.getByTestId('chat-send').first().click();
  // stream 중에는 stop 버튼. 다시 send 로 돌아오면 turn loop 종료.
  await expect(page.getByTestId('chat-send')).toBeVisible({
    timeout: timeoutMs,
  });
  await page.waitForTimeout(1500);
}

test.describe('LIVE form-fill — 이즈파크/다빈치렌스 예지보전 중간보고서', () => {
  test.skip(!OPENAI_KEY, 'AHWP_TEST_OPENAI_KEY env not set');
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  test.skip(!existsSync(FORM_FIXTURE), 'form fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    const key = OPENAI_KEY!;
    await page.evaluate(
      async ({ key, fixture, model }) => {
        window.localStorage.setItem('ahwp:chat:provider', 'openai');
        window.localStorage.setItem(
          'ahwp:chat:models',
          JSON.stringify({ openai: model }),
        );
        window.localStorage.setItem('ahwp:chat:plan-mode-default', '0');
        await window.api.secrets.set('openai', key);
        await window.api.session.set({ lastActivePath: fixture });
      },
      { key, fixture: FORM_FIXTURE, model: OPENAI_MODEL },
    );
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('rhwp-editor-iframe').first()).toBeAttached({
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          try {
            return await readWasm<number>(launched.page, 'getSectionCount', []);
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('grounded names land in the form via the live agent loop', async () => {
    test.setTimeout(300_000);
    const { page } = launched;
    await sendChatPrompt(
      page,
      '이즈파크라는 회사가 공급기업이고, 수요기업은 다빈치렌스야. AI기반 예지보전으로 중간보고서 작성해줘',
    );
    // 사용자가 명시 제공한 두 회사명 = grounded. 양식 어딘가에 실제로 기입돼야.
    const izpark = await readWasm<unknown[]>(page, 'searchAllText', [
      '이즈파크',
      true,
      true,
    ]);
    const davinci = await readWasm<unknown[]>(page, 'searchAllText', [
      '다빈치렌스',
      true,
      true,
    ]);
    expect(
      izpark.length,
      '공급기업명 이즈파크가 양식에 기입됨',
    ).toBeGreaterThanOrEqual(1);
    expect(
      davinci.length,
      '도입기업명 다빈치렌스가 양식에 기입됨',
    ).toBeGreaterThanOrEqual(1);

    // 0.7.29 — 모델이 updatePlan 을 썼으면 진행 체크리스트 UI 가 렌더됨.
    // 비결정적이라 hard assert 아님 — 존재하면 스크린샷으로 가시성 확인.
    const planVisible = await page
      .getByTestId('chat-plan-checklist')
      .isVisible()
      .catch(() => false);
    if (planVisible && process.env.AHWP_PLAN_SHOT) {
      await page
        .getByTestId('chat-plan-checklist')
        .screenshot({ path: process.env.AHWP_PLAN_SHOT });
    }

    // 라이브 결과물을 export → /tmp 에 저장 → 외부에서 render-hwp-pages-cjk 로
    // 시각 검증. AHWP_DUMP_FILLED=path 로 저장 경로 지정.
    const dumpPath = process.env.AHWP_DUMP_FILLED;
    if (dumpPath) {
      const b64 = await page.evaluate(async () => {
        const iframe = document.querySelector(
          '[data-testid="rhwp-editor-iframe"]',
        ) as HTMLIFrameElement | null;
        if (!iframe?.contentWindow) throw new Error('iframe missing');
        const bytes = await new Promise<Uint8Array>((resolve, reject) => {
          const id = `exp-${Math.random().toString(36).slice(2)}`;
          const timer = window.setTimeout(
            () => reject(new Error('export timeout')),
            20_000,
          );
          const handler = (e: MessageEvent) => {
            const d = e.data as {
              type?: string;
              id?: string;
              result?: unknown;
              error?: string;
            };
            if (!d || d.type !== 'rhwp-response' || d.id !== id) return;
            window.clearTimeout(timer);
            window.removeEventListener('message', handler);
            if (d.error) reject(new Error(d.error));
            else resolve(d.result as Uint8Array);
          };
          window.addEventListener('message', handler);
          iframe.contentWindow!.postMessage(
            {
              type: 'rhwp-request',
              id,
              method: 'wasm',
              params: { fn: 'exportHwp', args: [] },
            },
            '*',
          );
        });
        const u8 =
          bytes instanceof Uint8Array
            ? bytes
            : new Uint8Array(Object.values(bytes));
        let bin = '';
        for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
        return btoa(bin);
      });
      writeFileSync(dumpPath, Buffer.from(b64, 'base64'));
    }
  });
});
