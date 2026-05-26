import { app, safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isProviderId, type ProviderId } from '../../shared/ai';

const FILE_NAME = 'secrets.json';

interface Persisted {
  /** providerId → base64(safeStorage.encryptString(plaintext)) */
  keys: Record<string, string>;
}

let cache: Map<ProviderId, string> | null = null;
// 0.4.8: main-process plaintext cache for decrypted keys. macOS Keychain
// ACL = "Allow once" (not "Always Allow") triggers a prompt every
// `safeStorage.decryptString` call. Caching the decrypted value in
// main-process memory consolidates prompts to ONCE per (providerId, app
// session). Renderer never sees the plaintext (no `secrets:get` IPC).
// Invalidated on `setSecret` / `deleteSecret`.
const plaintextCache = new Map<ProviderId, string>();
// 0.6.6 — 동시 호출 dedupe. ChatPanel 의 prefetchAllProviders 가 여러
// provider 키를 거의 동시에 fetch 하면 각 providerId 의 cache 가 모두
// miss → 동시 decryptString 발생 → macOS Keychain prompt 가 N번 큐잉.
// in-flight Promise 를 share 해서 같은 providerId 의 동시 요청은 한
// 번의 decrypt 만 발생. 더해서 globalDecryptChain 으로 서로 다른
// providerId 도 직렬화 — Keychain "Always Allow" ACL 이 자리 잡기 전
// 두 번째 prompt 가 끼어드는 회귀 방지.
const pendingDecrypts = new Map<ProviderId, Promise<string | null>>();
let globalDecryptChain: Promise<unknown> = Promise.resolve();
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

async function load(): Promise<Map<ProviderId, string>> {
  if (cache) return cache;
  const map = new Map<ProviderId, string>();
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (parsed.keys && typeof parsed.keys === 'object') {
      for (const [k, v] of Object.entries(parsed.keys)) {
        if (isProviderId(k) && typeof v === 'string') map.set(k, v);
      }
    }
  } catch (err) {
    const isMissing =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'ENOENT';
    if (!isMissing) {
      console.warn('[secrets] failed to load, starting empty:', err);
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
      console.error('[secrets] write failed:', err);
    });
}

function ensureSafeStorage(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // On Linux this typically means no keyring is configured (no
    // libsecret / GNOME Keyring / KDE Wallet). The user can install one
    // and restart, or use environment-variable injection in dev.
    throw new Error(
      'safeStorage is not available on this system. ' +
        'Install a system keyring (libsecret on Linux) and restart the app.',
    );
  }
}

export async function setSecret(
  providerId: ProviderId,
  plaintext: string,
): Promise<void> {
  if (plaintext.length === 0) {
    throw new Error('Cannot store an empty key. Use deleteSecret instead.');
  }
  ensureSafeStorage();
  const map = await load();
  const encrypted = safeStorage.encryptString(plaintext).toString('base64');
  map.set(providerId, encrypted);
  // 0.4.8: warm the plaintext cache so the next getSecret in this
  // session is silent (no extra Keychain decrypt prompt).
  plaintextCache.set(providerId, plaintext);
  persist();
}

/**
 * Decrypt and return the stored key. Main-process only — never expose this
 * over IPC. Adapters call this just before issuing a request.
 *
 * 0.4.8: caches the plaintext after first decrypt so repeated calls in
 * the same app session don't re-trigger macOS Keychain ACL prompts.
 *
 * 0.6.6: 동시 호출 dedupe + 전역 직렬화.
 * - 같은 providerId 의 in-flight 요청은 Promise share (cache stampede 회피).
 * - 서로 다른 providerId 라도 globalDecryptChain 으로 직렬화 — macOS Keychain
 *   prompt 가 응답되기 전 다음 decrypt 가 끼어들면 두 번째 prompt 가 큐잉
 *   되는 회귀 방지.
 */
export async function getSecret(
  providerId: ProviderId,
): Promise<string | null> {
  // Fast path 1: 이미 plaintext cache hit.
  const cached = plaintextCache.get(providerId);
  if (cached !== undefined) return cached;
  // Fast path 2: 같은 providerId 의 decrypt 가 이미 in-flight — 그 Promise share.
  const inflight = pendingDecrypts.get(providerId);
  if (inflight) return inflight;
  // 새 decrypt — globalDecryptChain 에 enqueue (다른 providerId 와 직렬화).
  const promise = (async () => {
    // chain 끝까지 기다린 후 본 decrypt 진입.
    await globalDecryptChain.catch(() => undefined);
    // chain 진입 후 다시 cache 확인 — 우리가 기다리는 동안 다른 호출이
    // 같은 key 를 decrypt 해뒀을 수 있음 (다른 providerId 끼리 별개지만
    // 동일 providerId 우회 케이스 가드).
    const recheck = plaintextCache.get(providerId);
    if (recheck !== undefined) return recheck;
    const map = await load();
    const enc = map.get(providerId);
    if (!enc) return null;
    ensureSafeStorage();
    try {
      const plaintext = safeStorage.decryptString(Buffer.from(enc, 'base64'));
      plaintextCache.set(providerId, plaintext);
      return plaintext;
    } catch (err) {
      console.error(`[secrets] failed to decrypt key for ${providerId}:`, err);
      return null;
    }
  })();
  pendingDecrypts.set(providerId, promise);
  // 다음 호출자가 이 작업을 기다리도록 chain 갱신. 실패해도 chain 은
  // resolved 상태로 두기 위해 catch.
  globalDecryptChain = promise.catch(() => undefined);
  try {
    return await promise;
  } finally {
    pendingDecrypts.delete(providerId);
  }
}

export async function deleteSecret(providerId: ProviderId): Promise<void> {
  const map = await load();
  if (map.delete(providerId)) {
    plaintextCache.delete(providerId);
    persist();
  }
}

export async function hasSecret(providerId: ProviderId): Promise<boolean> {
  const map = await load();
  return map.has(providerId);
}

export async function listProvidersWithSecret(): Promise<ProviderId[]> {
  const map = await load();
  return Array.from(map.keys());
}
