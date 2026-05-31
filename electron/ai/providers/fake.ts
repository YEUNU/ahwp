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
 *   "FORMFILL:<token>"  → multi-step driver: turn 1 emits getEmptyFormFields,
 *                          turn 2 parses its result and emits fillFormCells
 *                          writing <token> into the first empty cell (real
 *                          fixture coords, no hardcoding), turn 3 stops. Drives
 *                          the real getEmptyFormFields → fillFormCells agent
 *                          loop deterministically. Branches on how many
 *                          role='tool' messages are already in the history.
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

    // FORMFILL:<token> — deterministic multi-step form-fill driver. Keyed off
    // the original user message (not `last`, which becomes a tool result on
    // later turns) + the count of role='tool' messages so far, so the same
    // marker advances the getEmptyFormFields → fillFormCells → done chain
    // across the agent loop's re-invocations.
    const formFillMsg = req.messages.find(
      (m) => typeof m.content === 'string' && m.content.includes('FORMFILL:'),
    );
    if (formFillMsg && typeof formFillMsg.content === 'string') {
      const token = formFillMsg.content
        .split('FORMFILL:')[1]
        .trim()
        .split(/\s/)[0];
      const toolTurns = req.messages.filter((m) => m.role === 'tool').length;
      if (toolTurns === 0) {
        // Step 1 — locate empty cells.
        yield {
          type: 'tool-use',
          id: `call_${Date.now().toString(36)}`,
          name: 'getEmptyFormFields',
          args: { maxResults: 10 },
        };
        yield {
          type: 'done',
          usage: { inputTokens: last.length, outputTokens: 0 },
          finishReason: 'tool_calls',
        };
        return;
      }
      if (toolTurns === 1) {
        // Step 2 — parse the getEmptyFormFields result (== `last`) and fill the
        // first empty cell with the token.
        let cell:
          | {
              sectionIdx: number;
              parentParaIdx: number;
              controlIdx: number;
              cellIdx: number;
              cellParaIdx: number;
            }
          | undefined;
        try {
          type CellRow = {
            sectionIdx: number;
            parentParaIdx: number;
            controlIdx: number;
            cellIdx: number;
            cellParaIdx: number;
            isEmpty?: boolean;
          };
          // The tool-result content may be the helper payload directly
          // (`{cellFields}`) or wrapped (`{ok,data:{cellFields}}`) — handle both.
          const data = JSON.parse(last) as {
            cellFields?: CellRow[];
            data?: { cellFields?: CellRow[] };
          };
          const fields = data.cellFields ?? data.data?.cellFields ?? [];
          cell = fields.find((f) => f.isEmpty) ?? fields[0];
        } catch {
          cell = undefined;
        }
        if (cell) {
          yield {
            type: 'tool-use',
            id: `call_${Date.now().toString(36)}`,
            name: 'fillFormCells',
            args: {
              cells: [
                {
                  sectionIdx: cell.sectionIdx,
                  parentParaIdx: cell.parentParaIdx,
                  controlIdx: cell.controlIdx,
                  cellIdx: cell.cellIdx,
                  cellParaIdx: cell.cellParaIdx,
                  text: token,
                  mode: 'insert',
                },
              ],
            },
          };
          yield {
            type: 'done',
            usage: { inputTokens: last.length, outputTokens: 0 },
            finishReason: 'tool_calls',
          };
          return;
        }
        // No cell found — fall through to the terminal turn so the test's
        // searchAllText assertion fails loudly instead of looping.
      }
      // Step 3 (toolTurns >= 2, or no cell) — terminal turn.
      const doneText = 'form filled';
      for (const ch of doneText) {
        if (opts.signal?.aborted) {
          yield { type: 'error', message: 'aborted' };
          return;
        }
        yield { type: 'text-delta', text: ch };
      }
      yield {
        type: 'done',
        usage: { inputTokens: last.length, outputTokens: doneText.length },
        finishReason: 'stop',
      };
      return;
    }

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
