/**
 * Studio viewer public surface — what AppShell holds via `viewerRef` and
 * uses to drive save flows. `RhwpViewerHandle` was the historical name (it
 * lived in the legacy iframe-based RhwpViewer); the StudioViewer now owns
 * this interface.
 */

export type CharFormatKey = 'bold' | 'italic' | 'underline';

export interface ViewerHandle {
  /** Returns the current document as bytes (HWP/CFB — see converter notes). */
  exportBytes: () => Promise<Uint8Array>;
  /**
   * Toggle a character format on the caret's current paragraph. Chunk 5 has
   * no selection model, so the toggle applies to the entire paragraph the
   * caret sits in. The current state is read via getStyleAt + getStyleDetail.
   */
  toggleCharFormat: (key: CharFormatKey) => void;
}
