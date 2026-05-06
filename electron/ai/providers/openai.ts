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

/**
 * Route reasoning-class models (gpt-5.x, o-series) to /v1/responses 인지
 * 판별. /v1/chat/completions 는 reasoning model + function tools 의 동시
 * 사용을 제한해 (function tools + reasoning_effort 미지원), responses
 * API 가 유일한 정상 경로.
 *
 * https://developers.openai.com/api/docs/guides/reasoning
 */
function shouldUseResponsesApi(model: string): boolean {
  if (model.startsWith('gpt-5')) return true;
  // o1 / o1-mini / o1-preview / o3 / o3-mini 등.
  if (/^o\d/.test(model)) return true;
  return false;
}

/** /v1/responses 의 input 항목. messages → input 변환.
 *
 * 한 ChatMessage 가 여러 input item 으로 펼쳐질 수 있다 (assistant 가
 * 한 turn 에 여러 tool 호출 시). 호출 측에서 `flatMap` 사용. 0.4.7
 * fix: 이전엔 다중 호출을 `{ type: 'list', items: [...] }` wrapper 로
 * 보냈는데 Responses API 가 'list' 타입 모름 → 400 invalid_value. 이제
 * 각 호출이 individual `type: 'function_call'` item 으로 평탄화. */
function toResponsesInputItems(m: ChatMessage): Record<string, unknown>[] {
  if (m.role === 'tool' && m.toolResult) {
    // 직전 turn 의 tool 호출 결과 회신 — function_call_output.
    return [
      {
        type: 'function_call_output',
        call_id: m.toolResult.id,
        output: m.toolResult.content,
      },
    ];
  }
  if (m.role === 'assistant' && m.toolUses && m.toolUses.length > 0) {
    // assistant 가 도구 호출한 turn 은 각 호출이 별도 function_call item.
    // assistant 메시지 본문이 있어도 후속 turn 에서 재전송하지 않으니
    // 호출 items 만 직렬화하면 충분.
    return m.toolUses.map((u) => ({
      type: 'function_call',
      call_id: u.id,
      name: u.name,
      arguments: JSON.stringify(u.args ?? {}),
    }));
  }
  return [{ role: m.role, content: m.content }];
}

interface ResponsesEvent {
  type: string;
  delta?: string;
  item_id?: string;
  output_index?: number;
  item?: {
    id?: string;
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  response?: {
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
    };
    status?: string;
  };
  error?: { message?: string };
}

/** Parse /v1/responses SSE — events have `event: <name>` line then
 *  `data: <json>` line. We only need the data; the event name is also in
 *  data.type. Generator yields the parsed data objects. */
async function* parseResponsesSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ResponsesEvent> {
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
      if (line.length === 0) continue;
      if (!line.startsWith('data:')) continue;
      const json = line.slice(5).trim();
      if (json === '[DONE]') continue;
      try {
        yield JSON.parse(json) as ResponsesEvent;
      } catch {
        /* skip malformed line */
      }
    }
  }
}

async function* chatViaResponses(
  req: Parameters<Provider['chat']>[0],
  opts: ProviderRuntimeOptions,
): AsyncIterable<ChatStreamEvent> {
  const url = `${trimBaseUrl(opts.baseUrl)}/responses`;
  const body: Record<string, unknown> = {
    model: req.model,
    input: req.messages.flatMap(toResponsesInputItems),
    stream: true,
    store: false,
  };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    }));
    const tc = req.toolChoice;
    if (tc === 'none') body.tool_choice = 'none';
    else if (tc === 'auto') body.tool_choice = 'auto';
    else if (tc && typeof tc === 'object' && 'name' in tc) {
      body.tool_choice = { type: 'function', name: tc.name };
    }
  }
  if (req.reasoningEffort) {
    body.reasoning = { effort: req.reasoningEffort };
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
    let msg = `${res.status} ${res.statusText}`;
    try {
      const errBody = await res.text();
      if (errBody) msg += ` — ${errBody.slice(0, 1024)}`;
    } catch {
      /* ignore */
    }
    yield { type: 'error', message: msg };
    return;
  }

  // Accumulate function_call args by item_id (each call has its own item).
  const pending = new Map<string, { id: string; name: string; args: string }>();
  let usage: ChatUsage | undefined;
  let finishReason: ChatFinishReason | undefined;
  let hasToolCalls = false;

  try {
    for await (const evt of parseResponsesSse(res.body)) {
      const t = evt.type;
      if (
        t === 'response.output_item.added' &&
        evt.item?.type === 'function_call'
      ) {
        const id =
          evt.item.call_id ?? evt.item.id ?? `call_${Date.now().toString(36)}`;
        pending.set(evt.item.id ?? id, {
          id,
          name: evt.item.name ?? '',
          args: '',
        });
        hasToolCalls = true;
        continue;
      }
      if (t === 'response.function_call_arguments.delta') {
        const slot = evt.item_id ? pending.get(evt.item_id) : undefined;
        if (slot && typeof evt.delta === 'string') slot.args += evt.delta;
        continue;
      }
      if (t === 'response.output_text.delta') {
        if (typeof evt.delta === 'string' && evt.delta.length > 0) {
          yield { type: 'text-delta', text: evt.delta };
        }
        continue;
      }
      if (t === 'response.completed') {
        const u = evt.response?.usage;
        if (u) {
          usage = {
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
          };
        }
        finishReason = hasToolCalls ? 'tool_calls' : 'stop';
        continue;
      }
      if (t === 'response.failed' || t === 'error') {
        yield {
          type: 'error',
          message: evt.error?.message ?? 'responses-stream-error',
        };
        return;
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  // Emit accumulated tool calls.
  for (const slot of pending.values()) {
    if (slot.name.length === 0) continue;
    let parsedArgs: unknown;
    try {
      parsedArgs = JSON.parse(slot.args || '{}');
    } catch {
      parsedArgs = { __rawArguments: slot.args };
    }
    yield { type: 'tool-use', id: slot.id, name: slot.name, args: parsedArgs };
  }
  yield { type: 'done', usage, finishReason };
}

export const openaiProvider: Provider = {
  meta: getProviderMeta('openai'),

  async *chat(
    req,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent> {
    // Reasoning-class 모델은 /v1/responses 로 라우팅 — chat completions 의
    // tools + reasoning_effort 동시 사용 제한 우회.
    if (shouldUseResponsesApi(req.model)) {
      yield* chatViaResponses(req, opts);
      return;
    }
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
    // Phase 3 — tool_calls 누적. OpenAI stream 은 한 호출의 id/name/
    // arguments 를 여러 chunk 에 나눠 흘려 보낸다 (특히 arguments JSON).
    //
    // 0.4.18 — id 기반 dedup. 일부 OpenAI-compatible provider (NVIDIA NIM
    // gemma-4 확인) 는 parallel tool calls 를 같은 `index` (보통 0) 로
    // 보내면서 id 만 다르게 — 이전엔 index 만 key 로 써서 args JSON 이
    // 인접 호출 사이에 concat 되어 `{"query":"a"}{"query":"b"}` 처럼
    // invalid JSON 으로 합쳐졌다. id 가 있을 땐 id 우선, 동일 index 에
    // id 가 바뀌면 새 슬롯 시작.
    const slots: Array<{ id: string; name: string; argsJson: string }> = [];
    const slotById = new Map<string, number>();
    /** 마지막으로 어떤 slot 이 이 index 에 활성이었는지 — id 없는
     *  continuation chunk 가 합류할 때 lookup. */
    const lastSlotByIndex = new Map<number, number>();
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
            const hasId = typeof tc.id === 'string' && tc.id.length > 0;
            const hasIdx = typeof tc.index === 'number';
            if (!hasId && !hasIdx) continue;

            let slotIdx: number | undefined;
            if (hasId) {
              slotIdx = slotById.get(tc.id!);
              if (slotIdx === undefined) {
                slotIdx = slots.length;
                slots.push({ id: tc.id!, name: '', argsJson: '' });
                slotById.set(tc.id!, slotIdx);
                if (hasIdx) lastSlotByIndex.set(tc.index!, slotIdx);
              }
            } else if (hasIdx) {
              slotIdx = lastSlotByIndex.get(tc.index!);
              if (slotIdx === undefined) {
                slotIdx = slots.length;
                slots.push({ id: '', name: '', argsJson: '' });
                lastSlotByIndex.set(tc.index!, slotIdx);
              }
            }
            if (slotIdx === undefined) continue;
            const slot = slots[slotIdx];
            if (typeof tc.function?.name === 'string')
              slot.name = tc.function.name;
            if (typeof tc.function?.arguments === 'string')
              slot.argsJson += tc.function.arguments;
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
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i];
        if (slot.name.length === 0) continue;
        let parsedArgs: unknown = {};
        try {
          parsedArgs =
            slot.argsJson.length > 0 ? JSON.parse(slot.argsJson) : {};
        } catch {
          parsedArgs = { __rawArguments: slot.argsJson };
        }
        yield {
          type: 'tool-use',
          id: slot.id || `call_${i}`,
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
