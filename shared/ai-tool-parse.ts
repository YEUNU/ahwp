/**
 * `parseToolBlock` + `AhwpPreflightItem` — R4 에서 `shared/ai-tools.ts`
 * 로부터 분리. 모델이 작성한 ahwp-tools JSON 블록을 op 단위로
 * pre-flight. block-level 실패 (parse / not-array / over op limit) 는
 * 전체 거절, per-op 실패는 `ok: false` 항목으로 유지 (preview 가 빨간색
 * 표시).
 */
import { AHWP_TOOL_LIMITS, type AhwpToolCall } from './ai-tools';
import { validateToolCall } from './ai-tool-validate';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Pre-flight item: per-op validation result. Both arms are kept (the
 * preview lists failures in red so the user sees what the model got
 * wrong); the dispatcher only runs the `ok: true` arm. */
export type AhwpPreflightItem =
  | { ok: true; call: AhwpToolCall }
  | { ok: false; tool: string; reason: string };

/** Parse a model-authored block. Block-level failures (parse error,
 * not-an-array, over op limit) reject the whole thing. Per-op
 * validation failures are kept as `ok: false` items so the preview can
 * show them — the dispatcher runs only the successful ones. */
export function parseToolBlock(
  raw: string,
): { ok: true; items: AhwpPreflightItem[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `parse:${(err as Error).message}` };
  }
  if (!isObj(parsed)) return { ok: false, reason: 'root-not-object' };
  const ops = parsed.ops;
  if (!Array.isArray(ops)) return { ok: false, reason: 'ops-not-array' };
  if (ops.length === 0) return { ok: false, reason: 'ops-empty' };
  if (ops.length > AHWP_TOOL_LIMITS.maxOpsPerBlock)
    return { ok: false, reason: 'ops-over-limit' };
  const items: AhwpPreflightItem[] = ops.map((op) => {
    const v = validateToolCall(op);
    if (v.ok) return { ok: true, call: v.value };
    return { ok: false, tool: v.tool, reason: v.reason };
  });
  return { ok: true, items };
}
