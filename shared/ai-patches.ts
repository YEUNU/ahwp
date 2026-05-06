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
  /** 0.4.20 — 표 cell 안 좌표. paragraphIndex 는 cell 의 부모 paragraph
   *  (= 표 control 이 anchor 된 paragraph), startOffset / endOffset 은
   *  cell 의 cellParagraphIndex 안 char range. lib 의 *InCell APIs
   *  (insertTextInCell / deleteRangeInCell / applyCharFormatInCell) 로
   *  라우팅. 좌표는 getCellInfo 로 검증된 값이어야 안전. */
  cell?: {
    controlIndex: number;
    cellIndex: number;
    cellParagraphIndex: number;
  };
}

/** Char format hints applied to the addition after insertion. Mirrors
 * `applyCharFormat` props_json subset.
 *
 * 0.4.20 — `lib` raw passthrough 추가. 모델이 `getCharPropertiesAt` 결과를
 * 그대로 dump 하면 lib props_json 으로 직행 (key mapping 없이). 작은
 * 오차에 대한 fallback. typed 필드 (bold 등) 와 같이 쓸 때 typed 필드가
 * 우선. */
export interface PatchCharFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** Lowercase hex like "#ff0000". */
  textColor?: string;
  /** HWPUNIT (1pt = 100). e.g. 1000 = 10pt. */
  fontSize?: number;
  /** Font family name (e.g. "함초롬바탕"). lib `name` key. */
  fontName?: string;
  /** Raw lib props_json passthrough — `getCharPropertiesAt` 결과를 그대로
   *  넣어도 됨. 예: `{name:"함초롬바탕",size_hu:1000,bold:false,...}`. */
  lib?: Record<string, unknown>;
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
  /** Optional char format applied to the addition after insertion (e.g.
   * bold/italic/color). Applied via `applyCharFormat` in the same
   * undo group as the text change. */
  additionFormat?: PatchCharFormat;
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
  let cell: PatchLocation['cell'];
  if (location.cell !== undefined) {
    if (!isObj(location.cell)) return { ok: false, reason: 'cell-not-object' };
    const ctrl = location.cell.controlIndex;
    const ci = location.cell.cellIndex;
    const cp = location.cell.cellParagraphIndex;
    if (typeof ctrl !== 'number' || !Number.isInteger(ctrl) || ctrl < 0)
      return { ok: false, reason: 'cell.controlIndex-invalid' };
    if (typeof ci !== 'number' || !Number.isInteger(ci) || ci < 0)
      return { ok: false, reason: 'cell.cellIndex-invalid' };
    if (typeof cp !== 'number' || !Number.isInteger(cp) || cp < 0)
      return { ok: false, reason: 'cell.cellParagraphIndex-invalid' };
    cell = {
      controlIndex: ctrl,
      cellIndex: ci,
      cellParagraphIndex: cp,
    };
  }
  // 0.4.22 — empty cell fill 흔한 케이스 (deletion="") 친화. LLM 이
  // null / undefined / omit 으로 보내도 빈 string 으로 coerce. addition
  // 도 동일 (drop = "" addition).
  const delRaw = raw.deletion;
  const addRaw = raw.addition;
  const del = typeof delRaw === 'string' ? delRaw : delRaw == null ? '' : null;
  const add = typeof addRaw === 'string' ? addRaw : addRaw == null ? '' : null;
  if (del === null) return { ok: false, reason: 'deletion-not-string' };
  if (add === null) return { ok: false, reason: 'addition-not-string' };
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
  // Optional addition format. We accept narrow shape only — extra keys
  // are tolerated but not narrowed (caller passes the typed slice to
  // applyCharFormat).
  let additionFormat: PatchCharFormat | undefined;
  const fmt = raw.additionFormat;
  if (fmt !== undefined) {
    if (!isObj(fmt)) return { ok: false, reason: 'additionFormat-not-object' };
    additionFormat = {};
    if (typeof fmt.bold === 'boolean') additionFormat.bold = fmt.bold;
    if (typeof fmt.italic === 'boolean') additionFormat.italic = fmt.italic;
    if (typeof fmt.underline === 'boolean')
      additionFormat.underline = fmt.underline;
    if (typeof fmt.textColor === 'string')
      additionFormat.textColor = fmt.textColor;
    if (typeof fmt.fontSize === 'number')
      additionFormat.fontSize = fmt.fontSize;
    if (typeof fmt.fontName === 'string')
      additionFormat.fontName = fmt.fontName;
    if (isObj(fmt.lib)) additionFormat.lib = fmt.lib;
  }
  const value: AhwpPatch = {
    title,
    location: {
      sectionIndex: sec,
      paragraphIndex: par,
      startOffset: startOff,
      endOffset: endOff,
      label,
      cell,
    },
    deletion: del,
    addition: add,
    additionFormat,
    reason,
  };
  return { ok: true, value };
}

/** 0.4.20 — typed PatchCharFormat 를 lib applyCharFormat props_json 키
 *  매핑. 사용자에게 보이는 키 (bold / fontSize / textColor 등) 와 lib 의
 *  키 (bold / size_hu / color int) 가 일부 다르므로 변환. `lib` 가
 *  주어졌으면 우선 base 로 사용하고 typed 가 그 위에 덮음. */
export function patchFormatToLibProps(
  fmt: PatchCharFormat,
): Record<string, unknown> {
  const out: Record<string, unknown> = fmt.lib ? { ...fmt.lib } : {};
  if (fmt.bold !== undefined) out.bold = fmt.bold;
  if (fmt.italic !== undefined) out.italic = fmt.italic;
  if (fmt.underline !== undefined) out.underline = fmt.underline;
  if (fmt.fontName !== undefined) out.name = fmt.fontName;
  if (fmt.fontSize !== undefined) out.size_hu = fmt.fontSize;
  if (fmt.textColor !== undefined) {
    // "#RRGGBB" → 0xRRGGBB int. lib 가 정수 BGR/RGB 둘 다 케이스가
    // 있으니 lib 매뉴얼 그대로 RGB int.
    const m = fmt.textColor.match(/^#([0-9a-fA-F]{6})$/);
    if (m) out.color = parseInt(m[1], 16);
  }
  return out;
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
