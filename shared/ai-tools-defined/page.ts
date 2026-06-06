/**
 * Page / section / header-footer / bookmark / footnote / equation /
 * style 도구들 — defineTool migration (0.7.4).
 *
 * 도구 (16):
 * - applyPageDef / insertPageBreak / insertColumnBreak / setColumnDef /
 *   setSectionDef / setPageHide / getColumnDef (페이지·섹션)
 * - setHeaderFooterText / applyHfTemplate / createHeaderFooter /
 *   deleteHeaderFooter (머리/꼬리말)
 * - addBookmark / deleteBookmark (책갈피)
 * - insertFootnote / deleteFootnote / getFootnoteAtCursor (각주)
 * - insertEquation / deleteEquationControl (수식)
 * - createNamedStyle / getStyleListJson / getStyleAt (스타일)
 */
import type { AhwpToolArgs } from '../ai-tools';
import { AHWP_TOOL_LIMITS } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import {
  byteLen,
  coerceNonNegInt,
  isObj,
  nonNegInts,
} from '../ai-tool-validate';

export const applyPageDef = defineTool<
  'applyPageDef',
  AhwpToolArgs['applyPageDef']
>({
  name: 'applyPageDef',
  description:
    'Apply page definition (margin / orientation / size etc.). props is the lib pageDef JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      props: { type: 'object' },
      sectionIdx: { type: 'integer', minimum: 0 },
    },
    required: ['props'],
  },
  validate(raw) {
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    let sectionIdx: number | undefined;
    if (raw.sectionIdx !== undefined) {
      // schema declares minimum:0 — enforce the non-negative bound (the
      // bare Number.isInteger check let -1 through to the WASM bridge).
      const n = coerceNonNegInt(raw.sectionIdx);
      if (n === null) return { ok: false, reason: 'sectionIdx-not-int' };
      sectionIdx = n;
    }
    return {
      ok: true,
      args: { props, sectionIdx } as AhwpToolArgs['applyPageDef'],
    };
  },
});

export const insertPageBreak = defineTool<
  'insertPageBreak',
  AhwpToolArgs['insertPageBreak']
>({
  name: 'insertPageBreak',
  description: 'Insert a page break at the given location.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'charOffset'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'charOffset']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['insertPageBreak'] };
  },
});

export const insertColumnBreak = defineTool<
  'insertColumnBreak',
  AhwpToolArgs['insertColumnBreak']
>({
  name: 'insertColumnBreak',
  description:
    'Insert a column break at the given location (only meaningful in multi-column layouts).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'charOffset'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'charOffset']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['insertColumnBreak'] };
  },
});

export const setColumnDef = defineTool<
  'setColumnDef',
  AhwpToolArgs['setColumnDef']
>({
  name: 'setColumnDef',
  description:
    'Define section columns. columnCount 1-10, columnType 0=Newspaper / 1=BalancedNewspaper / 2=Parallel, sameWidth 1=equal / 0=unequal, spacingHu = column gap in HWPUNIT.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      columnCount: { type: 'integer', minimum: 1, maximum: 10 },
      columnType: { type: 'integer', minimum: 0, maximum: 2 },
      sameWidth: { type: 'integer', minimum: 0, maximum: 1 },
      spacingHu: { type: 'integer', minimum: 0 },
    },
    required: [
      'sectionIdx',
      'columnCount',
      'columnType',
      'sameWidth',
      'spacingHu',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
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
    return { ok: true, args: o as AhwpToolArgs['setColumnDef'] };
  },
});

export const setSectionDef = defineTool<
  'setSectionDef',
  AhwpToolArgs['setSectionDef']
>({
  name: 'setSectionDef',
  description: 'Update section definition (props is lib SectionDef JSON).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      props: { type: 'object' },
    },
    required: ['sectionIdx', 'props'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx']);
    if (!v.ok) return v;
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    return {
      ok: true,
      args: { ...v.value, props } as AhwpToolArgs['setSectionDef'],
    };
  },
});

export const setPageHide = defineTool<
  'setPageHide',
  AhwpToolArgs['setPageHide']
>({
  name: 'setPageHide',
  description:
    'Toggle visibility of header / footer / border / fill / page number on a specific page.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      hideHeader: { type: 'boolean' },
      hideFooter: { type: 'boolean' },
      hideMaster: { type: 'boolean' },
      hideBorder: { type: 'boolean' },
      hideFill: { type: 'boolean' },
      hidePageNum: { type: 'boolean' },
    },
    required: [
      'sectionIdx',
      'paragraphIdx',
      'hideHeader',
      'hideFooter',
      'hideMaster',
      'hideBorder',
      'hideFill',
      'hidePageNum',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
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
      const x = raw[k];
      if (typeof x !== 'boolean') return { ok: false, reason: `${k}-not-bool` };
      out[k] = x;
    }
    return { ok: true, args: out as AhwpToolArgs['setPageHide'] };
  },
});

export const getColumnDef = defineTool<
  'getColumnDef',
  AhwpToolArgs['getColumnDef']
>({
  name: 'getColumnDef',
  description:
    'Return the current column definition for a section: columnCount / columnType / sameWidth / spacing. Paired read for setColumnDef.',
  inputSchema: {
    type: 'object',
    properties: { sectionIdx: { type: 'integer', minimum: 0 } },
    required: ['sectionIdx'],
  },
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['getColumnDef'] };
  },
});

export const setHeaderFooterText = defineTool<
  'setHeaderFooterText',
  AhwpToolArgs['setHeaderFooterText']
>({
  name: 'setHeaderFooterText',
  description:
    'Set the header / footer text of a section. applyTo: 0=both / 1=odd / 2=even.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      isHeader: { type: 'boolean' },
      applyTo: { type: 'integer', minimum: 0, maximum: 2 },
      text: { type: 'string', maxLength: 4096 },
    },
    required: ['sectionIdx', 'isHeader', 'applyTo', 'text'],
  },
  validate(raw) {
    const isHeader = raw.isHeader;
    const text = raw.text;
    // schema declares sectionIdx minimum:0 and applyTo 0..2 — enforce both
    // bounds (bare Number.isInteger let negatives / out-of-range enum through).
    const sectionIdx = coerceNonNegInt(raw.sectionIdx);
    if (sectionIdx === null) return { ok: false, reason: 'sectionIdx-not-int' };
    if (typeof isHeader !== 'boolean')
      return { ok: false, reason: 'isHeader-not-bool' };
    const applyTo = coerceNonNegInt(raw.applyTo);
    if (applyTo === null || applyTo > 2)
      return { ok: false, reason: 'applyTo-not-int' };
    if (typeof text !== 'string')
      return { ok: false, reason: 'text-not-string' };
    if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
      return { ok: false, reason: 'text-too-large' };
    return {
      ok: true,
      args: {
        sectionIdx,
        isHeader,
        applyTo,
        text,
      } as AhwpToolArgs['setHeaderFooterText'],
    };
  },
});

export const applyHfTemplate = defineTool<
  'applyHfTemplate',
  AhwpToolArgs['applyHfTemplate']
>({
  name: 'applyHfTemplate',
  description:
    'Apply a header / footer template. applyTo: 0=both / 1=odd / 2=even. templateId is the lib enum.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      isHeader: { type: 'boolean' },
      applyTo: { type: 'integer', minimum: 0, maximum: 2 },
      templateId: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'isHeader', 'applyTo', 'templateId'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'applyTo', 'templateId']);
    if (!v.ok) return v;
    const isHeader = raw.isHeader;
    if (typeof isHeader !== 'boolean')
      return { ok: false, reason: 'isHeader-not-bool' };
    return {
      ok: true,
      args: { ...v.value, isHeader } as AhwpToolArgs['applyHfTemplate'],
    };
  },
});

export const createHeaderFooter = defineTool<
  'createHeaderFooter',
  AhwpToolArgs['createHeaderFooter']
>({
  name: 'createHeaderFooter',
  description:
    'Create an empty header / footer slot (applyTo 0=both / 1=odd / 2=even).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      isHeader: { type: 'boolean' },
      applyTo: { type: 'integer', minimum: 0, maximum: 2 },
    },
    required: ['sectionIdx', 'isHeader', 'applyTo'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'applyTo']);
    if (!v.ok) return v;
    const isHeader = raw.isHeader;
    if (typeof isHeader !== 'boolean')
      return { ok: false, reason: 'isHeader-not-bool' };
    return {
      ok: true,
      args: { ...v.value, isHeader } as AhwpToolArgs['createHeaderFooter'],
    };
  },
});

export const deleteHeaderFooter = defineTool<
  'deleteHeaderFooter',
  AhwpToolArgs['deleteHeaderFooter']
>({
  name: 'deleteHeaderFooter',
  description: 'Delete a header / footer slot entirely.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      isHeader: { type: 'boolean' },
      applyTo: { type: 'integer', minimum: 0, maximum: 2 },
    },
    required: ['sectionIdx', 'isHeader', 'applyTo'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'applyTo']);
    if (!v.ok) return v;
    const isHeader = raw.isHeader;
    if (typeof isHeader !== 'boolean')
      return { ok: false, reason: 'isHeader-not-bool' };
    return {
      ok: true,
      args: { ...v.value, isHeader } as AhwpToolArgs['deleteHeaderFooter'],
    };
  },
});

export const addBookmark = defineTool<
  'addBookmark',
  AhwpToolArgs['addBookmark']
>({
  name: 'addBookmark',
  description: 'Add a bookmark at the caret. Name ≤ 256 bytes.',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', minLength: 1, maxLength: 256 } },
    required: ['name'],
  },
  validate(raw) {
    const name = raw.name;
    if (typeof name !== 'string')
      return { ok: false, reason: 'name-not-string' };
    if (name.length === 0) return { ok: false, reason: 'name-empty' };
    if (byteLen(name) > AHWP_TOOL_LIMITS.maxNameBytes)
      return { ok: false, reason: 'name-too-large' };
    return { ok: true, args: { name } as AhwpToolArgs['addBookmark'] };
  },
});

export const deleteBookmark = defineTool<
  'deleteBookmark',
  AhwpToolArgs['deleteBookmark']
>({
  name: 'deleteBookmark',
  description: 'Delete a bookmark at the given coordinate.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'controlIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'controlIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteBookmark'] };
  },
});

export const insertFootnote = defineTool<
  'insertFootnote',
  AhwpToolArgs['insertFootnote']
>({
  name: 'insertFootnote',
  description: 'Insert a footnote at the caret and fill its body text.',
  inputSchema: {
    type: 'object',
    properties: { text: { type: 'string', maxLength: 4096 } },
    required: ['text'],
  },
  validate(raw) {
    const text = raw.text;
    if (typeof text !== 'string')
      return { ok: false, reason: 'text-not-string' };
    if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
      return { ok: false, reason: 'text-too-large' };
    return { ok: true, args: { text } as AhwpToolArgs['insertFootnote'] };
  },
});

export const deleteFootnote = defineTool<
  'deleteFootnote',
  AhwpToolArgs['deleteFootnote']
>({
  name: 'deleteFootnote',
  description: 'Delete a footnote control at the given coordinate.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'controlIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'controlIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteFootnote'] };
  },
});

export const getFootnoteAtCursor = defineTool<
  'getFootnoteAtCursor',
  AhwpToolArgs['getFootnoteAtCursor']
>({
  name: 'getFootnoteAtCursor',
  description:
    'Return the footnote marker at or near a cursor coordinate. direction "forward" or "backward" — the lib walks in that direction to find the nearest marker.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
      direction: { type: 'string', enum: ['forward', 'backward'] },
    },
    required: ['sectionIdx', 'paragraphIdx', 'charOffset', 'direction'],
  },
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'charOffset']);
    if (!v.ok) return v;
    const dir = raw.direction;
    if (dir !== 'forward' && dir !== 'backward')
      return { ok: false, reason: 'direction-invalid' };
    return {
      ok: true,
      args: {
        ...(v.value as {
          sectionIdx: number;
          paragraphIdx: number;
          charOffset: number;
        }),
        direction: dir,
      } as AhwpToolArgs['getFootnoteAtCursor'],
    };
  },
});

export const insertEquation = defineTool<
  'insertEquation',
  AhwpToolArgs['insertEquation']
>({
  name: 'insertEquation',
  description:
    'Insert an equation control at the given coordinate. `script` is the equation source (HWP equation syntax). `fontSizeHwpunit` defaults to 1000 (10pt). `color` is an RGB int (default 0 = black).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
      script: { type: 'string', maxLength: 16384 },
      fontSizeHwpunit: { type: 'integer', minimum: 1 },
      color: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'charOffset', 'script'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'charOffset']);
    if (!v.ok) return v;
    const script = raw.script;
    if (typeof script !== 'string' || script.length === 0)
      return { ok: false, reason: 'script-not-string' };
    if (byteLen(script) > 16384)
      return { ok: false, reason: 'script-too-large' };
    const out: AhwpToolArgs['insertEquation'] = {
      ...(v.value as {
        sectionIdx: number;
        paragraphIdx: number;
        charOffset: number;
      }),
      script,
    };
    if (raw.fontSizeHwpunit !== undefined) {
      const n = coerceNonNegInt(raw.fontSizeHwpunit);
      if (n === null || n < 1)
        return { ok: false, reason: 'fontSizeHwpunit-invalid' };
      out.fontSizeHwpunit = n;
    }
    if (raw.color !== undefined) {
      const n = coerceNonNegInt(raw.color);
      if (n === null) return { ok: false, reason: 'color-invalid' };
      out.color = n;
    }
    return { ok: true, args: out };
  },
});

export const deleteEquationControl = defineTool<
  'deleteEquationControl',
  AhwpToolArgs['deleteEquationControl']
>({
  name: 'deleteEquationControl',
  description: 'Delete an equation control at the given coordinate.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteEquationControl'] };
  },
});

export const createNamedStyle = defineTool<
  'createNamedStyle',
  AhwpToolArgs['createNamedStyle']
>({
  name: 'createNamedStyle',
  description:
    'Add an empty user-defined style shell to the document styleList (name only).',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 256 },
      englishName: { type: 'string' },
    },
    required: ['name'],
  },
  validate(raw) {
    const name = raw.name;
    const englishName = raw.englishName;
    if (typeof name !== 'string')
      return { ok: false, reason: 'name-not-string' };
    if (name.length === 0) return { ok: false, reason: 'name-empty' };
    if (byteLen(name) > AHWP_TOOL_LIMITS.maxNameBytes)
      return { ok: false, reason: 'name-too-large' };
    if (englishName !== undefined && typeof englishName !== 'string')
      return { ok: false, reason: 'englishName-not-string' };
    return {
      ok: true,
      args: { name, englishName } as AhwpToolArgs['createNamedStyle'],
    };
  },
});

export const getStyleListJson = defineTool<
  'getStyleListJson',
  AhwpToolArgs['getStyleListJson']
>({
  name: 'getStyleListJson',
  description:
    'List all named styles registered on the document (id / name / englishName). Use to look up a styleId to feed applyStyle.',
  inputSchema: { type: 'object', properties: {} },
  readonly: true,
  validate() {
    return { ok: true, args: {} as AhwpToolArgs['getStyleListJson'] };
  },
});

export const getStyleAt = defineTool<'getStyleAt', AhwpToolArgs['getStyleAt']>({
  name: 'getStyleAt',
  description:
    'Return the active styleId plus style detail (charShape / paraShape) at a paragraph. Call first when matching the formatting of an adjacent paragraph.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx'],
  },
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['getStyleAt'] };
  },
});
