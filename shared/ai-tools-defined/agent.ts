/**
 * Sub-agent dispatch 도구 — defineTool migration (0.7.11).
 *
 * AI 가 자기 turn 안에서 별도 sub-agent 호출. sub-agent 는 다른 mode /
 * 도구 set / 짧은 message history 로 self-contained 작업 실행. 결과는
 * final text + tool history summary 로 parent 에 반환. context window
 * 보존 + 복잡한 다단계 작업 위임.
 *
 * **재귀 차단**: sub-agent 의 catalog 에서 `runAgent` 제외 (depth=1
 * 강제). sub-agent.ts 의 `runSubAgent` 가 자동 처리.
 *
 * **Use cases:**
 *  - "최신 보도자료 찾아서 정리해줘" → sub-agent (cross-doc-research)
 *    가 webSearch + webFetch + 요약. parent 는 응축된 결과 받아 본문
 *    작성에 활용.
 *  - "이 양식의 모든 표 구조 분석해줘" → sub-agent 가 getEmptyFormFields
 *    반복 호출 + 카테고리화. parent 는 분류 결과 받아 작업 결정.
 *  - "git log 분석해서 changelog 초안" → sub-agent 가 runCommand + 정리.
 */
import type { AhwpToolArgs } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, coerceNonNegInt } from '../ai-tool-validate';

const VALID_MODES = new Set<string>([
  'cross-doc-research',
  'free-authoring',
  'form-fill',
  'body-edit',
  'table-manipulation',
  'formatting',
]);

export const runAgent = defineTool<'runAgent', AhwpToolArgs['runAgent']>({
  name: 'runAgent',
  description:
    'Spawn a sub-agent to handle a complex sub-task autonomously. The sub-agent runs its own agent loop (its own LLM calls + tool dispatch) and returns only a final text response — its intermediate thinking and tool calls are NOT shown in your conversation. Use this for: (a) complex multi-step research that would clutter your context window (web search + multiple fetches + synthesis), (b) tasks better suited to a different mode (e.g. you are in form-fill mode but need to research external info — spawn a cross-doc-research sub-agent), (c) parallel-style work that has a clear boundary. The sub-agent shares your provider/model and operates on the same active document. It CANNOT spawn its own sub-agents (depth=1 enforced). Max 30 turns (default 10). Be specific in `prompt`: state the goal, what to extract, what format the answer should take.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        minLength: 1,
        maxLength: 4096,
        description:
          'Task instruction for the sub-agent. Be specific: goal + expected output format.',
      },
      mode: {
        type: 'string',
        enum: [
          'cross-doc-research',
          'free-authoring',
          'form-fill',
          'body-edit',
          'table-manipulation',
          'formatting',
        ],
        description:
          'Sub-agent mode. Omit to inherit parent mode. Common: cross-doc-research for external info, free-authoring for general task.',
      },
      maxTurns: {
        type: 'integer',
        minimum: 1,
        maximum: 30,
        description: 'Sub-agent max turns (default 10, cap 30).',
      },
    },
    required: ['prompt'],
  },
  readonly: false, // sub-agent 가 write 도구 사용 가능 (parent mode 가 허용 시)
  // 모든 mode 에서 사용 가능 — sub-agent dispatch 는 mode-agnostic.
  // cross-doc-research 도 노출 — research 안에서 더 깊은 research 가능.
  modes: [
    'free-authoring',
    'body-edit',
    'form-fill',
    'cross-doc-research',
    'table-manipulation',
    'formatting',
  ],
  validate(raw) {
    const prompt = raw.prompt;
    if (typeof prompt !== 'string')
      return { ok: false, reason: 'prompt-not-string' };
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return { ok: false, reason: 'prompt-empty' };
    if (byteLen(trimmed) > 4096)
      return { ok: false, reason: 'prompt-too-large' };
    const out: AhwpToolArgs['runAgent'] = { prompt: trimmed };
    if (raw.mode !== undefined) {
      if (typeof raw.mode !== 'string' || !VALID_MODES.has(raw.mode))
        return { ok: false, reason: 'mode-invalid' };
      out.mode = raw.mode as AhwpToolArgs['runAgent']['mode'];
    }
    if (raw.maxTurns !== undefined) {
      const n = coerceNonNegInt(raw.maxTurns);
      if (n === null || n < 1 || n > 30)
        return { ok: false, reason: 'maxTurns-out-of-range' };
      out.maxTurns = n;
    }
    return { ok: true, args: out };
  },
});
