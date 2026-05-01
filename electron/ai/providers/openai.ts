import type {
  ChatStreamEvent,
  ChatUsage,
  Provider,
  ProviderRuntimeOptions,
} from '../../../shared/ai';
import { getProviderMeta } from '../../../shared/ai';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIDelta {
  content?: string;
}

interface OpenAIChoice {
  delta?: OpenAIDelta;
  finish_reason?: string | null;
}

interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

interface OpenAIChunk {
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage | null;
}

function trimBaseUrl(url: string | undefined): string {
  if (!url) return DEFAULT_BASE_URL;
  return url.replace(/\/+$/, '');
}

async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.length === 0 || !line.startsWith('data:')) continue;
      yield line.slice(5).trim();
    }
  }
  // Drain any trailing line that wasn't newline-terminated.
  const tail = buffer.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trim();
}

export const openaiProvider: Provider = {
  meta: getProviderMeta('openai'),

  async *chat(
    req,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent> {
    const url = `${trimBaseUrl(opts.baseUrl)}/chat/completions`;
    const body = {
      model: req.model,
      messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      stream_options: { include_usage: true },
      ...(typeof req.temperature === 'number'
        ? { temperature: req.temperature }
        : {}),
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${opts.apiKey ?? ''}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      });
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      yield {
        type: 'error',
        message: `OpenAI ${res.status}: ${text || res.statusText}`,
      };
      return;
    }

    let usage: ChatUsage | undefined;
    try {
      for await (const data of parseSseStream(res.body)) {
        if (data === '[DONE]') {
          yield { type: 'done', usage };
          return;
        }
        let chunk: OpenAIChunk;
        try {
          chunk = JSON.parse(data) as OpenAIChunk;
        } catch {
          continue;
        }
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield { type: 'text-delta', text: delta };
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      }
      yield { type: 'done', usage };
    } catch (err) {
      yield {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async ping(opts: ProviderRuntimeOptions): Promise<void> {
    const url = `${trimBaseUrl(opts.baseUrl)}/models`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${opts.apiKey ?? ''}` },
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`OpenAI ping ${res.status}: ${text || res.statusText}`);
    }
  },
};
