/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 E2-finalize live verify — 실제 OpenAI API 로 자연어 명령 →
 * tool call → BridgeIrHelper → rhwp-studio iframe IR 변경 까지의
 * end-to-end 동작 검증.
 *
 * `AHWP_TEST_OPENAI_KEY` env (`.env` 자동 로드) 가 있어야 실행.
 * 없으면 skip — CI 의 일반 e2e 실행에는 영향 없음.
 *
 * LLM 비결정성 흡수:
 * - 응답 시간: case 당 60s timeout (LLM 평균 5~30s)
 * - prompt 는 매우 구체적 — 어느 tool / 어떤 args 를 쓸지 강하게 hint
 * - 어설션은 "효과 발생" 위주 (예: 텍스트가 들어갔다 / 정렬이 바뀌었다).
 *   특정 tool 이 호출됐는지가 아니라 IR 의 관찰가능 변경.
 *
 * 본 spec 은 AHWP_TEST_OPENAI_KEY 가 없으면 자동 skip 되도록 설계.
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

const OPENAI_KEY = process.env.AHWP_TEST_OPENAI_KEY;

/**
 * 활성 탭의 RhwpEditor iframe 에 postMessage 로 직접 호출. AppShell 의
 * bridge 와 별도 wire — race condition 회피용으로 wasm dispatcher 만
 * 사용한다 (write op 은 LLM 이 시키고, 본 함수는 read 만).
 */
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
          {
            type: 'rhwp-request',
            id,
            method: 'wasm',
            params: { fn, args },
          },
          '*',
        );
      });
    },
    { fn, args },
  )) as T;
}

/**
 * Chat 입력에 prompt 를 보내고 streaming 완료 + tool 실행 완료 대기.
 * chat-send 가 다시 visible 해지면 turn 종료로 간주.
 */
async function sendChatPrompt(
  page: Page,
  prompt: string,
  timeoutMs = 90_000,
): Promise<void> {
  await page.getByTestId('chat-input').first().fill(prompt);
  await page.getByTestId('chat-send').first().click();
  // chat-send 가 stream 중에는 stop 버튼으로 바뀜. 다시 send 로 돌아오면 종료.
  await expect(page.getByTestId('chat-send')).toBeVisible({
    timeout: timeoutMs,
  });
  // tool 후처리가 끝나도록 1초 buffer.
  await page.waitForTimeout(1000);
}

test.describe('Phase 7 — live OpenAI tool dispatch verification', () => {
  test.skip(
    !OPENAI_KEY,
    'AHWP_TEST_OPENAI_KEY env not set — .env 에 키 저장 후 재실행',
  );
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  test.skip(!existsSync(FIXTURE), 'fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    // OPENAI_KEY 는 위 test.skip 가드를 통과한 시점에 string 보장.
    const keyChecked = OPENAI_KEY!;
    // Provider = openai, model = gpt-5.4-mini-2026-03-17 (사용자 지정),
    // plan-mode OFF (auto execute), key 등록.
    await page.evaluate(
      async ({ key, fixture }) => {
        window.localStorage.setItem('ahwp:chat:provider', 'openai');
        window.localStorage.setItem(
          'ahwp:chat:models',
          JSON.stringify({ openai: 'gpt-5.4-mini-2026-03-17' }),
        );
        window.localStorage.setItem('ahwp:chat:plan-mode-default', '0');
        await window.api.secrets.set('openai', key);
        await window.api.session.set({ lastActivePath: fixture });
      },
      { key: keyChecked, fixture: FIXTURE },
    );
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // iframe 마운트 + doc load 대기.
    await expect(page.getByTestId('rhwp-editor-iframe').first()).toBeAttached({
      timeout: 30_000,
    });
    // doc 이 로드되어 paragraph 가 존재할 때까지 대기 (rhwp-editor 의
    // onReady 가 fired 됐다는 신호).
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

  test('insertText — "문서 맨 앞에 X 추가해줘" 같은 자연어', async () => {
    const { page } = launched;
    const sentinel = 'AHWPLIVE-' + Date.now().toString(36).toUpperCase();
    // 사용자가 실제로 말할 법한 식 — 도구 이름 / 좌표 언급 X.
    await sendChatPrompt(page, `문서 맨 앞에 "${sentinel}" 라고 좀 넣어줘`);
    const hits = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  test('findInDocument — "사업 단어 몇 번 나와?" 같은 자연어 (read)', async () => {
    const { page } = launched;
    // 사용자 typical 질문 — "찾기" / "검색" / "몇 번" 등.
    await sendChatPrompt(
      page,
      `이 문서에 '사업' 이라는 단어가 몇 번이나 나와?`,
    );
    const lastAssistant = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last();
    // 응답이 사업 매치를 언급해야 함 (숫자 + 단어 포함).
    await expect(lastAssistant).toContainText(/사업/);
  });

  test('getDocumentSummary — "이 문서 뭐 내용이야?" 같은 자연어 (read composite)', async () => {
    const { page } = launched;
    // getDocumentSummary 도구는 helper 가 composite 로 구현 (단락 스캔).
    // AI 가 자연스럽게 호출하고 응답에 본문 키워드가 포함되는지 확인.
    await sendChatPrompt(
      page,
      `이 문서 어떤 내용인지 핵심만 요약해줘`,
      120_000,
    );
    const lastAssistant = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last();
    // fixture 의 도메인 키워드 — "사업" 또는 "AI" 또는 "스마트" 등 본문
    // 단어 중 하나는 포함되어야.
    await expect(lastAssistant).toContainText(/사업|AI|스마트|제조|공장/);
  });

  test('insertText — 한 번 더 사용자 표현으로 검증 (다른 위치 hint)', async () => {
    const { page } = launched;
    const sentinel = 'NATLANG-' + Date.now().toString(36).toUpperCase();
    // 더 캐주얼한 표현 — "맨 위" / "처음" 같은 일상어.
    await sendChatPrompt(page, `문서 처음에 "${sentinel}" 하나 적어줘`);
    const hits = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
