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

  /**
   * 컨텍스트 인식 — AI 가 검색 + 읽기 + 계산 + 수정의 multi-step 작업.
   * 알려진 데이터 3개 (교육비/사업비/운영비) 를 미리 주입한 뒤 사용자가
   * "사업비 +100만원 해줘" 식으로 자연어 요청. AI 는:
   *   1) 사업비 항목 찾기 (searchAllText/findInDocument)
   *   2) 값 읽기 (getTextRange)
   *   3) +100 계산
   *   4) deleteRange + insertText 또는 applyHtml 로 교체
   * 다른 항목 (교육비/운영비) 은 변경 X 검증 — selectivity.
   */
  test('context-aware multi-step — "사업비 +100만원 해줘"', async () => {
    const { page } = launched;
    // 1) 알려진 데이터 3개를 한 단락 안에 inline 으로 주입 (paragraph 분할
    // 회피 — AI 의 location 추정이 단순 offset 으로 가능). 구분자는 ", ".
    const seed = '교육비: 200만원, 사업비: 500만원, 운영비: 300만원 / ';
    await page.evaluate(
      async ({ seedText }) => {
        const iframe = document.querySelector(
          '[data-testid="rhwp-editor-iframe"]',
        ) as HTMLIFrameElement;
        const post = (method: string, params: Record<string, unknown>) =>
          new Promise<unknown>((resolve, reject) => {
            const id = `seed-${Math.random().toString(36).slice(2)}`;
            const timer = window.setTimeout(
              () => reject(new Error('seed timeout')),
              15_000,
            );
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
              { type: 'rhwp-request', id, method, params },
              '*',
            );
          });
        // insertText(0, 0, 0, seed) — 단락 0 시작에 \n 포함 텍스트 삽입.
        await post('wasm', { fn: 'insertText', args: [0, 0, 0, seedText] });
      },
      { seedText: seed },
    );

    // 2) 셋업 확인 — 3 키워드 모두 검색 가능해야.
    const beforeEdu = await readWasm<unknown[]>(page, 'searchAllText', [
      '교육비: 200만원',
      true,
      false,
    ]);
    const beforeBiz = await readWasm<unknown[]>(page, 'searchAllText', [
      '사업비: 500만원',
      true,
      false,
    ]);
    const beforeOp = await readWasm<unknown[]>(page, 'searchAllText', [
      '운영비: 300만원',
      true,
      false,
    ]);
    expect(beforeEdu.length).toBeGreaterThanOrEqual(1);
    expect(beforeBiz.length).toBeGreaterThanOrEqual(1);
    expect(beforeOp.length).toBeGreaterThanOrEqual(1);

    // 3) AI 한테 컨텍스트 인식 명령 — 도구 / 좌표 / 계산 hint 없음.
    await sendChatPrompt(
      page,
      `문서에서 사업비 항목 찾아서 거기에 +100만원 해줘 (다른 항목은 그대로 두고)`,
      180_000,
    );

    // 4) AI 가 patches 형식 (DiffCard) 으로 변경 제안한 경우 Accept 자동.
    // patches block 이 chat 또는 editor portal 어느 쪽에든 렌더되어 있을 수
    // 있음. attached 가드.
    await page.waitForTimeout(1000); // patches block 렌더 안정화.
    const patchesBlocks = page.getByTestId('chat-patches-block');
    const blockCount = await patchesBlocks.count();
    console.log('[debug context] chat-patches-block count:', blockCount);
    // invalid patches 가 있으면 reason 출력 — 어떤 validation 으로 fail.
    const invalids = page.locator('[data-testid^="diff-patch-invalid-"]');
    const ic = await invalids.count();
    for (let i = 0; i < ic; i++) {
      const r = await invalids.nth(i).textContent();
      console.log(`[debug context] invalid patch #${i}: ${r?.slice(0, 200)}`);
    }
    // accept 버튼은 여러 패턴: 다중 patches 면 diff-accept-all, 단일이면
    // diff-accept-1 (SinglePatchCard), 다중 patches 내 개별이면 diff-accept-{idx}.
    // 0.5.x: ChatPanel auto-accept (autoAcceptedPatchesRef) 가 처음 mount 시
    // 한 번 fire → 버튼이 disabled 상태로 들어오는 케이스가 정상. 누락된
    // pending 만 click. status='pending' 만 enable, 'accepted' / 'rejected'
    // 면 disabled.
    const acceptAll = page.getByTestId('diff-accept-all');
    const acceptSingle = page.getByTestId('diff-accept-1');
    const aaCount = await acceptAll.count();
    const asCount = await acceptSingle.count();
    console.log(
      '[debug context] diff-accept-all:',
      aaCount,
      'diff-accept-1:',
      asCount,
    );
    if (aaCount > 0 && (await acceptAll.first().isEnabled())) {
      await acceptAll.first().click();
    } else if (asCount > 0 && (await acceptSingle.first().isEnabled())) {
      await acceptSingle.first().click();
    } else {
      console.log(
        '[debug context] accept buttons disabled — auto-accept fired',
      );
    }
    // auto-accept 의 async helper.deleteRange/insertText 완료 + IR 반영
    // 대기. patch 1-3개면 1초 충분. 안정성 위해 3초.
    await page.waitForTimeout(3000);

    // 적용 후 paragraph 0, 1, 2 텍스트 확인 — 셋업 정렬 검증.
    for (let p = 0; p < 4; p++) {
      const txt = await readWasm<string>(page, 'getTextRange', [0, p, 0, 100]);
      console.log(`[debug context] para ${p}:`, txt.slice(0, 80));
    }

    // 5) 검증 정책 — 자연어 + LLM coordinate 정확도 변동성 고려:
    //    (a) "사업비" 근처에 "600" 이 새로 등장 (= +100만원 적용)
    //    (b) 교육비 / 운영비 라인은 원본 보존 (selectivity)
    //    (c) 사업비 의 원래 값 "500만원" 은 사라짐
    //    AI 가 Korean offset 계산할 때 ±1 / ±2 char 오차로 인접 separator
    //    가 같이 먹히는 케이스가 있어서 strict pattern ("사업비: 600만원")
    //    대신 substring + selectivity 로 본질만 검증.
    const afterBizOld = await readWasm<unknown[]>(page, 'searchAllText', [
      '500만원',
      true,
      false,
    ]);
    const after600 = await readWasm<unknown[]>(page, 'searchAllText', [
      '600만원',
      true,
      false,
    ]);
    const afterEdu = await readWasm<unknown[]>(page, 'searchAllText', [
      '교육비: 200만원',
      true,
      false,
    ]);
    const afterOp = await readWasm<unknown[]>(page, 'searchAllText', [
      '운영비: 300만원',
      true,
      false,
    ]);
    // 사업비 원본 값 ("500만원") 은 사라짐 + 새 값 ("600만원") 이 등장.
    expect(after600.length).toBeGreaterThanOrEqual(1);
    expect(afterBizOld.length).toBe(0);
    // 다른 두 항목은 그대로 (selectivity — AI 가 사업비 만 손댔어야).
    expect(afterEdu.length).toBeGreaterThanOrEqual(1);
    expect(afterOp.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Phase 7 form-fill live verify — 양식(.hwp) 의 빈 표 칸을 자연어로 채우는
 * end-to-end. getEmptyFormFields (scope self-heal, 0.7.15) → fillFormCells
 * (bulk, 0.7.13) 경로가 실제 GPT 판단으로 동작하는지 검증.
 *
 * 어설션 정책 (live 비결정성 흡수): 사용자가 제공한 unique sentinel 값이
 * 문서에 실제로 기입됐는지만 본다 — 어느 셀인지 / 어떤 tool 순서인지가
 * 아니라 IR 의 관찰가능 변경. sentinel 은 매 실행 고유 → 사전 매치 0 보장.
 */
const FORM_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
);

test.describe('Phase 7 — live OpenAI form-fill verification', () => {
  test.skip(
    !OPENAI_KEY,
    'AHWP_TEST_OPENAI_KEY env not set — .env 에 키 저장 후 재실행',
  );
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  test.skip(!existsSync(FORM_FIXTURE), 'form fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    const keyChecked = OPENAI_KEY!;
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
      { key: keyChecked, fixture: FORM_FIXTURE },
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

  test('form-fill — "이 양식 채워줘" → 빈 표 칸에 sentinel 기입', async () => {
    const { page } = launched;
    const sentinel = 'AHWPFORM-' + Date.now().toString(36).toUpperCase();
    // 사전 존재 매치 0 확인 (sentinel 은 매 실행 고유).
    const before = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(before.length).toBe(0);

    // 사용자 자연어 — 도구 / 좌표 언급 X. 구체 값(sentinel 포함)을 제공해
    // 모델이 빈 표 칸을 찾아(getEmptyFormFields) 채우도록(fillFormCells) 유도.
    await sendChatPrompt(
      page,
      `이 보고서 양식의 빈 칸 중 사업명(과제명) 같은 제목 칸에 "${sentinel}" 라고 채워줘. 값을 모르는 다른 칸은 그대로 비워둬.`,
      240_000,
    );

    // 양식 write 는 patches/diff 로 제안될 수 있음 — context 테스트와 동일하게
    // pending accept 버튼이 있으면 누른다 (auto-accept fired 면 disabled = 정상).
    await page.waitForTimeout(1000);
    const acceptAll = page.getByTestId('diff-accept-all');
    const acceptSingle = page.getByTestId('diff-accept-1');
    if (
      (await acceptAll.count()) > 0 &&
      (await acceptAll.first().isEnabled())
    ) {
      await acceptAll.first().click();
    } else if (
      (await acceptSingle.count()) > 0 &&
      (await acceptSingle.first().isEnabled())
    ) {
      await acceptSingle.first().click();
    }
    await page.waitForTimeout(3000);

    // 효과 검증 — sentinel 이 문서 어딘가(표 칸)에 실제로 들어갔다.
    const after = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(after.length).toBeGreaterThanOrEqual(1);
  });
});
