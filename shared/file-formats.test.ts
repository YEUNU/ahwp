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
        'a.xls',
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
