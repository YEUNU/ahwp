/**
 * @rhwp/core JSON 응답 narrow types — Phase R5.A refactor
 * (REFACTORING_PLAN.md). lib 의 method 들은 모두 `string` 을 반환하고
 * caller 가 `JSON.parse`해야 한다. 이 모듈은 자주 쓰는 응답 shape 을
 * 좁힌 타입으로 정의 — `Record<string, unknown>` 사용을 줄이고 IDE
 * 자동완성 / 리팩터 안전성을 회복한다.
 *
 * 모든 필드는 lib 가 채워주는 것을 기준으로 `optional?` 로 정의 —
 * 안전한 narrow.
 */

// ─── Caret / Hit-test ────────────────────────────────────

export interface RhwpHitTest {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  /** Phase E nested table — 안쪽 cell 좌표 체인. */
  cell?: {
    parentParaIndex: number;
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
    path?: Array<{
      controlIndex: number;
      cellIndex: number;
      cellParaIndex: number;
    }>;
  };
}

export interface RhwpCursorRect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

export interface RhwpSelectionRect {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Style / Format ──────────────────────────────────────

export interface RhwpStyleAt {
  /** 0 일 때 본문 (default). */
  styleId?: number;
  /** Some lib versions use `id` instead. */
  id?: number;
  name?: string;
  englishName?: string;
}

export interface RhwpStyleListItem {
  id: number;
  name: string;
  englishName: string;
  /** 0 = 본문 (body), 1 = 시스템 (쪽 번호 등). */
  type: number;
  paraShapeId: number;
  charShapeId: number;
}

export interface RhwpCharProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** HWPUNIT — 1pt = 100 units. e.g. 1000 = 10pt, 2400 = 24pt. */
  fontSize?: number;
  fontFamily?: string;
  /** Lowercase hex like "#ff0000". */
  textColor?: string;
}

export type RhwpAlignment = 'left' | 'center' | 'right' | 'justify';

export interface RhwpParaProps {
  alignment?: RhwpAlignment;
  /** Percent of single line height (100 = 1.0, 200 = 2.0). */
  lineSpacing?: number;
  lineSpacingType?: 'Percent' | 'Fixed' | 'AtLeast';
  /** HWPUNIT (1mm ≈ 567 HWPUNIT). */
  spacingBefore?: number;
  spacingAfter?: number;
  marginLeft?: number;
  marginRight?: number;
  /** Positive = first-line indent, negative = hanging. */
  indent?: number;
}

// ─── Table / Cell ────────────────────────────────────────

export interface RhwpTableCellBbox {
  cellIdx: number;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RhwpTableDimensions {
  rowCount: number;
  colCount: number;
  cellCount: number;
}

export interface RhwpCellInfo {
  cellIdx: number;
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  /** Cell 안 단락 수. */
  paragraphCount?: number;
  isHeader?: boolean;
}

// ─── Page def / Header-Footer ────────────────────────────

export interface RhwpPageDef {
  /** HWPUNIT 너비 (portrait orientation 기준). */
  width?: number;
  /** HWPUNIT 높이. */
  height?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  marginHeader?: number;
  marginFooter?: number;
  marginGutter?: number;
  landscape?: boolean;
}

export interface RhwpHeaderFooter {
  exists?: boolean;
  /** 0 = header, 1 = footer. */
  kind?: number;
  /** 0 = both, 1 = odd-only, 2 = even-only. */
  applyTo?: number;
  paraCount?: number;
  text?: string;
}

// ─── Bookmark / Footnote ─────────────────────────────────

export interface RhwpBookmarkInfo {
  name: string;
  sectionIndex: number;
  paragraphIndex: number;
  controlIndex: number;
  charOffset?: number;
}

export interface RhwpFootnoteInfo {
  /** Footnote control 의 본문 (footnote text). */
  text?: string;
  number?: number;
  /** 페이지 안에서의 위치 (페이지 하단 / 직접 지정 등). */
  position?: string;
}

// ─── Control op result ───────────────────────────────────

export interface RhwpOpResult {
  ok: boolean;
  /** Failure reason (machine readable, when `ok === false`). */
  reason?: string;
  /** Some ops echo the new control coords. */
  paraIdx?: number;
  controlIdx?: number;
}

// ─── Find / Replace ──────────────────────────────────────

export interface RhwpReplaceResult {
  /** Number of matches replaced (replaceAll) or 1 (replaceOne). */
  count?: number;
}

// ─── Picture / Shape ─────────────────────────────────────

export interface RhwpPictureProps {
  /** HWPUNIT. */
  width: number;
  height: number;
  /** 자연 (intrinsic) 픽셀 크기. */
  naturalWidthPx?: number;
  naturalHeightPx?: number;
  treatAsChar?: boolean;
  /** 'png' / 'jpeg' / 'gif' / 'bmp'. */
  extension?: string;
}

export interface RhwpShapeProps {
  width?: number;
  height?: number;
  treatAsChar?: boolean;
  fillColor?: string;
  borderColor?: string;
  borderWidth?: number;
}

// ─── Formula ─────────────────────────────────────────────

export interface RhwpFormulaResult {
  ok: boolean;
  value?: string | number;
  /** When `ok === false`. */
  reason?: string;
}

// ─── Selection / Excerpt ────────────────────────────────

export interface RhwpSelectionInfo {
  sectionIndex: number;
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
  text: string;
}

// ─── Text positions / Control text ──────────────────────

export interface RhwpControlTextEntry {
  controlIdx?: number;
  controlIndex?: number;
  charOffset?: number;
}
