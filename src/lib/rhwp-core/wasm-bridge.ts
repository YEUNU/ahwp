/**
 * `WasmBridge` — lifecycle owner for an `HwpDocument` instance.
 *
 * Introduced in chunk 100 (Phase 6.0) as the foundation for the rhwp-studio
 * view-layer alignment migration (docs/PHASE6_PLAN.md). The bridge:
 *
 * - Owns the `HwpDocument` lifecycle (`create()` gates `ensureRhwpCore`,
 *   `dispose()` calls `.free()`). Future viewer instances or per-document
 *   ancillary state (page cache, layer-tree parser) attach here.
 * - Centralizes the future intercept point for Phase 6.3 (Canvas render
 *   path swap) — when `renderPageSvg` is replaced with
 *   `renderPageToCanvasFiltered`, the change happens behind this class.
 * - Exposes the underlying `HwpDocument` directly via `.doc` for now;
 *   chunks 100~107 may incrementally move method categories onto the
 *   bridge as they gain bridge-specific logic. Pre-chunk-100 call sites
 *   (~136 `docRef.current?.X(...)`) keep working unchanged because the
 *   `docRef` still points at the `HwpDocument` (mirrored from `bridge.doc`).
 *
 * No method delegation up front: 109 trivial passthroughs would be
 * boilerplate without payoff. Methods migrate when they have a reason
 * (intercept, transform, mode-aware dispatch).
 */
import { ensureRhwpCore } from './init';
import { HwpDocument } from '@rhwp/core';
import type { RhwpDoc } from './types';

export class WasmBridge {
  private constructor(public readonly doc: RhwpDoc) {}

  /**
   * Construct a bridge around a fresh `HwpDocument`. Awaits WASM init,
   * then parses `bytes` (HWP/CFB or HWPX). On parse failure the bridge
   * is not created and the underlying allocation is freed.
   */
  static async create(bytes: Uint8Array): Promise<WasmBridge> {
    await ensureRhwpCore();
    // We don't construct HwpViewer — its constructor consumes the
    // HwpDocument (`document.__destroy_into_raw()`), zeroing the doc's
    // internal pointer and breaking subsequent exportHwpx() / insertText()
    // calls. The doc itself exposes everything we need (pageCount,
    // renderPageSvg, renderPageHtml). See useDocumentLifecycle 2026-04
    // commentary for the original incident.
    const doc = new HwpDocument(bytes);
    return new WasmBridge(doc);
  }

  /** Page count from the underlying document. */
  pageCount(): number {
    return this.doc.pageCount();
  }

  /**
   * Free the underlying WASM allocation. Idempotent — calling twice is
   * a no-op (the inner `.free()` errors but is swallowed). Once disposed,
   * `.doc` continues to exist as a JS reference but its WASM-side
   * pointer is invalid; callers must drop their references.
   */
  dispose(): void {
    try {
      this.doc.free();
    } catch {
      /* idempotent — second free is a no-op for callers */
    }
  }
}
