/**
 * Render-mode dual-gate (chunk 102, Phase 6.2).
 *
 * Selects between the legacy SVG render path (`renderPageSvg` →
 * `<svg>` mount) and the Phase 6.3+ Canvas path (`renderPageToCanvasFiltered`
 * → `<canvas>` + 3-tier overlay). Defaults to `'svg'` until chunk 107
 * cleans up the SVG path entirely.
 *
 * ## Source of truth
 *
 * `localStorage.ahwp:render-mode` — `'svg' | 'canvas'`. Anything else
 * falls back to `'svg'`. Chosen for parity with the historical
 * `localStorage.ahwp:use-studio` flag pattern (chunks 1~6) and to allow
 * e2e to set per-spec via `page.evaluate`.
 *
 * ## Reading
 *
 * Components call `getRenderMode()` synchronously at render time. The
 * value is read once per call — no caching, no subscription. Hot
 * mode-switch is intentionally not supported in chunk 102 (would
 * require remounting all viewers); to switch mode, set the flag and
 * reload.
 */
export type RenderMode = 'svg' | 'canvas';

const STORAGE_KEY = 'ahwp:render-mode';

/**
 * Read the current render mode from localStorage. Returns `'svg'` for
 * any unrecognized or missing value (fail-safe — the legacy path is
 * always valid until chunk 107).
 */
export function getRenderMode(): RenderMode {
  if (typeof window === 'undefined') return 'svg';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'canvas') return 'canvas';
  } catch {
    /* localStorage may throw in private mode / sandboxed contexts */
  }
  return 'svg';
}

/**
 * Write the render mode (mostly for tests / dev console). Production
 * does not expose this in the UI yet — chunk 107 removes the flag
 * entirely after Canvas becomes the only path.
 */
export function setRenderMode(mode: RenderMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}
