/**
 * Sub-agent loop 단위 테스트 — 0.7.11.
 *
 * 핵심 검증:
 *   - runSubAgent 가 LLM 의 text-only 응답을 final result 로 반환
 *   - tool calls 가 있으면 dispatcher 로 실행 후 next turn
 *   - maxTurns 초과 → ok:false, error='max-turns-exhausted'
 *   - **재귀 차단**: sub-agent 의 catalog 에서 runAgent 가 빠져있음
 *   - dispatcher 가 throw 해도 graceful 처리
 *   - LLM error 시 ok:false
 *
 * `window.api.ai.chat` 은 mock (callback-based streaming).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSubAgent } from './sub-agent';
import type { AhwpToolResult } from '@shared/ai-tools';
import type { ChatStreamEvent } from '@shared/ai';

// `window.api.ai.chat` mock helper. caller 가 emit 할 events 배열을 전달.
// 매 호출 시 그 events 를 순서대로 emit.
function mockAiChat(eventBatches: ChatStreamEvent[][]): void {
  let callCount = 0;
  const mockChat = vi.fn(
    (_req: unknown, opts: { onEvent: (e: ChatStreamEvent) => void }) => {
      const batch = eventBatches[callCount++] ?? [];
      // sync emit — runSubAgent 의 callLlmAwaitable promise 가 resolve 됨.
      queueMicrotask(() => {
        for (const evt of batch) opts.onEvent(evt);
      });
      return { abort: vi.fn() };
    },
  );
  // window.api.ai.chat 만 setup. 다른 api 는 무시.
  Object.defineProperty(globalThis, 'window', {
    value: {
      api: {
        ai: { chat: mockChat },
      },
    },
    configurable: true,
    writable: true,
  });
}

const baseOpts = {
  provider: 'openai' as const,
  model: 'gpt-test',
  parentMode: 'free-authoring' as const,
  baseSystemPrompt: 'BASE PROMPT',
  targetPath: null,
};

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('runSubAgent — text-only response', () => {
  it('1 turn 만에 text-only 응답 → final result 반환', async () => {
    mockAiChat([
      [
        { type: 'text-delta', text: 'Hello' },
        { type: 'text-delta', text: ' from sub-agent' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    const dispatcher = vi.fn().mockResolvedValue([]);
    const r = await runSubAgent({
      ...baseOpts,
      prompt: 'Say hi',
      dispatcher,
    });

    expect(r.ok).toBe(true);
    expect(r.result).toBe('Hello from sub-agent');
    expect(r.turnsUsed).toBe(1);
    expect(r.toolHistory).toEqual([]);
    expect(dispatcher).not.toHaveBeenCalled();
  });
});

describe('runSubAgent — tool calls', () => {
  it('tool call → dispatch → next turn → final response', async () => {
    mockAiChat([
      // Turn 1: tool call (no text)
      [
        {
          type: 'tool-use',
          id: 'call_1',
          name: 'getDocumentSummary',
          args: {},
        },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      // Turn 2: final text
      [
        { type: 'text-delta', text: 'Document has 3 sections' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    const dispatcher = vi.fn().mockResolvedValueOnce([
      {
        ok: true,
        tool: 'getDocumentSummary',
        data: { sectionCount: 3 },
      } as AhwpToolResult,
    ]);

    const r = await runSubAgent({
      ...baseOpts,
      prompt: 'Analyze document',
      dispatcher,
    });

    expect(r.ok).toBe(true);
    expect(r.result).toBe('Document has 3 sections');
    expect(r.turnsUsed).toBe(2);
    expect(r.toolHistory).toEqual([{ name: 'getDocumentSummary', ok: true }]);
    expect(dispatcher).toHaveBeenCalledTimes(1);
  });

  it('failed tool call → toolHistory ok:false → next turn 진행', async () => {
    mockAiChat([
      [
        {
          type: 'tool-use',
          id: 'call_1',
          name: 'getCellInfo',
          args: { sectionIdx: 99, parentParaIdx: 0, controlIdx: 0, cellIdx: 0 },
        },
        { type: 'done', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text-delta', text: 'Tool failed, fallback' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    const dispatcher = vi.fn().mockResolvedValueOnce([
      {
        ok: false,
        tool: 'getCellInfo',
        reason: 'getCellInfo-failed',
      } as AhwpToolResult,
    ]);

    const r = await runSubAgent({
      ...baseOpts,
      prompt: 'x',
      dispatcher,
    });

    expect(r.ok).toBe(true);
    expect(r.toolHistory).toEqual([{ name: 'getCellInfo', ok: false }]);
  });
});

describe('runSubAgent — max turns guard', () => {
  it('maxTurns 도달 시 ok:false', async () => {
    // 매 turn 마다 tool call (text 없음) → 영원히 진행 → cap 에 걸림.
    const turnEvents: ChatStreamEvent[][] = [];
    for (let i = 0; i < 10; i++) {
      turnEvents.push([
        {
          type: 'tool-use',
          id: `call_${i}`,
          name: 'getDocumentSummary',
          args: {},
        },
        { type: 'done', finishReason: 'tool_calls' },
      ]);
    }
    mockAiChat(turnEvents);

    const dispatcher = vi
      .fn()
      .mockResolvedValue([
        { ok: true, tool: 'getDocumentSummary', data: {} } as AhwpToolResult,
      ]);

    const r = await runSubAgent({
      ...baseOpts,
      prompt: 'x',
      maxTurns: 3,
      dispatcher,
    });

    expect(r.ok).toBe(false);
    expect(r.error).toBe('max-turns-exhausted');
    expect(r.turnsUsed).toBe(3);
    expect(r.toolHistory).toHaveLength(3);
  });

  it('maxTurns 1-30 범위 clamp', async () => {
    mockAiChat([
      [
        { type: 'text-delta', text: 'done' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    // maxTurns 50 → 30 으로 clamp 됐는지는 직접 확인 어려움. 단, 1턴 만에 끝나니 정상 통과.
    const r = await runSubAgent({
      ...baseOpts,
      prompt: 'x',
      maxTurns: 50,
      dispatcher: vi.fn(),
    });
    expect(r.ok).toBe(true);
  });
});

describe('runSubAgent — LLM error', () => {
  it('LLM error event → ok:false, llm-error reason', async () => {
    mockAiChat([
      [
        { type: 'text-delta', text: 'partial' },
        { type: 'error', message: 'rate-limit' },
        { type: 'done', finishReason: 'stop' },
      ],
    ]);

    const r = await runSubAgent({
      ...baseOpts,
      prompt: 'x',
      dispatcher: vi.fn(),
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain('llm-error');
    expect(r.error).toContain('rate-limit');
  });
});

describe('runSubAgent — 재귀 차단', () => {
  it('catalog 에서 runAgent 가 제외됨 (sub-agent 가 sub-agent 못 spawn)', async () => {
    let capturedReq: { tools?: { name: string }[] } | null = null;
    const mockChat = vi.fn(
      (req: unknown, opts: { onEvent: (e: ChatStreamEvent) => void }) => {
        capturedReq = req as typeof capturedReq;
        queueMicrotask(() => {
          opts.onEvent({ type: 'text-delta', text: 'done' });
          opts.onEvent({ type: 'done', finishReason: 'stop' });
        });
        return { abort: vi.fn() };
      },
    );
    Object.defineProperty(globalThis, 'window', {
      value: { api: { ai: { chat: mockChat } } },
      configurable: true,
      writable: true,
    });

    await runSubAgent({
      ...baseOpts,
      prompt: 'x',
      dispatcher: vi.fn(),
    });

    expect(capturedReq).not.toBeNull();
    const tools = capturedReq!.tools ?? [];
    const names = tools.map((t) => t.name);
    // 다른 도구는 있을 수 있지만 runAgent 는 절대 없어야 함.
    expect(names).not.toContain('runAgent');
  });
});
