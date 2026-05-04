/**
 * AI provider contract shared between renderer and main.
 *
 * - This file (Phase 2 토대): types + provider metadata. No runtime logic.
 * - Phase 2-B: provider adapters implement `Provider` in the main process.
 * - Phase 3: tool-use extension to `ChatStreamEvent` (agent mode).
 *
 * The renderer never holds an API key. It sends a `ChatRequest` through IPC;
 * the main process attaches the stored secret and runs the adapter, streaming
 * `ChatStreamEvent` back to the renderer.
 */

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'nvidia'
  | 'custom';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** True when a BYOK API key is required. */
  requiresApiKey: boolean;
  /** True when the user must supply a base URL — `custom` covers any
   * OpenAI-compatible endpoint (self-hosted Ollama via /v1 shim,
   * vLLM, LM Studio, on-prem LLM gateway, etc.). */
  requiresBaseUrl: boolean;
}

export const PROVIDERS: readonly ProviderMeta[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    requiresApiKey: true,
    requiresBaseUrl: false,
  },
  {
    // `custom` is the catch-all OpenAI-compatible bucket: self-hosted
    // Ollama (`http://localhost:11434/v1`), vLLM, LM Studio,
    // on-prem LLM gateways, etc. We removed the dedicated `ollama`
    // entry in chunk 49 — the OpenAI-compat /v1 shim covers it
    // identically and an extra adapter was just dead surface area.
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    requiresApiKey: true,
    requiresBaseUrl: true,
  },
];

const PROVIDER_IDS = new Set<string>(PROVIDERS.map((p) => p.id));

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDER_IDS.has(value);
}

export function getProviderMeta(id: ProviderId): ProviderMeta {
  const meta = PROVIDERS.find((p) => p.id === id);
  if (!meta) throw new Error(`Unknown provider: ${id}`);
  return meta;
}

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * Phase 3 — chat message가 plain text 외에 `tool_use` (assistant)와
 * `tool_result` (tool) 도 carry. provider 어댑터에서 native 형식으로
 * 변환:
 *   - OpenAI: assistant의 tool_calls + 별도 role='tool' 메시지
 *   - Anthropic: content blocks (text / tool_use / tool_result)
 *   - Google: parts[] with functionCall / functionResponse
 */
export interface ChatMessage {
  role: ChatRole;
  /** Plain text portion. tool_use/tool_result 메시지는 비어있어도 됨 */
  content: string;
  /**
   * assistant 가 호출한 tool. 한 메시지에 여러 호출 가능 (provider에
   * 따라 병렬 가능). chunk 38 OpenAI tool calling 에서 적재.
   */
  toolUses?: ToolUseRecord[];
  /**
   * role='tool' 일 때만 의미 — 직전 turn의 tool_use에 대한 응답.
   */
  toolResult?: ToolResultRecord;
}

export interface ToolUseRecord {
  /** provider가 부여한 호출 id — tool_result에 다시 인용. */
  id: string;
  name: string;
  /** tool_use 인자 — JSON object. 실제 schema 검증은
   * `shared/ai-tools.ts` 의 `validateToolCall` 이 담당. */
  args: unknown;
}

export interface ToolResultRecord {
  id: string;
  /** 직전 호출의 IR 결과 — 성공 시 free-form text (값/요약), 실패 시
   * machine-readable reason 코드. provider에 다시 들려보냄. */
  content: string;
  isError?: boolean;
}

/**
 * Phase 3 — Agent 모드용 tool 카탈로그. `shared/ai-tools.ts` 의
 * `AHWP_TOOL_NAMES` 에서 변환해서 ChatRequest.tools 로 주입.
 */
export interface ChatTool {
  name: string;
  description: string;
  /** JSON Schema (draft-07 호환). provider가 자체 형식으로 변환. */
  inputSchema: Record<string, unknown>;
}

export type ChatToolChoice = 'auto' | 'none' | { name: string };

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  /** 0~2 (provider clamps as needed). Defaults are provider-specific. */
  temperature?: number;
  /** Phase 3 — Agent 모드일 때 주입. `undefined` 면 Manual (text-only). */
  tools?: ChatTool[];
  /** 'auto' (기본) — 모델이 결정. 'none' — tool 호출 금지. {name} — 강제. */
  toolChoice?: ChatToolChoice;
}

/**
 * Streamed chat events. Phase 3 부터 tool-use / tool-result 이벤트 추가.
 * 한 stream은 정확히 한 개의 `done` 또는 `error` 로 종료.
 *
 * Agent 한 turn 흐름:
 *   text-delta? → tool-use* → done (tool이 있으면 다음 turn 호출 필요)
 *
 * tool-use 이벤트는 호출 시점이 아니라 stream 종료 직전에 emit (모델이
 * 인자 JSON 을 chunk 단위로 흘리는 경우 어댑터가 누적해서 한 번에).
 */
export type ChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; id: string; name: string; args: unknown }
  | { type: 'done'; usage?: ChatUsage; finishReason?: ChatFinishReason }
  | { type: 'error'; message: string };

/**
 * `done` 이벤트의 종료 원인. agent 루프는 `tool_calls` 면 다음 turn 을
 * 자동 호출하고, 그 외 (`stop` / `length` / `content_filter`) 면 종료.
 */
export type ChatFinishReason =
  | 'stop'
  | 'tool_calls'
  | 'length'
  | 'content_filter';

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
}

/** Per-call runtime context the main process injects into adapters. */
export interface ProviderRuntimeOptions {
  apiKey?: string;
  baseUrl?: string;
  signal?: AbortSignal;
}

/**
 * Adapter contract. Implemented in the main process. The renderer never
 * imports a `Provider` directly — it only sees `ChatStreamEvent` over IPC.
 */
export interface Provider {
  readonly meta: ProviderMeta;
  /** Stream chat tokens. The iterable terminates after `done` or `error`. */
  chat(
    req: ChatRequest,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent>;
  /** Reachability check. Resolves on success, throws on auth/network errors. */
  ping(opts: ProviderRuntimeOptions): Promise<void>;
  /**
   * Fetch the list of model IDs available for this provider — chunk 48.
   * Optional: providers without a public list endpoint can omit this and
   * the UI falls back to free-text input. Throws on network / auth
   * failure; the IPC layer translates that into a "확인 불가" state and
   * the renderer keeps the free-text input open.
   */
  listModels?(opts: ProviderRuntimeOptions): Promise<string[]>;
}

/**
 * Result envelope for the `ai:list-models` IPC — chunk 48. The UI uses
 * `status` to decide whether to show a dropdown (`ok`), a "확인 불가"
 * label + free-text input (`error`), or a stale-but-usable list
 * (`stale-cache` — last successful fetch served while a fresh fetch
 * fails).
 */
export type ModelListResult =
  | { status: 'ok'; models: string[]; fetchedAt: number }
  | {
      status: 'stale-cache';
      models: string[];
      fetchedAt: number;
      reason: string;
    }
  | { status: 'error'; reason: string };
