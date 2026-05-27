/**
 * `validateToolCall` — 0.7.4 thin wrapper.
 *
 * **0.7.3 까지**: 본 파일이 800-line `validateArgs` switch 를 직접 들고
 * 모든 도구의 args 검증을 inline 으로 처리했다. catalog 와 분리되어 schema
 * 만 추가하고 validator 누락한 사례 (0.6.17 includeFilled) 가 회귀의 원인.
 *
 * **0.7.4**: 모든 55 도구가 `shared/ai-tools-defined/*.ts` 에서
 * `defineTool` 로 정의되고 validate 함수가 거기 co-located. 본 파일은
 * registry 의 validator map 으로 dispatch 하는 thin wrapper 만 남았다.
 * legacy `validateArgs` switch 완전 제거.
 *
 * helper 함수들 (isObj, byteLen, coerceNonNegInt, nonNegInts) 는 모든
 * defineTool 의 validate 안에서 재사용되도록 export.
 */
import { AHWP_TOOL_NAMES, type AhwpToolCall } from './ai-tools';
import { DEFINED_TOOL_REGISTRY } from './ai-tools-defined';

// ── helper 함수들 (defineTool 의 validate 안에서 재사용) ──────────────

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** chunk 96 — coerce a string-encoded non-negative integer ("42") to
 * number. Real LLM tool-use APIs (OpenAI / NVIDIA NIM / Gemini) often
 * stringify integer arg values even when the JSON Schema says
 * `integer`. Returns null if the value is not a usable non-negative
 * integer (rejects floats, negatives, NaN, scientific, leading zeroes
 * other than "0"). */
export function coerceNonNegInt(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isInteger(v) && v >= 0 ? v : null;
  }
  if (typeof v === 'string') {
    if (!/^(0|[1-9]\d*)$/.test(v)) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  }
  return null;
}

/** Phase 3 chunk 45+ — common pattern: validate a list of keys as
 * non-negative integers. chunk 96 — accept string-encoded ints too. */
export function nonNegInts(
  args: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; value: Record<string, number> } | { ok: false; reason: string } {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const n = coerceNonNegInt(args[k]);
    if (n === null) return { ok: false, reason: `${k}-not-non-negative-int` };
    out[k] = n;
  }
  return { ok: true, value: out };
}

// ── public entry ──────────────────────────────────────────────────────

export function validateToolCall(
  call: unknown,
):
  | { ok: true; value: AhwpToolCall }
  | { ok: false; tool: string; reason: string } {
  if (!isObj(call))
    return { ok: false, tool: '<root>', reason: 'op-not-object' };
  const tool = call.tool;
  if (typeof tool !== 'string')
    return { ok: false, tool: '<missing>', reason: 'tool-not-string' };
  if (!(AHWP_TOOL_NAMES as readonly string[]).includes(tool))
    return { ok: false, tool, reason: 'unknown_tool' };
  const args = call.args;
  if (!isObj(args)) return { ok: false, tool, reason: 'args-not-object' };

  // defineTool registry 가 single source. 모든 등록된 도구가 여기 있어야
  // 함 — 없으면 정의 누락 (AHWP_TOOL_NAMES 에 있는데 defineTool 안 됨).
  const validator = DEFINED_TOOL_REGISTRY.validators.get(tool);
  if (!validator) return { ok: false, tool, reason: 'tool-not-in-registry' };
  const v = validator(args);
  if (!v.ok) return { ok: false, tool, reason: v.reason };
  return { ok: true, value: { tool, args: v.args } as AhwpToolCall };
}
