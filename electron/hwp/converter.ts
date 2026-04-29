import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import { detectHwpFormat } from '../../shared/format';

/**
 * @rhwp/core (Rust + WASM, ~4.5 MB) integration in the main process.
 *
 * Audit policy: any HWP/HWPX content manipulation defers to @rhwp/core.
 * Our `detectHwpFormat` (magic-byte sniff in shared/format.ts) is the one
 * exception — kept as a cheap pre-parse optimizer for the HWPX pass-through
 * path (saves ~hundreds of ms per `file:read` of an already-HWPX file). For
 * authoritative format identification post-parse, use `HwpDocument.getSourceFormat()`.
 *
 * Future @rhwp/core uses: extractThumbnail (FileList previews), exportHwpVerify
 * (validation UI), HwpViewer (self-hosted viewer to drop the iframe dep),
 * HwpDocument.applyXxx (Phase 3 AI agent edits).
 */

const require = createRequire(import.meta.url);

interface RhwpCoreModule {
  default: (init?: {
    module_or_path: Uint8Array | ArrayBuffer;
  }) => Promise<unknown>;
  HwpDocument: new (data: Uint8Array) => {
    exportHwp(): Uint8Array;
    exportHwpx(): Uint8Array;
    getSourceFormat(): string;
    free(): void;
  };
  init_panic_hook: () => void;
  version: () => string;
}

let modulePromise: Promise<RhwpCoreModule> | null = null;

async function loadRhwpCore(): Promise<RhwpCoreModule> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const t0 = performance.now();
    // Dynamic import — bypasses the CJS `require` ESM restriction.
    const mod = (await import('@rhwp/core')) as unknown as RhwpCoreModule;
    // Resolve the WASM file shipped with @rhwp/core.
    const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
    const bytes = await fs.readFile(wasmPath);
    await mod.default({ module_or_path: bytes });
    // Activate WASM panic hook so Rust panics surface as throw'd Errors with
    // stacks (otherwise they're opaque). One-shot per WASM instance.
    mod.init_panic_hook();
    console.info(
      `[hwp/core] WASM init v${mod.version()} in ${(performance.now() - t0).toFixed(0)} ms`,
    );
    return mod;
  })();
  return modulePromise;
}

/**
 * Read-side: returns the input bytes verbatim.
 *
 * **Why no longer pre-converting HWP→HWPX**: `@rhwp/core` v0.7.8's
 * `HwpDocument(hwp).exportHwpx() → HwpDocument(...)` round-trip drops image
 * references — `BinData/*` blobs land in the zip but the IR can't relocate
 * them on the subsequent load. Verified via scripts/check-image-pipeline.mjs:
 *   A) HWP direct load → renderPageSvg: 25 <image> across 40 pages
 *   B) HWP → exportHwpx → re-load → renderPageSvg: 0 <image> across 53 pages
 *   C) HWPX zip from (B) still contains 46 BinData/* references
 * Reported upstream. Until fixed, the renderer loads HWP/HWPX bytes directly
 * via HwpDocument's auto-detect, which preserves image rendering on read.
 *
 * Save-side `normalizeToHwpx` still round-trips because we have no choice —
 * the point of save is to serialize the in-memory edits. That means **save
 * is currently lossy for documents with embedded images** (KNOWN_ISSUES).
 *
 * We keep the magic-byte gate so unsupported formats (PDF dropped on the
 * viewer, etc.) fail fast with a clear message instead of a WASM panic.
 */
export async function ensureHwpxBytes(input: Uint8Array): Promise<Uint8Array> {
  const format = detectHwpFormat(input);
  if (format === 'unknown') {
    throw new Error(
      'Unsupported input: bytes are neither HWP (CFB) nor HWPX (zip)',
    );
  }
  return input;
}

/**
 * Write-side normalization: parse via @rhwp/core then re-serialize as **HWP**.
 *
 * **Why HWP (CFB) and not HWPX (zip)**: `@rhwp/core` v0.7.8's `exportHwpx →
 * HwpDocument` round-trip drops image references on the next load (see
 * `ensureHwpxBytes` comment + scripts/check-image-pipeline.mjs). The
 * `exportHwp` round-trip preserves images and even page count:
 *
 *   A) HWP direct:                  40 pages, 25 <image>
 *   B) HWP→exportHwpx→reload:       53 pages,  0 <image>  ← bug
 *   D) HWP→exportHwp→reload:        40 pages, 25 <image>  ← OK
 *
 * So we route saves through HWP. The disk format becomes `.hwp`. Internal
 * canonical, originally HWPX (ARCHITECTURE.md §B), is **provisionally HWP**
 * until @rhwp/core fixes the HWPX round-trip. Future versioning (HWPX zip
 * member dedup) is deferred to that fix.
 *
 * Cost: full WASM parse + serialize per save. Multi-MB documents take a few
 * hundred ms.
 */
export async function normalizeToHwp(input: Uint8Array): Promise<Uint8Array> {
  const { HwpDocument } = await loadRhwpCore();
  const t0 = performance.now();
  const doc = new HwpDocument(input); // throws on invalid bytes
  try {
    const sourceFormat = doc.getSourceFormat(); // authoritative
    const out = doc.exportHwp();
    console.info(
      `[hwp/core] normalize ${sourceFormat} → HWP (${(input.byteLength / 1024 / 1024).toFixed(2)} MB → ${(out.byteLength / 1024 / 1024).toFixed(2)} MB) in ${(performance.now() - t0).toFixed(0)} ms`,
    );
    return out;
  } finally {
    doc.free();
  }
}
