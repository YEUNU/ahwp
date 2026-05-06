import { describe, expect, it } from 'vitest';
import { parsePageDimensions } from './page-dims';

describe('parsePageDimensions (chunk 107: getPageInfo JSON)', () => {
  it('returns null for malformed JSON', () => {
    expect(parsePageDimensions('')).toBeNull();
    expect(parsePageDimensions('not json')).toBeNull();
  });

  it('reads width / height from a getPageInfo JSON payload', () => {
    const json = JSON.stringify({ width: 595, height: 842 });
    expect(parsePageDimensions(json)).toEqual({ w: 595, h: 842 });
  });

  it('returns null when width / height are missing', () => {
    expect(parsePageDimensions(JSON.stringify({}))).toBeNull();
    expect(parsePageDimensions(JSON.stringify({ width: 595 }))).toBeNull();
  });

  it('rejects non-positive dimensions', () => {
    expect(
      parsePageDimensions(JSON.stringify({ width: 0, height: 842 })),
    ).toBeNull();
    expect(
      parsePageDimensions(JSON.stringify({ width: 595, height: -1 })),
    ).toBeNull();
  });

  it('rejects non-numeric width / height', () => {
    expect(
      parsePageDimensions(JSON.stringify({ width: '595', height: 842 })),
    ).toBeNull();
  });

  it('ignores unrelated fields (margins, etc.) — pageInfo has more than just dims', () => {
    const json = JSON.stringify({
      width: 595,
      height: 842,
      marginLeft: 20,
      marginRight: 20,
      marginTop: 30,
      marginBottom: 30,
      marginHeader: 15,
      marginFooter: 15,
    });
    expect(parsePageDimensions(json)).toEqual({ w: 595, h: 842 });
  });
});
