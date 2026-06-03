/**
 * Public barrel for the renderer-side `@rhwp/core` integration.
 *
 * `import { ensureRhwpCore } from '@/lib/rhwp-core'` lazy-inits the WASM
 * module once at startup (main.tsx). The pre-iframe local-render helpers
 * (WasmBridge / coordinate-system / canvas-pool / page-layer-tree /
 * text-layout) were removed once editing moved into the rhwp-studio
 * iframe — all HWP content manipulation now runs through the iframe's
 * `BridgeIrHelper`, not these renderer-side wrappers.
 */
export { ensureRhwpCore } from './init';
