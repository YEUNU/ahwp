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
  | 'ollama'
  | 'custom';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  /** True when a BYOK API key is required. False for self-hosted ollama. */
  requiresApiKey: boolean;
  /** True when the user must supply a base URL (ollama, custom). */
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
    id: 'ollama',
    label: 'Ollama (self-hosted)',
    requiresApiKey: false,
    requiresBaseUrl: true,
  },
  {
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

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[];
  /** 0~2 (provider clamps as needed). Defaults are provider-specific. */
  temperature?: number;
}

/**
 * Streamed chat events. Phase 2 only emits text deltas; Phase 3 will add
 * tool-call events for agent mode. A stream always terminates with exactly
 * one `done` or `error`.
 */
export type ChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'done'; usage?: ChatUsage }
  | { type: 'error'; message: string };

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
}
