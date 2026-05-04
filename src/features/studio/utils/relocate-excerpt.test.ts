import { describe, expect, it } from 'vitest';
import {
  relocateExcerpt,
  RELOCATE_PARA_SCAN_LIMIT,
  type DocReadOnly,
} from './relocate-excerpt';

function fakeDoc(paras: string[]): DocReadOnly {
  return {
    getParagraphCount: () => paras.length,
    getParagraphLength: (_s, p) => paras[p].length,
    getTextRange: (_s, p, off, len) => paras[p].slice(off, off + len),
  };
}

describe('relocateExcerpt', () => {
  it('returns null for empty expected', () => {
    expect(relocateExcerpt(fakeDoc(['hello']), '')).toBeNull();
  });

  it('finds match in first paragraph at offset 0', () => {
    expect(relocateExcerpt(fakeDoc(['hello world']), 'hello')).toEqual({
      sectionIndex: 0,
      startParagraphIndex: 0,
      startOffset: 0,
      endParagraphIndex: 0,
      endOffset: 5,
    });
  });

  it('finds match at non-zero offset', () => {
    expect(relocateExcerpt(fakeDoc(['hello world']), 'world')).toEqual({
      sectionIndex: 0,
      startParagraphIndex: 0,
      startOffset: 6,
      endParagraphIndex: 0,
      endOffset: 11,
    });
  });

  it('finds match in later paragraph', () => {
    expect(
      relocateExcerpt(
        fakeDoc(['intro', 'middle', 'target text here']),
        'target',
      ),
    ).toEqual({
      sectionIndex: 0,
      startParagraphIndex: 2,
      startOffset: 0,
      endParagraphIndex: 2,
      endOffset: 6,
    });
  });

  it('skips paragraphs shorter than expected', () => {
    expect(
      relocateExcerpt(fakeDoc(['x', 'y', 'long enough text']), 'long'),
    ).toEqual({
      sectionIndex: 0,
      startParagraphIndex: 2,
      startOffset: 0,
      endParagraphIndex: 2,
      endOffset: 4,
    });
  });

  it('returns null when no match', () => {
    expect(relocateExcerpt(fakeDoc(['hello world']), 'goodbye')).toBeNull();
  });

  it('respects the paragraph scan cap', () => {
    const paras = Array.from(
      { length: RELOCATE_PARA_SCAN_LIMIT + 5 },
      (_, i) => (i === RELOCATE_PARA_SCAN_LIMIT + 2 ? 'needle here' : 'noise'),
    );
    // Match is past the cap → null.
    expect(relocateExcerpt(fakeDoc(paras), 'needle')).toBeNull();
  });
});
