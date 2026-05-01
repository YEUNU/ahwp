/**
 * Studio viewer public surface — what AppShell holds via `viewerRef` and
 * uses to drive save flows. `RhwpViewerHandle` was the historical name (it
 * lived in the legacy iframe-based RhwpViewer); the StudioViewer now owns
 * this interface.
 */

export type CharFormatKey = 'bold' | 'italic' | 'underline';
export type ParagraphAlignment = 'left' | 'center' | 'right' | 'justify';

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
  /** Open the Find bar with replace input focused (chunk 7 — Phase 2). */
  openReplace: () => void;
  /** Read the current section's PageDef (for Page Setup dialog seed values). */
  getPageDef: (sectionIdx?: number) => Record<string, unknown> | null;
  /** Apply a PageDef props bag (paper size / margins / orientation). */
  applyPageDef: (props: Record<string, unknown>, sectionIdx?: number) => void;
  /**
   * Read a header / footer slot. Shape:
   * `{ exists, kind, applyTo, paraCount, text, ... }`. applyTo=0 covers
   * all pages ("양 쪽").
   */
  getHeaderFooter: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
  ) => Record<string, unknown> | null;
  /** Replace a header/footer's text in one shot (empty string = remove). */
  setHeaderFooterText: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
    text: string,
  ) => void;
  /** Add a bookmark at the current caret position (chunk 12). */
  addBookmarkAtCaret: (name: string) => void;
  /** All bookmarks in the document. Each entry has `{name, sectionIndex, paragraphIndex, controlIndex, ...}` (shape varies by lib version). */
  getBookmarks: () => Record<string, unknown>[] | null;
  /** Delete a bookmark by its IR coordinates. */
  deleteBookmarkAt: (
    sectionIdx: number,
    paraIdx: number,
    ctrlIdx: number,
  ) => void;
  /** Rename a bookmark in place. */
  renameBookmarkAt: (
    sectionIdx: number,
    paraIdx: number,
    ctrlIdx: number,
    newName: string,
  ) => void;
  /** Set paragraph alignment on selection / current paragraph (chunk 10). */
  applyAlignment: (a: ParagraphAlignment) => void;
  /** Apply font size in points (converted to HWPUNIT internally). */
  applyFontSizePt: (pt: number) => void;
  /** Apply text color in #RRGGBB hex. */
  applyTextColor: (hex: string) => void;
  /** Whether the doc has unsaved changes (mirrors internal dirtyRef). */
  isDirty: () => boolean;
}
