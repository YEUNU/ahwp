import type {
  ChatFinishReason,
  ChatMessage,
  ChatStreamEvent,
  ChatUsage,
  Provider,
  ProviderRuntimeOptions,
} from '../../../shared/ai';
import { getProviderMeta } from '../../../shared/ai';

/**
 * Google Gemini 어댑터 — Phase 3 chunk 43.
 *
 * Native API:
 *   - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent`
 *   - Auth: query param `?key=<API_KEY>` (Bearer 미사용)
 *   - Stream: SSE-like JSON arrays (`?alt=sse` 옵션 켜면 OpenAI 와 비슷한
 *     `data: ` line-prefixed) — 우리는 sse 옵션 사용해서 통일된 파싱.
 *
 * Message 변환:
 *   - `system` → top-level `systemInstruction.parts[0].text`
 *   - `user`/`assistant` → `contents[].role` ('user' / 'model') + `parts[].text`
 *   - assistant tool_use → `parts[].functionCall: {name, args}`
 *   - role='tool' → `contents` 안 user role + `parts[].functionResponse:
 *     {name, response: {result: ...}}` (Google 은 tool_call_id 없이 name으로
 *     매칭)
 *
 * Tool 카탈로그:
 *   - `{tools: [{functionDeclarations: [{name, description, parameters}]}]}`
 *   - parameters 는 JSON Schema (draft-07) — OpenAI 와 동일 포맷이지만
 *     Gemini 는 일부 제약 (예: `additionalProperties` 무시, `enum` 만 허용)
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const API_VERSION = 'v1beta';

interface GeminiPart {
  text?: string;
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
}

interface GeminiCandidate {
  content?: { role?: string; parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
}

interface GeminiChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

function trimBaseUrl(url: string | undefined): string {
  if (!url) return DEFAULT_BASE_URL;
  return url.replace(/\/+$/, '');
}

function mapFinishReason(s: string | undefined): ChatFinishReason {
  // Gemini codes: STOP, MAX_TOKENS, SAFETY, RECITATION, OTHER, MALFORMED_FUNCTION_CALL
  // 우리 contract: 'stop' | 'tool_calls' | 'length' | 'content_filter'
  if (s === 'MAX_TOKENS') return 'length';
  if (s === 'SAFETY' || s === 'RECITATION') return 'content_filter';
  return 'stop';
}

/** Convert our message list to Gemini's `contents` + `systemInstruction`.
 * - system: 별도 top-level (Gemini는 system 메시지를 contents에 안 받음)
 * - user/assistant: contents[] + role 변환 (assistant → 'model')
 * - tool result (role='tool'): user role + functionResponse part
 */
function toGeminiBody(messages: ChatMessage[]): {
  systemInstruction: { parts: { text: string }[] } | undefined;
  contents: { role: string; parts: GeminiPart[] }[];
} {
  const systemTexts: string[] = [];
  const contents: { role: string; parts: GeminiPart[] }[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      if (m.content.length > 0) systemTexts.push(m.content);
      continue;
    }
    if (m.role === 'tool' && m.toolResult) {
      // Gemini tool result 는 user role 의 functionResponse part.
      // toolResult.id 는 OpenAI/Anthropic 용 — Gemini 는 tool name 으로
      // 매칭하지만 우리는 id 만 있어서 직전 호출의 name 을 lookup 해야 함.
      // 가장 안전한 방법: 직전 model 메시지의 toolUses 에서 같은 id 의
      // name 을 찾기.
      const prev = (() => {
        for (let i = messages.indexOf(m) - 1; i >= 0; i--) {
          const x = messages[i];
          if (x.role === 'assistant' && x.toolUses) {
            const u = x.toolUses.find((tu) => tu.id === m.toolResult!.id);
            if (u) return u.name;
          }
        }
        return 'unknown';
      })();
      contents.push({
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: prev,
              response: { result: m.toolResult.content },
            },
          },
        ],
      });
      continue;
    }
    if (m.role === 'assistant') {
      const parts: GeminiPart[] = [];
      if (m.content.length > 0) parts.push({ text: m.content });
      for (const u of m.toolUses ?? []) {
        parts.push({ functionCall: { name: u.name, args: u.args } });
      }
      contents.push({
        role: 'model',
        parts: parts.length > 0 ? parts : [{ text: '' }],
      });
      continue;
    }
    // user
    contents.push({ role: 'user', parts: [{ text: m.content }] });
  }
  return {
    systemInstruction:
      systemTexts.length > 0
        ? { parts: [{ text: systemTexts.join('\n\n') }] }
        : undefined,
    contents,
  };
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
  const tail = buffer.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trim();
}

export const googleProvider: Provider = {
  meta: getProviderMeta('google'),

  async *chat(
    req,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent> {
    const apiKey = opts.apiKey ?? '';
    const baseUrl = trimBaseUrl(opts.baseUrl);
    const url =
      `${baseUrl}/${API_VERSION}/models/${encodeURIComponent(req.model)}` +
      `:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;

    const { systemInstruction, contents } = toGeminiBody(req.messages);
    const body: Record<string, unknown> = {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(typeof req.temperature === 'number'
        ? { generationConfig: { temperature: req.temperature } }
        : {}),
    };
    // Phase 3 — tools. Gemini 는 toolChoice 가 toolConfig.functionCallingConfig.
    if (req.tools && req.tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
      const tc = req.toolChoice;
      if (tc === 'none') {
        body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
      } else if (tc === 'auto') {
        body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
      } else if (tc && typeof tc === 'object' && 'name' in tc) {
        body.toolConfig = {
          functionCallingConfig: {
            mode: 'ANY',
            allowedFunctionNames: [tc.name],
          },
        };
      }
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
        message: `Google ${res.status}: ${text || res.statusText}`,
      };
      return;
    }

    let usage: ChatUsage | undefined;
    let finishReason: ChatFinishReason = 'stop';
    // Gemini 의 functionCall 은 stream 중간에 통째로 한 번에 도착 (OpenAI
    // 처럼 chunk 분할 안 됨). 그래서 누적 슬롯 대신 즉시 emit.
    let toolEmitted = 0;
    try {
      for await (const data of parseSseStream(res.body)) {
        if (data.length === 0 || data === '[DONE]') continue;
        let chunk: GeminiChunk;
        try {
          chunk = JSON.parse(data) as GeminiChunk;
        } catch {
          continue;
        }
        const cand = chunk.candidates?.[0];
        const parts = cand?.content?.parts ?? [];
        for (const part of parts) {
          if (typeof part.text === 'string' && part.text.length > 0) {
            yield { type: 'text-delta', text: part.text };
          }
          if (part.functionCall && typeof part.functionCall.name === 'string') {
            toolEmitted += 1;
            yield {
              type: 'tool-use',
              id: `call_${Date.now().toString(36)}_${toolEmitted}`,
              name: part.functionCall.name,
              args: part.functionCall.args ?? {},
            };
          }
        }
        if (cand?.finishReason) {
          finishReason = mapFinishReason(cand.finishReason);
        }
        if (chunk.usageMetadata) {
          usage = {
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
          };
        }
      }
      // Gemini 는 functionCall 이 있으면 finishReason='STOP' 으로 와도
      // 의미상 tool_calls. emitted > 0 이면 재정의.
      if (toolEmitted > 0 && finishReason === 'stop') {
        finishReason = 'tool_calls';
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
    // 가장 가벼운 reachability — listModels 와 같은 endpoint.
    const url =
      `${trimBaseUrl(opts.baseUrl)}/${API_VERSION}/models?key=` +
      encodeURIComponent(opts.apiKey ?? '');
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Google ping ${res.status}: ${text || res.statusText}`);
    }
  },

  async listModels(opts: ProviderRuntimeOptions): Promise<string[]> {
    const url =
      `${trimBaseUrl(opts.baseUrl)}/${API_VERSION}/models?key=` +
      encodeURIComponent(opts.apiKey ?? '');
    const res = await fetch(url, { signal: opts.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Google listModels ${res.status}: ${text || res.statusText}`,
      );
    }
    const json = (await res.json()) as {
      models?: Array<{
        name?: string;
        supportedGenerationMethods?: string[];
      }>;
    };
    const ids: string[] = [];
    for (const row of json.models ?? []) {
      // name format: "models/gemini-1.5-pro" — 사용자가 기억하기 쉬운
      // short id 만 노출. supportedGenerationMethods 가 generateContent
      // 를 포함해야 chat 가능.
      if (typeof row?.name !== 'string') continue;
      if (
        Array.isArray(row.supportedGenerationMethods) &&
        !row.supportedGenerationMethods.includes('generateContent')
      ) {
        continue;
      }
      const short = row.name.startsWith('models/')
        ? row.name.slice('models/'.length)
        : row.name;
      if (short.length > 0) ids.push(short);
    }
    ids.sort();
    return ids;
  },
};
