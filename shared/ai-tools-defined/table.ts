/**
 * Table structure 도구들 — defineTool migration (0.7.4).
 *
 * 표 구조 변경 (행 / 열 / 병합 / 분할) + 표 / 셀 properties + 수식. 셀
 * 내용 (insertTextInCell 등) 은 별도 (cell.ts).
 *
 * 도구 (12):
 * - createTable
 * - insertTableRow / insertTableColumn
 * - deleteTableRow / deleteTableColumn
 * - mergeTableCells / splitTableCellInto / unmergeCell
 * - setTableProperties / setCellProperties
 * - evaluateTableFormula
 * - deleteTableControl
 */
import type { AhwpToolArgs } from '../ai-tools';
import { AHWP_TOOL_LIMITS } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, isObj, nonNegInts } from '../ai-tool-validate';

export const createTable = defineTool<
  'createTable',
  AhwpToolArgs['createTable']
>({
  name: 'createTable',
  description:
    'Create an N-row × M-column table at the given location. Rows 1-100, cols 1-50.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      paragraphIdx: { type: 'integer', minimum: 0 },
      charOffset: { type: 'integer', minimum: 0 },
      rowCount: { type: 'integer', minimum: 1, maximum: 100 },
      colCount: { type: 'integer', minimum: 1, maximum: 50 },
    },
    required: [
      'sectionIdx',
      'paragraphIdx',
      'charOffset',
      'rowCount',
      'colCount',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
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
    return { ok: true, args: o as AhwpToolArgs['createTable'] };
  },
});

export const insertTableRow = defineTool<
  'insertTableRow',
  AhwpToolArgs['insertTableRow']
>({
  name: 'insertTableRow',
  description:
    'Insert one row into a table. below=true inserts below rowIdx, false inserts above.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      rowIdx: { type: 'integer', minimum: 0 },
      below: { type: 'boolean' },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'rowIdx', 'below'],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'rowIdx',
    ]);
    if (!v.ok) return v;
    const below = raw.below;
    if (typeof below !== 'boolean')
      return { ok: false, reason: 'below-not-bool' };
    return {
      ok: true,
      args: { ...v.value, below } as AhwpToolArgs['insertTableRow'],
    };
  },
});

export const insertTableColumn = defineTool<
  'insertTableColumn',
  AhwpToolArgs['insertTableColumn']
>({
  name: 'insertTableColumn',
  description:
    'Insert one column into a table. right=true inserts to the right of colIdx, false to the left.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      colIdx: { type: 'integer', minimum: 0 },
      right: { type: 'boolean' },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'colIdx', 'right'],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'colIdx',
    ]);
    if (!v.ok) return v;
    const right = raw.right;
    if (typeof right !== 'boolean')
      return { ok: false, reason: 'right-not-bool' };
    return {
      ok: true,
      args: { ...v.value, right } as AhwpToolArgs['insertTableColumn'],
    };
  },
});

export const deleteTableRow = defineTool<
  'deleteTableRow',
  AhwpToolArgs['deleteTableRow']
>({
  name: 'deleteTableRow',
  description:
    'Delete one table row. Lib rejects deleting the last remaining row.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      rowIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'rowIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'rowIdx',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteTableRow'] };
  },
});

export const deleteTableColumn = defineTool<
  'deleteTableColumn',
  AhwpToolArgs['deleteTableColumn']
>({
  name: 'deleteTableColumn',
  description: 'Delete one table column.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      colIdx: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'colIdx'],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'colIdx',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['deleteTableColumn'] };
  },
});

export const mergeTableCells = defineTool<
  'mergeTableCells',
  AhwpToolArgs['mergeTableCells']
>({
  name: 'mergeTableCells',
  description:
    'Merge cells across the rectangular region (startRow, startCol) to (endRow, endCol).',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      startRow: { type: 'integer', minimum: 0 },
      startCol: { type: 'integer', minimum: 0 },
      endRow: { type: 'integer', minimum: 0 },
      endCol: { type: 'integer', minimum: 0 },
    },
    required: [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'startRow',
      'startCol',
      'endRow',
      'endCol',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'startRow',
      'startCol',
      'endRow',
      'endCol',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['mergeTableCells'] };
  },
});

export const splitTableCellInto = defineTool<
  'splitTableCellInto',
  AhwpToolArgs['splitTableCellInto']
>({
  name: 'splitTableCellInto',
  description:
    'Split one cell into nRows × mCols. equalRowHeight / mergeFirst options available.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      row: { type: 'integer', minimum: 0 },
      col: { type: 'integer', minimum: 0 },
      nRows: { type: 'integer', minimum: 1 },
      mCols: { type: 'integer', minimum: 1 },
      equalRowHeight: { type: 'boolean' },
      mergeFirst: { type: 'boolean' },
    },
    required: [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'row',
      'col',
      'nRows',
      'mCols',
      'equalRowHeight',
      'mergeFirst',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'row',
      'col',
      'nRows',
      'mCols',
    ]);
    if (!v.ok) return v;
    const equalRowHeight = raw.equalRowHeight;
    const mergeFirst = raw.mergeFirst;
    if (typeof equalRowHeight !== 'boolean')
      return { ok: false, reason: 'equalRowHeight-not-bool' };
    if (typeof mergeFirst !== 'boolean')
      return { ok: false, reason: 'mergeFirst-not-bool' };
    return {
      ok: true,
      args: {
        ...v.value,
        equalRowHeight,
        mergeFirst,
      } as AhwpToolArgs['splitTableCellInto'],
    };
  },
});

export const unmergeCell = defineTool<
  'unmergeCell',
  AhwpToolArgs['unmergeCell']
>({
  name: 'unmergeCell',
  description: 'Unmerge a merged cell back into its original row × col layout.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      row: { type: 'integer', minimum: 0 },
      col: { type: 'integer', minimum: 0 },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'row', 'col'],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'row',
      'col',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['unmergeCell'] };
  },
});

export const setTableProperties = defineTool<
  'setTableProperties',
  AhwpToolArgs['setTableProperties']
>({
  name: 'setTableProperties',
  description:
    'Update whole-table properties (border, width, etc.). props is lib setTableProperties JSON.',
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
      args: { ...v.value, props } as AhwpToolArgs['setTableProperties'],
    };
  },
});

export const setCellProperties = defineTool<
  'setCellProperties',
  AhwpToolArgs['setCellProperties']
>({
  name: 'setCellProperties',
  description:
    'Update properties of a single cell (border; background color must go through a style). props is lib setCellProperties JSON.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      cellIdx: { type: 'integer', minimum: 0 },
      props: { type: 'object' },
    },
    required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'cellIdx', 'props'],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'cellIdx',
    ]);
    if (!v.ok) return v;
    const props = raw.props;
    if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
    return {
      ok: true,
      args: { ...v.value, props } as AhwpToolArgs['setCellProperties'],
    };
  },
});

export const evaluateTableFormula = defineTool<
  'evaluateTableFormula',
  AhwpToolArgs['evaluateTableFormula']
>({
  name: 'evaluateTableFormula',
  description:
    'Evaluate a table cell formula in HWP syntax (e.g. =SUM(A1:A5), =A1*B2). writeResult=true also writes the result into the target cell.',
  inputSchema: {
    type: 'object',
    properties: {
      sectionIdx: { type: 'integer', minimum: 0 },
      parentParaIdx: { type: 'integer', minimum: 0 },
      controlIdx: { type: 'integer', minimum: 0 },
      targetRow: { type: 'integer', minimum: 0 },
      targetCol: { type: 'integer', minimum: 0 },
      formula: { type: 'string', maxLength: 4096 },
      writeResult: { type: 'boolean' },
    },
    required: [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'targetRow',
      'targetCol',
      'formula',
      'writeResult',
    ],
  },
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'parentParaIdx',
      'controlIdx',
      'targetRow',
      'targetCol',
    ]);
    if (!v.ok) return v;
    const formula = raw.formula;
    const writeResult = raw.writeResult;
    if (typeof formula !== 'string')
      return { ok: false, reason: 'formula-not-string' };
    if (byteLen(formula) > AHWP_TOOL_LIMITS.maxTextBytes)
      return { ok: false, reason: 'formula-too-large' };
    if (typeof writeResult !== 'boolean')
      return { ok: false, reason: 'writeResult-not-bool' };
    return {
      ok: true,
      args: {
        ...v.value,
        formula,
        writeResult,
      } as AhwpToolArgs['evaluateTableFormula'],
    };
  },
});

export const deleteTableControl = defineTool<
  'deleteTableControl',
  AhwpToolArgs['deleteTableControl']
>({
  name: 'deleteTableControl',
  description: 'Delete a table control entirely.',
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
    return { ok: true, args: v.value as AhwpToolArgs['deleteTableControl'] };
  },
});
