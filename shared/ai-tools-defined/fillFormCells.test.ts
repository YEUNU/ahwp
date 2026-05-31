/**
 * fillFormCells (0.7.13) batch validation — bulk cell-fill 도구.
 *
 * 단일 셀 도구(insertTextInCell / replaceTextInCell)의 expectedFormat 검증은
 * cell.test.ts 가 커버. 본 파일은 fillFormCells 의 배열 검증 path 만:
 * 빈/과대 배열, per-cell 좌표·mode·expectedFormat, args 정규화.
 */
import { describe, expect, it } from 'vitest';
import { fillFormCells } from './cell';

const baseCell = {
  sectionIdx: 0,
  parentParaIdx: 42,
  controlIdx: 0,
  cellIdx: 2,
  cellParaIdx: 0,
  text: '㈜코렌스',
};

describe('fillFormCells — batch validation', () => {
  it('cells 누락 → reject', () => {
    expect(fillFormCells.validate({}).ok).toBe(false);
  });

  it('빈 배열 → reject', () => {
    expect(fillFormCells.validate({ cells: [] }).ok).toBe(false);
  });

  it('정상 다중 셀 → 통과 + cells 보존', () => {
    const r = fillFormCells.validate({
      cells: [baseCell, { ...baseCell, cellIdx: 4, text: '예지테크' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.cells).toHaveLength(2);
  });

  it("mode='replace' + text='' (clear) → 통과", () => {
    const r = fillFormCells.validate({
      cells: [{ ...baseCell, mode: 'replace', text: '' }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.cells[0].mode).toBe('replace');
  });

  it('잘못된 mode → reject (셀 인덱스 포함)', () => {
    const r = fillFormCells.validate({
      cells: [{ ...baseCell, mode: 'delete' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('cell[0].mode');
  });

  it('per-cell expectedFormat=marker + 자유 텍스트 → reject', () => {
    const r = fillFormCells.validate({
      cells: [
        { ...baseCell, expectedFormat: 'marker', text: '예지보전 솔루션' },
      ],
    });
    expect(r.ok).toBe(false);
  });

  it('상한(200) 초과 → reject', () => {
    const many = Array.from({ length: 201 }, (_, i) => ({
      ...baseCell,
      cellIdx: i,
    }));
    expect(fillFormCells.validate({ cells: many }).ok).toBe(false);
  });

  it('좌표 누락 셀 → reject (셀 인덱스 포함)', () => {
    const r = fillFormCells.validate({ cells: [{ text: 'x' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('cell[0]');
  });
});
