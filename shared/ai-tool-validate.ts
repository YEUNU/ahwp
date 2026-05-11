/**
 * `validateToolCall` + helpers — R4 에서 `shared/ai-tools.ts` 로부터
 * 분리. dispatcher 가 IR 호출 직전 op 의 args 를 검증.
 *
 * 모든 검증 실패는 `{ ok: false, tool, reason }` 으로 반환 — caller 가
 * preflight 메시지로 노출. 검증 통과 시 narrow 된 typed args 를 반환.
 */
import {
  AHWP_TOOL_LIMITS,
  AHWP_TOOL_NAMES,
  type AhwpToolCall,
  type AhwpToolArgs,
  type AhwpToolName,
} from './ai-tools';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** chunk 96 — coerce a string-encoded non-negative integer ("42") to
 * number. Real LLM tool-use APIs (OpenAI / NVIDIA NIM / Gemini) often
 * stringify integer arg values even when the JSON Schema says
 * `integer`. Returns null if the value is not a usable non-negative
 * integer (rejects floats, negatives, NaN, scientific, leading zeroes
 * other than "0"). */
function coerceNonNegInt(v: unknown): number | null {
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
function nonNegInts(
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
  const v = validateArgs(tool as AhwpToolName, args);
  if (!v.ok) return { ok: false, tool, reason: v.reason };
  return { ok: true, value: { tool, args: v.value } as AhwpToolCall };
}

function validateArgs<T extends AhwpToolName>(
  tool: T,
  args: Record<string, unknown>,
): { ok: true; value: AhwpToolArgs[T] } | { ok: false; reason: string } {
  switch (tool) {
    case 'applyHtml': {
      const html = args.html;
      if (typeof html !== 'string')
        return { ok: false, reason: 'html-not-string' };
      if (byteLen(html) > AHWP_TOOL_LIMITS.maxHtmlBytes)
        return { ok: false, reason: 'html-too-large' };
      return {
        ok: true,
        value: { html } as AhwpToolArgs[T],
      };
    }
    case 'applyAlignment': {
      const align = args.align;
      if (
        align !== 'left' &&
        align !== 'center' &&
        align !== 'right' &&
        align !== 'justify'
      )
        return { ok: false, reason: 'align-not-enum' };
      return { ok: true, value: { align } as AhwpToolArgs[T] };
    }
    case 'applyFontSize': {
      const pt = args.pt;
      if (typeof pt !== 'number' || !Number.isFinite(pt))
        return { ok: false, reason: 'pt-not-number' };
      if (pt < 1 || pt > AHWP_TOOL_LIMITS.maxFontSizePt)
        return { ok: false, reason: 'pt-out-of-range' };
      return { ok: true, value: { pt } as AhwpToolArgs[T] };
    }
    case 'applyTextColor': {
      const hex = args.hex;
      if (typeof hex !== 'string')
        return { ok: false, reason: 'hex-not-string' };
      if (!HEX_COLOR_RE.test(hex))
        return { ok: false, reason: 'hex-not-rrggbb' };
      return { ok: true, value: { hex } as AhwpToolArgs[T] };
    }
    case 'toggleCharFormat': {
      const key = args.key;
      if (key !== 'bold' && key !== 'italic' && key !== 'underline')
        return { ok: false, reason: 'key-not-enum' };
      return { ok: true, value: { key } as AhwpToolArgs[T] };
    }
    case 'insertFootnote': {
      const text = args.text;
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return { ok: true, value: { text } as AhwpToolArgs[T] };
    }
    case 'addBookmark': {
      const name = args.name;
      if (typeof name !== 'string')
        return { ok: false, reason: 'name-not-string' };
      if (name.length === 0) return { ok: false, reason: 'name-empty' };
      if (byteLen(name) > AHWP_TOOL_LIMITS.maxNameBytes)
        return { ok: false, reason: 'name-too-large' };
      return { ok: true, value: { name } as AhwpToolArgs[T] };
    }
    case 'setHeaderFooterText': {
      const sectionIdx = args.sectionIdx;
      const isHeader = args.isHeader;
      const applyTo = args.applyTo;
      const text = args.text;
      if (typeof sectionIdx !== 'number' || !Number.isInteger(sectionIdx))
        return { ok: false, reason: 'sectionIdx-not-int' };
      if (typeof isHeader !== 'boolean')
        return { ok: false, reason: 'isHeader-not-bool' };
      if (typeof applyTo !== 'number' || !Number.isInteger(applyTo))
        return { ok: false, reason: 'applyTo-not-int' };
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return {
        ok: true,
        value: { sectionIdx, isHeader, applyTo, text } as AhwpToolArgs[T],
      };
    }
    case 'applyPageDef': {
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      const sectionIdx = args.sectionIdx;
      if (
        sectionIdx !== undefined &&
        (typeof sectionIdx !== 'number' || !Number.isInteger(sectionIdx))
      )
        return { ok: false, reason: 'sectionIdx-not-int' };
      return {
        ok: true,
        value: { props, sectionIdx } as AhwpToolArgs[T],
      };
    }
    case 'createNamedStyle': {
      const name = args.name;
      const englishName = args.englishName;
      if (typeof name !== 'string')
        return { ok: false, reason: 'name-not-string' };
      if (name.length === 0) return { ok: false, reason: 'name-empty' };
      if (byteLen(name) > AHWP_TOOL_LIMITS.maxNameBytes)
        return { ok: false, reason: 'name-too-large' };
      if (englishName !== undefined && typeof englishName !== 'string')
        return { ok: false, reason: 'englishName-not-string' };
      return {
        ok: true,
        value: { name, englishName } as AhwpToolArgs[T],
      };
    }
    case 'createRectShape': {
      const w = args.widthHwpunit;
      const h = args.heightHwpunit;
      if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0)
        return { ok: false, reason: 'width-not-positive' };
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0)
        return { ok: false, reason: 'height-not-positive' };
      if (w > AHWP_TOOL_LIMITS.maxShapeHwpunit)
        return { ok: false, reason: 'width-too-large' };
      if (h > AHWP_TOOL_LIMITS.maxShapeHwpunit)
        return { ok: false, reason: 'height-too-large' };
      const opts = args.opts;
      if (opts !== undefined && !isObj(opts))
        return { ok: false, reason: 'opts-not-object' };
      const treatAsChar = opts?.treatAsChar;
      if (treatAsChar !== undefined && typeof treatAsChar !== 'boolean')
        return { ok: false, reason: 'treatAsChar-not-bool' };
      return {
        ok: true,
        value: {
          widthHwpunit: w,
          heightHwpunit: h,
          opts: opts === undefined ? undefined : { treatAsChar },
        } as AhwpToolArgs[T],
      };
    }
    case 'applyCellStyle': {
      const keys = [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
        'cellParaIdx',
        'styleId',
      ] as const;
      const out: Record<string, number> = {};
      for (const k of keys) {
        const v = args[k];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
          return { ok: false, reason: `${k}-not-non-negative-int` };
        out[k] = v;
      }
      return { ok: true, value: out as AhwpToolArgs[T] };
    }
    // === Phase 3 chunk 45 — body edit primitives ===
    case 'insertText': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'charOffset']);
      if (!v.ok) return v;
      const text = args.text;
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return { ok: true, value: { ...v.value, text } as AhwpToolArgs[T] };
    }
    // 0.4.16 — cell-level text insert
    case 'insertTextInCell': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
        'cellParaIdx',
        'charOffset',
      ]);
      if (!v.ok) return v;
      const text = args.text;
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return { ok: true, value: { ...v.value, text } as AhwpToolArgs[T] };
    }
    case 'deleteRange': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'startParagraphIdx',
        'startOffset',
        'endParagraphIdx',
        'endOffset',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'insertParagraph':
    case 'deleteParagraph':
    case 'mergeParagraph': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'applyCharFormat': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'paragraphIdx',
        'startOffset',
        'endOffset',
      ]);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'applyParaProps': {
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return { ok: true, value: { props } as AhwpToolArgs[T] };
    }
    case 'applyStyle': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'styleId']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    // === Phase 3 chunk 46 — table structure ===
    case 'createTable': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'paragraphIdx',
        'charOffset',
        'rowCount',
        'colCount',
      ]);
      if (!v.ok) return v;
      const o = v.value;
      if (o.rowCount < 1 || o.rowCount > 100)
        return { ok: false, reason: 'rowCount-out-of-range' };
      if (o.colCount < 1 || o.colCount > 50)
        return { ok: false, reason: 'colCount-out-of-range' };
      return { ok: true, value: o as AhwpToolArgs[T] };
    }
    case 'insertTableRow': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'rowIdx',
      ]);
      if (!v.ok) return v;
      const below = args.below;
      if (typeof below !== 'boolean')
        return { ok: false, reason: 'below-not-bool' };
      return { ok: true, value: { ...v.value, below } as AhwpToolArgs[T] };
    }
    case 'insertTableColumn': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'colIdx',
      ]);
      if (!v.ok) return v;
      const right = args.right;
      if (typeof right !== 'boolean')
        return { ok: false, reason: 'right-not-bool' };
      return { ok: true, value: { ...v.value, right } as AhwpToolArgs[T] };
    }
    case 'deleteTableRow':
    case 'deleteTableColumn': {
      const ki =
        tool === 'deleteTableRow'
          ? ['sectionIdx', 'parentParaIdx', 'controlIdx', 'rowIdx']
          : ['sectionIdx', 'parentParaIdx', 'controlIdx', 'colIdx'];
      const v = nonNegInts(args, ki);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'mergeTableCells': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'startRow',
        'startCol',
        'endRow',
        'endCol',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'splitTableCellInto': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'row',
        'col',
        'nRows',
        'mCols',
      ]);
      if (!v.ok) return v;
      const equalRowHeight = args.equalRowHeight;
      const mergeFirst = args.mergeFirst;
      if (typeof equalRowHeight !== 'boolean')
        return { ok: false, reason: 'equalRowHeight-not-bool' };
      if (typeof mergeFirst !== 'boolean')
        return { ok: false, reason: 'mergeFirst-not-bool' };
      return {
        ok: true,
        value: {
          ...v.value,
          equalRowHeight,
          mergeFirst,
        } as AhwpToolArgs[T],
      };
    }
    case 'unmergeCell': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'row',
        'col',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'setTableProperties':
    case 'setShapeProperties':
    case 'setPictureProperties': {
      const v = nonNegInts(args, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'setCellProperties': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
      ]);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'evaluateTableFormula': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'targetRow',
        'targetCol',
      ]);
      if (!v.ok) return v;
      const formula = args.formula;
      const writeResult = args.writeResult;
      if (typeof formula !== 'string')
        return { ok: false, reason: 'formula-not-string' };
      if (byteLen(formula) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'formula-too-large' };
      if (typeof writeResult !== 'boolean')
        return { ok: false, reason: 'writeResult-not-bool' };
      return {
        ok: true,
        value: {
          ...v.value,
          formula,
          writeResult,
        } as AhwpToolArgs[T],
      };
    }
    case 'deleteTableControl':
    case 'deletePictureControl':
    case 'deleteShapeControl': {
      const v = nonNegInts(args, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'changeShapeZOrder': {
      const v = nonNegInts(args, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
      if (!v.ok) return v;
      const op = args.operation;
      if (
        op !== 'top' &&
        op !== 'bottom' &&
        op !== 'forward' &&
        op !== 'backward'
      )
        return { ok: false, reason: 'operation-not-enum' };
      return {
        ok: true,
        value: { ...v.value, operation: op } as AhwpToolArgs[T],
      };
    }
    case 'insertPicture': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'paragraphIdx',
        'charOffset',
        'widthHwpunit',
        'heightHwpunit',
        'naturalWidthPx',
        'naturalHeightPx',
      ]);
      if (!v.ok) return v;
      const o = v.value;
      if (
        o.widthHwpunit > AHWP_TOOL_LIMITS.maxShapeHwpunit ||
        o.heightHwpunit > AHWP_TOOL_LIMITS.maxShapeHwpunit
      )
        return { ok: false, reason: 'dimension-too-large' };
      const base64Data = args.base64Data;
      const extension = args.extension;
      const description = args.description;
      if (typeof base64Data !== 'string' || base64Data.length === 0)
        return { ok: false, reason: 'base64Data-not-string' };
      if (base64Data.length > 4 * 1024 * 1024)
        return { ok: false, reason: 'base64Data-too-large' };
      if (typeof extension !== 'string' || extension.length === 0)
        return { ok: false, reason: 'extension-not-string' };
      if (typeof description !== 'string')
        return { ok: false, reason: 'description-not-string' };
      return {
        ok: true,
        value: {
          ...o,
          base64Data,
          extension,
          description,
        } as AhwpToolArgs[T],
      };
    }
    case 'insertPageBreak':
    case 'insertColumnBreak': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'charOffset']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'setColumnDef': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'columnCount',
        'columnType',
        'sameWidth',
        'spacingHu',
      ]);
      if (!v.ok) return v;
      const o = v.value;
      if (o.columnCount < 1 || o.columnCount > 10)
        return { ok: false, reason: 'columnCount-out-of-range' };
      return { ok: true, value: o as AhwpToolArgs[T] };
    }
    case 'setSectionDef': {
      const v = nonNegInts(args, ['sectionIdx']);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'setPageHide': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      const flags = [
        'hideHeader',
        'hideFooter',
        'hideMaster',
        'hideBorder',
        'hideFill',
        'hidePageNum',
      ] as const;
      const out: Record<string, unknown> = { ...v.value };
      for (const k of flags) {
        const x = args[k];
        if (typeof x !== 'boolean')
          return { ok: false, reason: `${k}-not-bool` };
        out[k] = x;
      }
      return { ok: true, value: out as AhwpToolArgs[T] };
    }
    case 'applyHfTemplate': {
      const v = nonNegInts(args, ['sectionIdx', 'applyTo', 'templateId']);
      if (!v.ok) return v;
      const isHeader = args.isHeader;
      if (typeof isHeader !== 'boolean')
        return { ok: false, reason: 'isHeader-not-bool' };
      return {
        ok: true,
        value: { ...v.value, isHeader } as AhwpToolArgs[T],
      };
    }
    case 'createHeaderFooter':
    case 'deleteHeaderFooter': {
      const v = nonNegInts(args, ['sectionIdx', 'applyTo']);
      if (!v.ok) return v;
      const isHeader = args.isHeader;
      if (typeof isHeader !== 'boolean')
        return { ok: false, reason: 'isHeader-not-bool' };
      return {
        ok: true,
        value: { ...v.value, isHeader } as AhwpToolArgs[T],
      };
    }
    case 'deleteBookmark': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'controlIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    // === Phase 3 chunk 51 — read-only Agent tools ===
    case 'getDocumentOutline':
    case 'getDocumentSummary':
    case 'getStyleListJson':
    case 'getCaretPosition':
      return { ok: true, value: {} as AhwpToolArgs[T] };
    case 'getStyleAt':
    case 'getParaPropertiesAt': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'getCharPropertiesAt': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'charOffset']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'getTextRange': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'startParagraphIdx',
        'startOffset',
        'endParagraphIdx',
        'endOffset',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'findInDocument': {
      const query = args.query;
      if (typeof query !== 'string')
        return { ok: false, reason: 'query-not-string' };
      if (query.length === 0) return { ok: false, reason: 'query-empty' };
      if (byteLen(query) > 1024)
        return { ok: false, reason: 'query-too-large' };
      const maxResults = args.maxResults;
      if (
        maxResults !== undefined &&
        (typeof maxResults !== 'number' ||
          !Number.isInteger(maxResults) ||
          maxResults < 1 ||
          maxResults > 200)
      )
        return { ok: false, reason: 'maxResults-out-of-range' };
      return {
        ok: true,
        value: { query, maxResults } as AhwpToolArgs[T],
      };
    }
    case 'getCellInfo': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'getEmptyFormFields': {
      const out: { sectionIdx?: number; maxResults?: number } = {};
      const sec = args.sectionIdx;
      if (sec !== undefined) {
        const n = coerceNonNegInt(sec);
        if (n === null) return { ok: false, reason: 'sectionIdx-invalid' };
        out.sectionIdx = n;
      }
      const max = args.maxResults;
      if (max !== undefined) {
        const n = coerceNonNegInt(max);
        if (n === null || n < 1 || n > 5000)
          return { ok: false, reason: 'maxResults-out-of-range' };
        out.maxResults = n;
      }
      return { ok: true, value: out as AhwpToolArgs[T] };
    }
    // === Phase 5 chunk 96 — workspace outline router ===
    case 'searchWorkspaceOutlines': {
      const raw = args.maxDocs;
      if (raw === undefined) {
        return { ok: true, value: {} as AhwpToolArgs[T] };
      }
      const n = coerceNonNegInt(raw);
      if (n === null || n < 1 || n > 200)
        return { ok: false, reason: 'maxDocs-out-of-range' };
      return { ok: true, value: { maxDocs: n } as AhwpToolArgs[T] };
    }
    case 'readParagraphByPath': {
      const filePath = args.path;
      if (typeof filePath !== 'string' || filePath.length === 0)
        return { ok: false, reason: 'path-not-string' };
      if (byteLen(filePath) > 4096)
        return { ok: false, reason: 'path-too-large' };
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      const rawCtx = args.contextParagraphs;
      let contextParagraphs: number | undefined;
      if (rawCtx !== undefined) {
        const n = coerceNonNegInt(rawCtx);
        if (n === null || n > 10)
          return { ok: false, reason: 'contextParagraphs-out-of-range' };
        contextParagraphs = n;
      }
      return {
        ok: true,
        value: {
          path: filePath,
          ...v.value,
          ...(contextParagraphs !== undefined ? { contextParagraphs } : {}),
        } as AhwpToolArgs[T],
      };
    }
    case 'switchTargetDoc': {
      const filePath = args.path;
      if (typeof filePath !== 'string' || filePath.length === 0)
        return { ok: false, reason: 'path-not-string' };
      if (byteLen(filePath) > 4096)
        return { ok: false, reason: 'path-too-large' };
      return {
        ok: true,
        value: { path: filePath } as AhwpToolArgs[T],
      };
    }
    default: {
      // Exhaustiveness — the AHWP_TOOL_NAMES guard above already filters
      // unknown names, so this branch is unreachable unless the registry
      // and the type drift apart.
      const _exhaustive: never = tool;
      return { ok: false, reason: `unknown_tool:${String(_exhaustive)}` };
    }
  }
}
