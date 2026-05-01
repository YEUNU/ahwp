import { ipcMain, type WebContents } from 'electron';
import { getProvider } from '../ai/registry';
import { getSecret } from '../store/secrets';
import { isProviderId } from '../../shared/ai';
import type { ChatRequest, ChatStreamEvent } from '../../shared/ai';

interface ChatStartParams {
  id: string;
  request: ChatRequest;
}

const inflight = new Map<string, AbortController>();

function isValidRequest(req: unknown): req is ChatRequest {
  if (!req || typeof req !== 'object') return false;
  const r = req as Record<string, unknown>;
  return (
    isProviderId(r.provider) &&
    typeof r.model === 'string' &&
    Array.isArray(r.messages) &&
    r.messages.every(
      (m) =>
        m &&
        typeof m === 'object' &&
        typeof (m as { role?: unknown }).role === 'string' &&
        typeof (m as { content?: unknown }).content === 'string',
    )
  );
}

function send(
  sender: WebContents,
  channel: string,
  payload: ChatStreamEvent,
): void {
  if (sender.isDestroyed()) return;
  sender.send(channel, payload);
}

export function registerAiIpc(): void {
  ipcMain.handle(
    'ai:chat-start',
    async (event, raw: unknown): Promise<void> => {
      const params = raw as Partial<ChatStartParams>;
      if (!params || typeof params.id !== 'string') {
        throw new Error('ai:chat-start: invalid params (missing id)');
      }
      const channel = `ai:chat-event:${params.id}`;

      if (!isValidRequest(params.request)) {
        send(event.sender, channel, {
          type: 'error',
          message: 'Invalid chat request',
        });
        return;
      }

      const request = params.request;
      const provider = getProvider(request.provider);
      if (!provider) {
        send(event.sender, channel, {
          type: 'error',
          message: `Provider '${request.provider}' is not implemented yet`,
        });
        return;
      }

      const apiKey = await getSecret(request.provider);
      if (provider.meta.requiresApiKey && !apiKey) {
        send(event.sender, channel, {
          type: 'error',
          message: `${provider.meta.label}: API 키가 저장되어 있지 않습니다. 설정에서 추가하세요.`,
        });
        return;
      }

      const ctrl = new AbortController();
      inflight.set(params.id, ctrl);

      try {
        let terminated = false;
        for await (const evt of provider.chat(request, {
          apiKey: apiKey ?? undefined,
          signal: ctrl.signal,
        })) {
          send(event.sender, channel, evt);
          if (evt.type === 'done' || evt.type === 'error') {
            terminated = true;
            return;
          }
        }
        if (!terminated) {
          send(event.sender, channel, { type: 'done' });
        }
      } catch (err) {
        send(event.sender, channel, {
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        inflight.delete(params.id);
      }
    },
  );

  ipcMain.handle('ai:chat-abort', (_event, id: unknown): void => {
    if (typeof id !== 'string') return;
    const ctrl = inflight.get(id);
    if (ctrl) {
      ctrl.abort();
      inflight.delete(id);
    }
  });

  ipcMain.handle('ai:ping', async (_event, raw: unknown): Promise<void> => {
    const params = (raw ?? {}) as {
      providerId?: unknown;
      apiKey?: unknown;
      baseUrl?: unknown;
    };
    if (!isProviderId(params.providerId)) {
      throw new Error(`Invalid provider id: ${String(params.providerId)}`);
    }
    const provider = getProvider(params.providerId);
    if (!provider) {
      throw new Error(`Provider '${params.providerId}' is not implemented yet`);
    }
    // Transient (typed-but-not-saved) key wins. Fall back to stored secret.
    const transient =
      typeof params.apiKey === 'string' && params.apiKey.length > 0
        ? params.apiKey
        : null;
    const apiKey = transient ?? (await getSecret(params.providerId));
    if (provider.meta.requiresApiKey && !apiKey) {
      throw new Error(
        `${provider.meta.label}: 키가 없습니다. 입력 후 테스트하거나 먼저 저장하세요.`,
      );
    }
    const baseUrl =
      typeof params.baseUrl === 'string' && params.baseUrl.length > 0
        ? params.baseUrl
        : undefined;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 15_000);
    try {
      await provider.ping({
        apiKey: apiKey ?? undefined,
        baseUrl,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  });
}
