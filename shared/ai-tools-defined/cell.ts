/**
 * Cell-level 도구들 — defineTool migration (0.7.4).
 *
 * 셀 안 텍스트 / 서식 / 정보 조회 + form-fill workflow 의 cornerstone.
 *
 * 도구 (5):
 * - insertTextInCell — 빈 셀 채우기 (slotKind='value-slot')
 * - replaceTextInCell — atomic delete+insert (slotKind='instruction'
 *   placeholder 교체)
 * - applyCellStyle — 셀에 명명 style 적용 (배경색 등)
 * - getCellInfo — 셀 좌표 / merge 상태 / row·col / 이웃 cellIdx
 * - getEmptyFormFields — form-fill discovery. slotKind 분류 (0.7.2)
 *   포함, 회귀 보호 핵심 (0.6.17 includeFilled strip 의 직접 원인).
 */
import type { AhwpToolArgs } from '../ai-tools';
import { AHWP_TOOL_LIMITS } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, coerceNonNegInt, nonNegInts } from '../ai-tool-validate';
import {
  VALID_EXPECTED_FORMATS,
  validateTextForFormat,
  type ExpectedFormat,
} from '../form-format';

/**
 * 0.7.12 — 두 도구 공통의 `expectedFormat` 검증 헬퍼. 호출자가
 * `validate()` 안에서 text 유효성 검사 직후 호출. expectedFormat 미지정
 * 시 통과 (backward compat).
 *
 * args 객체에 expectedFormat 을 stamp 하고, 위반 시 reason 반환.
 */
function checkExpectedFormat(
  raw: { expectedFormat?: unknown },
  text: string,
): { ok: true; format?: ExpectedFormat } | { ok: false; reason: string } {
  if (raw.expectedFormat === undefined) return { ok: true };
  if (typeof raw.expectedFormat !== 'string')
    return { ok: false, reason: 'expectedFormat-not-string' };
  if (!VALID_EXPECTED_FORMATS.has(raw.expectedFormat as ExpectedFormat))
    return { ok: false, reason: 'expectedFormat-unknown' };
  const fmt = raw.expectedFormat as ExpectedFormat;
  const v = validateTextForFormat(text, fmt);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, format: fmt };
}

export const insertTextInCell = defineTool<
  'insertTextInCell',
  AhwpToolArgs['insertTextInCell']
>({
  name: 'insertTextInCell',
  description:
    "Insert text into a specific cell + cellParagraph + charOffset of a table control. Cell-scoped, safe even where body-level insertText would break table layout. Prereq: call getCellInfo first to confirm cellParaCount and that cellParaIdx is within range. For the first insertion into an empty cell use cellParaIdx=0, charOffset=0. cellParaIdx out of range returns out-of-range. Use \\n for multi-paragraph content within one cell. Does NOT clear existing content — only inserts at charOffset. For replacing existing cell content (modifying filled cells / removing template placeholders), use replaceTextInCell. slotKind from getEmptyFormFields tells you which: value-slot → insertTextInCell, instruction → replaceTextInCell. 0.7.12 — pass `expectedFormat` (echo the value from getEmptyFormFields) so the system can verify the text matches the column's semantics. Without it, no format check runs; with it, format-mismatches are rejected before dispatch (e.g. writing '85' into a marker column is refused).",
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      cellIdx: { type: 'integer', minimum: 0 },
      cellParaIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
      text: { type: 'string', maxLength: 4096 },
      expectedFormat: {
        type: 'string',
        enum: ['marker', 'number', 'currency', 'date', 'text'],
        description:
          "Echo the cell's expectedFormat from getEmptyFormFields. Enables tool-level format check (e.g. marker column only accepts O/X-class chars; number column rejects Korean text).",
      },
    },
    required: [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
      'cellParaIdx',
      'charOffset',
      'text',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
      'cellParaIdx',
      'charOffset',
    ]);
    if (!v.ok) return v;
    const text = raw.text;
    if (typeof text !== 'string')
      return { ok: false, reason: 'text-not-string' };
    if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
      return { ok: false, reason: 'text-too-large' };
    const ef = checkExpectedFormat(raw, text);
    if (!ef.ok) return { ok: false, reason: ef.reason };
    const args: AhwpToolArgs['insertTextInCell'] = {
      ...(v.value as Omit<
        AhwpToolArgs['insertTextInCell'],
        'text' | 'expectedFormat'
      >),
      text,
    };
    if (ef.format !== undefined) args.expectedFormat = ef.format;
    return { ok: true, args };
  },
});

export const replaceTextInCell = defineTool<
  'replaceTextInCell',
  AhwpToolArgs['replaceTextInCell']
>({
  name: 'replaceTextInCell',
  description:
    "Atomically replace a cell paragraph's entire text with a new value. Internally deletes existing content then inserts the new text in one logical step (single group-undo). Use for: (a) modifying a previously-filled cell to a corrected value, (b) clearing template placeholder / example text (slotKind='instruction' from getEmptyFormFields — italic with non-black color) before writing the real value. Pass text='' to clear without re-inserting. Same coordinate system as insertTextInCell (sectionIdx / parentParaIdx / controlIdx / cellIdx / cellParaIdx must come from getEmptyFormFields response). 0.7.12 — pass `expectedFormat` (echo from getEmptyFormFields) to enable tool-level format check.",
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      cellIdx: { type: 'integer', minimum: 0 },
      cellParaIdx: { type: 'integer', minimum: 0 },
      text: { type: 'string', maxLength: 4096 },
      expectedFormat: {
        type: 'string',
        enum: ['marker', 'number', 'currency', 'date', 'text'],
        description:
          "Echo the cell's expectedFormat from getEmptyFormFields. Enables tool-level format check.",
      },
    },
    required: [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
      'cellParaIdx',
      'text',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
      'cellParaIdx',
    ]);
    if (!v.ok) return v;
    const text = raw.text;
    if (typeof text !== 'string')
      return { ok: false, reason: 'text-not-string' };
    if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
      return { ok: false, reason: 'text-too-large' };
    const ef = checkExpectedFormat(raw, text);
    if (!ef.ok) return { ok: false, reason: ef.reason };
    const args: AhwpToolArgs['replaceTextInCell'] = {
      ...(v.value as Omit<
        AhwpToolArgs['replaceTextInCell'],
        'text' | 'expectedFormat'
      >),
      text,
    };
    if (ef.format !== undefined) args.expectedFormat = ef.format;
    return { ok: true, args };
  },
});

export const applyCellStyle = defineTool<
  'applyCellStyle',
  AhwpToolArgs['applyCellStyle']
>({
  name: 'applyCellStyle',
  description:
    'Apply a previously registered named style to a specific cell. Lib does not support direct cell background-color setting — must go through a style (KNOWN_ISSUES L-006).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      cellIdx: { type: 'integer', minimum: 0 },
      cellParaIdx: { type: 'integer', minimum: 0 },
      styleId: { type: 'integer', minimum: 0 },
    },
    required: [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
      'cellParaIdx',
      'styleId',
    ],
  },
  validate(raw) {
    // 기존 validator 가 별도 분기 (nonNegInts 헬퍼 안 쓰고 inline) 였음.
    // 동작은 nonNegInts 와 동일하므로 helper 사용.
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
      'cellParaIdx',
      'styleId',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['applyCellStyle'] };
  },
});

export const getCellInfo = defineTool<
  'getCellInfo',
  AhwpToolArgs['getCellInfo']
>({
  name: 'getCellInfo',
  description:
    "Return a cell's coordinates, merge state, row / col, rowSpan / colSpan, and neighbor cellIdx. Use before table edits (mergeTableCells, splitTableCellInto etc.) to validate.",
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      cellIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'cellIdx'],
  },
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['getCellInfo'] };
  },
});

export const getEmptyFormFields = defineTool<
  'getEmptyFormFields',
  AhwpToolArgs['getEmptyFormFields']
>({
  name: 'getEmptyFormFields',
  description:
    "Enumerate fillable cells in the document. For each cell returns the coordinate, a label hint (text of the adjacent cell — left sibling first, then top sibling), the label's char-shape, the cell's currentText, isEmpty, slotKind, rowLabel (text of the (row,0) cell — the row header in the first column), columnHeader (text of the (0,col) cell — the column header in the first row), and expectedFormat. slotKind is one of: 'value-slot' (empty cell — use insertTextInCell), 'instruction' (italic + non-black placeholder e.g. '예) …' — use replaceTextInCell to swap), 'sub-header' (bold + short in-cell label — do not touch), 'content' (filled real data — leave alone unless user asked). expectedFormat is one of: 'marker' (O/X-style boolean column), 'number' (count/percent), 'currency' (금액/백만원), 'date' (일자/년월일), or 'text' (free-form, default). When you call insertTextInCell / replaceTextInCell, echo the expectedFormat in the args so the system can reject obvious mismatches before they touch the document (e.g. writing '85' into a marker column). The (rowLabel, columnHeader) pair tells you exactly which row × column you're filling — never rely on cellIdx alone for semantics. By default returns only empty cells. Pass includeFilled=true to also see filled cells. parentParaIdx scopes to one table (composable with sectionIdx). Read-only. Cap maxResults to keep response small (default 200).",
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      maxResults: { type: 'integer', minimum: 1, maximum: 5000 },
      includeFilled: { type: 'boolean' },
    },
  },
  readonly: true,
  validate(raw) {
    const out: AhwpToolArgs['getEmptyFormFields'] = {};
    if (raw.sectionIdx !== undefined) {
      const n = coerceNonNegInt(raw.sectionIdx);
      if (n === null) return { ok: false, reason: 'sectionIdx-invalid' };
      out.sectionIdx = n;
    }
    if (raw.parentParaIdx !== undefined) {
      const n = coerceNonNegInt(raw.parentParaIdx);
      if (n === null) return { ok: false, reason: 'parentParaIdx-invalid' };
      out.parentParaIdx = n;
    }
    if (raw.maxResults !== undefined) {
      const n = coerceNonNegInt(raw.maxResults);
      if (n === null || n < 1 || n > 5000)
        return { ok: false, reason: 'maxResults-out-of-range' };
      out.maxResults = n;
    }
    // 0.6.17 회귀의 직접 원인 — 이전 validator 가 includeFilled 를
    // 빼먹어 dispatcher 까지 도달 못 함. defineTool 의 single-place
    // 정의가 이런 drift 를 차단.
    if (raw.includeFilled !== undefined) {
      if (typeof raw.includeFilled !== 'boolean')
        return { ok: false, reason: 'includeFilled-not-boolean' };
      out.includeFilled = raw.includeFilled;
    }
    return { ok: true, args: out };
  },
});
