/**
 * Format / text-edit 도구들 — defineTool migration (0.7.4).
 *
 * 본문 텍스트 편집 + caret 기반 서식 + 단락 스타일. 모든 도구가 한
 * paragraph 또는 caret 위치의 IR 변경.
 *
 * 도구 (13):
 * - applyHtml / applyAlignment / applyFontSize / applyTextColor /
 *   toggleCharFormat (caret 기반 서식)
 * - insertText / deleteRange / insertParagraph / deleteParagraph /
 *   mergeParagraph (단락 텍스트 primitive)
 * - applyCharFormat / applyParaProps / applyStyle (영역 / paragraph 단위 서식)
 */
import type { AhwpToolArgs } from '../ai-tools';
import { AHWP_TOOL_LIMITS } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, isObj, nonNegInts } from '../ai-tool-validate';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const applyHtml = defineTool<'applyHtml', AhwpToolArgs['applyHtml']>({
  name: 'applyHtml',
  description:
    'Apply an HTML fragment at the caret in the active document. Supports alignment, line spacing, indentation, paragraph spacing, character formatting, and table round-trip. Recognises <p>, <table>, and a subset of inline styles.',
  inputSchema: {
    type: 'object',
    properties: { html: { type: 'string', maxLength: 65536 } },
    required: ['html'],
  },
  validate(raw) {
    const html = raw.html;
    if (typeof html !== 'string')
      return { ok: false, reason: 'html-not-string' };
    if (byteLen(html) > AHWP_TOOL_LIMITS.maxHtmlBytes)
      return { ok: false, reason: 'html-too-large' };
    return { ok: true, args: { html } as AhwpToolArgs['applyHtml'] };
  },
});

export const applyAlignment = defineTool<
  'applyAlignment',
  AhwpToolArgs['applyAlignment']
>({
  name: 'applyAlignment',
  description:
    'Change the alignment of the active selection / caret paragraph.',
  inputSchema: {
    type: 'object',
    properties: {
      align: { type: 'string', enum: ['left', 'center', 'right', 'justify'] },
    },
    required: ['align'],
  },
  validate(raw) {
    const align = raw.align;
    if (
      align !== 'left' &&
      align !== 'center' &&
      align !== 'right' &&
      align !== 'justify'
    )
      return { ok: false, reason: 'align-not-enum' };
    return { ok: true, args: { align } as AhwpToolArgs['applyAlignment'] };
  },
});

export const applyFontSize = defineTool<
  'applyFontSize',
  AhwpToolArgs['applyFontSize']
>({
  name: 'applyFontSize',
  description:
    'Change the font size (pt) of the active selection / caret. 1-999.',
  inputSchema: {
    type: 'object',
    properties: { pt: { type: 'number', minimum: 1, maximum: 999 } },
    required: ['pt'],
  },
  validate(raw) {
    const pt = raw.pt;
    if (typeof pt !== 'number' || !Number.isFinite(pt))
      return { ok: false, reason: 'pt-not-number' };
    if (pt < 1 || pt > AHWP_TOOL_LIMITS.maxFontSizePt)
      return { ok: false, reason: 'pt-out-of-range' };
    return { ok: true, args: { pt } as AhwpToolArgs['applyFontSize'] };
  },
});

export const applyTextColor = defineTool<
  'applyTextColor',
  AhwpToolArgs['applyTextColor']
>({
  name: 'applyTextColor',
  description:
    'Change the text color of the active selection / caret to a #RRGGBB hex value.',
  inputSchema: {
    type: 'object',
    properties: { hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
    required: ['hex'],
  },
  validate(raw) {
    const hex = raw.hex;
    if (typeof hex !== 'string') return { ok: false, reason: 'hex-not-string' };
    if (!HEX_COLOR_RE.test(hex)) return { ok: false, reason: 'hex-not-rrggbb' };
    return { ok: true, args: { hex } as AhwpToolArgs['applyTextColor'] };
  },
});

export const toggleCharFormat = defineTool<
  'toggleCharFormat',
  AhwpToolArgs['toggleCharFormat']
>({
  name: 'toggleCharFormat',
  description:
    'Toggle bold / italic / underline on the active selection / caret.',
  inputSchema: {
    type: 'object',
    properties: {
      key: { type: 'string', enum: ['bold', 'italic', 'underline'] },
    },
    required: ['key'],
  },
  validate(raw) {
    const key = raw.key;
    if (key !== 'bold' && key !== 'italic' && key !== 'underline')
      return { ok: false, reason: 'key-not-enum' };
    return { ok: true, args: { key } as AhwpToolArgs['toggleCharFormat'] };
  },
});

export const insertText = defineTool<'insertText', AhwpToolArgs['insertText']>({
  name: 'insertText',
  description:
    'Insert raw text at a coordinate (sectionIdx, paragraphIdx, charOffset). Do NOT call at (0,0,0) on a form / report document — the runtime hard-rejects multi-paragraph text there because it dumps into the cover-page table cell and destroys layout. Inserted text only inherits the surrounding paragraph char-shape; new styles / headings do not apply. Use applyHtml for multi-paragraph + heading + body mixed content. Use insertTextInCell when the target lives inside a table cell. Safe uses: empty document, empty paragraph, or verified plain-text spots.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
      text: { type: 'string', maxLength: 4096 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'charOffset', 'text'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'charOffset']);
    if (!v.ok) return v;
    const text = raw.text;
    if (typeof text !== 'string')
      return { ok: false, reason: 'text-not-string' };
    if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
      return { ok: false, reason: 'text-too-large' };
    return {
      ok: true,
      args: { ...v.value, text } as AhwpToolArgs['insertText'],
    };
  },
});

export const deleteRange = defineTool<
  'deleteRange',
  AhwpToolArgs['deleteRange']
>({
  name: 'deleteRange',
  description:
    'Delete text in a paragraph / offset range (may cross paragraphs).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      startParagraphIdx: { type: 'integer', minimum: 0 },
      startOffset: { type: 'integer', minimum: 0 },
      endParagraphIdx: { type: 'integer', minimum: 0 },
      endOffset: { type: 'integer', minimum: 0 },
    },
    required: [
      'sectionIdx',
      'startParagraphIdx',
      'startOffset',
      'endParagraphIdx',
      'endOffset',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'startParagraphIdx',
      'startOffset',
      'endParagraphIdx',
      'endOffset',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteRange'] };
  },
});

export const insertParagraph = defineTool<
  'insertParagraph',
  AhwpToolArgs['insertParagraph']
>({
  name: 'insertParagraph',
  description:
    'Insert a new paragraph break at paragraphIdx (splits the caret paragraph).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['insertParagraph'] };
  },
});

export const deleteParagraph = defineTool<
  'deleteParagraph',
  AhwpToolArgs['deleteParagraph']
>({
  name: 'deleteParagraph',
  description:
    'Delete a paragraph entirely (merges into the previous paragraph).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteParagraph'] };
  },
});

export const mergeParagraph = defineTool<
  'mergeParagraph',
  AhwpToolArgs['mergeParagraph']
>({
  name: 'mergeParagraph',
  description:
    'Merge this paragraph with the next one (removes the paragraph break).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['mergeParagraph'] };
  },
});

export const applyCharFormat = defineTool<
  'applyCharFormat',
  AhwpToolArgs['applyCharFormat']
>({
  name: 'applyCharFormat',
  description:
    'Apply char formatting over a range. props keys: bold / italic / underline (boolean), strikeThrough, subscript / superscript, name (font family string), size_hu (HWPUNIT, pt×100), color (#RRGGBB int), shadeColor, etc. Passes through to lib applyCharFormat props_json. Note: no-ops on empty paragraphs — insert text first, then format.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      startOffset: { type: 'integer', minimum: 0 },
      endOffset: { type: 'integer', minimum: 0 },
      props: { type: 'object' },
    },
    required: [
      'sectionIdx',
      'paragraphIdx',
      'startOffset',
      'endOffset',
      'props',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'paragraphIdx',
      'startOffset',
      'endOffset',
    ]);
    if (!v.ok) return v;
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    return {
      ok: true,
      args: { ...v.value, props } as AhwpToolArgs['applyCharFormat'],
    };
  },
});

export const applyParaProps = defineTool<
  'applyParaProps',
  AhwpToolArgs['applyParaProps']
>({
  name: 'applyParaProps',
  description:
    'Apply paragraph props to the active caret / selection paragraph. props keys (all optional): alignment (left / center / right / justify), lineSpacing (percent), lineSpacingType (Percent / Fixed / AtLeast), spacingBefore / spacingAfter (HWPUNIT), marginLeft / marginRight (HWPUNIT), indent (HWPUNIT; positive = first-line indent, negative = hanging indent).',
  inputSchema: {
    type: 'object',
    properties: { props: { type: 'object' } },
    required: ['props'],
  },
  validate(raw) {
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    return { ok: true, args: { props } as AhwpToolArgs['applyParaProps'] };
  },
});

export const applyStyle = defineTool<'applyStyle', AhwpToolArgs['applyStyle']>({
  name: 'applyStyle',
  description:
    'Apply a named style to a paragraph. styleId comes from getStyleListJson.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      styleId: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'paragraphIdx', 'styleId'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'styleId']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['applyStyle'] };
  },
});
