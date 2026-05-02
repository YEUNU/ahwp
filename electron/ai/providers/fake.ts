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
 *   "ECHO:hello"   → emit each char of "hello" as a text-delta, then done
 *   "ERROR:msg"    → emit a single error event with `msg`
 *   "SLOW:abc"     → echo with 50ms gap between chars (for abort tests)
 *
 * The fake never calls fetch — no network involvement, no API key actually
 * required. We still pretend to be 'openai' so the IPC layer's
 * `requiresApiKey` branch exercises the same path as production.
 */
function decodeScript(text: string): {
  mode: 'echo' | 'error' | 'slow';
  payload: string;
} {
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
