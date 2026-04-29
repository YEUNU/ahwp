/**
 * Renderer-side @rhwp/core integration. Lazy WASM init on first use.
 *
 * This is the foundation for the Studio migration (see docs/STUDIO_MIGRATION.md).
 * Chunk 1: just import + version() to verify Vite bundles @rhwp/core's WASM
 * asset and resolves it at runtime. Chunk 2 will add HwpViewer rendering.
 *
 * Note: the main process has its own @rhwp/core instance (see
 * electron/hwp/converter.ts). They're separate WASM instances in separate
 * processes — no shared state.
 */
import init, {
  HwpDocument,
  HwpViewer,
  init_panic_hook,
  version,
} from '@rhwp/core';

let initPromise: Promise<void> | null = null;

/**
 * Register the host-side text-measurement callback @rhwp/core requires for
 * line wrapping / alignment in the WASM renderer (see node_modules/@rhwp/core/
 * README — "필수 설정: measureTextWidth"). Must be installed BEFORE init().
 *
 * Canvas-based: cache the 2D context and the last `font` string to avoid the
 * surprisingly costly `ctx.font = ...` assignment per call (it parses the
 * font shorthand) when the same font is used many times in a row.
 */
function installMeasureTextWidth(): void {
  type MeasureFn = (font: string, text: string) => number;
  const target = globalThis as unknown as {
    measureTextWidth?: MeasureFn;
  };
  if (typeof target.measureTextWidth === 'function') return;
  let ctx: CanvasRenderingContext2D | null = null;
  let lastFont = '';
  target.measureTextWidth = (font, text) => {
    if (!ctx) {
      ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return text.length * 7; // fallback heuristic
    }
    if (font !== lastFont) {
      ctx.font = font;
      lastFont = font;
    }
    return ctx.measureText(text).width;
  };
}

export async function ensureRhwpCore(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const t0 = performance.now();
    installMeasureTextWidth();
    // Vite resolves the WASM URL automatically when no argument is passed
    // (uses `new URL('rhwp_bg.wasm', import.meta.url)` inside the package).
    await init();
    init_panic_hook();
    console.info(
      `[rhwp/core renderer] WASM init v${version()} in ${(performance.now() - t0).toFixed(0)} ms`,
    );
  })();
  return initPromise;
}

export { HwpDocument, HwpViewer };

// Dev-only window attachment so the module can be probed from DevTools without
// having to wait for chunk 2's UI. Also serves as a top-level side effect so
// Vite/Rollup don't tree-shake the module away when imported as a side-effect.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (
    window as Window & { __rhwpProbe?: { ensure: typeof ensureRhwpCore } }
  ).__rhwpProbe = { ensure: ensureRhwpCore };
}
