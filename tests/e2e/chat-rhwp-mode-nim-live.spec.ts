/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * NIM live verification — 0.6.7 (applyHtml guard + 양식 doc anchor 동작).
 *
 * `NVAPI_KEY` env (`.env` 자동 로드) 가 있어야 실행 — 없으면 skip.
 * Default test model: `google/gemma-4-31b-it` (CLAUDE.md feedback —
 * qwen 류는 stall / 비용 회피).
 *
 * 사용자 보고 시나리오 회귀 가드:
 *   양식 HWP 의 default caret (0,0,0) 이 표지 표 cell 안 → AI 가
 *   applyHtml 호출 시 cell 안에 dump → layout 파괴. 0.6.7 가드가
 *   reject + anchor 워크플로 강제.
 *
 * 본 spec 의 검증 의도:
 *   1. NIM 모델이 0.6.7 가드의 reject 메시지를 받고 anchor 를 찾는
 *      후속 흐름으로 진입하는지 (vs silent infinite retry).
 *   2. 결과적으로 표지 표 cell 의 paragraph 0 텍스트가 보존되는지.
 *   3. AI 가 작성한 컨텐트가 doc 어딘가 (표 바깥) 에 들어가는지.
 *
 * LLM 비결정성 흡수 — gemma 류는 사용자 의도 따라 anchor 정확도가
 * 다르다. 본 spec 은 "표 cell 망가지지 않음" 을 핵심 검증 (silent
 * 회귀 방지). 정확한 섹션 위치는 LLM 별 편차 큼 — soft assertion.
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

const NIM_KEY = process.env.NVAPI_KEY;

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
  timeoutMs = 180_000,
): Promise<void> {
  await page.getByTestId('chat-input').first().fill(prompt);
  await page.getByTestId('chat-send').first().click();
  await expect(page.getByTestId('chat-send')).toBeVisible({
    timeout: timeoutMs,
  });
  await page.waitForTimeout(1500);
}

test.describe('NIM live — 0.6.7 applyHtml guard + anchor 동작 검증', () => {
  test.skip(!NIM_KEY, 'NVAPI_KEY env not set — .env 에 키 저장 후 재실행');
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  test.skip(!existsSync(FIXTURE), 'fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    const keyChecked = NIM_KEY!;
    // Provider = nvidia, model = google/gemma-4-31b-it (CLAUDE.md 권장).
    // plan-mode OFF, key 등록.
    await page.evaluate(
      async ({ key, fixture }) => {
        window.localStorage.setItem('ahwp:chat:provider', 'nvidia');
        window.localStorage.setItem(
          'ahwp:chat:models',
          JSON.stringify({ nvidia: 'google/gemma-4-31b-it' }),
        );
        window.localStorage.setItem('ahwp:chat:plan-mode-default', '0');
        await window.api.secrets.set('nvidia', key);
        await window.api.session.set({ lastActivePath: fixture });
      },
      { key: keyChecked, fixture: FIXTURE },
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

  test('insertText — 단순 자연어 (NIM sanity)', async () => {
    const { page } = launched;
    const sentinel = 'NIM-' + Date.now().toString(36).toUpperCase();
    await sendChatPrompt(page, `문서 처음에 "${sentinel}" 라고 넣어줘`);
    const hits = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  /**
   * 0.6.7 핵심 회귀 가드 — applyHtml hard-guard 가 적용된 후의 양식 doc
   * 작성 흐름. 사용자가 "코렌스 사업계획서 작성해줘" 같은 자연어를 보낼
   * 때, AI 가 표지 표 cell (paragraph 0) 을 망가뜨리지 않아야 한다.
   *
   * 이전 (0.6.6 이하): applyHtml 가드 없어서 AI 가 default caret (0,0,0)
   * 에 dump → 표지 cell 안에 dump → layout 파괴.
   *
   * 이후 (0.6.7+): 가드가 reject → AI 가 anchor 워크플로로 진입 →
   * 표지 cell 보존.
   */
  test('양식 doc 작성 — 표지 표 cell 보존 검증 (0.6.7 fix)', async () => {
    // gemma-4-31b 의 multi-step tool 흐름은 60s default 보다 김.
    // playwright.config.ts 의 timeout=60_000 을 본 테스트만 override.
    test.setTimeout(360_000);
    const { page } = launched;
    // 1) 작성 전 paragraph 0 텍스트 스냅샷.
    const beforeP0 = await readWasm<string>(
      page,
      'getTextRange',
      [0, 0, 0, 200],
    );
    const beforeP0Trimmed = beforeP0.trim();
    console.log(
      `[debug nim] before P0 (len=${beforeP0Trimmed.length}):`,
      beforeP0Trimmed.slice(0, 60),
    );

    // 2) 사용자 자연어 — "코렌스 / AI 예지보전 사업계획서 작성".
    // gemma-4-31b 는 양식 doc 의 표 구조를 인식하고 anchor 워크플로
    // 사용해야 가드를 통과. silent dump 시도 시 가드가 reject → AI 가
    // 재시도하거나 사용자에게 가이드를 전달.
    await sendChatPrompt(
      page,
      `이 양식 문서에 "코렌스" 라는 자동차 부품 업체로 AI 기반 설비 예지보전 사업계획서를 작성해줘. 표지 표는 건드리지 말고 본문 섹션에만 내용을 채워.`,
      240_000,
    );

    // 3) 작성 후 paragraph 0 텍스트가 보존됐는지 확인. 양식의 표지 표
    // 안 텍스트는 변경되지 않아야 한다.
    const afterP0 = await readWasm<string>(
      page,
      'getTextRange',
      [0, 0, 0, 200],
    );
    const afterP0Trimmed = afterP0.trim();
    console.log(
      `[debug nim] after P0 (len=${afterP0Trimmed.length}):`,
      afterP0Trimmed.slice(0, 60),
    );
    // 표지 cell paragraph 0 의 텍스트가 그대로 유지되어야 한다.
    // (AI 가 표 cell 을 망가뜨리면 paragraph 0 의 텍스트가 바뀜)
    expect(afterP0Trimmed).toBe(beforeP0Trimmed);
  });
});
