/**
 * Tool router 단위 테스트 — mode-aware essentials (0.7.28) 중심.
 *
 * 핵심 회귀: form-fill 모드에서 라우터가 좁힌 subset 에 replaceTextInCell /
 * getPageSvg / getTextRange 가 빠지면, 0.7.25 시각 self-verification loop 와
 * placeholder/오기입 수정이 호출 불가가 된다. mode==='form-fill' 일 때 이
 * 셋이 항상 보장돼야 한다.
 *
 * 라우터는 window.api.ai.chat 으로 LLM 을 부르므로, 그 streaming 호출을
 * stub 으로 주입해 결정적으로 테스트한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatStreamEvent } from '@shared/ai';
import { selectToolsViaLlm, resetRouterCache } from './toolRouter';

/** window.api.ai.chat 을 stub — onEvent 로 주어진 router 응답 텍스트를
 *  text-delta + done 으로 emit. */
function stubRouterChat(responseText: string): void {
  const api = {
    ai: {
      chat: (
        _req: unknown,
        handlers: { onEvent: (e: ChatStreamEvent) => void },
      ) => {
        queueMicrotask(() => {
          handlers.onEvent({ type: 'text-delta', text: responseText });
          handlers.onEvent({ type: 'done', finishReason: 'stop' });
        });
        return { abort: () => {} };
      },
    },
  };
  (globalThis as unknown as { window: { api: typeof api } }).window = { api };
}

const baseOpts = {
  history: [{ role: 'user' as const, content: '양식 채워줘' }],
  provider: 'openai',
  model: 'gpt-x',
  hasKey: true,
};

describe('selectToolsViaLlm — mode-aware essentials (0.7.28)', () => {
  beforeEach(() => resetRouterCache());
  afterEach(() => {
    resetRouterCache();
    vi.restoreAllMocks();
  });

  it('form-fill 모드 → replaceTextInCell / getPageSvg / getTextRange 보장', async () => {
    // 라우터가 좁은 subset 만 골라도 essentials 가 union 돼야.
    stubRouterChat('["getEmptyFormFields","fillFormCells"]');
    const r = await selectToolsViaLlm({ ...baseOpts, mode: 'form-fill' });
    expect(r.isFullCatalog).toBe(false);
    expect(r.tools).toContain('replaceTextInCell');
    expect(r.tools).toContain('getPageSvg');
    expect(r.tools).toContain('getTextRange');
    expect(r.tools).toContain('updatePlan');
    // 글로벌 ALWAYS_INCLUDE 도 그대로.
    expect(r.tools).toContain('getEmptyFormFields');
    expect(r.tools).toContain('fillFormCells');
  });

  it('비-form 모드 → essentials 강제 안 함 (bloat 없음)', async () => {
    stubRouterChat('["insertText"]');
    const r = await selectToolsViaLlm({
      ...baseOpts,
      mode: 'free-authoring',
    });
    expect(r.isFullCatalog).toBe(false);
    // 라우터가 안 골랐고 form-fill 도 아니므로 getPageSvg 강제 안 됨.
    expect(r.tools).not.toContain('getPageSvg');
    // 단, 라우터가 명시한 것 + 글로벌 ALWAYS_INCLUDE 는 포함.
    expect(r.tools).toContain('insertText');
    expect(r.tools).toContain('getEmptyFormFields'); // 글로벌
  });

  it('router 가 essentials 를 명시해도 중복 없이 1회 (mode 무관)', async () => {
    stubRouterChat('["getPageSvg","getPageSvg","replaceTextInCell"]');
    const r = await selectToolsViaLlm({ ...baseOpts, mode: 'form-fill' });
    const svgCount = r.tools.filter((t) => t === 'getPageSvg').length;
    expect(svgCount).toBe(1);
  });

  it('빈 query → full-catalog fallback (essentials 는 그 안에 이미 포함)', async () => {
    const r = await selectToolsViaLlm({
      ...baseOpts,
      history: [{ role: 'user', content: '   ' }],
      mode: 'form-fill',
    });
    expect(r.isFullCatalog).toBe(true);
    expect(r.reason).toBe('empty-query');
    expect(r.tools).toContain('getPageSvg');
  });

  it('키 없음 → full-catalog fallback', async () => {
    const r = await selectToolsViaLlm({
      ...baseOpts,
      hasKey: false,
      mode: 'form-fill',
    });
    expect(r.isFullCatalog).toBe(true);
    expect(r.reason).toBe('no-key');
  });

  it('router 응답 파싱 실패 → full-catalog fallback', async () => {
    stubRouterChat('이건 JSON 배열이 아니에요');
    const r = await selectToolsViaLlm({ ...baseOpts, mode: 'form-fill' });
    expect(r.isFullCatalog).toBe(true);
    expect(r.reason).toBe('router-parse-failed');
  });

  it('mode 가 cache key 에 포함 — 같은 query 라도 mode 다르면 분리', async () => {
    stubRouterChat('["insertText"]');
    const formFill = await selectToolsViaLlm({
      ...baseOpts,
      mode: 'form-fill',
    });
    // 같은 query/history, 다른 mode → cache hit 가 아니라 재계산(essentials 차이).
    stubRouterChat('["insertText"]');
    const free = await selectToolsViaLlm({
      ...baseOpts,
      mode: 'free-authoring',
    });
    expect(formFill.tools).toContain('getPageSvg');
    expect(free.tools).not.toContain('getPageSvg');
  });

  // 0.7.41 — 라우터가 도구와 함께 coarse intent 를 분류. `intent: <...>` 줄을
  // 도구 배열과 독립적으로 파싱(배열 프로토콜·폴백 무손상).
  describe('intent classification (0.7.41)', () => {
    it('`intent: audit` 줄 → r.intent==="audit", 도구 배열은 그대로 파싱', async () => {
      stubRouterChat('intent: audit\n["getEmptyFormFields","getPageSvg"]');
      const r = await selectToolsViaLlm({ ...baseOpts, mode: 'form-fill' });
      expect(r.intent).toBe('audit');
      expect(r.isFullCatalog).toBe(false);
      expect(r.tools).toContain('getEmptyFormFields');
    });

    it('`intent: fill` 줄 → r.intent==="fill"', async () => {
      stubRouterChat('intent: fill\n["fillFormCells"]');
      const r = await selectToolsViaLlm({ ...baseOpts, mode: 'form-fill' });
      expect(r.intent).toBe('fill');
    });

    it('intent 줄 없는 legacy bare-array → "unknown" (하위호환)', async () => {
      stubRouterChat('["insertText"]');
      const r = await selectToolsViaLlm({ ...baseOpts, mode: 'form-fill' });
      expect(r.intent).toBe('unknown');
      expect(r.tools).toContain('insertText');
    });

    it('폴백(빈 query)도 intent "unknown"', async () => {
      const r = await selectToolsViaLlm({
        ...baseOpts,
        history: [{ role: 'user', content: '   ' }],
      });
      expect(r.isFullCatalog).toBe(true);
      expect(r.intent).toBe('unknown');
    });
  });
});
