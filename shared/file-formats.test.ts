import { describe, it, expect } from 'vitest';
import { isEditable, isReadable } from './file-formats';

describe('shared/file-formats — predicates', () => {
  describe('isEditable', () => {
    it('accepts .hwp / .hwpx (any case)', () => {
      expect(isEditable('foo.hwp')).toBe(true);
      expect(isEditable('foo.HWP')).toBe(true);
      expect(isEditable('foo.hwpx')).toBe(true);
      expect(isEditable('foo.HWPX')).toBe(true);
      expect(isEditable('/abs/path/사업.hwp')).toBe(true);
    });

    it('rejects non-HWP formats', () => {
      expect(isEditable('foo.pdf')).toBe(false);
      expect(isEditable('foo.docx')).toBe(false);
      expect(isEditable('foo.txt')).toBe(false);
      expect(isEditable('foo.md')).toBe(false);
      expect(isEditable('foo.xlsx')).toBe(false);
      expect(isEditable('foo')).toBe(false); // no extension
    });
  });

  describe('isReadable', () => {
    it('accepts HWP + extended formats', () => {
      const cases = [
        'a.hwp',
        'a.hwpx',
        'a.pdf',
        'a.docx',
        'a.txt',
        'a.md',
        'a.markdown',
        'a.csv',
        'a.tsv',
        'a.json',
        'a.xml',
        'a.html',
        'a.htm',
        'a.xlsx',
      ];
      for (const name of cases) {
        expect(isReadable(name)).toBe(true);
      }
    });

    it('rejects binary / unknown formats', () => {
      expect(isReadable('foo.exe')).toBe(false);
      expect(isReadable('foo.png')).toBe(false);
      expect(isReadable('foo.zip')).toBe(false);
      expect(isReadable('foo')).toBe(false);
      // edge — hidden file with HWP-like name shouldn't pass without ext
      expect(isReadable('.hwp.bak')).toBe(false);
    });

    // 0.7.16 — .xls (legacy BIFF8) 는 의도적으로 미지원. 추출기 (exceljs)
    // 가 OOXML 전용이라 런타임 throw → "검증 못 하는 포맷은 선언 안 함".
    // .xlsx 는 그대로 readable 이어야 함 (회귀 가드).
    it('rejects legacy .xls (unsupported) but keeps .xlsx', () => {
      expect(isReadable('budget.xls')).toBe(false);
      expect(isReadable('BUDGET.XLS')).toBe(false);
      expect(isReadable('budget.xlsx')).toBe(true);
    });

    it('case-insensitive across all formats', () => {
      expect(isReadable('REPORT.PDF')).toBe(true);
      expect(isReadable('Data.XLSX')).toBe(true);
      expect(isReadable('Notes.MD')).toBe(true);
    });
  });

  it('every editable is also readable (editable ⊂ readable)', () => {
    const editables = ['x.hwp', 'x.hwpx', 'X.HWP'];
    for (const name of editables) {
      expect(isEditable(name)).toBe(true);
      expect(isReadable(name)).toBe(true);
    }
  });
});
