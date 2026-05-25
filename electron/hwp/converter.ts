import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { detectHwpFormat } from '../../shared/format';
import { BLANK_HWPX_BASE64 } from './blank-seed';

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

// chunk 82 — vite 8 CJS bundle 에서 `import.meta.url` 이 `undefined`
// 로 erase 되어 `createRequire(import.meta.url)` 가 throw. 대신 후보
// 경로 list 로 WASM 파일 직접 resolve. asar packed 빌드에서도
// `__dirname` 이 asar virtual root 을 가리켜 fs 가 투명하게 읽음.
function resolveRhwpWasm(): string {
  const candidates = [
    path.join(process.cwd(), 'node_modules', '@rhwp', 'core', 'rhwp_bg.wasm'),
    path.join(__dirname, '..', 'node_modules', '@rhwp', 'core', 'rhwp_bg.wasm'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  throw new Error(`@rhwp/core WASM not found. Tried: ${candidates.join(', ')}`);
}

interface RhwpDocLike {
  exportHwp(): Uint8Array;
  exportHwpx(): Uint8Array;
  getSourceFormat(): string;
  createBlankDocument(): string;
  free(): void;
  // Exposed for the cross-folder text search (chunk 60).
  getSectionCount(): number;
  getParagraphCount(sectionIdx: number): number;
  getParagraphLength(sectionIdx: number, paraIdx: number): number;
  getTextRange(
    sectionIdx: number,
    paraIdx: number,
    startOffset: number,
    endOffset: number,
  ): string;
  // chunk 96 — outline-as-router workspace search.
  getStyleAt(sectionIdx: number, paraIdx: number): string;
  getStyleList(): string;
}

interface RhwpDocCtor {
  new (data: Uint8Array): RhwpDocLike;
  createEmpty(): RhwpDocLike;
}

interface RhwpCoreModule {
  default: (init?: {
    module_or_path: Uint8Array | ArrayBuffer;
  }) => Promise<unknown>;
  HwpDocument: RhwpDocCtor;
  init_panic_hook: () => void;
  version: () => string;
}

let modulePromise: Promise<RhwpCoreModule> | null = null;

export async function loadRhwpCore(): Promise<RhwpCoreModule> {
  if (modulePromise) return modulePromise;
  modulePromise = (async () => {
    const t0 = performance.now();
    // Dynamic import — bypasses the CJS `require` ESM restriction.
    const mod = (await import('@rhwp/core')) as unknown as RhwpCoreModule;
    // Resolve the WASM file shipped with @rhwp/core.
    const wasmPath = resolveRhwpWasm();
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
      'Unsupported input: bytes are not HWP (CFB) / HWPX (zip) / HWP 3.0',
    );
  }
  // 0.4.26 — HWP 3.0 (legacy 한컴 한글 95~97) 도 lib 가 직접 처리. lib
  // 가 panic 하면 그 시점에 surface — 미리 reject 안 함.
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

/**
 * Build a fresh blank HWP document.
 *
 * **Why not `HwpDocument.createEmpty()`**: that static factory returns a
 * shell with `sectionCount=0`, which fails on subsequent `insertText` /
 * `applyCharFormat` ("구역 인덱스 0 범위 초과"). The instance-method
 * `createBlankDocument()` route — load a seed, then reset its IR — keeps
 * the section/paragraph structure intact (verified via
 * scripts/probe-blank3.mjs). We embed a tiny seed (~6KB blank HWPX) as
 * base64 to avoid shipping an extra resource file.
 */
export async function createBlankHwpBytes(): Promise<Uint8Array> {
  const { HwpDocument } = await loadRhwpCore();
  const seed = Uint8Array.from(Buffer.from(BLANK_HWPX_BASE64, 'base64'));
  const doc = new HwpDocument(seed);
  try {
    doc.createBlankDocument();
    return doc.exportHwp();
  } finally {
    doc.free();
  }
}
