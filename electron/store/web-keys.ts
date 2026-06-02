/**
 * Web search backend API key store — 0.7.8.
 *
 * 0.7.7 의 DDG HTML scraping 은 IP rate-limit / 결과 품질 문제. 0.7.8
 * 부터 사용자가 무료 / 유료 정식 API 키를 등록하면 그쪽을 우선 사용,
 * 없으면 DDG fallback.
 *
 * 지원 backend:
 *   - `brave` — Brave Search API (https://api.search.brave.com/). 무료 tier
 *     2000 q/month. 가장 깔끔한 JSON 응답, 가장 빠른 응답.
 *   - `serpapi` — SerpAPI (https://serpapi.com/). Google 결과를 직접 받음.
 *     무료 tier 100 q/month. 향후 추가 — 본 chunk 에선 placeholder.
 *
 * **저장 방식**: secrets.ts 와 동일한 `safeStorage` 암호화 + JSON sidecar.
 * provider 키 store 와 분리한 이유는 ProviderId union 오염 회피 + UI
 * (chat provider dropdown) 에 검색 backend 가 새도록 하지 않기 위함.
 *
 * **renderer 노출**: 키 plaintext 는 renderer 에 노출 안 함 (`get` IPC
 * 없음). renderer 는 `has` / `set` / `delete` 만 호출. 실제 API 호출은
 * main process 의 webSearchImpl 안에서 키를 직접 사용.
 */
import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type WebSearchBackend = 'brave' | 'serpapi';

const SUPPORTED: WebSearchBackend[] = ['brave', 'serpapi'];

export function isWebSearchBackend(v: unknown): v is WebSearchBackend {
  return typeof v === 'string' && (SUPPORTED as string[]).includes(v);
}

const FILE_NAME = 'web-keys.json';

interface Persisted {
  /** backend → base64(safeStorage.encryptString(plaintext)) */
  keys: Record<string, string>;
}

let cache: Map<WebSearchBackend, string> | null = null;
const plaintextCache = new Map<WebSearchBackend, string>();
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

async function load(): Promise<Map<WebSearchBackend, string>> {
  if (cache) return cache;
  const map = new Map<WebSearchBackend, string>();
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (parsed.keys && typeof parsed.keys === 'object') {
      for (const [k, v] of Object.entries(parsed.keys)) {
        if (isWebSearchBackend(k) && typeof v === 'string') map.set(k, v);
      }
    }
  } catch (err) {
    const isMissing =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'ENOENT';
    if (!isMissing) {
      console.warn('[web-keys] failed to load, starting empty:', err);
    }
  }
  cache = map;
  return cache;
}

function persist(): void {
  if (!cache) return;
  const snapshot: Persisted = {
    keys: Object.fromEntries(cache.entries()),
  };
  writeChain = writeChain
    .then(async () => {
      const target = storePath();
      const tmp = `${target}.tmp`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(snapshot), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(tmp, target);
    })
    .catch((err) => {
      console.error('[web-keys] write failed:', err);
    });
}

export async function setWebSearchKey(
  backend: WebSearchBackend,
  plaintext: string,
): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('safeStorage encryption is not available on this platform');
  }
  const trimmed = plaintext.trim();
  if (trimmed.length === 0) throw new Error('Key must be non-empty');
  const encrypted = safeStorage.encryptString(trimmed).toString('base64');
  const map = await load();
  map.set(backend, encrypted);
  plaintextCache.set(backend, trimmed);
  persist();
}

export async function deleteWebSearchKey(
  backend: WebSearchBackend,
): Promise<void> {
  const map = await load();
  map.delete(backend);
  plaintextCache.delete(backend);
  persist();
}

export async function hasWebSearchKey(
  backend: WebSearchBackend,
): Promise<boolean> {
  const map = await load();
  return map.has(backend);
}

export async function listBackendsWithKey(): Promise<WebSearchBackend[]> {
  const map = await load();
  return [...map.keys()];
}

/**
 * Main process 전용 — plaintext key 조회. renderer 에 노출 안 함.
 * 호출 시 safeStorage.decryptString 발생 → macOS Keychain prompt 가능
 * (Always Allow ACL 등록 전까지). 동일 backend 의 plaintext 는 cache.
 */
export async function getWebSearchKeyPlaintext(
  backend: WebSearchBackend,
): Promise<string | null> {
  const cached = plaintextCache.get(backend);
  if (cached !== undefined) return cached;
  const map = await load();
  const enc = map.get(backend);
  if (!enc) return null;
  try {
    const buf = Buffer.from(enc, 'base64');
    const plain = safeStorage.decryptString(buf);
    plaintextCache.set(backend, plain);
    return plain;
  } catch (err) {
    console.warn(`[web-keys] decrypt failed for ${backend}:`, err);
    return null;
  }
}

/**
 * 사용 가능한 backend 의 우선순위 자동 선택. brave > serpapi > null
 * (null 이면 caller 가 DDG fallback).
 */
export async function pickActiveSearchBackend(): Promise<WebSearchBackend | null> {
  const available = await listBackendsWithKey();
  if (available.includes('brave')) return 'brave';
  if (available.includes('serpapi')) return 'serpapi';
  return null;
}
