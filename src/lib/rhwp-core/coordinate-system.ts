/**
 * Coordinate-system conversion utilities for the Studio viewer.
 *
 * Introduced in chunk 101 (Phase 6.1) as the foundation for the eventual
 * Canvas render-path swap (chunk 103+). See docs/PHASE6_PLAN.md.
 *
 * ## Coordinate spaces
 *
 * | Space          | Origin                    | Unit       | Used by                          |
 * | -------------- | ------------------------- | ---------- | -------------------------------- |
 * | **Client**     | viewport top-left         | CSS px     | DOM mouse / pointer events       |
 * | **Scroller**   | scroller content top-left | CSS px     | marquee selection rect           |
 * | **Page-CSS**   | page top-left (DOM)       | CSS px     | (rare — usually divided by zoom) |
 * | **Page**       | page top-left (lib)       | page units | `doc.hitTest`, `getCursorRect`   |
 * | **Canvas-px**  | canvas top-left           | device px  | Canvas drawing (Phase 6.3+)      |
 *
 * The current rendered page DOM element has CSS size `pageWidth × zoom` ×
 * `pageHeight × zoom`. The lib's "page" coordinate space is identical to
 * the rendered page divided by zoom — i.e., the units the lib used when
 * laying out the page.
 *
 * DPR (devicePixelRatio) only matters for Canvas backing-store sizing.
 * Hit-testing and cursor placement are zoom-only — the lib never sees DPR.
 *
 * ## Migration policy
 *
 * Pre-Phase 6.1, identical conversions were inlined at ~6 sites
 * (`StudioViewer.tsx:hitTestAt`, `usePageMouseHandlers.ts` × 5). This
 * module consolidates them. New hit-test or marquee logic should call
 * these functions instead of recomputing rects.
 */

export interface PageCoord {
  x: number;
  y: number;
}

export interface ClientCoord {
  x: number;
  y: number;
}

export interface ScrollerCoord {
  x: number;
  y: number;
}

/**
 * Convert DOM client coords (e.g., `e.clientX`, `e.clientY`) to lib's
 * page-coordinate space. Used by every hit-test entry point.
 *
 * `pageEl` is the DOM element whose CSS size = `pageW × zoom × pageH ×
 * zoom`. `zoom` is the current viewer zoom (1.0 = 100%).
 */
export function clientToPage(
  clientX: number,
  clientY: number,
  pageEl: HTMLElement,
  zoom: number,
): PageCoord {
  const rect = pageEl.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / zoom,
    y: (clientY - rect.top) / zoom,
  };
}

/**
 * Same as `clientToPage` but reuses an already-computed bounding rect.
 * Use when the caller has multiple conversions against the same page
 * element and wants to avoid repeated `getBoundingClientRect()` calls.
 */
export function clientToPageWithRect(
  clientX: number,
  clientY: number,
  pageRect: DOMRect,
  zoom: number,
): PageCoord {
  return {
    x: (clientX - pageRect.left) / zoom,
    y: (clientY - pageRect.top) / zoom,
  };
}

/**
 * Convert lib's page-coord (e.g., a `cursorRect.y` returned by
 * `doc.getCursorRect`) back to a client (viewport) Y coordinate. Used to
 * compare a hit-result rect to the current pointer Y in
 * `usePageMouseHandlers` (drag selection clamp).
 */
export function pageYToClientY(
  pageY: number,
  pageEl: HTMLElement,
  zoom: number,
): number {
  const rect = pageEl.getBoundingClientRect();
  return rect.top + pageY * zoom;
}

/**
 * Convert DOM client coords to scroller-content coords. Used by marquee
 * selection — the marquee rect is drawn in scroller-content space so it
 * tracks both pointer movement and scroll-during-drag.
 *
 * Scroller-content coords have origin at the scroller's top-left content
 * corner (i.e., includes `scrollLeft` / `scrollTop` offsets).
 */
export function clientToScroller(
  clientX: number,
  clientY: number,
  scroller: HTMLElement,
): ScrollerCoord {
  const sr = scroller.getBoundingClientRect();
  return {
    x: clientX - sr.left + scroller.scrollLeft,
    y: clientY - sr.top + scroller.scrollTop,
  };
}

/**
 * Convert lib page-coord (with a known `pageEl`) to scroller-content
 * coords. Used when checking whether a `getTableBBox` rect overlaps a
 * marquee rect — the marquee is in scroller-space.
 */
export function pageToScroller(
  pageX: number,
  pageY: number,
  pageEl: HTMLElement,
  scroller: HTMLElement,
  zoom: number,
): ScrollerCoord {
  const pr = pageEl.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  return {
    x: pr.left - sr.left + scroller.scrollLeft + pageX * zoom,
    y: pr.top - sr.top + scroller.scrollTop + pageY * zoom,
  };
}

/**
 * Compute Canvas backing-store + CSS sizes for a given page at the
 * current zoom. DPR-aware — call when sizing a Canvas element to match
 * page dimensions.
 *
 * Returns `{ backingW, backingH }` for `canvas.width` / `canvas.height`
 * and `{ cssW, cssH }` for `canvas.style.width` / `canvas.style.height`.
 *
 * Phase 6.3+: the renderer should set `canvas.width = backingW`,
 * `canvas.height = backingH`, then call
 * `bridge.doc.renderPageToCanvasFiltered(idx, canvas, zoom * dpr, "flow")`
 * — the lib's `scale` parameter takes the combined zoom × DPR factor.
 */
export function pageDimsToCanvasSize(
  pageW: number,
  pageH: number,
  zoom: number,
  dpr: number = typeof window !== 'undefined'
    ? window.devicePixelRatio || 1
    : 1,
): { backingW: number; backingH: number; cssW: number; cssH: number } {
  const cssW = pageW * zoom;
  const cssH = pageH * zoom;
  return {
    backingW: cssW * dpr,
    backingH: cssH * dpr,
    cssW,
    cssH,
  };
}
