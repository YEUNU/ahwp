/**
 * Per-provider configuration store — Phase 3 chunk 44.
 *
 * Stores non-secret per-provider settings (currently `baseUrl` for the
 * `custom` OpenAI-compatible bucket; could grow to include feature flags
 * like `supportsTools`). API keys still go through `secrets.ts` (safeStorage
 * encrypted) since they're sensitive; URLs are public so plain JSON is fine.
 *
 * File: `userData/provider-config.json`. Schema:
 *   { "<providerId>": { "baseUrl"?: string, "supportsTools"?: boolean } }
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ProviderId } from '../../shared/ai';

const FILE_NAME = 'provider-config.json';

export interface ProviderConfig {
  baseUrl?: string;
  /** Phase 3 chunk 44 — Agent 모드에서 tool 카탈로그 주입 여부.
   *  Custom (OpenAI-호환) 모델 중 tool 미지원 (Llama 2 base 등) 은
   *  Agent 모드에서 tools 미주입 + UI 에서 Agent 토글 비활성. */
  supportsTools?: boolean;
}

type Store = Partial<Record<ProviderId, ProviderConfig>>;

function file(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

function read(): Store {
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    const parsed = JSON.parse(raw) as Store;
    return parsed;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  try {
    fs.writeFileSync(file(), JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[provider-config] write failed', err);
  }
}

export function getProviderConfig(id: ProviderId): ProviderConfig {
  return read()[id] ?? {};
}

export function setProviderConfig(
  id: ProviderId,
  config: ProviderConfig,
): void {
  const store = read();
  store[id] = { ...store[id], ...config };
  write(store);
}

export function clearProviderConfig(id: ProviderId): void {
  const store = read();
  delete store[id];
  write(store);
}
