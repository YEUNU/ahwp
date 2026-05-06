/**
 * `getPageLayerTree` JSON parser + overlay DOM applicator (chunk 104,
 * Phase 6.4). Ported from rhwp-studio reference
 * (`rhwp-studio/src/view/page-renderer.ts:163-317`).
 *
 * ## Why
 *
 * `renderPageToCanvasFiltered(idx, c, scale, "flow")` emits the body
 * layer (text, tables, inline images) onto Canvas — but skips images
 * with `wrap = behindText` / `inFrontOfText` (watermarks, stamps,
 * background decorations). For correct visual fidelity those images
 * must be rendered as separate sibling overlays so they layer behind
 * (z-index < canvas) or in front (z-index > canvas) of the body.
 *
 * `bridge.doc.getPageLayerTree(idx)` returns a JSON paint-op tree.
 * This module:
 * - parses the tree
 * - filters for `type:"image"` ops with `wrap = behindText|inFrontOfText`
 * - returns bbox + base64 + effect metadata for each
 *
 * ## Effect mapping
 *
 * HWP picture effects → CSS filter:
 * - `effect: "grayScale"` / `"pattern8x8"` → `grayscale(100%)`
 * - `effect: "blackWhite"` → `grayscale(100%) contrast(1000%)`
 * - `brightness: N` → `brightness((100+N)/100)` (0 = no change, +50 = 1.5×)
 * - `contrast: N` → `contrast((100+N)/100)`
 *
 * Watermark images additionally get `mix-blend-mode: multiply` so the
 * white background of the watermark image composites naturally with
 * body text.
 */

export interface OverlayImageInfo {
  bbox: { x: number; y: number; width: number; height: number };
  mime: string;
  base64: string;
  effect: string;
  brightness: number;
  contrast: number;
  watermark?: { preset: 'hancom-watermark' | 'custom' };
  wrap: 'behindText' | 'inFrontOfText';
  transform?: { rotation: number; horzFlip: boolean; vertFlip: boolean };
}

export interface PageOverlays {
  behind: OverlayImageInfo[];
  front: OverlayImageInfo[];
}

/**
 * Parse a `getPageLayerTree` JSON payload into behind/front floating
 * image lists. Returns empty lists on parse failure (malformed JSON or
 * unexpected schema). Body-layer images (square / topAndBottom / none)
 * are silently dropped — they belong on the canvas, not as overlays.
 */
export function parsePageLayerTree(json: string): PageOverlays {
  const behind: OverlayImageInfo[] = [];
  const front: OverlayImageInfo[] = [];
  try {
    const wrapper = JSON.parse(json) as { root?: unknown };
    if (wrapper?.root) {
      collectOverlayImages(wrapper.root, behind, front);
    }
  } catch (err) {
    console.warn('[rhwp/page-layer-tree] parse failed:', err);
  }
  return { behind, front };
}

interface LayerNode {
  ops?: unknown;
  children?: unknown;
  child?: unknown;
}

interface LayerImageOp {
  type: 'image';
  wrap?: string;
  bbox?: OverlayImageInfo['bbox'];
  mime?: string;
  base64?: string;
  effect?: string;
  brightness?: number;
  contrast?: number;
  watermark?: OverlayImageInfo['watermark'];
  transform?: OverlayImageInfo['transform'];
}

function collectOverlayImages(
  node: unknown,
  behind: OverlayImageInfo[],
  front: OverlayImageInfo[],
): void {
  if (!node || typeof node !== 'object') return;
  const n = node as LayerNode;
  if (Array.isArray(n.ops)) {
    for (const op of n.ops as unknown[]) {
      if (!op || typeof op !== 'object') continue;
      const o = op as LayerImageOp;
      if (o.type !== 'image' || !o.bbox) continue;
      if (o.wrap === 'behindText') {
        behind.push(toOverlayInfo(o, 'behindText'));
      } else if (o.wrap === 'inFrontOfText') {
        front.push(toOverlayInfo(o, 'inFrontOfText'));
      }
    }
  }
  if (Array.isArray(n.children)) {
    for (const child of n.children) {
      collectOverlayImages(child, behind, front);
    }
  }
  if (n.child) {
    collectOverlayImages(n.child, behind, front);
  }
}

function toOverlayInfo(
  op: LayerImageOp,
  wrap: 'behindText' | 'inFrontOfText',
): OverlayImageInfo {
  return {
    bbox: op.bbox!,
    mime: op.mime ?? 'application/octet-stream',
    base64: op.base64 ?? '',
    effect: op.effect ?? 'realPic',
    brightness: op.brightness ?? 0,
    contrast: op.contrast ?? 0,
    watermark: op.watermark,
    wrap,
    transform: op.transform,
  };
}

/**
 * Apply behind/front image overlays as siblings of `canvas` inside
 * `parent`. Idempotent — removes any existing
 * `[data-rhwp-overlay="behind-N"]` / `front-N` children before adding
 * fresh ones, so calling repeatedly (e.g., after zoom change) gives a
 * consistent result.
 *
 * `pageIdx` is used as a tag in the `data-rhwp-overlay` attribute so
 * multiple pages inside a single scroll container don't conflict on
 * cleanup.
 *
 * `pointer-events: none` on every overlay layer — text hit-testing is
 * the canvas's responsibility.
 */
export function applyOverlayLayers(
  parent: HTMLElement,
  pageIdx: number,
  overlays: PageOverlays,
  zoom: number,
): void {
  const existingBehind = parent.querySelector(
    `[data-rhwp-overlay="behind-${pageIdx}"]`,
  );
  const existingFront = parent.querySelector(
    `[data-rhwp-overlay="front-${pageIdx}"]`,
  );
  if (existingBehind) existingBehind.remove();
  if (existingFront) existingFront.remove();

  if (overlays.behind.length === 0 && overlays.front.length === 0) return;

  const canvas = parent.querySelector('canvas');
  if (!canvas) return;

  if (overlays.behind.length > 0) {
    const layer = createOverlayLayer(overlays.behind, zoom);
    layer.dataset.rhwpOverlay = `behind-${pageIdx}`;
    layer.style.zIndex = '0';
    parent.insertBefore(layer, canvas);
  }
  if (overlays.front.length > 0) {
    const layer = createOverlayLayer(overlays.front, zoom);
    layer.dataset.rhwpOverlay = `front-${pageIdx}`;
    layer.style.zIndex = '2';
    parent.appendChild(layer);
  }
}

function createOverlayLayer(
  images: OverlayImageInfo[],
  zoom: number,
): HTMLDivElement {
  const layer = document.createElement('div');
  layer.style.position = 'absolute';
  layer.style.inset = '0';
  layer.style.pointerEvents = 'none';
  for (const img of images) {
    const el = document.createElement('img');
    el.src = `data:${img.mime};base64,${img.base64}`;
    el.style.position = 'absolute';
    // bbox is in lib page-coord units; the parent (pageRefsRef inner
    // div) has CSS size = pageDims × zoom. So bbox needs to be scaled
    // by zoom to match the visual placement of the canvas underneath.
    el.style.left = `${img.bbox.x * zoom}px`;
    el.style.top = `${img.bbox.y * zoom}px`;
    el.style.width = `${img.bbox.width * zoom}px`;
    el.style.height = `${img.bbox.height * zoom}px`;
    el.style.pointerEvents = 'none';
    const filterParts: string[] = [];
    if (img.effect === 'grayScale' || img.effect === 'pattern8x8') {
      filterParts.push('grayscale(100%)');
    } else if (img.effect === 'blackWhite') {
      filterParts.push('grayscale(100%) contrast(1000%)');
    }
    if (img.brightness !== 0) {
      filterParts.push(`brightness(${(100 + img.brightness) / 100})`);
    }
    if (img.contrast !== 0) {
      filterParts.push(`contrast(${(100 + img.contrast) / 100})`);
    }
    if (filterParts.length > 0) {
      el.style.filter = filterParts.join(' ');
    }
    if (img.watermark) {
      el.style.mixBlendMode = 'multiply';
    }
    layer.appendChild(el);
  }
  return layer;
}
