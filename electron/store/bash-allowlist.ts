/**
 * Bash 명령 실행 설정 store — 0.7.9.
 *
 * 두 가지 상태:
 *   - `enabled` (boolean): 도구 활성화 토글. 기본 false. AI catalog 에
 *     `runCommand` 가 노출되려면 true 필수.
 *   - `allowlist` (string[]): 명령의 prefix 패턴들. 비어있으면 enabled
 *     라도 모든 호출 거부 (deny-by-default).
 *
 * **저장 위치**: `userData/bash-config.json` — plaintext. allowlist 는
 * 비밀이 아니므로 safeStorage 사용 안 함. enabled 토글도 plaintext.
 *
 * **renderer 노출**: enabled + allowlist 둘 다 getter / setter 가 있음
 * (Settings UI 가 사용). 실제 명령 실행은 main process IPC 가 직접
 * 처리, allowlist 검증도 main 측에서만.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const FILE_NAME = 'bash-config.json';

interface Persisted {
  enabled: boolean;
  allowlist: string[];
}

interface State {
  enabled: boolean;
  allowlist: string[];
}

let cache: State | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

async function load(): Promise<State> {
  if (cache) return cache;
  const next: State = { enabled: false, allowlist: [] };
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    if (typeof parsed.enabled === 'boolean') next.enabled = parsed.enabled;
    if (Array.isArray(parsed.allowlist)) {
      next.allowlist = parsed.allowlist.filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0,
      );
    }
  } catch (err) {
    const isMissing =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'ENOENT';
    if (!isMissing) {
      console.warn(
        '[bash-allowlist] load failed, starting with defaults:',
        err,
      );
    }
  }
  cache = next;
  return cache;
}

function persist(): void {
  if (!cache) return;
  const snapshot: Persisted = { ...cache };
  writeChain = writeChain
    .then(async () => {
      const target = storePath();
      const tmp = `${target}.tmp`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await fs.rename(tmp, target);
    })
    .catch((err) => {
      console.error('[bash-allowlist] write failed:', err);
    });
}

export async function isBashEnabled(): Promise<boolean> {
  const s = await load();
  return s.enabled;
}

export async function setBashEnabled(on: boolean): Promise<void> {
  const s = await load();
  s.enabled = on;
  persist();
}

export async function getBashAllowlist(): Promise<string[]> {
  const s = await load();
  return [...s.allowlist];
}

export async function setBashAllowlist(patterns: string[]): Promise<void> {
  const s = await load();
  s.allowlist = patterns
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .slice(0, 200); // 200 패턴 cap.
  persist();
}

/**
 * 명령이 allowlist 의 prefix 중 하나와 매치하는지 검사.
 *
 * 매치 규칙:
 *   - 단순 prefix 매치 (case-sensitive). e.g. allowlist 에 "git status"
 *     가 있으면 "git status", "git status -s" 등 매치.
 *   - "git status -s -uall" 처럼 추가 args 가 있어도 prefix 가 같으면 OK.
 *   - "git statuses" 같은 word-boundary 위반은 거부 (prefix 끝이 word
 *     character 일 때, 다음 문자가 space / 끝 / 시작이어야 함).
 *
 * **regex 형식 (0.7.9 단순화)**: 지원 안 함. 미래 chunk 에서 `/^npm /` 같은
 * 슬래시 wrapper 로 regex 지원 추가 예정.
 */
export function matchesAllowlist(
  command: string,
  allowlist: readonly string[],
): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  for (const pat of allowlist) {
    if (trimmed === pat) return true;
    // prefix 매치 + 다음 문자가 word boundary
    if (trimmed.startsWith(pat)) {
      const next = trimmed.charAt(pat.length);
      if (next === '' || next === ' ' || next === '\t') return true;
    }
  }
  return false;
}
