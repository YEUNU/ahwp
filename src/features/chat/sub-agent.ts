/**
 * Sub-agent dispatch — 0.7.11.
 *
 * AI 의 `runAgent` 도구의 구현. parent agent 가 sub-agent 를 spawn 해서
 * 별도 mode / 도구 set / 짧은 message history 로 self-contained 작업
 * 실행. 결과는 final text + tool history summary 로 받음 — parent 의
 * context window 에 sub-agent 의 thinking / 중간 tool calls 노출 없음.
 *
 * **재귀 차단**: sub-agent 의 catalog 에서 `runAgent` 제외 (depth=1 강제).
 *
 * **실행 위치**: renderer-side (본 파일). main process 가 아닌 이유:
 * sub-agent 도 tool dispatcher (renderer 의 `runTools`) 를 그대로 사용
 * 해야 viewer / bridge / IPC 에 접근 가능. main 에서 실행하면 IPC
 * round-trip 폭증.
 *
 * **streaming → Promise 어댑터**: `window.api.ai.chat(req, {onEvent})`
 * 는 streaming. sub-agent 의 매 turn 의 final response 를 모아야 하므로
 * `callLlmAwaitable` 헬퍼로 wrap.
 */
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ChatTool,
  ProviderId,
} from '@shared/ai';
import type {
  AhwpToolResult,
  AhwpPreflightItem,
  AhwpToolCall,
} from '@shared/ai-tools';
import {
  getAhwpToolCatalog,
  validateToolCall,
  isReadOnlyTool,
} from '@shared/ai-tools';
import type { ModeContext, TaskMode } from '@shared/ai-modes';
import { appendModePrompt } from './prompts';

export interface RunSubAgentOptions {
  /** Sub-agent 가 받을 task instruction. */
  prompt: string;
  /** Sub-agent 의 mode. null/undefined 면 parent mode 사용. */
  mode?: TaskMode | null;
  /** Max turns (1-30). 기본 10. */
  maxTurns?: number;
  /** Parent 의 provider (sub-agent 도 동일 provider 사용). */
  provider: ProviderId;
  /** Parent 의 model. */
  model: string;
  /** Parent 의 mode — sub-agent 가 mode 지정 안 했을 때 fallback. */
  parentMode: TaskMode;
  /**
   * Tool dispatcher — sub-agent 의 tool calls 를 실제 IR / IPC 로 보낼
   * 함수. parent 의 `runTools` 를 그대로 전달.
   */
  dispatcher: (
    items: AhwpPreflightItem[],
    targetPath?: string | null,
  ) => Promise<AhwpToolResult[]>;
  /** Active doc path (parent 의 turnTargetPathRef). null 이면 dispatcher 가
   *  자체 결정. */
  targetPath?: string | null;
  /** Sub-agent 가 사용할 base system prompt (parent 의 SYSTEM_PROMPT_AGENT_GUIDE 등). */
  baseSystemPrompt: string;
}

export interface RunSubAgentResult {
  ok: boolean;
  /** Sub-agent 의 final text response. */
  result?: string;
  /** 실제 사용한 turns 수. */
  turnsUsed: number;
  /** 실패 / 종료 사유. */
  error?: string;
  /** Sub-agent 가 호출한 도구 요약 (name + ok). 디버깅 / parent context 보강. */
  toolHistory: { name: string; ok: boolean }[];
}

/**
 * Sub-agent 의 system prompt. parent 의 base guide 위에 mode 별
 * promptFragment + sub-agent 전용 안내.
 *
 * sub-agent 가 알아야 할 핵심:
 *   - 자기 결과가 parent 에게 final text 로 전달됨 — 명확하고 응축된 응답
 *   - 별도 LLM call 이라 비용 발생 → 효율적으로 작업
 *   - tool calls 의 중간 thinking 은 parent 에 안 보임 → 자기 안에서 완결
 */
function buildSubAgentSystemPrompt(
  baseSystemPrompt: string,
  modeCtx: ModeContext,
): string {
  const subAgentDirective = `\n\n#### SUB-AGENT MODE\n\nYou are a sub-agent spawned by a parent agent. Your final text response will be returned to the parent as your complete output — the parent does NOT see your intermediate thinking or tool calls. Therefore:\n\n1. Stay focused on the parent's instruction. Do exactly what was asked, no more, no less.\n2. Use tools efficiently — every call is a real LLM turn. Avoid redundant reads.\n3. Your final response should be self-contained: include the key findings / extracted facts / completed actions. The parent will quote or reference your output.\n4. Cite sources when applicable (URLs, file paths) so the parent can verify.\n5. If the task is impossible or ambiguous, say so briefly and stop — don't fabricate.\n6. Maximum ${30} turns enforced; stay well under for typical tasks.`;
  return appendModePrompt(baseSystemPrompt, modeCtx) + subAgentDirective;
}

/**
 * Streaming `window.api.ai.chat` → Promise. 매 turn 의 응답을 한 번에
 * 받아서 next turn 결정.
 */
function callLlmAwaitable(req: ChatRequest): Promise<{
  text: string;
  toolCalls: { id: string; name: string; args: unknown }[];
  finishReason: string;
}> {
  return new Promise((resolve, reject) => {
    let text = '';
    const toolCalls: { id: string; name: string; args: unknown }[] = [];
    let finishReason = 'stop';
    try {
      window.api.ai.chat(req, {
        onEvent: (evt: ChatStreamEvent) => {
          if (evt.type === 'text-delta') {
            text += evt.text;
          } else if (evt.type === 'tool-use') {
            toolCalls.push({ id: evt.id, name: evt.name, args: evt.args });
          } else if (evt.type === 'done') {
            finishReason = evt.finishReason ?? 'stop';
            resolve({ text, toolCalls, finishReason });
          } else if (evt.type === 'error') {
            reject(new Error(evt.message));
          }
        },
      });
    } catch (err) {
      reject(err as Error);
    }
  });
}

/**
 * Sub-agent loop 실행.
 *
 * 작동 흐름:
 *   1. Sub-agent system prompt 조립 (parent base + mode + sub-agent
 *      directive)
 *   2. messages = [system, user(prompt)]
 *   3. for turn in 0..maxTurns:
 *      - LLM 호출 (catalog = mode 의 tools, runAgent 제외)
 *      - response.toolCalls 비어있고 text 있음 → 종료, result=text
 *      - toolCalls 있음 → dispatcher 로 실행 → tool_result 메시지 추가 →
 *        next turn
 *   4. maxTurns 도달 → ok:false, error='max-turns-exhausted'
 *
 * Provider tool-use API 의 message 형식 (toolUses / toolResult) 은 parent
 * 의 fireChat 와 동일 — 같은 OpenAI / Gemini adapter 가 처리.
 */
export async function runSubAgent(
  opts: RunSubAgentOptions,
): Promise<RunSubAgentResult> {
  const maxTurns = Math.min(Math.max(opts.maxTurns ?? 10, 1), 30);
  const effectiveMode: TaskMode = opts.mode ?? opts.parentMode;
  const modeCtx: ModeContext = {
    primary: effectiveMode,
    addons: [],
    source: 'user-override',
    reason: `sub-agent invocation (parent=${opts.parentMode})`,
  };

  // Sub-agent 의 tool catalog. runAgent 는 제외 — 재귀 차단.
  const baseCatalog = getAhwpToolCatalog(modeCtx);
  const tools: ChatTool[] = baseCatalog
    .filter((d) => d.name !== 'runAgent')
    .map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
    }));

  const systemPrompt = buildSubAgentSystemPrompt(
    opts.baseSystemPrompt,
    modeCtx,
  );

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: opts.prompt },
  ];

  const toolHistory: { name: string; ok: boolean }[] = [];
  let turnsUsed = 0;

  for (let turn = 0; turn < maxTurns; turn++) {
    turnsUsed = turn + 1;
    const req: ChatRequest = {
      provider: opts.provider,
      model: opts.model,
      messages,
      tools,
      toolChoice: 'auto',
      modeContext: modeCtx,
      reasoningEffort: 'low',
    };

    let response: {
      text: string;
      toolCalls: typeof toolHistory extends never[]
        ? never
        : { id: string; name: string; args: unknown }[];
      finishReason: string;
    };
    try {
      response = await callLlmAwaitable(req);
    } catch (err) {
      return {
        ok: false,
        error: `llm-error:${(err as Error).message ?? String(err)}`,
        turnsUsed,
        toolHistory,
      };
    }

    // Tool 호출 없음 + text 있음 → 종료
    if (response.toolCalls.length === 0) {
      // text 가 비어도 종료 (사용자에게는 empty result 보고).
      return {
        ok: true,
        result: response.text.trim(),
        turnsUsed,
        toolHistory,
      };
    }

    // Tool 호출 → dispatch
    messages.push({
      role: 'assistant',
      content: response.text,
      toolUses: response.toolCalls.map((c) => ({
        id: c.id,
        name: c.name,
        args: c.args,
      })),
    });

    // 0.7.31 — dispatch: parent 의 advanceAgentLoop 패턴 미러. read-only 도구
    // 는 병렬(Promise.all, IR 무변경이라 안전), write/invalid 는 순차(IR race
    // + undo 그룹 보존). 결과는 call.id 로 모은 뒤 원래 순서로 메시지 조립.
    const dispatchOne = async (
      call: (typeof response.toolCalls)[number],
    ): Promise<AhwpToolResult> => {
      const v = validateToolCall({ tool: call.name, args: call.args });
      if (!v.ok) return { ok: false, tool: call.name, reason: v.reason };
      try {
        const out = await opts.dispatcher(
          [{ ok: true, call: v.value as AhwpToolCall }],
          opts.targetPath ?? null,
        );
        return (
          out[0] ?? { ok: false, tool: call.name, reason: 'dispatcher-empty' }
        );
      } catch (err) {
        return {
          ok: false,
          tool: call.name,
          reason: `dispatch-threw:${(err as Error).message ?? String(err)}`,
        };
      }
    };

    const resultById = new Map<string, AhwpToolResult>();
    // read-only → 병렬.
    const reads = response.toolCalls.filter((c) => isReadOnlyTool(c.name));
    await Promise.all(
      reads.map(async (call) => {
        resultById.set(call.id, await dispatchOne(call));
      }),
    );
    // write / 기타 → 순차 (원래 순서 보존).
    for (const call of response.toolCalls) {
      if (resultById.has(call.id)) continue;
      resultById.set(call.id, await dispatchOne(call));
    }

    // 원래 순서로 toolHistory + tool result 메시지 조립.
    for (const call of response.toolCalls) {
      const result =
        resultById.get(call.id) ??
        ({ ok: false, tool: call.name, reason: 'no-result' } as AhwpToolResult);
      toolHistory.push({ name: call.name, ok: result.ok });

      // Tool result message — parent 의 advanceAgentLoop 와 동일 형식.
      let content: string;
      if (result.ok) {
        if ('data' in result && result.data !== undefined) {
          try {
            content = JSON.stringify(result.data).slice(0, 8192);
          } catch {
            content = `ok: ${call.name}`;
          }
        } else {
          content = `ok: ${call.name}`;
        }
      } else {
        content = `error: ${result.reason ?? 'unknown'}`;
      }
      messages.push({
        role: 'tool',
        content,
        toolResult: {
          id: call.id,
          content,
          isError: !result.ok,
        },
      });
    }
  }

  return {
    ok: false,
    error: 'max-turns-exhausted',
    turnsUsed,
    toolHistory,
  };
}

// 별도 export — 테스트가 dispatcher / LLM 호출을 inject 할 수 있도록.
// 실제 production 호출은 runSubAgent 가 직접 window.api.ai.chat 사용.
export { callLlmAwaitable, buildSubAgentSystemPrompt };
