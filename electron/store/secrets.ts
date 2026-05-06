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
 */
export async function getSecret(
  providerId: ProviderId,
): Promise<string | null> {
  const cached = plaintextCache.get(providerId);
  if (cached !== undefined) return cached;
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
