/**
 * Bash 명령 실행 IPC — 0.7.9.
 *
 * AI 의 `runCommand` 도구의 main-process 구현. **위험 도구라 보안 게이트
 * 다중**:
 *
 *   1. **Enabled check** — `bash-config.json` 의 enabled 가 true 여야 함
 *      (사용자가 Settings 에서 명시 켜야 작동).
 *   2. **Allowlist match** — 명령이 사용자 등록 prefix 와 매치해야 함.
 *      비어있으면 deny-by-default.
 *   3. **Hardcoded blocklist** — sudo / rm -rf / fork bomb / curl|sh 등
 *      위험 패턴은 allowlist 통과해도 거부.
 *   4. **cwd 격리** — workspace root 기준 상대 경로만, 절대 경로 / `..`
 *      탈출 거부.
 *   5. **Timeout** — 기본 60s, 사용자 args 로 최대 5분.
 *   6. **Output cap** — stdout / stderr 각 32KB.
 *   7. **Env 화이트리스트** — PATH / HOME / USER / LANG 같은 안전한
 *      변수만 전달. 호스트 env 의 secrets (API keys 등) 노출 차단.
 *
 * **workspace root 결정**: file IPC 의 `lastFolderPath` (session.json) 에
 * 등록된 폴더. 등록 안 됐으면 cwd 사용 불가 (root 가 없으니).
 */
import { ipcMain } from 'electron';
import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BashRunRequest, BashRunResult } from '../../shared/api';
import {
  getBashAllowlist,
  isBashEnabled,
  matchesAllowlist,
  setBashAllowlist,
  setBashEnabled,
} from '../store/bash-allowlist';
import { getSession } from '../store/session';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_CAP_BYTES = 32 * 1024;

/**
 * Hardcoded blocklist. allowlist 가 어떻게 설정됐어도 이 패턴들은 거부.
 * 사용자가 의도하지 않은 catastrophic 명령 차단.
 *
 * 각 패턴은 trimmed command 의 substring 으로 검사. 위양성 가능성보다는
 * 명백한 위험 명령 차단이 우선 — 사용자가 정말 필요하면 0.7.9 이후
 * Settings 에서 blocklist override 옵션 추가 (현재 chunk 에서는 hardcoded).
 */
const BLOCKLIST_PATTERNS: readonly RegExp[] = [
  /\bsudo\b/, // 권한 상승
  /\bsu\b\s/, // user 전환
  /\brm\s+-[a-z]*r[a-z]*f/i, // rm -rf 변종
  /\brm\s+-[a-z]*f[a-z]*r/i, // rm -fr 변종
  /:\(\)\s*\{.*&\s*\}\s*;\s*:/, // fork bomb :(){:|:&};:
  /\bcurl\b[^|]*\|[^|]*\b(sh|bash|zsh)\b/, // curl ... | sh (remote exec)
  /\bwget\b[^|]*\|[^|]*\b(sh|bash|zsh)\b/, // wget ... | sh
  />\s*\/dev\/(?!null|stderr|stdout)/, // > /dev/(sda|disk0|...) 위험 redirect
  /\bdd\s+if=/, // dd if=... (disk write)
  /\bmkfs\b/, // 포맷
  /\bshutdown\b/,
  /\breboot\b/,
];

/**
 * 안전한 환경변수 화이트리스트. host env 의 모든 변수를 그대로 노출하면
 * API keys / tokens 등 secrets 가 child process 로 leak 가능. 명령 실행
 * 에 필요한 최소한만 전달.
 */
const SAFE_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'USERNAME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TERM',
  'SHELL',
  'TMPDIR',
] as const;

function buildSafeEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = process.env[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * `command` 가 blocklist 의 위험 패턴 중 하나와 매치되는지 검사. 매치
 * 시 reason 문자열 반환, 아니면 null.
 */
function checkBlocklist(command: string): string | null {
  for (const re of BLOCKLIST_PATTERNS) {
    if (re.test(command)) {
      return `blocklist:${re.source}`;
    }
  }
  return null;
}

/**
 * cwd 검증. 절대 경로 거부, `..` 으로 workspace root 탈출 거부.
 * 정상 케이스에선 workspace root 와 결합한 절대 경로 반환.
 */
function resolveCwd(
  relativeCwd: string | undefined,
  workspaceRoot: string,
): { ok: true; absolute: string } | { ok: false; reason: string } {
  if (relativeCwd === undefined || relativeCwd === '') {
    return { ok: true, absolute: workspaceRoot };
  }
  if (path.isAbsolute(relativeCwd)) {
    return { ok: false, reason: 'cwd-must-be-relative' };
  }
  const absolute = path.resolve(workspaceRoot, relativeCwd);
  // workspace 외부로 탈출 검사 (path.resolve 가 ".." 처리).
  const rel = path.relative(workspaceRoot, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: 'cwd-outside-workspace' };
  }
  return { ok: true, absolute };
}

/**
 * 응답 출력을 cap. binary safety 보다 가독성 우선 — UTF-8 decode 후
 * length 기준 자르기. 잘림 여부 boolean 으로 보고.
 */
function capOutput(s: string): { text: string; truncated: boolean } {
  if (s.length <= OUTPUT_CAP_BYTES) return { text: s, truncated: false };
  return {
    text: s.slice(0, OUTPUT_CAP_BYTES) + '\n…[trimmed]',
    truncated: true,
  };
}

const execAsync = promisify(exec);

/**
 * 모든 보안 게이트 검사 — exec 직전까지. pure async function 이라
 * 테스트 가능. 통과 시 `{ok:true, command, cwdAbsolute, timeoutMs}` 반환,
 * 실패 시 `{ok:false, reason}`. bashRunImpl 가 이 결과로 exec 결정.
 */
export async function validateBashRun(
  req: BashRunRequest,
): Promise<
  | { ok: true; command: string; cwdAbsolute: string; timeoutMs: number }
  | { ok: false; reason: string }
> {
  // 1. enabled check
  if (!(await isBashEnabled())) return { ok: false, reason: 'bash-disabled' };

  // 2. command 형식
  const command = req.command?.trim() ?? '';
  if (command.length === 0) return { ok: false, reason: 'command-empty' };
  if (command.length > 4096) return { ok: false, reason: 'command-too-large' };

  // 3. blocklist (가장 먼저 — allowlist 와 무관)
  const blockedBy = checkBlocklist(command);
  if (blockedBy) return { ok: false, reason: blockedBy };

  // 4. allowlist match
  const allowlist = await getBashAllowlist();
  if (allowlist.length === 0) return { ok: false, reason: 'allowlist-empty' };
  if (!matchesAllowlist(command, allowlist))
    return { ok: false, reason: 'not-in-allowlist' };

  // 5. workspace root 결정
  const session = await getSession();
  const workspaceRoot = session.lastFolderPath ?? null;
  if (!workspaceRoot) return { ok: false, reason: 'no-workspace-root' };

  // 6. cwd 검증
  const cwd = resolveCwd(req.cwd, workspaceRoot);
  if (!cwd.ok) return { ok: false, reason: cwd.reason };

  // 7. timeout clamp
  const timeoutMs = Math.min(
    Math.max(req.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000),
    MAX_TIMEOUT_MS,
  );

  return { ok: true, command, cwdAbsolute: cwd.absolute, timeoutMs };
}

export async function bashRunImpl(req: BashRunRequest): Promise<BashRunResult> {
  const v = await validateBashRun(req);
  if (!v.ok) return { ok: false, reason: v.reason };
  const { command, cwdAbsolute, timeoutMs } = v;

  // 8. exec — child_process.exec 는 shell 통과. allowlist 가 있어도 shell
  // metacharacter (` ; | &) 는 expansion 됨. 사용자가 의도해서 등록한
  // pipe 명령 등 정상 동작. blocklist 가 위험 redirect / fork bomb 차단.
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: cwdAbsolute,
      timeout: timeoutMs,
      maxBuffer: OUTPUT_CAP_BYTES * 4, // exec 의 내부 buffer (cap 외 여유).
      env: buildSafeEnv(),
      windowsHide: true,
    });
    const capped = capOutput(stdout);
    const cappedErr = capOutput(stderr);
    return {
      ok: true,
      exitCode: 0,
      stdout: capped.text,
      stderr: cappedErr.text,
      truncatedStdout: capped.truncated,
      truncatedStderr: cappedErr.truncated,
    };
  } catch (e) {
    // exec 가 throw 하는 경우: non-zero exit / timeout / signal.
    const err = e as {
      code?: number;
      signal?: string;
      stdout?: string;
      stderr?: string;
      message?: string;
      killed?: boolean;
    };
    const stdout = capOutput(err.stdout ?? '');
    const stderr = capOutput(err.stderr ?? '');
    if (err.killed && err.signal === 'SIGTERM') {
      return {
        ok: false,
        reason: 'timeout',
        stdout: stdout.text,
        stderr: stderr.text,
        truncatedStdout: stdout.truncated,
        truncatedStderr: stderr.truncated,
      };
    }
    return {
      ok: false,
      reason: `exec-failed:${err.message ?? 'unknown'}`,
      exitCode: err.code,
      stdout: stdout.text,
      stderr: stderr.text,
      truncatedStdout: stdout.truncated,
      truncatedStderr: stderr.truncated,
    };
  }
}

export function registerBashIpc(): void {
  ipcMain.handle('bash:is-enabled', async (): Promise<boolean> => {
    return await isBashEnabled();
  });
  ipcMain.handle(
    'bash:set-enabled',
    async (_event, on: unknown): Promise<void> => {
      if (typeof on !== 'boolean') throw new Error('on-must-be-boolean');
      await setBashEnabled(on);
    },
  );
  ipcMain.handle('bash:get-allowlist', async (): Promise<string[]> => {
    return await getBashAllowlist();
  });
  ipcMain.handle(
    'bash:set-allowlist',
    async (_event, patterns: unknown): Promise<void> => {
      if (!Array.isArray(patterns)) {
        throw new Error('patterns-must-be-array');
      }
      const strs = patterns.filter((p): p is string => typeof p === 'string');
      await setBashAllowlist(strs);
    },
  );
  // 실제 명령 실행은 renderer (tools.ts dispatcher) 가 호출. 단 본 IPC
  // 는 contextBridge 에 노출되지 않음 — dispatcher 가 main 측 IPC 를
  // 직접 호출하는 게 아니라, BashApi 의 read/write 만 노출되고 exec
  // 는 별도 'bash:run' invoke 로. dispatcher 가 이걸 사용.
  ipcMain.handle(
    'bash:run',
    async (_event, req: BashRunRequest): Promise<BashRunResult> => {
      return await bashRunImpl(req);
    },
  );
}
