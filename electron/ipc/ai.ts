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
}
