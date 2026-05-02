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
  /**
   * Insert a footnote at the current caret with optional body text
   * (chunk 13). Empty text creates an empty footnote shell.
   */
  insertFootnoteAtCaret: (text: string) => void;
  /** Create a new named style (chunk 14). Returns the new id, or null on failure. */
  createNamedStyle: (name: string, englishName?: string) => number | null;
  /** Rename an existing style. */
  renameStyle: (id: number, name: string, englishName?: string) => boolean;
  /** Delete a style. Paragraphs using it fall back to id 0 (바탕글). */
  deleteStyleById: (id: number) => boolean;
  /** Read the style list as parsed JSON. */
  getStyleListJson: () => Record<string, unknown>[] | null;
  /**
   * Render a 한컴 수식 script to SVG via `renderEquationPreview`
   * (chunk 16). Empty string on failure.
   */
  renderEquationSvg: (
    script: string,
    fontSizeHwpunit?: number,
    color?: number,
  ) => string;
  /**
   * Insert a rectangle shape at the current caret (chunk 15). Returns
   * the (paraIdx, controlIdx) of the new shape, or null on failure.
   */
  createRectShapeAtCaret: (
    widthHwpunit: number,
    heightHwpunit: number,
    opts?: { treatAsChar?: boolean },
  ) => { paraIdx: number; controlIdx: number } | null;
  /**
   * Apply an HTML fragment at the current caret (chunk 18). Wraps
   * `pasteHtml` and additionally walks the source HTML to apply
   * paragraph-level styles (text-align, line-height, margins, indent)
   * the IR's pasteHtml drops. Use this for AI-authored HTML responses.
   */
  applyHtmlAtCaret: (html: string) => void;
  /**
   * Export the first N paragraphs of section 0 as HTML (chunk 18).
   * Used by the chat panel to attach document context to AI requests.
   * Token-cheap compared to HWPX; lossy on header/footer/footnote
   * meta but fine for AI comprehension of body content.
   */
  exportDocumentHtml: (maxParagraphs?: number) => string;
  /** Set paragraph alignment on selection / current paragraph (chunk 10). */
  applyAlignment: (a: ParagraphAlignment) => void;
  /** Apply font size in points (converted to HWPUNIT internally). */
  applyFontSizePt: (pt: number) => void;
  /** Apply text color in #RRGGBB hex. */
  applyTextColor: (hex: string) => void;
  /** Whether the doc has unsaved changes (mirrors internal dirtyRef). */
  isDirty: () => boolean;
  /**
   * Apply a pre-existing named style to a cell — chunk 23. Routes
   * through `@rhwp/core`'s `applyCellStyle(sec, parentPara, ctrl, cell,
   * cellPara, styleId)`. The library has no direct cell-color setter;
   * see KNOWN_ISSUES L-006.
   */
  applyCellStyle: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    styleId: number,
  ) => boolean;
  /** Read picture-control properties — chunk 24. Shape: `{ width,
   * height, treatAsChar, ... }` (HWPUNIT). `null` when bounds invalid. */
  getPictureProps: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
  ) => Record<string, unknown> | null;
  /** Update picture-control properties — chunk 24. Pass any subset
   * (`width`, `height`, `treatAsChar`, etc.). Returns ok flag. */
  setPictureProps: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    props: Record<string, unknown>,
  ) => boolean;
  /** Remove a picture control — chunk 24. */
  deletePictureControl: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
  ) => boolean;
  /** Begin grouping subsequent mutations into a single undo entry —
   * chunk 27. Reentrant: nested begin/end pairs balance via a depth
   * counter. Pair every begin with end. */
  beginUndoGroup: () => void;
  /** End the current undo group and push one snapshot covering all
   * mutations since the matching begin — chunk 27. */
  endUndoGroup: () => void;
  /** Copy a control object (table, image, shape) to the IR's internal
   * clipboard — chunk 25. Distinct from text copy. */
  copyControl: (
    sectionIdx: number,
    paraIdx: number,
    controlIdx: number,
  ) => boolean;
  /** Paste the previously-copied control at a body caret — chunk 25. */
  pasteControlAt: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
  ) => boolean;
  /**
   * Capture the current viewer selection as a portable excerpt — chunk
   * 20. Returns null when no selection is active or the selection
   * spans multiple paragraphs (multi-paragraph excerpts are deferred:
   * the IR's `getTextRange` is single-paragraph). Returned `text` is
   * frozen at call time; the caller stores it alongside an anchor for
   * later stale verification.
   */
  captureExcerpt: () => {
    sectionIndex: number;
    paragraphIndex: number;
    startOffset: number;
    endOffset: number;
    text: string;
  } | null;
  /**
   * Re-read the IR at a stored anchor and compare to the captured
   * text — chunk 20. Used right before send so we know whether the
   * user has since edited the source paragraph. On mismatch, scans
   * the doc once for `expected` and returns a relocated anchor when
   * found. `null` return = section/paragraph index out of bounds.
   */
  verifyExcerpt: (
    anchor: {
      sectionIndex: number;
      paragraphIndex: number;
      startOffset: number;
      endOffset: number;
    },
    expected: string,
  ) => {
    status: 'fresh' | 'stale-relocated' | 'stale-missing';
    newAnchor?: {
      sectionIndex: number;
      paragraphIndex: number;
      startOffset: number;
      endOffset: number;
    };
  } | null;
}
