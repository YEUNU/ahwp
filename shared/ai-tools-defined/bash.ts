/**
 * Bash 명령 실행 도구 — defineTool migration (0.7.9).
 *
 * **위험 도구**. Default OFF — 사용자가 Settings 에서 명시 enable 하고
 * allowlist 등록해야 catalog 에 노출됨. main process 에서 다중 게이트:
 *   - enabled 토글
 *   - allowlist prefix 매치
 *   - hardcoded blocklist (rm -rf / sudo / fork bomb / curl | sh 등)
 *   - cwd 격리 (workspace root 안만)
 *   - 60s timeout (사용자 args 로 최대 5분)
 *   - stdout / stderr 32KB cap
 *
 * 본 defineTool 의 validate 는 **shape 만** 검사. 실제 보안 게이트는
 * main process IPC 핸들러 (`electron/ipc/bash.ts`) 가 처리.
 */
import type { AhwpToolArgs } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, coerceNonNegInt } from '../ai-tool-validate';

export const runCommand = defineTool<'runCommand', AhwpToolArgs['runCommand']>({
  name: 'runCommand',
  description:
    "Execute a shell command in the user's workspace. **Restricted by allowlist** — the user has pre-registered command prefixes in Settings; commands not matching any prefix are rejected. Common useful patterns the user may have allowed: `git status`, `git diff`, `npm test`, `npm run build`, `ls`, `cat`, `grep`. Working directory defaults to the workspace root; pass `cwd` as a *relative* path (workspace-rooted) for sub-folders — absolute paths are rejected. Output is capped at 32KB per stream (stdout / stderr). Default timeout 60s, max 5 minutes. Hardcoded blocklist always rejects sudo, rm -rf, fork bombs, curl|sh, dd if=, mkfs, shutdown, reboot, dev redirects. **Use sparingly** — prefer specific tools (webFetch / searchWorkspaceOutlines / readParagraphByPath) when they fit; runCommand is for when the user explicitly wants to invoke their dev workflow.",
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', minLength: 1, maxLength: 4096 },
      cwd: { type: 'string', maxLength: 1024 },
      timeoutMs: { type: 'integer', minimum: 1000, maximum: 300_000 },
    },
    required: ['command'],
  },
  // IR mutation 은 아니지만 filesystem 부작용 가능 → readonly:false.
  // (현재 dispatcher 는 confirm 게이트 폐기됐지만, 향후 0.7.x 에서 bash
  // 만의 confirm UI 추가 시 본 flag 활용.)
  readonly: false,
  // cross-doc-research 는 read-only 라 제외. free-authoring / body-edit
  // 에서만 노출 (사용자가 실제 작업 중일 때만 의미 있음).
  modes: ['free-authoring', 'body-edit'],
  validate(raw) {
    const command = raw.command;
    if (typeof command !== 'string')
      return { ok: false, reason: 'command-not-string' };
    const trimmed = command.trim();
    if (trimmed.length === 0) return { ok: false, reason: 'command-empty' };
    if (byteLen(trimmed) > 4096)
      return { ok: false, reason: 'command-too-large' };
    const out: AhwpToolArgs['runCommand'] = { command: trimmed };
    if (raw.cwd !== undefined) {
      if (typeof raw.cwd !== 'string')
        return { ok: false, reason: 'cwd-not-string' };
      if (byteLen(raw.cwd) > 1024)
        return { ok: false, reason: 'cwd-too-large' };
      out.cwd = raw.cwd;
    }
    if (raw.timeoutMs !== undefined) {
      const n = coerceNonNegInt(raw.timeoutMs);
      if (n === null || n < 1000 || n > 300_000)
        return { ok: false, reason: 'timeoutMs-out-of-range' };
      out.timeoutMs = n;
    }
    return { ok: true, args: out };
  },
});
