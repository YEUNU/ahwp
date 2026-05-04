/**
 * Pure SVG page-dimension parser. Extracted from StudioViewer.tsx as the
 * first step of Phase R1 — refactoring (REFACTORING_PLAN.md). No React /
 * lib dependencies — runs in jsdom for unit testing.
 */

export interface PageDims {
  /** SVG `width` attribute or viewBox[2] — pixels (HwpDocument 의 page-0
   *  렌더 결과 단위). */
  w: number;
  /** SVG `height` attribute or viewBox[3]. */
  h: number;
}

/**
 * Parse `<svg width="X" height="Y">` from an SVG document string. Falls
 * back to the last two numbers of `viewBox` when explicit width/height are
 * absent. Returns null when neither route yields finite positive numbers
 * (caller treats this as a parse failure).
 */
export function parsePageDimensions(svg: string): PageDims | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  const w = parseFloat(root.getAttribute('width') || '');
  const h = parseFloat(root.getAttribute('height') || '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w, h };
  }
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/\s+/).map(parseFloat);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { w: parts[2], h: parts[3] };
    }
  }
  return null;
}
