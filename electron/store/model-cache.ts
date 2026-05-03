import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProviderId } from '../../shared/ai';

/**
 * Provider model-list cache — chunk 48. Each successful `listModels`
 * fetch is persisted to `userData/model-cache.json` with a fetch
 * timestamp. The renderer reads through `ai:list-models`, which serves
 * fresh entries (< 24h) directly and refetches stale ones; on refetch
 * failure we hand back the stale entry as `{ status: 'stale-cache' }`
 * so the UI can keep its dropdown populated while flagging the issue.
 *
 * Disk shape:
 *   { "openai": { "fetchedAt": 173..., "models": [...] }, "nvidia": ... }
 *
 * Failures (read or write) are non-fatal — the cache is best-effort and
 * a missing file just means the next fetch becomes the seed.
 */

export interface CacheEntry {
  fetchedAt: number;
  models: string[];
}

type CacheFile = Partial<Record<ProviderId, CacheEntry>>;

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function cachePath(): string {
  return path.join(app.getPath('userData'), 'model-cache.json');
}

async function readFile(): Promise<CacheFile> {
  try {
    const buf = await fs.readFile(cachePath(), 'utf8');
    const parsed = JSON.parse(buf) as CacheFile;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeFile(data: CacheFile): Promise<void> {
  try {
    await fs.writeFile(cachePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // Non-fatal — log and move on. Next save will retry.
    console.warn('[model-cache] write failed:', err);
  }
}

export async function readCachedModels(
  providerId: ProviderId,
): Promise<CacheEntry | null> {
  const file = await readFile();
  return file[providerId] ?? null;
}

export async function writeCachedModels(
  providerId: ProviderId,
  models: string[],
): Promise<CacheEntry> {
  const file = await readFile();
  const entry: CacheEntry = { fetchedAt: Date.now(), models };
  file[providerId] = entry;
  await writeFile(file);
  return entry;
}

export async function clearCachedModels(providerId: ProviderId): Promise<void> {
  const file = await readFile();
  if (file[providerId]) {
    delete file[providerId];
    await writeFile(file);
  }
}

export function isFresh(entry: CacheEntry, now = Date.now()): boolean {
  return now - entry.fetchedAt < CACHE_TTL_MS;
}
