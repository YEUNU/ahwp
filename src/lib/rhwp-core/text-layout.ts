/**
 * `getPageTextLayout` JSON parser + transparent text-tooltip overlay
 * applicator (Phase 6 follow-up — L-004 Canvas-mode mitigation).
 *
 * ## Why
 *
 * Pre-chunk-107 the SVG render path injected `<title>` children into
 * each `<text>` element so the browser's native tooltip exposed the
 * full text on hover (KNOWN_ISSUES L-004 — narrow-column text gets
 * clipped by the lib's column-width estimate). Canvas has no such
 * affordance.
 *
 * `bridge.doc.getPageTextLayout(idx)` returns the per-run text layout
 * with `bbox` (`x`/`y`/`w`/`h`) and content. This module:
 * - parses the runs
 * - filters non-empty text + sane bbox
 * - mounts a transparent `<div title="...">` per run, sized + positioned
 *   at the run's bbox (page-coord × zoom for CSS px)
 *
 * Browser native tooltip recreates the L-004 hover affordance with no
 * SVG dependency.
 *
 * ## Performance
 *
 * Stress-fixture page-0 has ~30 runs in the head section we probed; a
 * dense layout might emit a few hundred per page. Each run becomes one
 * empty `<div>` — DOM cost is small. We re-apply on zoom change /
 * forceRerender, removing the previous overlay first to keep the count
 * bounded by the current page's run count, not a multiple of it.
 */

export interface TextLayoutRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageTextLayout {
  runs: TextLayoutRun[];
}

interface RawTextLayoutRun {
  text?: unknown;
  x?: unknown;
  y?: unknown;
  w?: unknown;
  h?: unknown;
}

/**
 * Parse a `getPageTextLayout` JSON payload into a flat list of runs
 * with non-empty text content. Returns an empty list on parse failure
 * or when no runs have visible text.
 */
export function parsePageTextLayout(json: string): PageTextLayout {
  try {
    const parsed = JSON.parse(json) as { runs?: RawTextLayoutRun[] };
    const raw = Array.isArray(parsed?.runs) ? parsed.runs : [];
    const runs: TextLayoutRun[] = [];
    for (const r of raw) {
      const text = typeof r.text === 'string' ? r.text : '';
      if (!text.trim()) continue; // skip empty / whitespace-only
      const x = typeof r.x === 'number' ? r.x : NaN;
      const y = typeof r.y === 'number' ? r.y : NaN;
      const w = typeof r.w === 'number' ? r.w : NaN;
      const h = typeof r.h === 'number' ? r.h : NaN;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
      if (w <= 0 || h <= 0) continue;
      runs.push({ text, x, y, w, h });
    }
    return { runs };
  } catch (err) {
    console.warn('[rhwp/text-layout] parse failed:', err);
    return { runs: [] };
  }
}

/**
 * Apply transparent text-tooltip overlay as a sibling of `canvas`
 * inside `parent`. Idempotent — removes any existing
 * `[data-rhwp-text-tooltip="N"]` child before adding fresh ones.
 *
 * Each run becomes one absolute-positioned empty `<div>` with the
 * `title` attribute set to its text. The browser's native tooltip
 * does the rest. `pointer-events: auto` is required for `title` to
 * fire on Chromium; mouse events bubble up naturally to the page
 * container's existing mousedown handler in `usePageMouseHandlers`,
 * so click-to-caret and drag-select continue to work.
 *
 * Z-index 1 — between behind-overlay (0) and front-overlay (2). The
 * tooltip layer itself is pointer-transparent (events fall through
 * the gaps between runs); per-run divs are pointer-active.
 */
export function applyTextTooltipOverlay(
  parent: HTMLElement,
  pageIdx: number,
  layout: PageTextLayout,
  zoom: number,
): void {
  const existing = parent.querySelector(
    `[data-rhwp-text-tooltip="${pageIdx}"]`,
  );
  if (existing) existing.remove();

  if (layout.runs.length === 0) return;

  const canvas = parent.querySelector('canvas');
  if (!canvas) return;

  const layer = document.createElement('div');
  layer.dataset.rhwpTextTooltip = String(pageIdx);
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.zIndex = '1';
  // Layer itself is pointer-transparent so gaps between runs don't
  // steal events. Per-run divs below opt back in to receive hover.
  layer.style.pointerEvents = 'none';

  for (const run of layout.runs) {
    const el = document.createElement('div');
    el.title = run.text;
    el.style.position = 'absolute';
    el.style.left = `${run.x * zoom}px`;
    el.style.top = `${run.y * zoom}px`;
    el.style.width = `${run.w * zoom}px`;
    el.style.height = `${run.h * zoom}px`;
    // pointer-events: auto so the browser shows the `title` tooltip
    // on hover. Mouse events bubble up to the page container's
    // mousedown handler — caret placement / drag selection unchanged.
    el.style.pointerEvents = 'auto';
    el.style.background = 'transparent';
    el.style.cursor = 'text';
    layer.appendChild(el);
  }

  parent.appendChild(layer);
}
