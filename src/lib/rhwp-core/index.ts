/**
 * Public barrel for the renderer-side `@rhwp/core` integration.
 *
 * Existing imports stay shape-compatible: `import { HwpDocument,
 * ensureRhwpCore } from '@/lib/rhwp-core'` resolves through this barrel
 * after the chunk 100 split (was a single file `src/lib/rhwp-core.ts`,
 * now a directory with submodules).
 *
 * New consumers prefer:
 * - `WasmBridge` — for lifecycle (`WasmBridge.create(bytes)` / `.dispose()`)
 * - `RhwpDoc` / `RhwpViewer` types — instead of duplicating
 *   `InstanceType<typeof HwpDocument>`
 */
export { ensureRhwpCore } from './init';
export { WasmBridge } from './wasm-bridge';
export type { RhwpDoc, RhwpViewer } from './types';
export {
  clientToPage,
  clientToPageWithRect,
  pageYToClientY,
  clientToScroller,
  pageToScroller,
  pageDimsToCanvasSize,
} from './coordinate-system';
export type {
  PageCoord,
  ClientCoord,
  ScrollerCoord,
} from './coordinate-system';
export { CanvasPool } from './canvas-pool';
export { getRenderMode, setRenderMode, type RenderMode } from './render-mode';
export {
  parsePageLayerTree,
  applyOverlayLayers,
  type OverlayImageInfo,
  type PageOverlays,
} from './page-layer-tree';

// Direct lib re-exports — kept for back-compat with existing import sites
// that construct `new HwpDocument(bytes)` directly (`useDebugSurface`'s
// reparseAndReadParaProps is one such ad-hoc lifecycle).
export { HwpDocument, HwpViewer } from '@rhwp/core';
