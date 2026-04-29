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

export async function ensureRhwpCore(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const t0 = performance.now();
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
