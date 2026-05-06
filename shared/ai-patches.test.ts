/**
 * 0.4.20 — patches schema 의 cell location + charShape 확장 검증.
 * Body 단락 backward compat + cell 추가 + lib props 매핑 모두.
 */
import { describe, expect, it } from 'vitest';
import { parsePatchBlock, patchFormatToLibProps } from './ai-patches';

function ok(raw: string): ReturnType<typeof parsePatchBlock> {
  const result = parsePatchBlock(raw);
  if (!result.ok) throw new Error(`parse failed: ${result.reason}`);
  return result;
}

describe('parsePatchBlock — cell location', () => {
  it('parses cell coords when present', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'fill cell',
          location: {
            sectionIndex: 0,
            paragraphIndex: 5,
            startOffset: 0,
            endOffset: 0,
            cell: {
              controlIndex: 0,
              cellIndex: 3,
              cellParagraphIndex: 0,
            },
          },
          deletion: '',
          addition: 'TechFlow',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.location.cell).toEqual({
      controlIndex: 0,
      cellIndex: 3,
      cellParagraphIndex: 0,
    });
  });

  it('rejects malformed cell shape', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'bad cell',
          location: {
            sectionIndex: 0,
            paragraphIndex: 0,
            cell: { controlIndex: 0, cellIndex: -1, cellParagraphIndex: 0 },
          },
          deletion: '',
          addition: 'x',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(false);
    if (item.ok) return;
    expect(item.reason).toMatch(/cell\.cellIndex-invalid/);
  });

  it('omits cell when not provided (backward compat)', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'body edit',
          location: { sectionIndex: 0, paragraphIndex: 1 },
          deletion: 'old',
          addition: 'new',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.location.cell).toBeUndefined();
  });
});

describe('parsePatchBlock — additionFormat', () => {
  it('parses fontName + lib raw passthrough', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'styled',
          location: { sectionIndex: 0, paragraphIndex: 0 },
          deletion: '',
          addition: 'hello',
          additionFormat: {
            fontName: '함초롬바탕',
            fontSize: 1000,
            lib: { name: '함초롬바탕', size_hu: 1000, bold: false },
          },
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.additionFormat?.fontName).toBe('함초롬바탕');
    expect(item.patch.additionFormat?.lib).toEqual({
      name: '함초롬바탕',
      size_hu: 1000,
      bold: false,
    });
  });
});

describe('patchFormatToLibProps', () => {
  it('maps typed fields to lib keys', () => {
    const props = patchFormatToLibProps({
      bold: true,
      italic: false,
      fontName: '함초롬바탕',
      fontSize: 1200,
      textColor: '#ff0000',
    });
    expect(props).toEqual({
      bold: true,
      italic: false,
      name: '함초롬바탕',
      size_hu: 1200,
      color: 0xff0000,
    });
  });

  it('lib base + typed override', () => {
    const props = patchFormatToLibProps({
      lib: { name: 'old', size_hu: 800, bold: true },
      fontName: 'new',
    });
    expect(props.name).toBe('new');
    expect(props.size_hu).toBe(800);
    expect(props.bold).toBe(true);
  });

  it('skips invalid hex color', () => {
    const props = patchFormatToLibProps({ textColor: 'not-a-hex' });
    expect(props.color).toBeUndefined();
  });
});
