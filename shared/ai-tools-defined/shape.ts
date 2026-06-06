/**
 * Picture / shape 도구들 — defineTool migration (0.7.4).
 *
 * 도구 (7):
 * - createRectShape (직사각형 생성)
 * - setShapeProperties / deleteShapeControl / changeShapeZOrder
 * - setPictureProperties / deletePictureControl
 * - insertPicture (base64 데이터)
 */
import type { AhwpToolArgs } from '../ai-tools';
import { AHWP_TOOL_LIMITS } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { coerceNonNegInt, isObj, nonNegInts } from '../ai-tool-validate';

export const createRectShape = defineTool<
  'createRectShape',
  AhwpToolArgs['createRectShape']
>({
  name: 'createRectShape',
  description:
    'Insert a rectangle shape control at the caret. width / height in HWPUNIT (1mm ≈ 28.35 HWPUNIT).',
  inputSchema: {
    type: 'object',
    properties: {
      widthHwpunit: { type: 'number', exclusiveMinimum: 0, maximum: 283500 },
      heightHwpunit: { type: 'number', exclusiveMinimum: 0, maximum: 283500 },
      opts: {
        type: 'object',
        properties: { treatAsChar: { type: 'boolean' } },
      },
    },
    required: ['widthHwpunit', 'heightHwpunit'],
  },
  validate(raw) {
    const w = raw.widthHwpunit;
    const h = raw.heightHwpunit;
    if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0)
      return { ok: false, reason: 'width-not-positive' };
    if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0)
      return { ok: false, reason: 'height-not-positive' };
    if (w > AHWP_TOOL_LIMITS.maxShapeHwpunit)
      return { ok: false, reason: 'width-too-large' };
    if (h > AHWP_TOOL_LIMITS.maxShapeHwpunit)
      return { ok: false, reason: 'height-too-large' };
    const opts = raw.opts;
    if (opts !== undefined && !isObj(opts))
      return { ok: false, reason: 'opts-not-object' };
    const treatAsChar = (opts as { treatAsChar?: unknown } | undefined)
      ?.treatAsChar;
    if (treatAsChar !== undefined && typeof treatAsChar !== 'boolean')
      return { ok: false, reason: 'treatAsChar-not-bool' };
    return {
      ok: true,
      args: {
        widthHwpunit: w,
        heightHwpunit: h,
        opts: opts === undefined ? undefined : { treatAsChar },
      } as AhwpToolArgs['createRectShape'],
    };
  },
});

export const setShapeProperties = defineTool<
  'setShapeProperties',
  AhwpToolArgs['setShapeProperties']
>({
  name: 'setShapeProperties',
  description:
    'Update shape properties (width / height / position / color, etc.). props is lib JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      props: { type: 'object' },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'props'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
    if (!v.ok) return v;
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    return {
      ok: true,
      args: { ...v.value, props } as AhwpToolArgs['setShapeProperties'],
    };
  },
});

export const deleteShapeControl = defineTool<
  'deleteShapeControl',
  AhwpToolArgs['deleteShapeControl']
>({
  name: 'deleteShapeControl',
  description: 'Delete a shape control.',
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
    return { ok: true, args: v.value as AhwpToolArgs['deleteShapeControl'] };
  },
});

export const changeShapeZOrder = defineTool<
  'changeShapeZOrder',
  AhwpToolArgs['changeShapeZOrder']
>({
  name: 'changeShapeZOrder',
  description:
    'Change a shape Z-order. operation: top / bottom / forward / backward.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      operation: {
        type: 'string',
        enum: ['top', 'bottom', 'forward', 'backward'],
      },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'operation'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
    if (!v.ok) return v;
    const op = raw.operation;
    if (
      op !== 'top' &&
      op !== 'bottom' &&
      op !== 'forward' &&
      op !== 'backward'
    )
      return { ok: false, reason: 'operation-not-enum' };
    return {
      ok: true,
      args: { ...v.value, operation: op } as AhwpToolArgs['changeShapeZOrder'],
    };
  },
});

export const setPictureProperties = defineTool<
  'setPictureProperties',
  AhwpToolArgs['setPictureProperties']
>({
  name: 'setPictureProperties',
  description:
    'Update picture properties (width / height HWPUNIT, treatAsChar, etc.). props is lib JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      props: { type: 'object' },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'props'],
  },
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
    if (!v.ok) return v;
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    return {
      ok: true,
      args: { ...v.value, props } as AhwpToolArgs['setPictureProperties'],
    };
  },
});

export const deletePictureControl = defineTool<
  'deletePictureControl',
  AhwpToolArgs['deletePictureControl']
>({
  name: 'deletePictureControl',
  description: 'Delete a picture control.',
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
    return { ok: true, args: v.value as AhwpToolArgs['deletePictureControl'] };
  },
});

export const insertPicture = defineTool<
  'insertPicture',
  AhwpToolArgs['insertPicture']
>({
  name: 'insertPicture',
  description:
    'Insert a picture. base64Data is PNG / JPEG / GIF / BMP bytes encoded as base64. width / height in HWPUNIT (1mm ≈ 28.35).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
      base64Data: { type: 'string' },
      widthHwpunit: { type: 'integer', minimum: 1, maximum: 283500 },
      heightHwpunit: { type: 'integer', minimum: 1, maximum: 283500 },
      naturalWidthPx: { type: 'integer', minimum: 1 },
      naturalHeightPx: { type: 'integer', minimum: 1 },
      extension: { type: 'string' },
      description: { type: 'string' },
      cellPath: {
        type: 'array',
        description:
          'Optional — insert into a table cell. [{controlIndex, cellIndex, cellParaIndex}, ...]; paragraphIdx is the table paragraph. Omit for body insertion.',
        items: {
          type: 'object',
          properties: {
            controlIndex: { type: 'integer', minimum: 0 },
            cellIndex: { type: 'integer', minimum: 0 },
            cellParaIndex: { type: 'integer', minimum: 0 },
          },
          required: ['controlIndex', 'cellIndex', 'cellParaIndex'],
        },
      },
    },
    required: [
      'sectionIdx',
      'paragraphIdx',
      'charOffset',
      'base64Data',
      'widthHwpunit',
      'heightHwpunit',
      'naturalWidthPx',
      'naturalHeightPx',
      'extension',
      'description',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
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
    const base64Data = raw.base64Data;
    const extension = raw.extension;
    const description = raw.description;
    if (typeof base64Data !== 'string' || base64Data.length === 0)
      return { ok: false, reason: 'base64Data-not-string' };
    if (base64Data.length > 4 * 1024 * 1024)
      return { ok: false, reason: 'base64Data-too-large' };
    if (typeof extension !== 'string' || extension.length === 0)
      return { ok: false, reason: 'extension-not-string' };
    if (typeof description !== 'string')
      return { ok: false, reason: 'description-not-string' };
    // 0.7.14 — optional cell target (insert into a table cell).
    let cellPath: AhwpToolArgs['insertPicture']['cellPath'];
    if (raw.cellPath !== undefined) {
      if (!Array.isArray(raw.cellPath) || raw.cellPath.length === 0)
        return { ok: false, reason: 'cellPath-not-array' };
      const parsed: NonNullable<AhwpToolArgs['insertPicture']['cellPath']> = [];
      for (const entry of raw.cellPath) {
        if (!isObj(entry))
          return { ok: false, reason: 'cellPath-entry-not-object' };
        const ci = coerceNonNegInt(entry.controlIndex);
        const cell = coerceNonNegInt(entry.cellIndex);
        const cp = coerceNonNegInt(entry.cellParaIndex);
        if (ci === null || cell === null || cp === null)
          return { ok: false, reason: 'cellPath-entry-invalid' };
        parsed.push({ controlIndex: ci, cellIndex: cell, cellParaIndex: cp });
      }
      cellPath = parsed;
    }
    return {
      ok: true,
      args: {
        ...o,
        base64Data,
        extension,
        description,
        cellPath,
      } as AhwpToolArgs['insertPicture'],
    };
  },
});
