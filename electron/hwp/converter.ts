import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { detectHwpFormat } from '../../shared/format';

/**
 * @rhwp/core (Rust + WASM, ~4.5 MB) integration in the main process.
 *
 * Use case in this phase: turn HWP (CFB) bytes into HWPX (zip) bytes at the
 * file:read boundary so the renderer / studio always sees HWPX. That makes
 * the `exportHwp() → save` round-trip deterministic and aligns with
 * ARCHITECTURE.md §B (internal canonical = HWPX).
 *
 * Why dynamic import: @rhwp/core is published as "type": "module" (ESM-only)
 * but vite-plugin-electron bundles main as CJS by default. Node 20 (Electron
 * 33's runtime) cannot `require()` an ESM-only package — it throws
 * ERR_REQUIRE_ESM. `await import()` works from CJS without that restriction.
 */

const require = createRequire(import.meta.url);

interface RhwpCoreModule {
  default: (init?: {
    module_or_path: Uint8Array | ArrayBuffer;
  }) => Promise<unknown>;
  HwpDocument: new (data: Uint8Array) => {
    exportHwpx(): Uint8Array;
    free(): void;
  };
}

let modulePromise: Promise<RhwpCoreModule> | null = null;

async function loadRhwpCore(): Promise<RhwpCoreModule> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const t0 = performance.now();
    // Dynamic import — bypasses the CJS `require` ESM restriction.
    const mod = (await import('@rhwp/core')) as unknown as RhwpCoreModule;
    // resolve the WASM file shipped with @rhwp/core (no `exports` field, so
    // subpath resolution falls back to file lookup).
    const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
    const bytes = await fs.readFile(wasmPath);
    await mod.default({ module_or_path: bytes });
    console.info(
      `[hwp/core] WASM init in ${(performance.now() - t0).toFixed(0)} ms`,
    );
    return mod;
  })();
  return modulePromise;
}

/**
 * Returns HWPX bytes regardless of input format. Pass-through if input is
 * already HWPX (zip magic) — saves a round-trip through HwpDocument and
 * preserves the file byte-exactly.
 */
export async function ensureHwpxBytes(input: Uint8Array): Promise<Uint8Array> {
  const format = detectHwpFormat(input);
  if (format === 'hwpx') return input;
  if (format === 'unknown') {
    throw new Error(
      'Unsupported input: bytes are neither HWP (CFB) nor HWPX (zip)',
    );
  }
  const { HwpDocument } = await loadRhwpCore();
  const t0 = performance.now();
  const doc = new HwpDocument(input);
  try {
    const out = doc.exportHwpx();
    console.info(
      `[hwp/core] HWP → HWPX (${(input.byteLength / 1024 / 1024).toFixed(2)} MB → ${(out.byteLength / 1024 / 1024).toFixed(2)} MB) in ${(performance.now() - t0).toFixed(0)} ms`,
    );
    return out;
  } finally {
    doc.free();
  }
}
