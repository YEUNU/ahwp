import type {
  ChatStreamEvent,
  Provider,
  ProviderRuntimeOptions,
} from '../../../shared/ai';
import { getProviderMeta } from '../../../shared/ai';

/**
 * Test-only deterministic provider. Activated by `AHWP_E2E_FAKE_AI=1`
 * env in main (see registry.ts). Behavior is encoded in the *last user
 * message content* so each e2e case stays self-contained:
 *
 *   "ECHO:hello"        → emit each char of "hello" as a text-delta, then done
 *   "ERROR:msg"         → emit a single error event with `msg`
 *   "SLOW:abc"          → echo with 50ms gap between chars (for abort tests)
 *   "TOOL:<name>:<json>" → emit a single tool-use event {name, args=JSON.parse(json)},
 *                          finishReason='tool_calls'. Used by chunk 38+ Agent tests.
 *                          Example: TOOL:applyAlignment:{"align":"center"}
 *   "TOOL_DONE:text"    → echo `text` and finishReason='stop' (used as the
 *                          "agent done" terminal turn after tool results).
 *
 * The fake never calls fetch — no network involvement, no API key actually
 * required. We still pretend to be 'openai' so the IPC layer's
 * `requiresApiKey` branch exercises the same path as production.
 */
type FakeMode = 'echo' | 'error' | 'slow' | 'tool' | 'tool_done';

function decodeScript(text: string): { mode: FakeMode; payload: string } {
  if (text.includes('TOOL_DONE:')) {
    return { mode: 'tool_done', payload: text.split('TOOL_DONE:')[1].trim() };
  }
  if (text.includes('TOOL:')) {
    return { mode: 'tool', payload: text.split('TOOL:')[1].trim() };
  }
  if (text.includes('ERROR:')) {
    return { mode: 'error', payload: text.split('ERROR:')[1].trim() };
  }
  if (text.includes('SLOW:')) {
    return { mode: 'slow', payload: text.split('SLOW:')[1].trim() };
  }
  if (text.includes('ECHO:')) {
    return { mode: 'echo', payload: text.split('ECHO:')[1].trim() };
  }
  // Default: echo a fixed greeting so unscripted test paths still work.
  return { mode: 'echo', payload: 'ok' };
}

export const fakeProvider: Provider = {
  meta: getProviderMeta('openai'),

  async *chat(
    req,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent> {
    const last = req.messages[req.messages.length - 1]?.content ?? '';
    const { mode, payload } = decodeScript(last);

    if (mode === 'error') {
      yield { type: 'error', message: payload };
      return;
    }

    if (mode === 'tool') {
      // payload format: "<toolName>:<argsJson>"
      const colonIdx = payload.indexOf(':');
      const name = colonIdx < 0 ? payload : payload.slice(0, colonIdx);
      const argsRaw = colonIdx < 0 ? '{}' : payload.slice(colonIdx + 1);
      let args: unknown;
      try {
        args = JSON.parse(argsRaw);
      } catch {
        args = { __rawArguments: argsRaw };
      }
      yield {
        type: 'tool-use',
        id: `call_${Date.now().toString(36)}`,
        name,
        args,
      };
      yield {
        type: 'done',
        usage: { inputTokens: last.length, outputTokens: 0 },
        finishReason: 'tool_calls',
      };
      return;
    }

    // tool_done: echo payload as text-delta then finishReason='stop'.
    if (mode === 'tool_done') {
      for (const ch of payload) {
        if (opts.signal?.aborted) {
          yield { type: 'error', message: 'aborted' };
          return;
        }
        yield { type: 'text-delta', text: ch };
      }
      yield {
        type: 'done',
        usage: { inputTokens: last.length, outputTokens: payload.length },
        finishReason: 'stop',
      };
      return;
    }

    for (const ch of payload) {
      if (opts.signal?.aborted) {
        yield { type: 'error', message: 'aborted' };
        return;
      }
      if (mode === 'slow') {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 50);
          opts.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(t);
              reject(new Error('aborted'));
            },
            { once: true },
          );
        }).catch(() => {});
        if (opts.signal?.aborted) {
          yield { type: 'error', message: 'aborted' };
          return;
        }
      }
      yield { type: 'text-delta', text: ch };
    }
    yield {
      type: 'done',
      usage: { inputTokens: last.length, outputTokens: payload.length },
      finishReason: 'stop',
    };
  },

  async ping(opts: ProviderRuntimeOptions): Promise<void> {
    // Allow e2e to drive the error path: a key starting with 'BAD' (e.g.
    // a transient input typed by the user in Settings) makes ping reject.
    if (opts.apiKey && opts.apiKey.startsWith('BAD')) {
      throw new Error('fake: invalid key');
    }
  },

  // chunk 48 — deterministic catalog for e2e. The renderer treats this
  // exactly like a real provider response (sorted alphabetically). A key
  // starting with 'BAD' makes listModels reject the same way ping does,
  // so tests can drive the "확인 불가" branch.
  async listModels(opts: ProviderRuntimeOptions): Promise<string[]> {
    if (opts.apiKey && opts.apiKey.startsWith('BAD')) {
      throw new Error('fake: listModels failed');
    }
    return ['fake/echo-1', 'fake/echo-2', 'fake/slow-1'];
  },
};
