import { ipcMain, type WebContents } from 'electron';
import { getProvider } from '../ai/registry';
import { getSecret } from '../store/secrets';
import {
  clearCachedModels,
  isFresh,
  readCachedModels,
  writeCachedModels,
} from '../store/model-cache';
import { getProviderConfig, setProviderConfig } from '../store/provider-config';
import { isProviderId } from '../../shared/ai';
import type {
  ChatRequest,
  ChatStreamEvent,
  ModelListResult,
  ProviderId,
} from '../../shared/ai';

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

      // Phase 3 chunk 44 — provider-config (baseUrl 등) 를 chat 에도 주입.
      // 기존엔 listModels 만 baseUrl 받아서 custom provider 가 chat 시점
      // 에 default URL 로 떨어지던 문제 해결.
      const cfg = getProviderConfig(request.provider);
      try {
        let terminated = false;
        for await (const evt of provider.chat(request, {
          apiKey: apiKey ?? undefined,
          baseUrl: cfg.baseUrl,
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

  // Phase 3 chunk 44 — provider-config (baseUrl, supportsTools) IPC.
  ipcMain.handle(
    'ai:provider-config-get',
    (
      _event,
      providerId: unknown,
    ): { baseUrl?: string; supportsTools?: boolean } => {
      if (!isProviderId(providerId)) return {};
      return getProviderConfig(providerId);
    },
  );
  ipcMain.handle(
    'ai:provider-config-set',
    (_event, params: unknown): { ok: true } => {
      const p = params as {
        providerId?: unknown;
        baseUrl?: unknown;
        supportsTools?: unknown;
      };
      if (!isProviderId(p?.providerId as ProviderId | string))
        throw new Error('invalid providerId');
      const next: { baseUrl?: string; supportsTools?: boolean } = {};
      if (typeof p.baseUrl === 'string') next.baseUrl = p.baseUrl;
      if (typeof p.supportsTools === 'boolean')
        next.supportsTools = p.supportsTools;
      setProviderConfig(p.providerId as ProviderId, next);
      return { ok: true };
    },
  );

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

  // chunk 48 — model list with 24h cache. Renderer params:
  //   { providerId, baseUrl?, force? }
  // - force=true bypasses cache and refetches.
  // - On fetch success we update the cache and return `{ ok }`.
  // - On fetch failure with a usable cached entry, return `{ stale-cache }`
  //   so the UI can keep its dropdown populated.
  // - On failure with no cache at all, return `{ error }` — the UI shows
  //   "확인 불가" and falls back to free-text input.
  ipcMain.handle(
    'ai:list-models',
    async (_event, raw: unknown): Promise<ModelListResult> => {
      const params = (raw ?? {}) as {
        providerId?: unknown;
        baseUrl?: unknown;
        force?: unknown;
      };
      if (!isProviderId(params.providerId)) {
        return {
          status: 'error',
          reason: `invalid provider id: ${String(params.providerId)}`,
        };
      }
      const providerId = params.providerId;
      const provider = getProvider(providerId);
      if (!provider || typeof provider.listModels !== 'function') {
        return {
          status: 'error',
          reason: `provider '${providerId}' does not expose a model list`,
        };
      }
      const force = params.force === true;
      const cached = await readCachedModels(providerId);
      if (!force && cached && isFresh(cached)) {
        return {
          status: 'ok',
          models: cached.models,
          fetchedAt: cached.fetchedAt,
        };
      }
      const apiKey = await getSecret(providerId);
      if (provider.meta.requiresApiKey && !apiKey) {
        if (cached) {
          return {
            status: 'stale-cache',
            models: cached.models,
            fetchedAt: cached.fetchedAt,
            reason: '키가 저장되어 있지 않아 새로 가져올 수 없습니다.',
          };
        }
        return {
          status: 'error',
          reason: '키가 저장되어 있지 않습니다.',
        };
      }
      const baseUrl =
        typeof params.baseUrl === 'string' && params.baseUrl.length > 0
          ? params.baseUrl
          : undefined;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 15_000);
      try {
        const models = await provider.listModels({
          apiKey: apiKey ?? undefined,
          baseUrl,
          signal: ctrl.signal,
        });
        const entry = await writeCachedModels(providerId, models);
        return {
          status: 'ok',
          models: entry.models,
          fetchedAt: entry.fetchedAt,
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        if (cached) {
          return {
            status: 'stale-cache',
            models: cached.models,
            fetchedAt: cached.fetchedAt,
            reason,
          };
        }
        return { status: 'error', reason };
      } finally {
        clearTimeout(timeout);
      }
    },
  );

  // chunk 48 — manual cache invalidation hook for the Settings "새로고침"
  // button when the user wants a clean slate (e.g. after rotating a key).
  ipcMain.handle(
    'ai:clear-models-cache',
    async (_event, raw: unknown): Promise<void> => {
      const params = (raw ?? {}) as { providerId?: unknown };
      if (!isProviderId(params.providerId)) return;
      await clearCachedModels(params.providerId);
    },
  );
}
