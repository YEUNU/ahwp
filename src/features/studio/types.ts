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
  /** True when the undo stack has an entry available — chunk 29.
   * AppShell uses this to decide whether to surface the "되돌리기"
   * button next to apply/run-tools affordances. */
  canUndo: () => boolean;
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
   * Apply an HTML fragment by replacing the body of an existing outline
   * section (chunk 99 follow-up). Removes paragraphs in
   * `[startParaIdx, endParaIdxExclusive)` then pastes HTML at
   * `startParaIdx`. The whole operation is wrapped in a single undo
   * group so ⌘Z rolls back as one.
   *
   * Used when the AI-authored HTML's first heading matches an outline
   * section number — fixes the chunk 99 markdown fallback duplicating
   * the section instead of replacing it.
   */
  applyHtmlReplaceSection: (
    html: string,
    target: { startParaIdx: number; endParaIdxExclusive: number },
  ) => void;
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
  /**
   * Read active char format at caret — chunk B-5. Mirrors the toolbar
   * pressed-state. Used by the CharFormatDialog (Alt+L) to seed
   * initial checkbox state so unchecking doesn't accidentally
   * re-toggle on apply.
   */
  getActiveFormat: () => Record<string, unknown>;
  /**
   * Apply paragraph properties to the current selection / caret —
   * Phase B-5 잔여 (Alt+T 다이얼로그용). Wraps `applyParaFormat` /
   * `applyParaFormatInCell` with selection-aware routing.
   * Props (모두 optional):
   *  - alignment: 'left' | 'center' | 'right' | 'justify'
   *  - lineSpacing: percent of single line height (100 = 1.0)
   *  - lineSpacingType: 'Percent' | 'Fixed' | 'AtLeast'
   *  - spacingBefore / spacingAfter: HWPUNIT (1mm ≈ 567 HWPUNIT)
   *  - marginLeft / marginRight: HWPUNIT (positive = inset)
   *  - indent: HWPUNIT (positive = first-line indent, negative = hanging)
   */
  applyParaProps: (props: Record<string, unknown>) => void;
  /**
   * Phase 3 chunk 45 — 본문 편집 primitive. Agent tool 카탈로그용 thin
   * wrapper. 모두 selection-aware 가 아니라 명시적 좌표 받음. lib API
   * (insertText / deleteRange / insertParagraph / deleteParagraph /
   * mergeParagraph) 1:1 매핑. 셀 안 편집은 별도 *InCell variant 후속.
   */
  irInsertText: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
    text: string,
  ) => boolean;
  /** 0.4.16 — cell-level text insert. 표 control 안의 특정 cell + cell-
   *  paragraph + offset 에 raw 텍스트 삽입. AI 양식 채우기 시 표지 cell
   *  의 빈 value 항목 (도입기업명 / 과제번호 등) 채울 때 사용. body-level
   *  insertText 와 달리 표 layout 영향 없음. */
  irInsertTextInCell: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    charOffset: number,
    text: string,
  ) => boolean;
  /** 0.4.23 — cell paragraph text reader. synthetic diff before/after용. */
  irGetTextInCell: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    startOffset: number,
    endOffset: number,
  ) => string | null;
  /** 0.4.20 — cell-level deleteRange. lib `deleteRangeInCell`. patches
   *  block 의 cell location 에서 텍스트 교체할 때 (deletion → addition
   *  순서) delete 단계용. */
  irDeleteRangeInCell: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
    startCellParaIdx: number,
    startOffset: number,
    endCellParaIdx: number,
    endOffset: number,
  ) => boolean;
  /** 0.4.20 — cell-level applyCharFormat. lib `applyCharFormatInCell`.
   *  cell 내부에서 삽입한 영역에 char-shape 적용할 때. */
  irApplyCharFormatInCell: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
    cellParaIdx: number,
    startOffset: number,
    endOffset: number,
    props: Record<string, unknown>,
  ) => boolean;
  irDeleteRange: (
    sectionIdx: number,
    startParaIdx: number,
    startOffset: number,
    endParaIdx: number,
    endOffset: number,
  ) => boolean;
  irInsertParagraph: (sectionIdx: number, paraIdx: number) => boolean;
  irDeleteParagraph: (sectionIdx: number, paraIdx: number) => boolean;
  irMergeParagraph: (sectionIdx: number, paraIdx: number) => boolean;
  /**
   * Phase 3 chunk 45 — 글자/단락 서식 통합. lib `applyCharFormat` 의 props_json
   * 을 그대로 받음 — bold/italic/underline 외에 폰트(name), 크기 (size_hu),
   * 글자색(color), 배경색(shadeColor), 취소선(strikeThrough), 첨자
   * (subscript/superscript), 밑줄 종류(underlineLine), 그림자/외곽선 등
   * 모두 한 호출로. Selection 없으면 caret 단락 전체.
   */
  irApplyCharFormat: (
    sectionIdx: number,
    paraIdx: number,
    startOffset: number,
    endOffset: number,
    props: Record<string, unknown>,
  ) => boolean;
  /**
   * Phase 3 chunk 45 — 명명된 스타일 적용. `applyStyle` lib 호출. styleId 는
   * `getStyleListJson()` 에서 조회. 활성 단락에 적용되며 selection 시 모든
   * 단락에 적용 (lib 가 처리).
   */
  irApplyStyle: (
    sectionIdx: number,
    paraIdx: number,
    styleId: number,
  ) => boolean;
  /**
   * Phase 3 chunk 46 — 표 구조 ops. lib API thin wrapper. Agent 가 직접
   * 호출 — undo group 처리는 dispatcher 가 wrap.
   */
  irCreateTable: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
    rowCount: number,
    colCount: number,
  ) => boolean;
  irInsertTableRow: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    rowIdx: number,
    below: boolean,
  ) => boolean;
  irInsertTableColumn: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    colIdx: number,
    right: boolean,
  ) => boolean;
  irDeleteTableRow: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    rowIdx: number,
  ) => boolean;
  irDeleteTableColumn: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    colIdx: number,
  ) => boolean;
  irMergeTableCells: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ) => boolean;
  irSplitTableCellInto: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    row: number,
    col: number,
    nRows: number,
    mCols: number,
    equalRowHeight: boolean,
    mergeFirst: boolean,
  ) => boolean;
  irUnmergeCell: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    row: number,
    col: number,
  ) => boolean;
  irDeleteTableControl: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
  ) => boolean;
  /**
   * Phase 3 chunk 47 — 이미지/도형. lib *Properties / delete*Control thin wrap.
   * insertPicture 는 base64 → Uint8Array 변환 후 호출.
   */
  irSetShapeProperties: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    props: Record<string, unknown>,
  ) => boolean;
  irDeleteShapeControl: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
  ) => boolean;
  irChangeShapeZOrder: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    operation: 'top' | 'bottom' | 'forward' | 'backward',
  ) => boolean;
  irInsertPicture: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
    base64Data: string,
    widthHwpunit: number,
    heightHwpunit: number,
    naturalWidthPx: number,
    naturalHeightPx: number,
    extension: string,
    description: string,
  ) => boolean;
  /**
   * Phase 3 chunk 48 — 페이지/섹션. break + 다단 layout + 페이지 숨김.
   */
  irInsertPageBreak: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
  ) => boolean;
  irInsertColumnBreak: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
  ) => boolean;
  irSetColumnDef: (
    sectionIdx: number,
    columnCount: number,
    columnType: number,
    sameWidth: number,
    spacingHu: number,
  ) => boolean;
  irSetSectionDef: (
    sectionIdx: number,
    props: Record<string, unknown>,
  ) => boolean;
  irSetPageHide: (
    sectionIdx: number,
    paraIdx: number,
    hideHeader: boolean,
    hideFooter: boolean,
    hideMaster: boolean,
    hideBorder: boolean,
    hideFill: boolean,
    hidePageNum: boolean,
  ) => boolean;
  /**
   * Phase 3 chunk 49 — 머리/꼬리말 고급 + 책갈피.
   */
  irApplyHfTemplate: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
    templateId: number,
  ) => boolean;
  irCreateHeaderFooter: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
  ) => boolean;
  irDeleteHeaderFooter: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
  ) => boolean;
  /**
   * Phase 3 chunk 51 — read-only Agent tools. Mutation 0. Agent 가 양식
   * 매칭 / 위치 결정 / 본문 검색 등을 turn 안에서 능동적으로 수행할 수
   * 있게 함. 모든 read 는 lib API 직결 + JSON 결과 그대로 반환.
   * 실패 시 null/[].
   */
  irGetStyleAt: (
    sectionIdx: number,
    paraIdx: number,
  ) => Record<string, unknown> | null;
  irGetCharPropertiesAt: (
    sectionIdx: number,
    paraIdx: number,
    charOffset: number,
  ) => Record<string, unknown> | null;
  irGetParaPropertiesAt: (
    sectionIdx: number,
    paraIdx: number,
  ) => Record<string, unknown> | null;
  irGetTextRange: (
    sectionIdx: number,
    startParaIdx: number,
    startOffset: number,
    endParaIdx: number,
    endOffset: number,
  ) => string | null;
  irGetCaretPosition: () => Record<string, unknown> | null;
  irFindInDocument: (
    query: string,
    maxResults?: number,
  ) => {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
  }[];
  irGetCellInfo: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
  ) => Record<string, unknown> | null;
  /** Whether the doc has unsaved changes (mirrors internal dirtyRef). */
  isDirty: () => boolean;
  /** Read the active cell context — chunk 38. Returns the table+cell
   * coordinates the caret currently sits in, or `null` when caret is
   * in body text (not inside any table). The cell context menu sets
   * caretRef.current.cell on right-click, so right-clicking a cell
   * then calling this returns that cell's coords. */
  getActiveCellContext: () => {
    sectionIndex: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
  } | null;
  /** Read table-level properties — chunk 38 (UI for chunk 17 IR). */
  getTableProps: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
  ) => Record<string, unknown> | null;
  /** Write table-level properties — chunk 38. */
  setTableProps: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    props: Record<string, unknown>,
  ) => void;
  /** Read cell-level properties — chunk 38. */
  getCellProps: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
  ) => Record<string, unknown> | null;
  /** Write cell-level properties — chunk 38. */
  setCellProps: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    cellIdx: number,
    props: Record<string, unknown>,
  ) => void;
  /**
   * Evaluate a table-cell formula and (optionally) write the result
   * into the target cell — chunk 34. Wraps `@rhwp/core`'s
   * `evaluateTableFormula(sec, parentPara, ctrl, row, col, formula,
   * write_result)`. Returns the parsed JSON result (`{ok, value, ...}`)
   * or `null` on failure. Formulas use HWP syntax — `=SUM(A1:A5)`,
   * `=A1+B2*3`, etc.
   */
  evaluateTableFormula: (
    sectionIdx: number,
    parentParaIdx: number,
    controlIdx: number,
    targetRow: number,
    targetCol: number,
    formula: string,
    writeResult: boolean,
  ) => Record<string, unknown> | null;
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
  /** Enumerate all picture controls in the document — chunk 39. Walks
   * `getControlTextPositions` per paragraph in section 0 and tries
   * `getPictureProperties` to filter to only picture controls. Returns
   * empty when the doc has no pictures. */
  enumeratePictures: () => {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    label: string;
  }[];
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
  /** High-level "copy the control at the current caret" — chunk 40
   * (UI for chunk 25). When the caret is inside a cell, copies the
   * containing table. When the caret's paragraph contains a single
   * picture/shape, copies that. Returns false when no copy-able
   * control is in scope. */
  copyControlAtCaret: () => boolean;
  /** High-level "paste the previously-copied control at the current
   * body caret" — chunk 40. */
  pasteControlAtCurrentCaret: () => boolean;
  /**
   * Scroll the viewer to a specific paragraph and place the caret at
   * its start — chunk 60. Used by the cross-folder search to jump to
   * a matched paragraph after the file becomes the active tab.
   */
  scrollToParagraph: (sectionIdx: number, paraIdx: number) => void;
  /**
   * Snapshot section 0 paragraph contents — chunk 57. Used as the
   * "before" half of the inline-diff bracket: the AppShell calls this
   * before an AI-driven apply, then `markChangedParagraphsSince` after
   * the apply settles. The map key is paragraph index, value is a
   * cheap fingerprint of the paragraph text.
   */
  snapshotParagraphs: () => Map<number, string>;
  /**
   * Compare the current paragraph state against a prior snapshot and
   * highlight paragraphs whose text changed (or that didn't exist
   * before) — chunk 57. The highlight auto-fades after ~15s. Call
   * this immediately after an AI-applied mutation settles.
   */
  markChangedParagraphsSince: (before: Map<number, string>) => void;
  /**
   * Read the document outline (headings) — chunk 58. Walks section 0's
   * paragraphs, resolves each `styleId` against the style list, and
   * keeps the ones whose name looks like "제목 N" (or "Heading N"). The
   * `level` is parsed from the trailing digit when present, else 1.
   * The TOC sidebar uses (paragraphIndex) to jump via
   * `scrollToParagraph`.
   */
  getOutline: () => {
    paragraphIndex: number;
    level: number;
    text: string;
  }[];
  /**
   * Doc structural summary — used by the AI agent's `getDocumentSummary`
   * read tool when `getOutline()` returns empty (doc has no heading
   * styles). Returns per-section paragraph counts + non-empty counts +
   * sample first/last filled paragraph so the agent can judge whether
   * the doc is "filled" without having to blindly probe paragraphs by
   * trial-and-error indices.
   */
  getDocumentSummary: () => {
    sectionCount: number;
    sections: {
      sectionIdx: number;
      paragraphCount: number;
      nonEmptyCount: number;
      firstFilled: { paragraphIdx: number; text: string } | null;
      lastFilled: { paragraphIdx: number; text: string } | null;
    }[];
  } | null;
  /**
   * 0.4.21 — empty form-field discovery. Walks every table cell in
   * the document and emits a coordinate for every cell whose only
   * paragraph has length 0 (= empty fillable spot). Includes a label
   * hint (text of the adjacent left or top sibling cell) and the
   * label's char-shape so the agent can apply matching typography.
   * Deterministic, read-only, no IR mutation. Used as the discovery
   * step for form-fill workflows so the LLM never has to guess
   * coordinates by trial-and-error.
   */
  getEmptyFormFields: (opts?: { sectionIdx?: number; maxResults?: number }) => {
    cellFields: {
      location: {
        sectionIndex: number;
        paragraphIndex: number;
        controlIndex: number;
        cellIndex: number;
        cellParagraphIndex: number;
      };
      labelHint: string;
      labelCharShape?: Record<string, unknown>;
    }[];
    truncated: boolean;
  } | null;
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
    startParagraphIndex: number;
    startOffset: number;
    endParagraphIndex: number;
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
      startParagraphIndex: number;
      startOffset: number;
      endParagraphIndex: number;
      endOffset: number;
    },
    expected: string,
  ) => {
    status: 'fresh' | 'stale-relocated' | 'stale-missing';
    newAnchor?: {
      sectionIndex: number;
      startParagraphIndex: number;
      startOffset: number;
      endParagraphIndex: number;
      endOffset: number;
    };
  } | null;
}
