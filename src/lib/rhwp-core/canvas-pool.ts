/**
 * `CanvasPool` — DOM `<canvas>` element pooling for the Phase 6.3+
 * Canvas render path. Ported from the rhwp-studio reference
 * (`rhwp-studio/src/view/canvas-pool.ts`) introduced in chunk 102
 * (Phase 6.2). See docs/PHASE6_PLAN.md.
 *
 * ## Why pool?
 *
 * `<canvas>` allocation cost is non-trivial — `getContext('2d')` allocates
 * a backing store and contexts are unique per element. With viewport
 * virtualization the renderer mounts ~11 pages at a time
 * (`VIEWPORT_BUFFER_PAGES × 2 + 1`). On every scroll some pages are
 * unmounted and others mounted. Allocating a fresh Canvas for each
 * mount-cycle creates GC pressure and visible jitter on long documents.
 *
 * The pool keeps a small set of `<canvas>` elements alive across
 * mount/unmount cycles. `acquire(pageIdx)` either pops an idle one from
 * the available list or creates a new one. `release(pageIdx)` removes
 * it from the DOM and returns it to the pool.
 *
 * ## Usage
 *
 * ```ts
 * const pool = new CanvasPool();
 * const canvas = pool.acquire(idx);
 * pageEl.appendChild(canvas);
 * bridge.doc.renderPageToCanvasFiltered(idx, canvas, scale, 'flow');
 * // ... later, when page leaves viewport ...
 * pool.release(idx);
 * ```
 *
 * No max size — the pool grows monotonically up to the active set, then
 * stays bounded by it. With a viewport buffer of 11 pages, the pool
 * stabilizes at ~11 elements.
 */
export class CanvasPool {
  private available: HTMLCanvasElement[] = [];
  private inUse = new Map<number, HTMLCanvasElement>();

  /** Acquire a canvas for the given page (pop from pool or allocate). */
  acquire(pageIdx: number): HTMLCanvasElement {
    let canvas = this.available.pop();
    if (!canvas) {
      canvas = document.createElement('canvas');
    }
    this.inUse.set(pageIdx, canvas);
    return canvas;
  }

  /** Release a canvas back to the pool (also removes it from DOM). */
  release(pageIdx: number): void {
    const canvas = this.inUse.get(pageIdx);
    if (canvas) {
      canvas.parentElement?.removeChild(canvas);
      this.inUse.delete(pageIdx);
      this.available.push(canvas);
    }
  }

  /** Look up the canvas currently assigned to a page (if any). */
  getCanvas(pageIdx: number): HTMLCanvasElement | undefined {
    return this.inUse.get(pageIdx);
  }

  /** Whether a page currently has an assigned canvas. */
  has(pageIdx: number): boolean {
    return this.inUse.has(pageIdx);
  }

  /** Release every page's canvas (e.g., on document close). */
  releaseAll(): void {
    const pages = Array.from(this.inUse.keys());
    for (const pageIdx of pages) {
      this.release(pageIdx);
    }
  }

  /** Currently-assigned page indices. */
  get activePages(): number[] {
    return Array.from(this.inUse.keys());
  }

  /** Total canvas count (in-use + idle). */
  get totalCount(): number {
    return this.inUse.size + this.available.length;
  }
}
