import { describe, expect, it } from 'vitest';
import { parsePageDimensions } from './page-dims';

describe('parsePageDimensions', () => {
  it('returns null for non-svg input', () => {
    expect(parsePageDimensions('')).toBeNull();
    expect(parsePageDimensions('<html><body>x</body></html>')).toBeNull();
  });

  it('reads width / height when present', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842"></svg>';
    expect(parsePageDimensions(svg)).toEqual({ w: 595, h: 842 });
  });

  it('falls back to viewBox when width/height absent', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 595 842"></svg>';
    expect(parsePageDimensions(svg)).toEqual({ w: 595, h: 842 });
  });

  it('rejects non-positive dimensions and falls through to viewBox', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="-1" viewBox="0 0 100 200"></svg>';
    expect(parsePageDimensions(svg)).toEqual({ w: 100, h: 200 });
  });

  it('rejects malformed viewBox', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 abc"></svg>';
    expect(parsePageDimensions(svg)).toBeNull();
  });
});
