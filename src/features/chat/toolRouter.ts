/**
 * LLM 기반 tool 라우터 — chunk 98 (heuristic v0) → chunk 99 (LLM v1).
 *
 * 사용자 query 를 보고 다음 turn 에 필요한 도구 부분집합을 결정. 60+ 의
 * tool catalog 가 매 turn LLM 에 다 들어가는 것을 막아 (a) request body
 * 가 너무 커서 stall 하는 일부 NIM 호스팅 모델 회피, (b) 모델이 도구 후보
 * 너무 많아 호출 정확도 떨어지는 문제 완화.
 *
 * 디자인 원칙:
 * - **사용자 선택 모델 그대로**: 별도 router 모델 (작은 모델 등) 없음.
 *   사용자가 chat-model-input 에서 고른 모델이 router 도 담당.
 * - **결정 LLM 호출은 1회**: router 응답은 짧은 JSON 배열만. 도구 카탈로그
 *   요약 (이름 + 1줄 설명) 을 system prompt 에 박고, user 질의 → JSON
 *   답변. tool_use API 없이 평문 응답으로 처리 (overhead 최소).
 * - **Fail-safe**: timeout / parse error / 빈 응답 / 키 없음 → full
 *   catalog fallback. Router 실패가 turn 자체를 막지 않게.
 * - **Multi-turn 일관**: latest user 메시지 한 번만 보고 결정. 같은 turn
 *   안에서는 selection 변하지 않음.
 */
import type { ChatMessage, ChatRequest, ChatStreamEvent } from '@shared/ai';
import { AHWP_TOOL_NAMES, type AhwpToolName } from '@shared/ai-tools';
import { getAhwpToolCatalog } from '@shared/ai-tools';

const ROUTER_TIMEOUT_MS = 30_000;

/** 매 turn 항상 포함되는 도구 — 위치 / 구조 / 양식 파악과 가장 기본적인
 *  본문 편집은 어떤 작업에서도 흔히 필요. router LLM 이 빠뜨려도 이 set
 *  은 보장. getEmptyFormFields + fillFormCells (+ insertTextInCell) 는
 *  form-fill workflow 의 축 — 빠지면 모델이 patches block (text) 으로
 *  우회하면서 agent loop 가 한 turn 만에 종료되는 회귀가 생김 (0.6.14 가드). */
const ALWAYS_INCLUDE: readonly AhwpToolName[] = [
  'getCaretPosition',
  'getDocumentOutline',
  'getDocumentSummary',
  'getEmptyFormFields',
  'findInDocument',
  'insertText',
  'insertTextInCell',
  'fillFormCells',
  'applyHtml',
];

/** Form-fill 모드에서 라우터가 빠뜨리면 안 되는 추가 핵심 도구. 글로벌
 *  ALWAYS_INCLUDE 의 getEmptyFormFields / fillFormCells / insertTextInCell
 *  에 더해, 양식 작성의 나머지 축을 보장한다:
 *  - replaceTextInCell — instruction placeholder 교체 / 오기입 수정
 *  - getPageSvg — 0.7.25 시각 self-verification (모델이 렌더를 보고 검증)
 *  - getTextRange — 표 주변 footnote / legend 의 값 어휘·척도 제약 읽기
 *  이게 라우터에 의해 빠지면 self-verification loop 와 수정 자체가 호출
 *  불가가 되어 form-fill 품질 가드가 무력화된다. form-fill 모드에서만
 *  추가 (다른 작업엔 router subset 그대로 — bloat 없음). */
const FORM_FILL_ESSENTIAL: readonly AhwpToolName[] = [
  'replaceTextInCell',
  'getPageSvg',
  'getTextRange',
  // 0.7.29 — 대형 양식 진행 추적(TodoWrite analog). 라우터가 빠뜨리면
  // 모델이 계획을 못 세우고 form-guard 의 plan 완료 게이트도 무의미.
  'updatePlan',
];

/**
 * 0.7.41 — 사용자 task 의 coarse intent. 라우터가 도구와 함께 분류한다.
 * 문서 모양(빈 셀 수)만 보는 detectMode 와 달리 **사용자 메시지의 실제
 * 의도**를 읽어, 양식 문서에 대한 "읽고 검토/누락 확인"(audit)을 "채워줘"
 * (fill)와 구분한다. form-guard 가 이 신호로 완료 nudge 를 게이팅 —
 * audit 이면 채우기 auto-continue 를 아예 돌리지 않는다. 분류 실패/폴백 시
 * 'unknown' → 기존 동작 보존(doc-shape 기반).
 */
export type RouterIntent = 'fill' | 'audit' | 'edit' | 'author' | 'unknown';

export interface ToolSelectionResult {
  /** Selected tool name set. Non-empty (full catalog on fallback). */
  tools: AhwpToolName[];
  /** 0.7.41 — 라우터가 분류한 coarse user intent. 폴백 시 'unknown'. */
  intent: RouterIntent;
  /** True when fallback (router failed or no key). */
  isFullCatalog: boolean;
  /** Reason when fallback. 'router-ok' / 'router-empty' /
   *  'router-timeout' / 'router-error' / 'router-parse-failed' /
   *  'no-key' / 'empty-query'. Useful for telemetry / debug. */
  reason: string;
  /** Latency of the router call (ms). 0 when fallback before LLM call. */
  latencyMs: number;
}

function lastUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

/** Build the router's system prompt — tool name + 1-line description
 *  for each tool in the catalog. The router LLM picks names from this
 *  list. Keep concise: descriptions are truncated to ~60 chars to fit
 *  the prompt within ~4KB. */
function buildRouterSystemPrompt(): string {
  const catalog = getAhwpToolCatalog();
  const lines = catalog.map((d) => {
    // First sentence (up to first '.' or '。') or first 80 chars.
    const desc = d.description;
    const first = desc.split(/[.。]/)[0]?.trim() ?? desc.trim().slice(0, 80);
    const trimmed = first.length > 80 ? first.slice(0, 80) + '…' : first;
    return `- ${d.name}: ${trimmed}`;
  });
  return [
    'You are the tool router for a Hancom HWP document-editing Agent. Given the user query plus the tool-call history so far, pick the subset of tool names needed for the *next* turn, and classify the user intent.',
    '',
    'Response rules:',
    '- Reply with exactly two lines and nothing else (no prose, no markdown, no explanation).',
    '- Line 1: `intent: <fill|audit|edit|author>` — classify what the user is asking for:',
    '    - fill = complete / populate a form or template (fill cells, write the report into its slots).',
    '    - audit = REVIEW or inspect the document WITHOUT changing it — identify which cells are unfilled, judge whether blanks are intentional or genuine omissions, check / verify / proof-read. The user wants a report, not edits.',
    '    - edit = modify existing body text (rewrite, translate, polish, fix wording).',
    '    - author = write new free-form content into an empty / non-form document.',
    '- Line 2: a single JSON array of tool names.',
    '- Example:',
    '    intent: fill',
    '    ["getEmptyFormFields","fillFormCells","getPageSvg"]',
    '- If the intent is genuinely ambiguous, use `intent: fill` and return [] on line 2 (full-catalog fallback).',
    '- Use tool names exactly as listed below. Do not invent or transform names.',
    '- For clear-intent turns, narrow to 5-15 names. Picking too many hurts main-model accuracy.',
    '- If the user references a doc that is not attached, include search/read tools.',
    '',
    '#### Phase principles (when tool history is provided)',
    '- Empty history (turn 1): decide from the user query alone. If coordinates / structure are unknown, lean toward read tools.',
    '- Recent history is mostly reads and enough coordinate / structure info has been gathered: shift toward write tools.',
    '- Recent history contains writes: prefer verify reads (getTextRange / getCharPropertiesAt etc.). Avoid repeating the same write.',
    '- A read returned empty or insufficient: try a different read (e.g. getDocumentOutline empty → getDocumentSummary).',
    '- Same tool failed multiple times in history: recommend an alternative approach.',
    '',
    'Tool catalog (name: description):',
    ...lines,
  ].join('\n');
}

/** Tool call history entry — Agent loop 누적. router 가 phase 판단에 사용. */
export interface RouterToolHistoryEntry {
  name: string;
  ok: boolean;
  /** 결과 또는 reason 의 짧은 요약 (≤120 chars). null 가능. */
  summary?: string;
}

/** Build the user-side prompt — query + (optional) tool call history.
 *  History 가 있으면 router 가 phase 판단을 할 수 있게 도와. */
function buildRouterUserPrompt(
  userText: string,
  history: readonly RouterToolHistoryEntry[],
): string {
  if (history.length === 0) return userText;
  const lines: string[] = [`User query: ${userText}`, '', 'Tool-call history:'];
  // Tail-only — older calls are weak signal. Saves tokens.
  const tail = history.slice(-12);
  for (const e of tail) {
    const status = e.ok ? '✓' : '✗';
    const summary = e.summary ? ` — ${e.summary.slice(0, 120)}` : '';
    lines.push(`${status} ${e.name}${summary}`);
  }
  return lines.join('\n');
}

/** Parse the router's response — expect a JSON array of tool names.
 *  Tolerates leading / trailing whitespace, code fences, prose around
 *  the array, and bracket-balanced extraction. Returns null when no
 *  parseable array found. */
function parseRouterResponse(raw: string): string[] | null {
  // Strip code fences (```json ... ``` / ``` ... ```), thinking tags
  // (<think>...</think> from some reasoning models), bullet prefixes.
  let cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```json\s*/gi, '')
    .replace(/```/g, '')
    .trim();
  // Strip leading "Answer:" / "도구 목록:" 같은 안내.
  cleaned = cleaned.replace(/^[^[]+(?=\[)/m, '').trim();

  // Direct parse — full text is JSON array.
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
  } catch {
    /* try bracket extraction below */
  }

  // Bracket-balanced extraction — find the FIRST balanced [...] in the
  // text. Robust against arrays-of-strings even with embedded commas.
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '[') depth += 1;
    else if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    const parsed = JSON.parse(candidate);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x));
  } catch {
    /* fallthrough to last-ditch parse */
  }

  // Last-ditch: extract all "quoted" identifiers between the brackets.
  // Useful when the model writes ['name', 'other'] with single quotes
  // or trailing commas that JSON.parse rejects.
  const inner = candidate.slice(1, -1);
  const ids = inner
    .split(/[,\n]/)
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s));
  return ids.length > 0 ? ids : null;
}

/** 0.7.41 — 라우터 응답의 `intent: <...>` 줄을 스캔. 도구 배열 파싱
 *  (parseRouterResponse) 과 독립적이라 배열 프로토콜·폴백을 건드리지 않는다.
 *  intent 줄이 없거나 알 수 없는 값이면 'unknown'. */
const INTENT_RE = /\bintent\s*[:=]\s*["']?(fill|audit|edit|author)\b/i;
function parseRouterIntent(raw: string): RouterIntent {
  const m = INTENT_RE.exec(raw);
  return (m ? (m[1].toLowerCase() as RouterIntent) : 'unknown') as RouterIntent;
}

/** Filter raw names down to known AhwpToolName values + always-include
 *  set (+ form-fill essentials when in form-fill mode). Discards unknowns
 *  silently. */
function normalizeSelection(raw: string[], mode?: string): AhwpToolName[] {
  const known = new Set<string>(AHWP_TOOL_NAMES);
  const out = new Set<AhwpToolName>(ALWAYS_INCLUDE);
  if (mode === 'form-fill') {
    for (const n of FORM_FILL_ESSENTIAL) out.add(n);
  }
  for (const name of raw) {
    if (known.has(name)) out.add(name as AhwpToolName);
  }
  return Array.from(out);
}

/** Promise wrapper for `window.api.ai.chat` — accumulates text-delta
 *  events into a buffer and resolves on 'done'. Rejects on 'error',
 *  reject on timeout (with abort). Used as the router LLM call. */
function callRouterChat(request: ChatRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        handle?.abort();
      } catch {
        /* ignore */
      }
      reject(new Error('router-timeout'));
    }, ROUTER_TIMEOUT_MS);
    const handle = window.api.ai.chat(request, {
      onEvent: (evt: ChatStreamEvent) => {
        if (settled) return;
        if (evt.type === 'text-delta') {
          buf += evt.text;
        } else if (evt.type === 'done') {
          settled = true;
          clearTimeout(timer);
          resolve(buf);
        } else if (evt.type === 'error') {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`router-error:${evt.message}`));
        }
      },
    });
  });
}

const FULL_CATALOG = (): AhwpToolName[] =>
  Array.from(AHWP_TOOL_NAMES) as AhwpToolName[];

/** Phase-aware cache — 같은 user query + 같은 tool history 면 router LLM 호출
 *  생략. fireChat 가 Agent loop 안에서 같은 입력으로 반복 호출되는 일은
 *  드물지만 (history 는 매 turn 누적), 동일 phase 가 둘 이상 turn 이어질
 *  때 (예: write 만 연속) cache 가 효과적. */
let cachedKey: string | null = null;
let cachedResult: ToolSelectionResult | null = null;

function cacheKey(
  userText: string,
  history: readonly RouterToolHistoryEntry[],
  mode?: string,
): string {
  // mode 포함 — 같은 query/history 라도 mode 가 다르면(form-fill ↔ 기타)
  // 보장 도구 set 이 달라지므로 cache 를 분리.
  return `${mode ?? ''}\n${userText}\n${history.map((e) => `${e.name}:${e.ok ? '1' : '0'}`).join(',')}`;
}

/** 외부에서 turn 종료 시 호출 가능 — 다음 user message 시작 시 stale cache 제거. */
export function resetRouterCache(): void {
  cachedKey = null;
  cachedResult = null;
}

/**
 * LLM 기반 tool selection. 사용자 query 가 비어있거나 키가 없거나 router
 * 호출이 실패하면 full catalog fallback.
 *
 * 0.4.19 — phase-aware. recentToolCalls 인자가 있으면 router 가 호출 phase
 * (정보 수집 vs 작성 vs 검증) 를 판단해 subset 을 좁힘. 같은 input cache.
 */
export async function selectToolsViaLlm(opts: {
  history: ChatMessage[];
  provider: string;
  model: string;
  hasKey: boolean;
  /** 0.4.19 — Agent loop 가 누적한 도구 호출 이력. 비어있으면 turn 1 신호. */
  recentToolCalls?: readonly RouterToolHistoryEntry[];
  /** 0.7.28 — 현재 ModeContext.primary. 'form-fill' 이면 핵심 form 도구
   *  (replaceTextInCell / getPageSvg / getTextRange) 를 router 선택과
   *  무관하게 보장. */
  mode?: string;
}): Promise<ToolSelectionResult> {
  const t0 = performance.now();
  const userText = lastUserText(opts.history);
  if (userText.trim().length === 0) {
    return {
      tools: FULL_CATALOG(),
      intent: 'unknown',
      isFullCatalog: true,
      reason: 'empty-query',
      latencyMs: 0,
    };
  }
  if (!opts.hasKey) {
    return {
      tools: FULL_CATALOG(),
      intent: 'unknown',
      isFullCatalog: true,
      reason: 'no-key',
      latencyMs: 0,
    };
  }
  const recent = opts.recentToolCalls ?? [];
  const key = cacheKey(userText, recent, opts.mode);
  if (cachedKey === key && cachedResult) {
    return {
      ...cachedResult,
      reason: `${cachedResult.reason}+cache`,
      latencyMs: 0,
    };
  }
  const request: ChatRequest = {
    provider: opts.provider as ChatRequest['provider'],
    model: opts.model,
    messages: [
      { role: 'system', content: buildRouterSystemPrompt() },
      { role: 'user', content: buildRouterUserPrompt(userText, recent) },
    ],
    // OpenAI reasoning 모델 (o1/o3/gpt-5.x) 의 경우 router 는 짧은 JSON
    // 만 응답하면 되니 reasoning_effort='low' 로 thinking 단계 최소화.
    // 다른 provider / non-reasoning 모델은 silently 무시.
    reasoningEffort: 'low',
  };
  let raw: string;
  try {
    raw = await callRouterChat(request);
  } catch (err) {
    const msg = (err as Error).message || String(err);
    return {
      tools: FULL_CATALOG(),
      intent: 'unknown',
      isFullCatalog: true,
      reason: msg.startsWith('router-') ? msg : `router-error:${msg}`,
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  const parsed = parseRouterResponse(raw);
  if (!parsed) {
    return {
      tools: FULL_CATALOG(),
      intent: 'unknown',
      isFullCatalog: true,
      reason: 'router-parse-failed',
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  if (parsed.length === 0) {
    return {
      tools: FULL_CATALOG(),
      intent: 'unknown',
      isFullCatalog: true,
      reason: 'router-empty',
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  const normalized = normalizeSelection(parsed, opts.mode);
  const result: ToolSelectionResult = {
    tools: normalized,
    intent: parseRouterIntent(raw),
    isFullCatalog: false,
    reason: 'router-ok',
    latencyMs: Math.round(performance.now() - t0),
  };
  cachedKey = key;
  cachedResult = result;
  return result;
}
