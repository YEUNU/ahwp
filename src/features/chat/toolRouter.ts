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

/** 매 turn 항상 포함되는 도구 — 위치 결정 / 문서 구조 파악은 어떤
 *  편집 작업에서도 흔히 필요. router 가 깜빡 빠뜨려도 이 두 개는 보장. */
const ALWAYS_INCLUDE: readonly AhwpToolName[] = [
  'getCaretPosition',
  'getDocumentOutline',
];

export interface ToolSelectionResult {
  /** Selected tool name set. Non-empty (full catalog on fallback). */
  tools: AhwpToolName[];
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
    'You are the tool router for a Hancom HWP document-editing Agent. Given the user query plus the tool-call history so far, pick the subset of tool names needed for the *next* turn.',
    '',
    'Response rules:',
    '- Reply with a single JSON array, nothing else. No prose, no markdown, no explanation.',
    '- Example: ["searchWorkspaceOutlines","insertText","applyHtml"]',
    '- If user intent is ambiguous, return [] (full-catalog fallback).',
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

/** Filter raw names down to known AhwpToolName values + always-include
 *  set. Discards unknowns silently. */
function normalizeSelection(raw: string[]): AhwpToolName[] {
  const known = new Set<string>(AHWP_TOOL_NAMES);
  const out = new Set<AhwpToolName>(ALWAYS_INCLUDE);
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
): string {
  return `${userText}\n${history.map((e) => `${e.name}:${e.ok ? '1' : '0'}`).join(',')}`;
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
}): Promise<ToolSelectionResult> {
  const t0 = performance.now();
  const userText = lastUserText(opts.history);
  if (userText.trim().length === 0) {
    return {
      tools: FULL_CATALOG(),
      isFullCatalog: true,
      reason: 'empty-query',
      latencyMs: 0,
    };
  }
  if (!opts.hasKey) {
    return {
      tools: FULL_CATALOG(),
      isFullCatalog: true,
      reason: 'no-key',
      latencyMs: 0,
    };
  }
  const recent = opts.recentToolCalls ?? [];
  const key = cacheKey(userText, recent);
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
      isFullCatalog: true,
      reason: msg.startsWith('router-') ? msg : `router-error:${msg}`,
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  const parsed = parseRouterResponse(raw);
  if (!parsed) {
    return {
      tools: FULL_CATALOG(),
      isFullCatalog: true,
      reason: 'router-parse-failed',
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  if (parsed.length === 0) {
    return {
      tools: FULL_CATALOG(),
      isFullCatalog: true,
      reason: 'router-empty',
      latencyMs: Math.round(performance.now() - t0),
    };
  }
  const normalized = normalizeSelection(parsed);
  const result: ToolSelectionResult = {
    tools: normalized,
    isFullCatalog: false,
    reason: 'router-ok',
    latencyMs: Math.round(performance.now() - t0),
  };
  cachedKey = key;
  cachedResult = result;
  return result;
}
