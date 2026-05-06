/**
 * Page-dimension extraction. Phase R1 originated as an SVG attribute
 * parser (`<svg width="X" height="Y">`); chunk 107 (Phase 6.7) flips it
 * to consume `bridge.doc.getPageInfo(idx)` JSON now that the renderer
 * is canvas-only. No React / WASM dependencies — runs in jsdom for
 * unit testing.
 */

export interface PageDims {
  /** Page width in lib page-coord units (matches `getPageInfo.width` and
   *  the coord space `doc.hitTest` / `getCursorRect` accept). */
  w: number;
  /** Page height in same units. */
  h: number;
}

/**
 * Extract page dimensions from a `getPageInfo` JSON payload (the lib
 * returns a JSON string — caller passes it through unchanged). Returns
 * null when the JSON is malformed or the width/height fields are
 * missing or non-positive.
 */
export function parsePageDimensions(pageInfoJson: string): PageDims | null {
  try {
    const info = JSON.parse(pageInfoJson) as {
      width?: number;
      height?: number;
    };
    const w = typeof info.width === 'number' ? info.width : NaN;
    const h = typeof info.height === 'number' ? info.height : NaN;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return { w, h };
    }
  } catch {
    /* fall through to null return */
  }
  return null;
}
