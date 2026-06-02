/**
 * Bash allowlist matcher 단위 테스트 — 0.7.9.
 *
 * `matchesAllowlist` 의 prefix 매치 + word boundary 검증. 회귀 시나리오:
 *   - "git status" 가 "git statuses" 와 false-positive 안 되도록
 *   - 정확히 같은 명령은 매치
 *   - prefix + args 는 매치
 *   - 빈 allowlist 는 모든 명령 거부
 */
import { describe, expect, it } from 'vitest';
import { matchesAllowlist } from './bash-allowlist';

describe('matchesAllowlist — prefix + word boundary', () => {
  it('빈 allowlist → 모두 거부', () => {
    expect(matchesAllowlist('git status', [])).toBe(false);
    expect(matchesAllowlist('ls', [])).toBe(false);
  });

  it('정확히 같은 명령 → 허용', () => {
    expect(matchesAllowlist('git status', ['git status'])).toBe(true);
    expect(matchesAllowlist('ls', ['ls'])).toBe(true);
  });

  it('prefix + args 허용 (다음 문자가 공백)', () => {
    expect(matchesAllowlist('git status -s', ['git status'])).toBe(true);
    expect(matchesAllowlist('git status -s -uall', ['git status'])).toBe(true);
    expect(matchesAllowlist('ls -la', ['ls'])).toBe(true);
  });

  it('word boundary 위반 거부 (prefix 끝에 추가 char 붙은 다른 단어)', () => {
    // "git statuses" 는 "git status" 의 false-positive 가 되면 안 됨.
    expect(matchesAllowlist('git statuses', ['git status'])).toBe(false);
    expect(matchesAllowlist('lsof', ['ls'])).toBe(false);
    expect(matchesAllowlist('npmtest', ['npm test'])).toBe(false);
  });

  it('여러 패턴 중 하나 매치 → 허용', () => {
    const list = ['git status', 'npm test', 'ls'];
    expect(matchesAllowlist('git status', list)).toBe(true);
    expect(matchesAllowlist('npm test --watch', list)).toBe(true);
    expect(matchesAllowlist('ls -la', list)).toBe(true);
    expect(matchesAllowlist('rm -rf /', list)).toBe(false);
  });

  it('빈 / whitespace-only 명령 거부', () => {
    expect(matchesAllowlist('', ['ls'])).toBe(false);
    expect(matchesAllowlist('   ', ['ls'])).toBe(false);
  });

  it('명령에 앞뒤 공백 있어도 trim 후 매치', () => {
    expect(matchesAllowlist('  git status  ', ['git status'])).toBe(true);
  });

  it('case-sensitive 매치 (Git Status ≠ git status)', () => {
    expect(matchesAllowlist('Git Status', ['git status'])).toBe(false);
  });
});
