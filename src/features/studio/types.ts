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
   * Toggle a character format. With an active selection, applies to the
   * selected range; otherwise applies to the caret's whole paragraph.
   */
  toggleCharFormat: (key: CharFormatKey) => void;
  /** Undo the most recent mutation (snapshot-based — chunk 7). */
  undo: () => void;
  /** Redo a previously-undone mutation. No-op if no redo available. */
  redo: () => void;
  /** Copy current selection to internal + system clipboard. No-op if empty. */
  copy: () => Promise<boolean>;
  /** Cut current selection (copy + deleteRange). No-op if empty. */
  cut: () => Promise<boolean>;
  /** Paste system clipboard text (or internal clipboard if it matches). */
  paste: () => Promise<boolean>;
  /** Open the in-document Find bar and focus its input (chunk 9). */
  openFind: () => void;
}
