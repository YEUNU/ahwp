/**
 * `shared/ai-tools-defined/cell.ts` 도구 validate 테스트 — 0.7.12.
 *
 * 핵심 검증: insertTextInCell / replaceTextInCell 에 expectedFormat 인자가
 * 들어왔을 때 text 가 포맷을 위반하면 reject 됨. 미지정 시 통과 (backward
 * compat).
 *
 * cell 좌표 validation 은 기존 nonNegInts 헬퍼 가 책임 — 본 파일은 신규
 * expectedFormat path 만 커버.
 */
import { describe, expect, it } from 'vitest';
import { insertTextInCell, replaceTextInCell } from './cell';

const baseCoord = {
  sectionIdx: 0,
  parentParaIdx: 1,
  controlIdx: 0,
  cellIdx: 4,
  cellParaIdx: 0,
  charOffset: 0,
};

describe('insertTextInCell — expectedFormat validation', () => {
  it('expectedFormat 미지정 → 한글 텍스트도 통과 (backward compat)', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '예지보전 솔루션',
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        (r.args as { expectedFormat?: string }).expectedFormat,
      ).toBeUndefined();
  });

  it('expectedFormat=text → 어떤 텍스트도 통과', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '아무 텍스트',
      expectedFormat: 'text',
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect((r.args as { expectedFormat?: string }).expectedFormat).toBe(
        'text',
      );
  });

  it('expectedFormat=marker + "예지보전 솔루션" → reject', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '예지보전 솔루션',
      expectedFormat: 'marker',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^marker-/);
  });

  it('expectedFormat=marker + "O" → 통과', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: 'O',
      expectedFormat: 'marker',
    });
    expect(r.ok).toBe(true);
  });

  it('expectedFormat=marker + "85" → reject (사용자 transcript 의 실제 버그)', () => {
    // ERP 행의 "도입여부 (O/X)" 컬럼에 "85" 가 박혔던 케이스 — 0.7.12 가
    // 잡으려는 정확한 시나리오.
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '85',
      expectedFormat: 'marker',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^marker-/);
  });

  it('expectedFormat=number + "백오십" → reject', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '백오십',
      expectedFormat: 'number',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('number-non-numeric');
  });

  it('expectedFormat=number + "120" → 통과', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '120',
      expectedFormat: 'number',
    });
    expect(r.ok).toBe(true);
  });

  it('expectedFormat=currency + "1,200" → 통과', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '1,200',
      expectedFormat: 'currency',
    });
    expect(r.ok).toBe(true);
  });

  it('expectedFormat=date + "2026-05-27" → 통과', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '2026-05-27',
      expectedFormat: 'date',
    });
    expect(r.ok).toBe(true);
  });

  it('expectedFormat=unknown-value → reject', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: 'whatever',
      expectedFormat: 'banana',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expectedFormat-unknown');
  });

  it('expectedFormat=non-string → reject', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: 'x',
      expectedFormat: 42,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('expectedFormat-not-string');
  });

  it('expectedFormat + 빈 text → 통과 (clear 허용)', () => {
    const r = insertTextInCell.validate({
      ...baseCoord,
      text: '',
      expectedFormat: 'marker',
    });
    expect(r.ok).toBe(true);
  });
});

describe('replaceTextInCell — expectedFormat validation', () => {
  const replaceCoord = {
    sectionIdx: 0,
    parentParaIdx: 1,
    controlIdx: 0,
    cellIdx: 4,
    cellParaIdx: 0,
  };

  it('expectedFormat 미지정 → 통과', () => {
    const r = replaceTextInCell.validate({
      ...replaceCoord,
      text: '아무것',
    });
    expect(r.ok).toBe(true);
  });

  it('expectedFormat=marker + 한글 → reject', () => {
    const r = replaceTextInCell.validate({
      ...replaceCoord,
      text: '예방정비 전환',
      expectedFormat: 'marker',
    });
    expect(r.ok).toBe(false);
  });

  it('expectedFormat=currency + 한글 → reject', () => {
    const r = replaceTextInCell.validate({
      ...replaceCoord,
      text: '백만원',
      expectedFormat: 'currency',
    });
    expect(r.ok).toBe(false);
  });

  it('text="" + expectedFormat → 통과 (clear)', () => {
    const r = replaceTextInCell.validate({
      ...replaceCoord,
      text: '',
      expectedFormat: 'marker',
    });
    expect(r.ok).toBe(true);
  });
});
