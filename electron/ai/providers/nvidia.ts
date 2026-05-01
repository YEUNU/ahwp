import type {
  ChatStreamEvent,
  Provider,
  ProviderRuntimeOptions,
} from '../../../shared/ai';
import { getProviderMeta } from '../../../shared/ai';
import { openaiProvider } from './openai';

/**
 * NVIDIA NIM hosted endpoint. The chat completion API is OpenAI-compatible
 * (verified against the live endpoint: SSE format identical, `delta.content`
 * shape identical, terminator `data: [DONE]`). Some chunks carry extra fields
 * like `reasoning_content` and `token_ids` that our parser silently ignores.
 *
 * Self-hosted NIM is also reachable by passing `opts.baseUrl` (e.g.
 * `http://localhost:8000/v1`).
 */
const NVIDIA_DEFAULT_BASE_URL = 'https://integrate.api.nvidia.com/v1';

export const nvidiaProvider: Provider = {
  meta: getProviderMeta('nvidia'),

  async *chat(
    req,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent> {
    yield* openaiProvider.chat(req, {
      ...opts,
      baseUrl: opts.baseUrl ?? NVIDIA_DEFAULT_BASE_URL,
    });
  },

  async ping(opts: ProviderRuntimeOptions): Promise<void> {
    return openaiProvider.ping({
      ...opts,
      baseUrl: opts.baseUrl ?? NVIDIA_DEFAULT_BASE_URL,
    });
  },
};
