/**
 * `callCellOp` — Phase R6 refactor (REFACTORING_PLAN.md).
 *
 * @rhwp/core 의 셀 안 편집 API 는 두 variant 를 가진다:
 *   - `xxxInCell(sec, parentPara, ctrl, cell, cellPara, ...rest)` —
 *     top-level 표 (cell.path.length === 1)
 *   - `xxxInCellByPath(sec, parentPara, pathJson, ...rest)` — 중첩
 *     표 (cell.path.length >= 2, Phase E)
 *
 * 같은 op 마다 if 분기로 두 함수를 호출하는 패턴이 코드베이스에 33+ 곳
 * 흩어져 있어 helper 로 일원화. trailing args 는 두 variant 가 동일.
 */

export interface CellLocation {
  parentParaIndex: number;
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
  /** Phase E nested table path. Undefined / single-segment → top-level. */
  path?: Array<{
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
  }>;
}

/**
 * Route a cell op to either the `*InCell` or `*InCellByPath` variant
 * based on `cell.path` depth. Both variants share the same trailing args.
 *
 * Usage:
 *   callCellOp(
 *     c.cell,
 *     c.sectionIndex,
 *     doc.insertTextInCell.bind(doc),
 *     doc.insertTextInCellByPath.bind(doc),
 *     c.charOffset,
 *     text,
 *   );
 */
export function callCellOp<TArgs extends readonly unknown[], TResult>(
  cell: CellLocation,
  sectionIndex: number,
  inCellFn: (
    sec: number,
    parentPara: number,
    ctrl: number,
    cellIdx: number,
    cellParaIdx: number,
    ...args: TArgs
  ) => TResult,
  byPathFn: (
    sec: number,
    parentPara: number,
    pathJson: string,
    ...args: TArgs
  ) => TResult,
  ...args: TArgs
): TResult {
  if (cell.path && cell.path.length > 1) {
    return byPathFn(
      sectionIndex,
      cell.parentParaIndex,
      JSON.stringify(cell.path),
      ...args,
    );
  }
  return inCellFn(
    sectionIndex,
    cell.parentParaIndex,
    cell.controlIndex,
    cell.cellIndex,
    cell.cellParaIndex,
    ...args,
  );
}

/**
 * Variant for ops that take only `(sec, parentPara, ctrl)` on the
 * non-path side — `getTableCellBboxes` / `getTableDimensions` etc. The
 * cell's controlIndex is used (cellIdx/cellParaIdx aren't passed).
 *
 * `cell.parentParaIndex` is the parent paragraph for both variants.
 */
export function callTableOp<TArgs extends readonly unknown[], TResult>(
  cell: CellLocation,
  sectionIndex: number,
  defaultFn: (
    sec: number,
    parentPara: number,
    ctrl: number,
    ...args: TArgs
  ) => TResult,
  byPathFn: (
    sec: number,
    parentPara: number,
    pathJson: string,
    ...args: TArgs
  ) => TResult,
  ...args: TArgs
): TResult {
  if (cell.path && cell.path.length > 1) {
    return byPathFn(
      sectionIndex,
      cell.parentParaIndex,
      JSON.stringify(cell.path),
      ...args,
    );
  }
  return defaultFn(
    sectionIndex,
    cell.parentParaIndex,
    cell.controlIndex,
    ...args,
  );
}
