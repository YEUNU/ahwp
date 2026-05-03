/**
 * AI Diff Viewer — chunk Q5 (UI/UX align). 모델이 평문 응답에
 * `\`\`\`ahwp-patches\`\`\`` JSON 블록을 작성하면 ChatPanel 이 각 패치를
 * Accept / Reject 버튼이 있는 시각적 카드로 렌더. Manual 모드 의 보강 —
 * 기존 `\`\`\`html\`\`\`` apply-all 흐름과 공존.
 *
 * 한 turn 한 블록, 한 블록에 ops 20개 상한 (적은 패치를 더 명확히
 * 보이게 하기 위함).
 */

export interface PatchLocation {
  sectionIndex: number;
  paragraphIndex: number;
  /** Char range within paragraph. Undefined → whole paragraph. */
  startOffset?: number;
  endOffset?: number;
  /** Display-only label (e.g. "3페이지 · 단락 2"). */
  label?: string;
}

export interface AhwpPatch {
  /** Short title shown in card header. */
  title: string;
  location: PatchLocation;
  /** Current text the model proposes to replace (used for visual diff
   * display + for stale-check before apply). */
  deletion: string;
  /** Replacement text. */
  addition: string;
  /** Optional explanation shown via expander. */
  reason?: string;
}

export interface AhwpPatchBlock {
  ops: AhwpPatch[];
}

export const AHWP_PATCH_LIMITS = {
  maxOpsPerBlock: 20,
  maxTitleBytes: 200,
  maxTextBytes: 8 * 1024,
  maxReasonBytes: 1024,
} as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

function validatePatch(
  raw: unknown,
): { ok: true; value: AhwpPatch } | { ok: false; reason: string } {
  if (!isObj(raw)) return { ok: false, reason: 'patch-not-object' };
  const title = raw.title;
  if (typeof title !== 'string' || title.length === 0)
    return { ok: false, reason: 'title-not-string' };
  if (byteLen(title) > AHWP_PATCH_LIMITS.maxTitleBytes)
    return { ok: false, reason: 'title-too-large' };
  const location = raw.location;
  if (!isObj(location)) return { ok: false, reason: 'location-not-object' };
  const sec = location.sectionIndex;
  const par = location.paragraphIndex;
  if (typeof sec !== 'number' || !Number.isInteger(sec) || sec < 0)
    return { ok: false, reason: 'sectionIndex-invalid' };
  if (typeof par !== 'number' || !Number.isInteger(par) || par < 0)
    return { ok: false, reason: 'paragraphIndex-invalid' };
  const startOff = location.startOffset;
  const endOff = location.endOffset;
  if (startOff !== undefined && (typeof startOff !== 'number' || startOff < 0))
    return { ok: false, reason: 'startOffset-invalid' };
  if (endOff !== undefined && (typeof endOff !== 'number' || endOff < 0))
    return { ok: false, reason: 'endOffset-invalid' };
  const label = location.label;
  if (label !== undefined && typeof label !== 'string')
    return { ok: false, reason: 'label-not-string' };
  const del = raw.deletion;
  const add = raw.addition;
  if (typeof del !== 'string')
    return { ok: false, reason: 'deletion-not-string' };
  if (typeof add !== 'string')
    return { ok: false, reason: 'addition-not-string' };
  if (byteLen(del) > AHWP_PATCH_LIMITS.maxTextBytes)
    return { ok: false, reason: 'deletion-too-large' };
  if (byteLen(add) > AHWP_PATCH_LIMITS.maxTextBytes)
    return { ok: false, reason: 'addition-too-large' };
  const reason = raw.reason;
  if (reason !== undefined && typeof reason !== 'string')
    return { ok: false, reason: 'reason-not-string' };
  if (
    typeof reason === 'string' &&
    byteLen(reason) > AHWP_PATCH_LIMITS.maxReasonBytes
  )
    return { ok: false, reason: 'reason-too-large' };
  const value: AhwpPatch = {
    title,
    location: {
      sectionIndex: sec,
      paragraphIndex: par,
      startOffset: startOff,
      endOffset: endOff,
      label,
    },
    deletion: del,
    addition: add,
    reason,
  };
  return { ok: true, value };
}

export type AhwpPatchPreflightItem =
  | { ok: true; patch: AhwpPatch }
  | { ok: false; reason: string };

/**
 * Parse a model-authored patches block. Block-level failures reject the
 * whole thing; per-patch failures keep the item as `ok: false` so the
 * preview can still surface what the model proposed.
 */
export function parsePatchBlock(
  raw: string,
):
  | { ok: true; items: AhwpPatchPreflightItem[] }
  | { ok: false; reason: string } {
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
  if (ops.length > AHWP_PATCH_LIMITS.maxOpsPerBlock)
    return { ok: false, reason: 'ops-over-limit' };
  const items: AhwpPatchPreflightItem[] = ops.map((op) => {
    const v = validatePatch(op);
    if (v.ok) return { ok: true, patch: v.value };
    return { ok: false, reason: v.reason };
  });
  return { ok: true, items };
}
