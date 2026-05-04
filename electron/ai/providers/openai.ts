import type {
  ChatFinishReason,
  ChatMessage,
  ChatStreamEvent,
  ChatUsage,
  Provider,
  ProviderRuntimeOptions,
} from '../../../shared/ai';
import { getProviderMeta } from '../../../shared/ai';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface OpenAIToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIDelta {
  content?: string;
  tool_calls?: OpenAIToolCallDelta[];
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

/**
 * OpenAI native message 형식 변환 — Phase 3 tool-use 지원.
 * - assistant + tool_calls: assistant 메시지에 tool_calls 배열
 * - tool result: role='tool' + tool_call_id (직전 호출 id)
 */
function toOpenAIMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool' && m.toolResult) {
    return {
      role: 'tool',
      tool_call_id: m.toolResult.id,
      content: m.toolResult.content,
    };
  }
  if (m.role === 'assistant' && m.toolUses && m.toolUses.length > 0) {
    return {
      role: 'assistant',
      content: m.content || null,
      tool_calls: m.toolUses.map((u) => ({
        id: u.id,
        type: 'function',
        function: { name: u.name, arguments: JSON.stringify(u.args ?? {}) },
      })),
    };
  }
  return { role: m.role, content: m.content };
}

function mapFinishReason(s: string | null | undefined): ChatFinishReason {
  if (s === 'tool_calls' || s === 'function_call') return 'tool_calls';
  if (s === 'length') return 'length';
  if (s === 'content_filter') return 'content_filter';
  return 'stop';
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
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toOpenAIMessage),
      stream: true,
      stream_options: { include_usage: true },
      ...(typeof req.temperature === 'number'
        ? { temperature: req.temperature }
        : {}),
      // chunk 99 — Reasoning models (o1/o3/gpt-5.x) 는 reasoning_effort 로
      // thinking 깊이 조절. router 같은 빠른 응답이 필요한 호출은 'low' /
      // 'minimal' 로 reasoning_tokens 최소화. non-reasoning 모델은 이
      // 필드 무시 (OpenAI 가 silently 처리).
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    };
    // Phase 3 — tool calling. ChatTool[] → OpenAI native format.
    if (req.tools && req.tools.length > 0) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
      const tc = req.toolChoice;
      if (tc === 'none') body.tool_choice = 'none';
      else if (tc === 'auto') body.tool_choice = 'auto';
      else if (tc && typeof tc === 'object' && 'name' in tc) {
        body.tool_choice = { type: 'function', function: { name: tc.name } };
      }
    }

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
    let finishReason: ChatFinishReason = 'stop';
    // Phase 3 — tool_calls 누적. OpenAI stream은 한 호출의 id/name/arguments
    // 를 여러 chunk에 나눠 흘려서 보낸다 (특히 arguments JSON). index 별
    // 슬롯에 append 하다가 finish_reason 받으면 yield.
    const pendingToolCalls = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >();
    try {
      for await (const data of parseSseStream(res.body)) {
        if (data === '[DONE]') {
          break;
        }
        let chunk: OpenAIChunk;
        try {
          chunk = JSON.parse(data) as OpenAIChunk;
        } catch {
          continue;
        }
        const choice = chunk.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          yield { type: 'text-delta', text: delta };
        }
        const tcDeltas = choice?.delta?.tool_calls;
        if (Array.isArray(tcDeltas)) {
          for (const tc of tcDeltas) {
            if (typeof tc.index !== 'number') continue;
            const slot = pendingToolCalls.get(tc.index) ?? {
              id: '',
              name: '',
              argsJson: '',
            };
            if (typeof tc.id === 'string') slot.id = tc.id;
            if (typeof tc.function?.name === 'string')
              slot.name = tc.function.name;
            if (typeof tc.function?.arguments === 'string')
              slot.argsJson += tc.function.arguments;
            pendingToolCalls.set(tc.index, slot);
          }
        }
        if (choice?.finish_reason) {
          finishReason = mapFinishReason(choice.finish_reason);
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
      }
      // Stream 종료 — 누적된 tool_calls 를 한꺼번에 emit. arguments 는
      // JSON 문자열로 들어오므로 parse 시도 (실패하면 raw 문자열 그대로).
      const indices = Array.from(pendingToolCalls.keys()).sort((a, b) => a - b);
      for (const idx of indices) {
        const slot = pendingToolCalls.get(idx);
        if (!slot || slot.name.length === 0) continue;
        let parsedArgs: unknown = {};
        try {
          parsedArgs =
            slot.argsJson.length > 0 ? JSON.parse(slot.argsJson) : {};
        } catch {
          parsedArgs = { __rawArguments: slot.argsJson };
        }
        yield {
          type: 'tool-use',
          id: slot.id || `call_${idx}`,
          name: slot.name,
          args: parsedArgs,
        };
      }
      yield { type: 'done', usage, finishReason };
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

  // chunk 48 — model list. OpenAI's `/v1/models` returns `{ data: [{
  // id, ... }] }`. We hand back the raw `id` strings; sorting and
  // filtering (e.g. drop tts-* / embedding-* models) is the renderer's
  // job — preview filtering server-side would discard models that newer
  // SDK builds may rely on.
  async listModels(opts: ProviderRuntimeOptions): Promise<string[]> {
    const url = `${trimBaseUrl(opts.baseUrl)}/models`;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${opts.apiKey ?? ''}` },
      signal: opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `OpenAI listModels ${res.status}: ${text || res.statusText}`,
      );
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const ids: string[] = [];
    for (const row of json.data ?? []) {
      if (typeof row?.id === 'string' && row.id.length > 0) ids.push(row.id);
    }
    ids.sort();
    return ids;
  },
};
