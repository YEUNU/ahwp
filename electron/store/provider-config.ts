/**
 * Per-provider configuration store — Phase 3 chunk 44.
 *
 * Stores non-secret per-provider settings (currently `baseUrl` for the
 * `custom` OpenAI-compatible bucket). API keys still go through `secrets.ts`
 * (safeStorage encrypted) since they're sensitive; URLs are public so plain
 * JSON is fine.
 *
 * File: `userData/provider-config.json`. Schema:
 *   { "<providerId>": { "baseUrl"?: string } }
 */
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { ProviderId } from '../../shared/ai';

const FILE_NAME = 'provider-config.json';

export interface ProviderConfig {
  baseUrl?: string;
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
