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
import type { AhwpToolArgs, PlanItem, PlanItemStatus } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, coerceNonNegInt } from '../ai-tool-validate';

const PLAN_STATUSES = new Set<PlanItemStatus>([
  'pending',
  'in_progress',
  'completed',
  'skipped',
]);
const MAX_PLAN_ITEMS = 40;

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

export const updatePlan = defineTool<'updatePlan', AhwpToolArgs['updatePlan']>({
  name: 'updatePlan',
  description:
    'Maintain a checklist of the work for the current task, like a TODO list. Pass the COMPLETE plan every call (it replaces the previous one): `items` is an ordered array of { title, status } where status is "pending" | "in_progress" | "completed" | "skipped". Use it for any multi-step task, and ESPECIALLY for a large form-fill: right after your first getEmptyFormFields, lay out one item per form section/table you intend to fill (derive titles from the form\'s own structure / tableInventory, do not invent generic ones), then update statuses as you go — mark the section you are filling "in_progress", flip it to "completed" once its grounded cells are written, and "skipped" if you are intentionally leaving it for the user to provide info or for a reviewer. Keep exactly one item "in_progress" at a time. This gives the user live progress and prevents you from forgetting a section or redoing one. The runtime will not let you announce completion while items are still pending/in_progress, so finish or explicitly skip each. Read-only with respect to the document (no IR change). Skip it for trivial single-cell or single-paragraph edits.',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        maxItems: MAX_PLAN_ITEMS,
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', minLength: 1, maxLength: 200 },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed', 'skipped'],
            },
          },
          required: ['title', 'status'],
        },
      },
    },
    required: ['items'],
  },
  readonly: true,
  validate(raw) {
    if (!Array.isArray(raw.items))
      return { ok: false, reason: 'items-not-array' };
    if (raw.items.length > MAX_PLAN_ITEMS)
      return { ok: false, reason: 'items-too-many' };
    const items: PlanItem[] = [];
    for (const it of raw.items) {
      if (!it || typeof it !== 'object')
        return { ok: false, reason: 'item-not-object' };
      const rec = it as Record<string, unknown>;
      const title = typeof rec.title === 'string' ? rec.title.trim() : '';
      if (title.length === 0) return { ok: false, reason: 'item-title-empty' };
      if (byteLen(title) > 400)
        return { ok: false, reason: 'item-title-too-large' };
      if (
        typeof rec.status !== 'string' ||
        !PLAN_STATUSES.has(rec.status as PlanItemStatus)
      )
        return { ok: false, reason: 'item-status-invalid' };
      items.push({ title, status: rec.status as PlanItemStatus });
    }
    return { ok: true, args: { items } };
  },
});
