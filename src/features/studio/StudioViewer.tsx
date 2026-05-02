import {
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Maximize2,
  MoreHorizontal,
  Pilcrow,
  Redo2,
  SeparatorHorizontal,
  Square,
  Table2,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CompositionEvent as ReactCompositionEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { ensureRhwpCore, HwpDocument } from '@/lib/rhwp-core';
import { SlashMenu } from './SlashMenu';
import type { CharFormatKey, ViewerHandle } from './types';

interface StudioViewerProps {
  path: string;
  /**
   * Tabs (chunk: tab system). Only the active viewer attaches its
   * `__studioDebug` surface to window; inactive viewers stay mounted
   * (preserving their HwpDocument + edit history) but don't claim the
   * global debug ref. Defaults to true so single-viewer callers keep
   * working unchanged.
   */
  isActive?: boolean;
  /** Notifies the parent whenever the doc's dirty state flips. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Cell context-menu extension hooks — chunk 38. The cell menu calls
   * these after closing itself; AppShell holds the dialog open state. */
  onOpenTableProps?: () => void;
  onOpenCellProps?: () => void;
  /** Cell context-menu — chunk 42. Open cell-style picker. */
  onOpenCellStylePicker?: () => void;
  /** Cell context-menu — chunk 34. Open table-formula recalc dialog
   * for the right-clicked cell. AppShell receives the cell coordinates
   * via `getActiveCellContext` after the click resolved. */
  onOpenFormula?: () => void;
  /**
   * AI selection command — chunk 56. Right-click on a body selection
   * opens the AI menu; menu items call this with a single composed
   * prompt string ("다듬기" / "요약" / "번역" / etc.) that already has
   * the selected text inlined. AppShell forwards to
   * `ChatPanelHandle.prefillAndSend` so the request fires immediately.
   */
  onAiCommand?: (prompt: string) => void;
  /** Show the cm-tick ruler above each page — chunk 61. AppShell
   *  toggles via the View menu + 명령 팔레트. */
  showRuler?: boolean;
}

type Phase = 'mounting' | 'reading' | 'rendering' | 'ready';

type RhwpDoc = InstanceType<typeof HwpDocument>;

interface PageDims {
  w: number;
  h: number;
}

interface StyleListItem {
  id: number;
  name: string;
  englishName: string;
  type: number;
  paraShapeId: number;
  charShapeId: number;
}

interface CharProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** HWPUNIT — 1pt = 100 units. e.g. 1000 = 10pt, 2400 = 24pt. */
  fontSize?: number;
  fontFamily?: string;
  /** Lowercase hex like "#ff0000". */
  textColor?: string;
}

type ParaAlignment = 'left' | 'center' | 'right' | 'justify';
/**
 * Subset of @rhwp/core's ParaShape props_json schema we expose to the
 * toolbar. Key names mirror the library's IR exactly (verified by reading
 * `getParaPropertiesAt` output) — calling them anything else makes the IR
 * silently ignore the value.
 */
interface ParaProps {
  alignment?: ParaAlignment;
  /** Percent of single line height (100 = 1.0, 200 = 2.0). */
  lineSpacing?: number;
  /** "Percent" | "Fixed" | "AtLeast" — defaults to "Percent" when omitted. */
  lineSpacingType?: 'Percent' | 'Fixed' | 'AtLeast';
  /** Space before / after the paragraph in HWPUNIT (1mm ≈ 567 HWPUNIT). */
  spacingBefore?: number;
  spacingAfter?: number;
  /** Left / right margins in HWPUNIT. Positive = inset from page margin. */
  marginLeft?: number;
  marginRight?: number;
  /** First-line offset in HWPUNIT. Positive = indent, negative = hanging. */
  indent?: number;
}

/** Line spacing presets shown in the toolbar (percent of single). */
const LINE_SPACING_PRESETS: { label: string; value: number }[] = [
  { label: '1.0', value: 100 },
  { label: '1.15', value: 115 },
  { label: '1.5', value: 150 },
  { label: '2.0', value: 200 },
  { label: '3.0', value: 300 },
];

/** One indent step ≈ 1cm = 5670 HWPUNIT. Matches what 한컴 한글 toolbar increments. */
const INDENT_STEP_HWPUNIT = 5670;

const PARA_ALIGNMENTS: ParaAlignment[] = ['left', 'center', 'right', 'justify'];

/** Common font sizes (in pt) shown in the toolbar dropdown. */
const FONT_SIZE_PRESETS_PT = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72,
];

/**
 * applyCharFormat requires a [start, end) char range. We have no selection
 * model in chunk 5 — the toolbar/shortcut applies the toggle to the entire
 * current paragraph. Native applyCharFormat clamps to the paragraph length
 * silently when end_offset overshoots (verified via scripts/check-charformat.mjs),
 * so passing this sentinel covers any paragraph.
 */
const PARAGRAPH_END_SENTINEL = 1_000_000_000;

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const PAGE_GAP_PX = 16;
const PAGE_PADDING_PX = 32;

/** Excerpt rebind scan — chunk 20. Walks the IR text top-to-bottom
 * looking for `expected` and returns the first hit's anchor. Capped
 * to keep send-time verification cheap; long docs simply lose their
 * relocation guarantee past the cap and the chip falls to
 * `stale-missing`. The IR's getTextRange / getParagraphCount /
 * getParagraphLength are hot paths so this is a thin wrapper. */
const RELOCATE_PARA_SCAN_LIMIT = 1000;
interface DocReadOnly {
  getParagraphCount: (sectionIdx: number) => number;
  getParagraphLength: (sectionIdx: number, paraIdx: number) => number;
  getTextRange: (
    sectionIdx: number,
    paraIdx: number,
    startOffset: number,
    length: number,
  ) => string;
}
function relocateExcerpt(
  doc: DocReadOnly,
  expected: string,
): {
  sectionIndex: number;
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
} | null {
  if (expected.length === 0) return null;
  // Single-section docs only (matches captureExcerpt). When we move to
  // multi-section, walk every section the same way.
  // Multi-paragraph excerpts that span paragraph breaks WILL have a
  // '\n' in `expected`; we don't try to rejoin paragraphs to relocate
  // those — they fall through to stale-missing. Single-line search
  // covers the common case (single-para excerpt edited in place).
  const SECTION_INDEX = 0;
  let paraCount: number;
  try {
    paraCount = doc.getParagraphCount(SECTION_INDEX);
  } catch {
    return null;
  }
  const limit = Math.min(paraCount, RELOCATE_PARA_SCAN_LIMIT);
  for (let p = 0; p < limit; p++) {
    let paraText: string;
    try {
      const len = doc.getParagraphLength(SECTION_INDEX, p);
      if (len < expected.length) continue;
      paraText = doc.getTextRange(SECTION_INDEX, p, 0, len);
    } catch {
      continue;
    }
    const idx = paraText.indexOf(expected);
    if (idx >= 0) {
      return {
        sectionIndex: SECTION_INDEX,
        startParagraphIndex: p,
        startOffset: idx,
        endParagraphIndex: p,
        endOffset: idx + expected.length,
      };
    }
  }
  return null;
}

/** Parse <svg width="X" height="Y"> or fall back to viewBox last two numbers. */
/**
 * Mini "rows × cols" picker — 8×8 grid of cells the user can hover over.
 * Hovering highlights the rectangle from (1,1) up to the hover cell;
 * clicking commits that size. Used for `Table 삽입`.
 */
function TablePicker({
  onPick,
  onCancel,
}: {
  onPick: (rows: number, cols: number) => void;
  onCancel: () => void;
}): React.ReactElement {
  const MAX = 8;
  const [hover, setHover] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const cells: React.ReactNode[] = [];
  for (let r = 1; r <= MAX; r++) {
    for (let c = 1; c <= MAX; c++) {
      const on = r <= hover.r && c <= hover.c;
      cells.push(
        <button
          key={`${r}:${c}`}
          type="button"
          onMouseEnter={() => setHover({ r, c })}
          onClick={() => onPick(r, c)}
          className={
            'h-4 w-4 rounded-sm border ' +
            (on
              ? 'border-ring bg-primary/40'
              : 'border-border bg-background hover:bg-muted')
          }
          aria-label={`${r}행 ${c}열`}
          data-testid="studio-table-picker-cell"
          data-rows={r}
          data-cols={c}
        />,
      );
    }
  }
  return (
    <div onMouseLeave={() => setHover({ r: 0, c: 0 })}>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${MAX}, minmax(0, 1fr))` }}
      >
        {cells}
      </div>
      <div
        className="mt-1 flex items-center justify-between text-xs text-muted-foreground"
        data-testid="studio-table-picker-label"
      >
        <span>
          {hover.r > 0 && hover.c > 0
            ? `${hover.r}행 × ${hover.c}열`
            : '크기 선택'}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-0.5 hover:bg-muted"
          aria-label="닫기"
        >
          <X className="size-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * Right-click context menu for table cells. Same dismiss model as the
 * folder-tree menu: outside mousedown + Escape close it.
 */
function CellContextMenu({
  state,
  onClose,
  onInsertRowAbove,
  onInsertRowBelow,
  onInsertColLeft,
  onInsertColRight,
  onDeleteRow,
  onDeleteCol,
  onMergeRight,
  onMergeBelow,
  onSplit2x2,
  onUnmerge,
  canMergeRight,
  canMergeBelow,
  onDeleteTable,
  onOpenTableProps,
  onOpenCellProps,
  onOpenCellStylePicker,
  onOpenFormula,
}: {
  state: { x: number; y: number };
  onClose: () => void;
  onInsertRowAbove: () => void;
  onInsertRowBelow: () => void;
  onInsertColLeft: () => void;
  onInsertColRight: () => void;
  onDeleteRow: () => void;
  onDeleteCol: () => void;
  onMergeRight: () => void;
  onMergeBelow: () => void;
  onSplit2x2: () => void;
  onUnmerge: () => void;
  canMergeRight: boolean;
  canMergeBelow: boolean;
  onDeleteTable: () => void;
  onOpenTableProps?: () => void;
  onOpenCellProps?: () => void;
  onOpenCellStylePicker?: () => void;
  onOpenFormula?: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (
        ref.current &&
        e.target instanceof Node &&
        ref.current.contains(e.target)
      )
        return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const item = (
    label: string,
    onClick: () => void,
    testid: string,
    disabled = false,
  ): React.ReactElement => (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        onClick();
        onClose();
      }}
      disabled={disabled}
      className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      data-testid={testid}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={ref}
      role="menu"
      className="fixed z-50 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md"
      style={{ left: state.x, top: state.y }}
      data-testid="studio-cell-context-menu"
    >
      {item('위에 행 추가', onInsertRowAbove, 'studio-cell-row-above')}
      {item('아래에 행 추가', onInsertRowBelow, 'studio-cell-row-below')}
      <hr className="my-1 border-border" />
      {item('왼쪽에 열 추가', onInsertColLeft, 'studio-cell-col-left')}
      {item('오른쪽에 열 추가', onInsertColRight, 'studio-cell-col-right')}
      <hr className="my-1 border-border" />
      {item('행 삭제', onDeleteRow, 'studio-cell-row-delete')}
      {item('열 삭제', onDeleteCol, 'studio-cell-col-delete')}
      <hr className="my-1 border-border" />
      {item(
        '오른쪽 셀과 병합',
        onMergeRight,
        'studio-cell-merge-right',
        !canMergeRight,
      )}
      {item(
        '아래 셀과 병합',
        onMergeBelow,
        'studio-cell-merge-below',
        !canMergeBelow,
      )}
      {item('셀 나누기 (2×2)', onSplit2x2, 'studio-cell-split-2x2')}
      {item('병합 해제', onUnmerge, 'studio-cell-unmerge')}
      <hr className="my-1 border-border" />
      {onOpenCellProps
        ? item('셀 속성…', onOpenCellProps, 'studio-cell-props')
        : null}
      {onOpenTableProps
        ? item('표 속성…', onOpenTableProps, 'studio-cell-table-props')
        : null}
      {onOpenCellStylePicker
        ? item('스타일 적용…', onOpenCellStylePicker, 'studio-cell-style-apply')
        : null}
      {onOpenFormula
        ? item('수식 다시 계산…', onOpenFormula, 'studio-cell-formula')
        : null}
      <hr className="my-1 border-border" />
      {item('표 삭제', onDeleteTable, 'studio-cell-table-delete')}
    </div>
  );
}

/**
 * AI selection-command menu — chunk 56. Right-click on a body selection
 * opens this. Each item carries a prompt template with `{{TEXT}}` as
 * the slot for the selected text; the parent substitutes the selection
 * in before firing `onAiCommand` → ChatPanel.prefillAndSend.
 */
const AI_COMMANDS: { id: string; label: string; template: string }[] = [
  {
    id: 'polish',
    label: '✨ 다듬기 (자연스럽게)',
    template:
      '다음 문단을 의미는 그대로 두되 한국어로 자연스럽고 매끄럽게 다듬어 주세요. 결과는 원문과 같은 문단 구조의 ```html``` 블록으로 답해 주세요.\n\n원문:\n"""\n{{TEXT}}\n"""',
  },
  {
    id: 'summarize',
    label: '📝 요약',
    template:
      '다음 단락을 핵심만 1-2 문장으로 요약해 주세요. 답변은 짧은 한국어 본문으로만 — 코드 블록 없이.\n\n원문:\n"""\n{{TEXT}}\n"""',
  },
  {
    id: 'translate-en',
    label: '🌐 영어로 번역',
    template:
      '다음 한국어 문단을 자연스러운 영어로 번역해 주세요. 결과를 ```html``` 블록 한 개로 답해 주세요 (원본의 단락 구조 유지).\n\n원문:\n"""\n{{TEXT}}\n"""',
  },
  {
    id: 'tone-formal',
    label: '🎩 격식체로',
    template:
      '다음 문단을 보고서 / 공문에 어울리는 격식체로 다듬어 주세요. 결과는 ```html``` 블록 한 개로.\n\n원문:\n"""\n{{TEXT}}\n"""',
  },
  {
    id: 'tone-plain',
    label: '💬 평어로',
    template:
      '다음 문단을 친근한 평어 / 일상체로 바꿔 주세요. 결과는 ```html``` 블록 한 개로.\n\n원문:\n"""\n{{TEXT}}\n"""',
  },
];

function AiCommandMenu({
  x,
  y,
  onClose,
  onPick,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onPick: (template: string) => void;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (
        ref.current &&
        e.target instanceof Node &&
        ref.current.contains(e.target)
      )
        return;
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="studio-ai-context-menu"
      className="fixed z-50 min-w-[12rem] rounded-md border border-border bg-popover py-1 shadow-md"
      style={{ left: x, top: y }}
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        선택 영역에 AI 적용
      </div>
      {AI_COMMANDS.map((cmd) => (
        <button
          key={cmd.id}
          type="button"
          onClick={() => onPick(cmd.template)}
          data-testid={`studio-ai-cmd-${cmd.id}`}
          className="block w-full px-3 py-1.5 text-left text-xs hover:bg-muted"
        >
          {cmd.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Horizontal ruler — chunk 61. Sits above each rendered page and draws
 * cm-tick marks across its width. SVG units → mm conversion uses 96 DPI
 * (matching how `@rhwp/core` rasterizes paper sizes). Vertical ruler is
 * deferred — it would need per-row ticking and isn't load-bearing for
 * casual reference of margins.
 */
const SVG_PER_MM = 96 / 25.4;

function HorizontalRuler({
  widthSvg,
  zoom,
}: {
  widthSvg: number;
  zoom: number;
}): React.ReactElement {
  const widthPx = widthSvg * zoom;
  const widthMm = widthSvg / SVG_PER_MM;
  // One tick per cm + minor 5mm tick. Cap to a reasonable number to
  // keep React render cheap (an A4 portrait at 210mm = 21 ticks).
  const tickEls: React.ReactElement[] = [];
  const cmCount = Math.floor(widthMm / 10);
  for (let cm = 0; cm <= cmCount; cm++) {
    const x = cm * 10 * SVG_PER_MM * zoom;
    tickEls.push(
      <div
        key={`cm-${cm}`}
        className="absolute bottom-0 border-l border-foreground/40"
        style={{ left: x, height: 8 }}
      />,
    );
    tickEls.push(
      <span
        key={`cm-l-${cm}`}
        className="absolute bottom-2 select-none text-[8px] leading-none text-muted-foreground"
        style={{ left: x + 2 }}
      >
        {cm}
      </span>,
    );
    // 5mm half-tick (skip past the last cm).
    if (cm < cmCount) {
      const halfX = (cm * 10 + 5) * SVG_PER_MM * zoom;
      tickEls.push(
        <div
          key={`mm5-${cm}`}
          className="absolute bottom-0 border-l border-foreground/30"
          style={{ left: halfX, height: 4 }}
        />,
      );
    }
  }
  return (
    <div
      className="relative h-4 border-b border-border bg-muted/30"
      style={{ width: widthPx }}
      data-testid="studio-ruler-h"
      aria-hidden="true"
    >
      {tickEls}
    </div>
  );
}

function parsePageDimensions(svg: string): PageDims | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  const w = parseFloat(root.getAttribute('width') || '');
  const h = parseFloat(root.getAttribute('height') || '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w, h };
  }
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/\s+/).map(parseFloat);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { w: parts[2], h: parts[3] };
    }
  }
  return null;
}

/**
 * Studio migration chunk 3 — multi-page + virtualized scroll + zoom.
 *
 * - All N pages rendered as placeholder divs sized from page-0 dimensions.
 * - IntersectionObserver lazy-renders SVG into placeholders as they scroll
 *   into view. Per-page cache (Map<idx, svg>) so we never re-parse.
 * - Zoom: CSS-driven (placeholder dimensions × zoom). The injected SVGs use
 *   `width:100%; height:100%` so they scale with the parent.
 * - Edit/input/cursor land in chunk 4.
 *
 * See docs/STUDIO_MIGRATION.md.
 */
export const StudioViewer = forwardRef<ViewerHandle, StudioViewerProps>(
  function StudioViewer(
    {
      path,
      isActive = true,
      onDirtyChange,
      onOpenTableProps,
      onOpenCellProps,
      onOpenCellStylePicker,
      onOpenFormula,
      onAiCommand,
      showRuler,
    },
    ref,
  ) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const docRef = useRef<RhwpDoc | null>(null);
    const pageRefsRef = useRef<(HTMLDivElement | null)[]>([]);
    const cacheRef = useRef<Map<number, string>>(new Map());

    const [phase, setPhase] = useState<Phase>('mounting');
    const [error, setError] = useState<string | null>(null);
    const [pageCount, setPageCount] = useState(0);
    const [pageDims, setPageDims] = useState<PageDims | null>(null);
    const [zoom, setZoom] = useState(1);
    const [currentPage, setCurrentPage] = useState(0);
    const [dirty, setDirty] = useState(false);
    // chunk 51 — body text counters (chars / words / paragraphs).
    // Recomputed via debounced effect on phase/dirty/pageCount changes;
    // walks the IR's section-0 paragraphs (cheap — 1k paragraph doc
    // measures < 5ms in practice).
    const [docStats, setDocStats] = useState<{
      chars: number;
      words: number;
      paragraphs: number;
    }>({ chars: 0, words: 0, paragraphs: 0 });
    // Stash the latest onDirtyChange in a ref so the dirty-notify effect
    // doesn't re-run every time the parent passes a new function identity.
    const onDirtyChangeRef = useRef(onDirtyChange);
    useEffect(() => {
      onDirtyChangeRef.current = onDirtyChange;
    }, [onDirtyChange]);
    useEffect(() => {
      onDirtyChangeRef.current?.(dirty);
    }, [dirty]);
    // Visual cursor — pageIndex and SVG-space coords. Updated from
    // doc.getCursorRect(s, p, c) after load/mutation, and from hitTest
    // result after a click.
    const [cursorRect, setCursorRect] = useState<{
      pageIndex: number;
      x: number;
      y: number;
      height: number;
    } | null>(null);
    // Mirror dirty into a ref so callers that captured an older `__studioDebug`
    // closure (e.g. tests grabbing the reference once) read the latest value.
    const dirtyRef = useRef(false);
    // Caret state is read from doc.getCaretPosition() after every mutation;
    // we keep the last-known value here so handlers can act without re-fetching.
    //
    // When `cell` is non-null the caret is inside a table cell — text edit
    // ops route through `*InCell` IPC variants. The IR's getCaretPosition
    // doesn't report cell-level location, so we maintain it ourselves.
    interface CellLocation {
      parentParaIndex: number;
      controlIndex: number;
      cellIndex: number;
      cellParaIndex: number;
    }
    const caretRef = useRef<{
      sectionIndex: number;
      paragraphIndex: number;
      charOffset: number;
      cell?: CellLocation;
    }>({
      sectionIndex: 0,
      paragraphIndex: 0,
      charOffset: 0,
    });
    // True between compositionstart and compositionend (Korean IME). keydown
    // forwards any composing keystrokes back to the IME by ignoring them —
    // composition* events deliver the final text on completion.
    const composingRef = useRef(false);
    // Style list for the toolbar dropdown (loaded once after doc parse).
    const [styleList, setStyleList] = useState<StyleListItem[]>([]);
    // Selection (chunk 5b). null = no selection, the doc is in caret-only
    // mode. anchor = where the selection started (mousedown / first
    // shift+arrow). focus = where the caret currently is. The actual
    // [start, end] range is derived by sorting these by (para, offset).
    const [selection, setSelectionState] = useState<{
      anchor: {
        sectionIndex: number;
        paragraphIndex: number;
        charOffset: number;
      };
      focus: {
        sectionIndex: number;
        paragraphIndex: number;
        charOffset: number;
      };
    } | null>(null);
    // Mirror selection state into a ref so keyboard / mouse handlers see
    // the latest value even before React re-renders. Useful when an
    // external test driver calls setSelection then immediately presses a
    // key — the handleKeyDown closure may still hold the previous value.
    const selectionRef = useRef<typeof selection>(null);
    const setSelection = useCallback(
      (
        next: typeof selection | ((prev: typeof selection) => typeof selection),
      ): void => {
        const resolved =
          typeof next === 'function'
            ? (next as (p: typeof selection) => typeof selection)(
                selectionRef.current,
              )
            : next;
        // Update the ref synchronously so handlers that fire on the same
        // tick (debug-driven test sequences, keyboard handlers) see the
        // latest value without waiting for React to re-render.
        selectionRef.current = resolved;
        setSelectionState(resolved);
      },
      [],
    );
    // Per-page selection rect arrays for the highlight overlay. Recomputed
    // from getSelectionRects after every selection change.
    const [selectionRectsByPage, setSelectionRectsByPage] = useState<
      Record<number, { x: number; y: number; width: number; height: number }[]>
    >({});
    // True while the user is mouse-dragging — mousemove updates focus.
    const draggingRef = useRef(false);
    // Cleanup callback for the active drag — set in handlePageMouseDown,
    // invoked from Esc handler / unmount to release window listeners and
    // cancel any auto-scroll loop. `null` when no drag is active.
    const dragCleanupRef = useRef<(() => void) | null>(null);
    // Drag origin selection — captured at mousedown so Esc can revert to
    // the pre-drag state (selection or null).
    const dragOriginSelectionRef = useRef<{
      anchor: {
        sectionIndex: number;
        paragraphIndex: number;
        charOffset: number;
      };
      focus: {
        sectionIndex: number;
        paragraphIndex: number;
        charOffset: number;
      };
    } | null>(null);
    // Undo/Redo (chunk 7). The doc IR exposes snapshot save/restore as a
    // bidirectional stack: each saveSnapshot returns an integer id; we
    // record IDs in chronological order along with an index pointer to
    // the "current" entry. New mutations after an undo discard the redo
    // tail. We cap the stack depth so ancient snapshots can be released.
    const HISTORY_CAP = 100;
    const historyRef = useRef<{
      entries: number[];
      // index of the current (latest applied) snapshot in `entries`
      index: number;
    }>({ entries: [], index: -1 });
    // chunk 27 — undo grouping. When > 0, intermediate `pushHistory`
    // calls inside `refreshAfterMutation` are no-ops; the bracket
    // (beginUndoGroup / endUndoGroup) records ONE snapshot at the end.
    // The counter (vs boolean) lets begin/end nest safely if a tool
    // pipeline triggers nested groups.
    const undoGroupDepthRef = useRef(0);
    const [canUndo, setCanUndo] = useState(false);
    const [canRedo, setCanRedo] = useState(false);
    // Find (chunk 9). When `findOpen=true` a small search bar overlays
    // the toolbar. Matches are computed by iterating sections+paragraphs
    // and indexOf-searching their text. Each match becomes a {s,p,off,len}
    // tuple; the active one is highlighted distinctly and brought into view.
    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [findMatches, setFindMatches] = useState<
      {
        sectionIndex: number;
        paragraphIndex: number;
        offset: number;
        length: number;
      }[]
    >([]);
    const [findIndex, setFindIndex] = useState(0);
    const [findHighlightsByPage, setFindHighlightsByPage] = useState<
      Record<
        number,
        {
          x: number;
          y: number;
          width: number;
          height: number;
          isActive: boolean;
        }[]
      >
    >({});
    const findInputRef = useRef<HTMLInputElement>(null);
    /** Replace UI state — chunk 7. ⌘H opens the bar with replace focused;
     *  ⌘F keeps the search-only entry point. The replace string can be empty
     *  (= delete matches), so we don't gate the buttons on emptiness. */
    const [replaceQuery, setReplaceQuery] = useState('');
    const [replaceFeedback, setReplaceFeedback] = useState<string | null>(null);
    const replaceInputRef = useRef<HTMLInputElement>(null);
    /** Hidden file input for the toolbar's "이미지 삽입" button. */
    const imageInputRef = useRef<HTMLInputElement>(null);
    /** Drop overlay state — true while a file drag is hovering the viewer. */
    const [isImageDropTarget, setIsImageDropTarget] = useState(false);
    /** Cell context menu (right-click on a table cell). */
    const [cellMenu, setCellMenu] = useState<{
      x: number;
      y: number;
      sectionIndex: number;
      parentParaIndex: number;
      controlIndex: number;
      cellIndex: number;
      rowCount: number;
      colCount: number;
    } | null>(null);
    /** AI command menu (chunk 56) — right-click on a body selection
     *  opens this. Coordinates only; the menu reads the current
     *  selection text via the imperative handle. */
    const [aiMenu, setAiMenu] = useState<{ x: number; y: number } | null>(null);
    /** chunk 64 — Notion-style slash menu. Opens when the user types
     *  `/` at the start of an empty body paragraph. Coordinates are in
     *  client space (caret rect + page offset). */
    const [slashMenu, setSlashMenu] = useState<{
      x: number;
      y: number;
      sectionIndex: number;
      paragraphIndex: number;
    } | null>(null);
    /** chunk 57 — paragraph rects marked "changed by AI" per page.
     *  AppShell calls `markChangedParagraphsSince` after an AI apply;
     *  the highlight auto-clears after the TTL. */
    const [changedParaRects, setChangedParaRects] = useState<
      Record<number, { x: number; y: number; width: number; height: number }[]>
    >({});
    const changedParaTimerRef = useRef<number | null>(null);
    /** Toolbar second-row visibility — collapsed by default. */
    const [toolbarExpanded, setToolbarExpanded] = useState(false);
    /** Doc-level view toggles. Mirror what setShow* set. */
    const [showControlCodes, setShowControlCodesState] = useState(false);
    const [showTransparentBorders, setShowTransparentBordersState] =
      useState(false);
    /** Inline rows × cols input for insert-table — open from toolbar. */
    const [tablePickerOpen, setTablePickerOpen] = useState(false);
    /**
     * Cached lowercased paragraph text for Find. Built lazily on the
     * first non-empty search; keyed by `${sec}:${para}` so multi-section
     * docs don't collide. `runFindSearch` reuses this on subsequent
     * keystrokes — without the cache, every keystroke re-issued
     * getTextRange across all paragraphs (4ms × N para per keystroke).
     * Invalidated by `refreshAfterMutation` since edits change paragraph
     * text and break the offsets we'd return as match positions.
     */
    const findTextCacheRef = useRef<Map<string, string> | null>(null);
    // Active formatting state on the caret's paragraph — drives toolbar
    // pressed-state. Recomputed after every mutation / caret move.
    const [activeFormat, setActiveFormat] = useState<{
      bold: boolean;
      italic: boolean;
      underline: boolean;
      styleId: number;
      /** HWPUNIT — fontSize at caret. */
      fontSize: number;
      /** Lowercase hex like "#ff0000". */
      textColor: string;
      alignment: ParaAlignment;
    }>({
      bold: false,
      italic: false,
      underline: false,
      styleId: 0,
      fontSize: 1000,
      textColor: '#000000',
      alignment: 'left',
    });

    // Effect 1: load doc, render page 0 to learn dimensions, prime cache.
    useEffect(() => {
      let cancelled = false;
      let localDoc: RhwpDoc | null = null;

      // Capture refs for cleanup — react-hooks/exhaustive-deps wants explicit
      // capture even though these are non-DOM refs (Map / array).
      const cache = cacheRef.current;
      const pageRefs = pageRefsRef;

      // Reset everything for a fresh path. Refs reset synchronously
      // (no React tear-related lint), but the React state setters are
      // moved into the async IIFE below so we avoid the
      // react-hooks/set-state-in-effect cascade warning.
      cache.clear();
      pageRefs.current = [];
      dirtyRef.current = false;
      historyRef.current = { entries: [], index: -1 };
      findTextCacheRef.current = null;

      (async () => {
        try {
          setDirty(false);
          setCanUndo(false);
          setCanRedo(false);
          setError(null);
          setPhase('mounting');
          await ensureRhwpCore();
          if (cancelled) return;

          setPhase('reading');
          const tRead = performance.now();
          const buffer = await window.api.file.read(path);
          if (cancelled) return;
          console.info(
            `[studio] read ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB in ${(performance.now() - tRead).toFixed(0)} ms`,
          );

          setPhase('rendering');
          const tParse = performance.now();
          // We use HwpDocument's render/page-count methods directly. We don't
          // construct HwpViewer — its constructor consumes the HwpDocument
          // (`document.__destroy_into_raw()`), zeroing the doc's internal
          // pointer and breaking subsequent exportHwpx() / insertText() calls.
          // The doc itself exposes everything we need (pageCount,
          // renderPageSvg, renderPageHtml).
          localDoc = new HwpDocument(new Uint8Array(buffer));
          const total = localDoc.pageCount();
          const svg0 = localDoc.renderPageSvg(0);
          const dims = parsePageDimensions(svg0);
          if (!dims) throw new Error('Could not parse page-0 dimensions');
          console.info(
            `[studio] parse ${total} pages, page-0 ${dims.w}×${dims.h} in ${(performance.now() - tParse).toFixed(0)} ms`,
          );

          if (cancelled) {
            localDoc.free();
            return;
          }

          docRef.current = localDoc;
          cacheRef.current.set(0, svg0);
          // Sync initial caret state from the doc.
          try {
            caretRef.current = JSON.parse(
              localDoc.getCaretPosition(),
            ) as typeof caretRef.current;
          } catch {
            /* keep default 0,0,0 */
          }
          // Compute initial cursor rect for the visual cursor.
          try {
            const c = caretRef.current;
            setCursorRect(
              JSON.parse(
                localDoc.getCursorRect(
                  c.sectionIndex,
                  c.paragraphIndex,
                  c.charOffset,
                ),
              ),
            );
          } catch {
            /* keep null */
          }
          // Load style list (paragraph styles) for toolbar dropdown +
          // initial active format from caret's paragraph CharShape.
          try {
            const list = JSON.parse(localDoc.getStyleList()) as StyleListItem[];
            // Only show 본문 styles (type=0) — type=1 is system styles
            // like 쪽 번호 which aren't user-applicable to body paragraphs.
            setStyleList(list.filter((s) => s.type === 0));
          } catch {
            setStyleList([]);
          }
          try {
            const c = caretRef.current;
            const cp = JSON.parse(
              localDoc.getCharPropertiesAt(
                c.sectionIndex,
                c.paragraphIndex,
                c.charOffset,
              ),
            ) as CharProps;
            const at = JSON.parse(
              localDoc.getStyleAt(c.sectionIndex, c.paragraphIndex),
            ) as { id: number };
            let alignment: ParaAlignment = 'left';
            try {
              const pp = JSON.parse(
                localDoc.getParaPropertiesAt(c.sectionIndex, c.paragraphIndex),
              ) as ParaProps;
              if (pp.alignment && PARA_ALIGNMENTS.includes(pp.alignment)) {
                alignment = pp.alignment;
              }
            } catch {
              /* keep default */
            }
            setActiveFormat({
              bold: !!cp.bold,
              italic: !!cp.italic,
              underline: !!cp.underline,
              styleId: at.id,
              fontSize: typeof cp.fontSize === 'number' ? cp.fontSize : 1000,
              textColor:
                typeof cp.textColor === 'string' ? cp.textColor : '#000000',
              alignment,
            });
          } catch {
            /* keep defaults */
          }
          setPageCount(total);
          setPageDims(dims);
          setPhase('ready');
          // Reset history and push baseline snapshot. Inline rather than
          // calling pushHistory() because that closure references docRef,
          // which has just been swapped — the safe ordering is to seed
          // historyRef directly here.
          try {
            const baseId = localDoc.saveSnapshot();
            historyRef.current = { entries: [baseId], index: 0 };
            setCanUndo(false);
            setCanRedo(false);
          } catch (err) {
            console.warn('[studio] baseline snapshot failed:', err);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
          localDoc?.free();
        }
      })();

      return () => {
        cancelled = true;
        docRef.current?.free();
        docRef.current = null;
        cache.clear();
        pageRefs.current = [];
      };
    }, [path]);

    // Mount or fetch SVG for a page (uses cache).
    const renderPageInto = useCallback((idx: number): void => {
      const el = pageRefsRef.current[idx];
      if (!el) return;
      // Already mounted? Skip.
      if (el.firstElementChild?.tagName.toLowerCase() === 'svg') return;
      let svg = cacheRef.current.get(idx);
      if (!svg) {
        const doc = docRef.current;
        if (!doc) return;
        try {
          svg = doc.renderPageSvg(idx);
          cacheRef.current.set(idx, svg);
        } catch (err) {
          console.error(`[studio] render page ${idx} failed:`, err);
          return;
        }
      }
      // Parse via DOMParser (image/svg+xml) — guarantees the SVG namespace
      // is established for `<image>` (otherwise the HTML parser may treat it
      // ambiguously) and that xlink:href / href on embedded images resolve
      // correctly. innerHTML works for many SVGs but is unreliable when the
      // payload contains <image>, <use href>, or namespace-prefixed attrs.
      const parser = new DOMParser();
      const parsed = parser.parseFromString(svg, 'image/svg+xml');
      const root = parsed.documentElement;
      // Surface parse errors (DOMParser doesn't throw — it returns a
      // <parsererror> document instead).
      if (root.tagName.toLowerCase() === 'parsererror') {
        console.error(
          `[studio] page ${idx} SVG parse error:`,
          root.textContent,
        );
        return;
      }
      const adopted = document.importNode(
        root,
        true,
      ) as unknown as SVGSVGElement;
      // Strip fixed dims so CSS controls size; preserve aspect via viewBox.
      adopted.removeAttribute('width');
      adopted.removeAttribute('height');
      adopted.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      adopted.style.width = '100%';
      adopted.style.height = '100%';
      adopted.style.display = 'block';
      el.replaceChildren(adopted);
      // Diagnostic: track image counts per page for debugging.
      const stringCount = (svg.match(/<image\b/g) ?? []).length;
      const parsedCount = parsed.querySelectorAll('image').length;
      const mountedCount = el.querySelectorAll('image').length;
      const diag = window as Window & {
        __studioPageDiag?: Record<
          number,
          { string: number; parsed: number; mounted: number }
        >;
      };
      diag.__studioPageDiag ??= {};
      diag.__studioPageDiag[idx] = {
        string: stringCount,
        parsed: parsedCount,
        mounted: mountedCount,
      };
      if (stringCount !== mountedCount) {
        console.warn(
          `[studio] page ${idx} image count mismatch: string=${stringCount} parsed=${parsedCount} mounted=${mountedCount}`,
        );
      }
    }, []);

    /**
     * After a HwpDocument mutation (insert / delete / etc.), the cached SVGs
     * are stale. Clear the cache and re-render any placeholders that were
     * already mounted; placeholders not yet mounted will lazy-render fresh
     * SVGs when the IntersectionObserver next visits them.
     *
     * Also resyncs caretRef from doc.getCaretPosition() — the doc auto-tracks
     * caret across insert/delete (verified via scripts/check-hittest.mjs).
     */
    /**
     * Recompute the visual cursor rect for the current logical caret using
     * `getCursorRect(s, p, c)`. Called after load / mutation / arrow nav.
     */
    const refreshCursorRect = useCallback((): void => {
      const doc = docRef.current;
      if (!doc) return;
      try {
        const c = caretRef.current;
        const rectJson = c.cell
          ? doc.getCursorRectInCell(
              c.sectionIndex,
              c.cell.parentParaIndex,
              c.cell.controlIndex,
              c.cell.cellIndex,
              c.cell.cellParaIndex,
              c.charOffset,
            )
          : doc.getCursorRect(c.sectionIndex, c.paragraphIndex, c.charOffset);
        const rect = JSON.parse(rectJson) as {
          pageIndex: number;
          x: number;
          y: number;
          height: number;
        };
        setCursorRect(rect);
      } catch {
        /* keep previous */
      }
    }, []);

    /**
     * Sort anchor/focus by (paragraphIndex, charOffset) to produce a
     * canonical [start, end] range. Same-section assumption — multi-section
     * selection is a future chunk.
     */
    const sortRange = useCallback(
      (
        a: { paragraphIndex: number; charOffset: number },
        b: { paragraphIndex: number; charOffset: number },
      ): {
        startPara: number;
        startOffset: number;
        endPara: number;
        endOffset: number;
        empty: boolean;
      } => {
        const aFirst =
          a.paragraphIndex < b.paragraphIndex ||
          (a.paragraphIndex === b.paragraphIndex &&
            a.charOffset <= b.charOffset);
        const start = aFirst ? a : b;
        const end = aFirst ? b : a;
        return {
          startPara: start.paragraphIndex,
          startOffset: start.charOffset,
          endPara: end.paragraphIndex,
          endOffset: end.charOffset,
          empty:
            start.paragraphIndex === end.paragraphIndex &&
            start.charOffset === end.charOffset,
        };
      },
      [],
    );

    /**
     * Recompute the visual selection rects from the doc's getSelectionRects.
     * No-op (clears) when selection is null or empty.
     */
    const refreshSelectionRects = useCallback(
      (sel: typeof selection): void => {
        const doc = docRef.current;
        if (!doc || !sel) {
          setSelectionRectsByPage({});
          return;
        }
        const r = sortRange(sel.anchor, sel.focus);
        if (r.empty) {
          setSelectionRectsByPage({});
          return;
        }
        try {
          const rects = JSON.parse(
            doc.getSelectionRects(
              sel.anchor.sectionIndex,
              r.startPara,
              r.startOffset,
              r.endPara,
              r.endOffset,
            ),
          ) as {
            pageIndex: number;
            x: number;
            y: number;
            width: number;
            height: number;
          }[];
          const grouped: Record<
            number,
            { x: number; y: number; width: number; height: number }[]
          > = {};
          for (const rect of rects) {
            (grouped[rect.pageIndex] ??= []).push({
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            });
          }
          setSelectionRectsByPage(grouped);
        } catch (err) {
          console.warn('[studio] getSelectionRects failed:', err);
          setSelectionRectsByPage({});
        }
      },
      [sortRange],
    );

    const clearSelection = useCallback((): void => {
      setSelection(null);
      setSelectionRectsByPage({});
    }, [setSelection]);

    /**
     * Returns true if there was a non-empty selection that we deleted.
     * Caller should NOT then proceed with its own delete/insert at the
     * caret; the deleteRange already moved the caret to the start of the
     * deleted range. Caller must call refreshAfterMutation afterward.
     */
    const deleteSelectionIfAny = useCallback((): boolean => {
      const doc = docRef.current;
      const sel = selectionRef.current;
      if (!doc || !sel) return false;
      const r = sortRange(sel.anchor, sel.focus);
      if (r.empty) return false;
      try {
        doc.deleteRange(
          sel.anchor.sectionIndex,
          r.startPara,
          r.startOffset,
          r.endPara,
          r.endOffset,
        );
        setSelection(null);
        setSelectionRectsByPage({});
        return true;
      } catch (err) {
        console.warn('[studio] deleteRange failed:', err);
        return false;
      }
    }, [setSelection, sortRange]);

    /**
     * Read the *effective* character formatting at the caret position via
     * getCharPropertiesAt — this reflects applyCharFormat overrides on top
     * of the paragraph style's CharShape. getStyleAt+getStyleDetail only
     * gives the style template, which doesn't update when applyCharFormat
     * runs. Paragraph styleId comes from getStyleAt (paragraph-level).
     */
    const refreshActiveFormat = useCallback((): void => {
      const doc = docRef.current;
      if (!doc) return;
      const c = caretRef.current;
      try {
        const cp = JSON.parse(
          doc.getCharPropertiesAt(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
          ),
        ) as CharProps;
        const at = JSON.parse(
          doc.getStyleAt(c.sectionIndex, c.paragraphIndex),
        ) as { id: number };
        let alignment: ParaAlignment = 'left';
        try {
          const pp = JSON.parse(
            doc.getParaPropertiesAt(c.sectionIndex, c.paragraphIndex),
          ) as ParaProps;
          if (pp.alignment && PARA_ALIGNMENTS.includes(pp.alignment)) {
            alignment = pp.alignment;
          }
        } catch {
          /* keep default */
        }
        setActiveFormat({
          bold: !!cp.bold,
          italic: !!cp.italic,
          underline: !!cp.underline,
          styleId: at.id,
          fontSize: typeof cp.fontSize === 'number' ? cp.fontSize : 1000,
          textColor:
            typeof cp.textColor === 'string' ? cp.textColor : '#000000',
          alignment,
        });
      } catch {
        /* keep previous */
      }
    }, []);

    /**
     * Push a snapshot of the current doc state onto the undo stack. Called
     * from the doc-load effect (baseline) and after every mutation. Discards
     * the redo tail (snapshots after the current index) so a fresh edit
     * can't be "redone past". Caps stack depth and discards oldest.
     */
    const pushHistory = useCallback((): void => {
      const doc = docRef.current;
      if (!doc) return;
      // chunk 27 — when an undo group is active, swallow intermediate
      // snapshots. endUndoGroup() will push a single one.
      if (undoGroupDepthRef.current > 0) return;
      try {
        const id = doc.saveSnapshot();
        const h = historyRef.current;
        // Drop redo tail (snapshots beyond current index) — they are now
        // obsolete branches.
        for (let i = h.index + 1; i < h.entries.length; i++) {
          try {
            doc.discardSnapshot(h.entries[i]);
          } catch {
            /* ignore */
          }
        }
        h.entries.length = h.index + 1;
        h.entries.push(id);
        h.index = h.entries.length - 1;
        // Cap depth — drop oldest entries (and their snapshot IDs).
        while (h.entries.length > HISTORY_CAP) {
          const oldId = h.entries.shift()!;
          try {
            doc.discardSnapshot(oldId);
          } catch {
            /* ignore */
          }
          h.index--;
        }
        setCanUndo(h.index > 0);
        setCanRedo(h.index < h.entries.length - 1);
      } catch (err) {
        console.warn('[studio] saveSnapshot failed:', err);
      }
    }, []);

    /**
     * Restore to the entry at index `targetIndex` and refresh layout/UI.
     * Bypasses pushHistory (we don't snapshot the restore itself).
     */
    const restoreToIndex = useCallback(
      (targetIndex: number): void => {
        const doc = docRef.current;
        const h = historyRef.current;
        if (
          !doc ||
          targetIndex < 0 ||
          targetIndex >= h.entries.length ||
          targetIndex === h.index
        )
          return;
        try {
          doc.restoreSnapshot(h.entries[targetIndex]);
          h.index = targetIndex;
          try {
            doc.reflowLinesegs();
          } catch {
            /* ignore — older lib */
          }
          cacheRef.current.clear();
          pageRefsRef.current.forEach((el, idx) => {
            if (el?.firstElementChild?.tagName.toLowerCase() === 'svg') {
              el.innerHTML = '';
              renderPageInto(idx);
            }
          });
          try {
            caretRef.current = JSON.parse(
              doc.getCaretPosition(),
            ) as typeof caretRef.current;
          } catch {
            /* keep previous */
          }
          // Selection is renderer-side state (not in the doc IR snapshot).
          // Drop it — restoring to a different point shouldn't carry over a
          // possibly-now-invalid range.
          setSelection(null);
          setSelectionRectsByPage({});
          refreshCursorRect();
          refreshActiveFormat();
          // Dirty: the *baseline* (index 0) is the loaded-from-disk state,
          // so being there means clean. Anything else is dirty.
          const dirty = h.index !== 0;
          dirtyRef.current = dirty;
          setDirty(dirty);
          setCanUndo(h.index > 0);
          setCanRedo(h.index < h.entries.length - 1);
        } catch (err) {
          console.warn('[studio] restoreSnapshot failed:', err);
        }
      },
      [renderPageInto, refreshCursorRect, refreshActiveFormat, setSelection],
    );

    const undo = useCallback((): void => {
      restoreToIndex(historyRef.current.index - 1);
    }, [restoreToIndex]);

    const redo = useCallback((): void => {
      restoreToIndex(historyRef.current.index + 1);
    }, [restoreToIndex]);

    const refreshAfterMutation = useCallback(
      (opts?: { syncCaret?: boolean }): void => {
        // Default true for back-compat with text-modifying paths
        // (insertText / deleteText / deleteRange) where the IR caret moves.
        // Format-only paths (applyCharFormat / applyParaFormat / applyStyle)
        // pass `syncCaret: false` because they don't touch the IR caret —
        // syncing would snap our renderer-side caret back to (0,0,0).
        const syncCaret = opts?.syncCaret ?? true;
        const doc = docRef.current;
        if (doc) {
          // Force lineseg reflow before re-rendering. The auto-reflow path
          // covers empty line_segs + empty text, but not empty line_segs +
          // text-just-inserted (issue #177 in upstream). Without this, an
          // insertText into a fresh blank.hwpx paragraph mutates the IR but
          // the SVG output stays empty.
          try {
            doc.reflowLinesegs();
          } catch {
            /* ignore — unsupported on older library versions */
          }
        }
        cacheRef.current.clear();
        // Mutations change paragraph text → drop the find text cache so
        // subsequent searches re-extract from the doc.
        findTextCacheRef.current = null;
        // Page count can change (insertPageBreak, table insert spanning
        // a page, large insertText pushing content to a new page). Only
        // setState if the value actually changed to avoid extra renders.
        if (doc) {
          try {
            const newCount = doc.pageCount();
            setPageCount((prev) => (prev !== newCount ? newCount : prev));
          } catch {
            /* keep previous */
          }
        }
        pageRefsRef.current.forEach((el, idx) => {
          if (el?.firstElementChild?.tagName.toLowerCase() === 'svg') {
            el.innerHTML = '';
            renderPageInto(idx);
          }
        });
        if (doc && syncCaret) {
          try {
            const parsed = JSON.parse(
              doc.getCaretPosition(),
            ) as typeof caretRef.current;
            caretRef.current = parsed;
          } catch {
            /* keep previous caret */
          }
        }
        refreshCursorRect();
        refreshActiveFormat();
        // Selection survives format-only mutations — recompute rects against
        // the (possibly reflowed) layout. setSelection in delete paths has
        // already cleared selection there, so this is a no-op when sel=null.
        setSelection((prev) => {
          refreshSelectionRects(prev);
          return prev;
        });
        dirtyRef.current = true;
        setDirty(true);
        pushHistory();
      },
      [
        renderPageInto,
        refreshCursorRect,
        refreshActiveFormat,
        refreshSelectionRects,
        setSelection,
        pushHistory,
      ],
    );

    /**
     * Toggle a character format. With an active selection, applies to the
     * selected range (across multiple paragraphs if needed). Without a
     * selection, applies to the caret's whole paragraph (chunk 5 fallback).
     * applyCharFormat clamps end_offset to paragraph length silently
     * (probe in scripts/check-charformat.mjs).
     */
    const toggleCharFormat = useCallback(
      (key: CharFormatKey): void => {
        const doc = docRef.current;
        if (!doc) return;
        const next = !activeFormat[key];
        const propsJson = JSON.stringify({ [key]: next } satisfies CharProps);
        const sel = selectionRef.current;
        try {
          if (sel) {
            const r = sortRange(sel.anchor, sel.focus);
            if (!r.empty) {
              const sec = sel.anchor.sectionIndex;
              if (r.startPara === r.endPara) {
                doc.applyCharFormat(
                  sec,
                  r.startPara,
                  r.startOffset,
                  r.endOffset,
                  propsJson,
                );
              } else {
                // Multi-paragraph selection: head paragraph from startOffset
                // to EOL, full middle paragraphs, tail paragraph from 0 to
                // endOffset.
                doc.applyCharFormat(
                  sec,
                  r.startPara,
                  r.startOffset,
                  PARAGRAPH_END_SENTINEL,
                  propsJson,
                );
                for (let p = r.startPara + 1; p < r.endPara; p++) {
                  doc.applyCharFormat(
                    sec,
                    p,
                    0,
                    PARAGRAPH_END_SENTINEL,
                    propsJson,
                  );
                }
                doc.applyCharFormat(sec, r.endPara, 0, r.endOffset, propsJson);
              }
              refreshAfterMutation({ syncCaret: false });
              return;
            }
          }
          // No selection — fall back to whole-paragraph at caret. When
          // the caret is in a cell, route via applyCharFormatInCell so
          // bold/italic/underline land on the cell text (cell selection
          // model is a v3).
          const c = caretRef.current;
          if (c.cell) {
            doc.applyCharFormatInCell(
              c.sectionIndex,
              c.cell.parentParaIndex,
              c.cell.controlIndex,
              c.cell.cellIndex,
              c.cell.cellParaIndex,
              0,
              PARAGRAPH_END_SENTINEL,
              propsJson,
            );
          } else {
            doc.applyCharFormat(
              c.sectionIndex,
              c.paragraphIndex,
              0,
              PARAGRAPH_END_SENTINEL,
              propsJson,
            );
          }
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyCharFormat failed:', err);
        }
      },
      [activeFormat, refreshAfterMutation, sortRange],
    );

    /**
     * Cell-aware text insertion at the renderer-side caret. Falls back
     * to the outer-paragraph variant when the caret isn't inside a
     * table cell. The IR's `insertTextInCell` doesn't auto-advance the
     * IR caret (`getCaretPosition` doesn't track cell location), so we
     * advance ours by `text.length` here.
     */
    const insertAtCaret = useCallback((text: string): void => {
      const doc = docRef.current;
      if (!doc) return;
      const c = caretRef.current;
      if (c.cell) {
        doc.insertTextInCell(
          c.sectionIndex,
          c.cell.parentParaIndex,
          c.cell.controlIndex,
          c.cell.cellIndex,
          c.cell.cellParaIndex,
          c.charOffset,
          text,
        );
        caretRef.current = { ...c, charOffset: c.charOffset + text.length };
      } else {
        doc.insertText(c.sectionIndex, c.paragraphIndex, c.charOffset, text);
      }
    }, []);

    /**
     * Cell-aware single-char delete. `at` is the start offset of the
     * range to remove; `count` is the number of chars (typically 1).
     * For backspace pass `c.charOffset - 1` so our renderer-side caret
     * follows.
     */
    const deleteAtCaret = useCallback((at: number, count: number): void => {
      const doc = docRef.current;
      if (!doc) return;
      const c = caretRef.current;
      if (c.cell) {
        doc.deleteTextInCell(
          c.sectionIndex,
          c.cell.parentParaIndex,
          c.cell.controlIndex,
          c.cell.cellIndex,
          c.cell.cellParaIndex,
          at,
          count,
        );
        if (at < c.charOffset) {
          caretRef.current = { ...c, charOffset: at };
        }
      } else {
        doc.deleteText(c.sectionIndex, c.paragraphIndex, at, count);
      }
    }, []);

    const applyParagraphStyle = useCallback(
      (styleId: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        const c = caretRef.current;
        try {
          doc.applyStyle(c.sectionIndex, c.paragraphIndex, styleId);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyStyle failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Generic paragraph-format applier. Spans the selection's paragraphs when
     * one is active, otherwise just the caret's paragraph (or its enclosing
     * cell if the caret sits inside a table). Used by alignment, line
     * spacing, indent, and paragraph spacing — they all funnel through here
     * so the selection / cell routing logic stays in one place.
     */
    const applyParaProps = useCallback(
      (props: ParaProps): void => {
        const doc = docRef.current;
        if (!doc) return;
        const sel = selectionRef.current;
        const propsJson = JSON.stringify(props);
        try {
          if (sel) {
            const r = sortRange(sel.anchor, sel.focus);
            for (let p = r.startPara; p <= r.endPara; p++) {
              doc.applyParaFormat(sel.anchor.sectionIndex, p, propsJson);
            }
          } else {
            const c = caretRef.current;
            if (c.cell) {
              doc.applyParaFormatInCell(
                c.sectionIndex,
                c.cell.parentParaIndex,
                c.cell.controlIndex,
                c.cell.cellIndex,
                c.cell.cellParaIndex,
                propsJson,
              );
            } else {
              doc.applyParaFormat(c.sectionIndex, c.paragraphIndex, propsJson);
            }
          }
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyParaFormat failed:', err);
        }
      },
      [refreshAfterMutation, sortRange],
    );

    /**
     * Apply paragraph alignment. Spans the selection's paragraphs when a
     * selection is active, otherwise just the caret's paragraph.
     */
    const applyAlignment = useCallback(
      (alignment: ParaAlignment): void => applyParaProps({ alignment }),
      [applyParaProps],
    );

    /** Set line spacing as a percent of single line height (100 = 1.0). */
    const applyLineSpacing = useCallback(
      (percent: number): void => applyParaProps({ lineSpacing: percent }),
      [applyParaProps],
    );

    /**
     * Step the left margin by ±1cm (matches 한컴 한글's toolbar buttons).
     * Reads the current value via getParaPropertiesAt so successive clicks
     * stack correctly; floors at 0.
     */
    const stepIndent = useCallback(
      (direction: 'increase' | 'decrease'): void => {
        const doc = docRef.current;
        if (!doc) return;
        const c = caretRef.current;
        let current = 0;
        try {
          const raw = doc.getParaPropertiesAt(c.sectionIndex, c.paragraphIndex);
          const parsed = JSON.parse(raw) as { marginLeft?: number };
          if (typeof parsed.marginLeft === 'number')
            current = parsed.marginLeft;
        } catch {
          /* fall back to 0 — IR will accept fresh value either way */
        }
        const next =
          direction === 'increase'
            ? current + INDENT_STEP_HWPUNIT
            : Math.max(0, current - INDENT_STEP_HWPUNIT);
        applyParaProps({ marginLeft: next });
      },
      [applyParaProps],
    );

    /** Set paragraph spacing (before / after) in HWPUNIT. */
    const applyParaSpacing = useCallback(
      (spacingBefore: number, spacingAfter: number): void =>
        applyParaProps({ spacingBefore, spacingAfter }),
      [applyParaProps],
    );

    /**
     * Apply a character-level prop (fontSize / textColor) on the selection
     * range or the caret's whole paragraph as fallback. Same multi-paragraph
     * split as toggleCharFormat — head/middle/tail with sentinel end.
     */
    const applyCharProps = useCallback(
      (props: CharProps): void => {
        const doc = docRef.current;
        if (!doc) return;
        const propsJson = JSON.stringify(props);
        const sel = selectionRef.current;
        try {
          if (sel) {
            const r = sortRange(sel.anchor, sel.focus);
            if (!r.empty) {
              const sec = sel.anchor.sectionIndex;
              if (r.startPara === r.endPara) {
                doc.applyCharFormat(
                  sec,
                  r.startPara,
                  r.startOffset,
                  r.endOffset,
                  propsJson,
                );
              } else {
                doc.applyCharFormat(
                  sec,
                  r.startPara,
                  r.startOffset,
                  PARAGRAPH_END_SENTINEL,
                  propsJson,
                );
                for (let p = r.startPara + 1; p < r.endPara; p++) {
                  doc.applyCharFormat(
                    sec,
                    p,
                    0,
                    PARAGRAPH_END_SENTINEL,
                    propsJson,
                  );
                }
                doc.applyCharFormat(sec, r.endPara, 0, r.endOffset, propsJson);
              }
              refreshAfterMutation({ syncCaret: false });
              return;
            }
          }
          const c = caretRef.current;
          if (c.cell) {
            doc.applyCharFormatInCell(
              c.sectionIndex,
              c.cell.parentParaIndex,
              c.cell.controlIndex,
              c.cell.cellIndex,
              c.cell.cellParaIndex,
              0,
              PARAGRAPH_END_SENTINEL,
              propsJson,
            );
          } else {
            doc.applyCharFormat(
              c.sectionIndex,
              c.paragraphIndex,
              0,
              PARAGRAPH_END_SENTINEL,
              propsJson,
            );
          }
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyCharProps failed:', err);
        }
      },
      [refreshAfterMutation, sortRange],
    );

    const applyFontSizePt = useCallback(
      (pt: number): void => {
        if (!Number.isFinite(pt) || pt <= 0) return;
        applyCharProps({ fontSize: Math.round(pt * 100) });
      },
      [applyCharProps],
    );

    const applyTextColor = useCallback(
      (hex: string): void => {
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return;
        applyCharProps({ textColor: hex.toLowerCase() });
      },
      [applyCharProps],
    );

    /**
     * Page setup — chunk 10. `applyPageDef` updates a section's PageDef
     * (paper size, margins, orientation) and triggers IR re-pagination.
     * The shape of `props` mirrors what `getPageDef` returns (HWPUNIT-
     * based: width/height, marginLeft/Right/Top/Bottom/Header/Footer/
     * Gutter, landscape, binding).
     */
    const applyPageDef = useCallback(
      (props: Record<string, unknown>, sectionIdx = 0): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.setPageDef(sectionIdx, JSON.stringify(props));
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setPageDef failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * HTML paste with paragraph-shape decomposition — chunk 18.
     *
     * `pasteHtml` alone is partially lossy: char-level styles (bold,
     * italic, underline, color, font-size) round-trip, but paragraph-
     * level inline styles (`text-align`, `margin-left`, `line-height`,
     * `text-indent`) are silently dropped to defaults. We verify what
     * the IR retains via probes; for the rest we walk the source HTML
     * and apply the missing fields directly with `applyParaFormat`.
     *
     * 1px ≈ 75 HWPUNIT (96 DPI: 25.4/96 mm × 283.5 HWPUNIT/mm ≈ 75).
     * line-height: 1.5 → lineSpacing: 150 (percent of single).
     */
    const applyHtmlAtCaret = useCallback(
      (html: string): void => {
        const doc = docRef.current;
        if (!doc) return;
        const c = caretRef.current;
        try {
          // 1. Native paste — body text + char-level styles only.
          doc.pasteHtml(c.sectionIndex, c.paragraphIndex, c.charOffset, html);
          // 2. DOM-walk for paragraph-level styles `pasteHtml` ignores.
          //    Each <p>/<h*>/<li> becomes a paragraph in IR order
          //    starting at the caret's paragraph index.
          const dom = new DOMParser().parseFromString(html, 'text/html');
          const blocks = Array.from(
            dom.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li'),
          );
          let paraIdx = c.paragraphIndex;
          for (const el of blocks) {
            const props: Record<string, unknown> = {};
            const style = (el as HTMLElement).style;
            // Alignment.
            const align = style.textAlign;
            if (
              align === 'left' ||
              align === 'center' ||
              align === 'right' ||
              align === 'justify'
            ) {
              props.alignment = align;
            }
            // Line height — accept "1.5" / "150%" / "200%".
            const lh = style.lineHeight;
            if (lh) {
              let percent: number | null = null;
              if (lh.endsWith('%')) percent = parseFloat(lh);
              else {
                const ratio = parseFloat(lh);
                if (Number.isFinite(ratio) && ratio > 0)
                  percent = Math.round(ratio * 100);
              }
              if (percent != null && Number.isFinite(percent)) {
                props.lineSpacing = percent;
                props.lineSpacingType = 'Percent';
              }
            }
            // Left/right indent — only handle px / pt for now.
            const pxToHu = (raw: string): number | null => {
              const m = raw.match(/^(-?\d+(?:\.\d+)?)(px|pt)?$/);
              if (!m) return null;
              const n = parseFloat(m[1]);
              if (!Number.isFinite(n)) return null;
              const unit = m[2] || 'px';
              // 1pt = 1/72 in × 25.4 mm × 283.5 HWPUNIT/mm ≈ 100
              // 1px = 1/96 in × 25.4 mm × 283.5 HWPUNIT/mm ≈ 75
              const k = unit === 'pt' ? 100 : 75;
              return Math.round(n * k);
            };
            const ml = pxToHu(style.marginLeft);
            if (ml != null) props.marginLeft = ml;
            const mr = pxToHu(style.marginRight);
            if (mr != null) props.marginRight = mr;
            const ti = pxToHu(style.textIndent);
            if (ti != null) props.indent = ti;
            const mt = pxToHu(style.marginTop);
            if (mt != null) props.spacingBefore = mt;
            const mb = pxToHu(style.marginBottom);
            if (mb != null) props.spacingAfter = mb;

            if (Object.keys(props).length > 0) {
              try {
                doc.applyParaFormat(
                  c.sectionIndex,
                  paraIdx,
                  JSON.stringify(props),
                );
              } catch (err) {
                console.warn(
                  '[studio] applyHtmlAtCaret applyParaFormat failed:',
                  err,
                );
              }
            }
            paraIdx += 1;
          }
          dirtyRef.current = true;
          setDirty(true);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyHtmlAtCaret failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * HTML export / paste — chunk 18 (probe). The IR's `pasteHtml` is
     * lossy — verifying which inline styles round-trip needs raw access
     * to both ends of the pipe.
     */
    const exportSelectionHtmlAt = useCallback(
      (
        sec: number,
        startPara: number,
        startOff: number,
        endPara: number,
        endOff: number,
      ): string => {
        const doc = docRef.current;
        if (!doc) return '';
        try {
          return doc.exportSelectionHtml(
            sec,
            startPara,
            startOff,
            endPara,
            endOff,
          );
        } catch (err) {
          console.warn('[studio] exportSelectionHtml failed:', err);
          return '';
        }
      },
      [],
    );

    const pasteHtmlAt = useCallback(
      (sec: number, para: number, charOffset: number, html: string): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.pasteHtml(sec, para, charOffset, html);
          dirtyRef.current = true;
          setDirty(true);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] pasteHtml failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Shapes — chunk 15. Insert / read / write / delete a rectangle
     * shape control at the current caret. Z-order ops too. The IR's
     * `createShapeControl` JSON shape:
     *   { sectionIdx, paraIdx, charOffset, width, height, horzOffset,
     *     vertOffset, treatAsChar, textWrap }
     * Returns `{ok, paraIdx, controlIdx}`. Subsequent
     * set/get/delete/zOrder calls take the (paraIdx, controlIdx) tuple.
     */
    const createRectShapeAtCaret = useCallback(
      (
        widthHwpunit: number,
        heightHwpunit: number,
        opts: { treatAsChar?: boolean } = {},
      ): { paraIdx: number; controlIdx: number } | null => {
        const doc = docRef.current;
        if (!doc) return null;
        const c = caretRef.current;
        try {
          const raw = doc.createShapeControl(
            JSON.stringify({
              sectionIdx: c.sectionIndex,
              paraIdx: c.paragraphIndex,
              charOffset: c.charOffset,
              width: widthHwpunit,
              height: heightHwpunit,
              horzOffset: 0,
              vertOffset: 0,
              treatAsChar: opts.treatAsChar ?? true,
              textWrap: 'Square',
            }),
          );
          const result = JSON.parse(raw) as {
            ok?: boolean;
            paraIdx?: number;
            controlIdx?: number;
          };
          if (!result.ok || typeof result.paraIdx !== 'number') return null;
          dirtyRef.current = true;
          setDirty(true);
          refreshAfterMutation({ syncCaret: false });
          return {
            paraIdx: result.paraIdx,
            controlIdx: result.controlIdx ?? 0,
          };
        } catch (err) {
          console.warn('[studio] createShapeControl failed:', err);
          return null;
        }
      },
      [refreshAfterMutation],
    );

    const getShapeProps = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
      ): Record<string, unknown> | null => {
        const doc = docRef.current;
        if (!doc) return null;
        try {
          return JSON.parse(
            doc.getShapeProperties(sec, parentPara, ctrl),
          ) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
      [],
    );

    const setShapeProps = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        props: Record<string, unknown>,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.setShapeProperties(sec, parentPara, ctrl, JSON.stringify(props));
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setShapeProperties failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const deleteShape = useCallback(
      (sec: number, parentPara: number, ctrl: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.deleteShapeControl(sec, parentPara, ctrl);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] deleteShapeControl failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const changeShapeZOrderAt = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        op: 'front' | 'back' | 'forward' | 'backward',
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.changeShapeZOrder(sec, parentPara, ctrl, op);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] changeShapeZOrder failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Table / cell properties — chunk 17. Read-modify-write helpers
     * for the IR's `{set,get}{Table,Cell}Properties`. Both setters
     * accept a JSON props bag mirroring the getter's shape:
     *   table: { cellSpacing, paddingLeft/Right/Top/Bottom, pageBreak,
     *            repeatHeader }
     *   cell:  { width, height, paddingLeft/Right/Top/Bottom,
     *            verticalAlign, textDirection, isHeader }
     */
    const getTableProps = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
      ): Record<string, unknown> | null => {
        const doc = docRef.current;
        if (!doc) return null;
        try {
          return JSON.parse(
            doc.getTableProperties(sec, parentPara, ctrl),
          ) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
      [],
    );

    const setTableProps = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        props: Record<string, unknown>,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.setTableProperties(sec, parentPara, ctrl, JSON.stringify(props));
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setTableProperties failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const getCellProps = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        cellIdx: number,
      ): Record<string, unknown> | null => {
        const doc = docRef.current;
        if (!doc) return null;
        try {
          return JSON.parse(
            doc.getCellProperties(sec, parentPara, ctrl, cellIdx),
          ) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
      [],
    );

    const setCellProps = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        cellIdx: number,
        props: Record<string, unknown>,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.setCellProperties(
            sec,
            parentPara,
            ctrl,
            cellIdx,
            JSON.stringify(props),
          );
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setCellProperties failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Equation preview — chunk 16. The IR's `renderEquationPreview`
     * takes a script string (한컴 수식 syntax — e.g. `x^2 + y^2 = z^2`),
     * a font size in HWPUNIT, and a color int (0xRRGGBB), and returns a
     * complete SVG string. Used by the equation dialog for live preview.
     *
     * Inserting a new equation control into the doc requires shape-
     * control machinery the lib doesn't expose as a one-liner — that
     * lands in the next chunk. For now MVP is preview-only.
     */
    const renderEquationSvg = useCallback(
      (script: string, fontSizeHwpunit = 1000, color = 0): string => {
        const doc = docRef.current;
        if (!doc) return '';
        try {
          return doc.renderEquationPreview(script, fontSizeHwpunit, color);
        } catch (err) {
          console.warn('[studio] renderEquationPreview failed:', err);
          return '';
        }
      },
      [],
    );

    /**
     * Styles — chunk 14. Add / rename / delete user styles. New style
     * is a "shell" with just a name; char/para shape mods are a
     * follow-up. `applyStyle` (chunk 5) already wires the toolbar.
     */
    const createNamedStyle = useCallback(
      (name: string, englishName?: string): number | null => {
        const doc = docRef.current;
        if (!doc) return null;
        try {
          const id = doc.createStyle(
            JSON.stringify({
              name,
              englishName: englishName ?? name,
              type: 0,
              nextStyleId: 0,
            }),
          );
          dirtyRef.current = true;
          setDirty(true);
          refreshAfterMutation({ syncCaret: false });
          return id;
        } catch (err) {
          console.warn('[studio] createStyle failed:', err);
          return null;
        }
      },
      [refreshAfterMutation],
    );

    const renameStyle = useCallback(
      (id: number, name: string, englishName?: string): boolean => {
        const doc = docRef.current;
        if (!doc) return false;
        try {
          const ok = doc.updateStyle(
            id,
            JSON.stringify({
              name,
              englishName: englishName ?? name,
              nextStyleId: 0,
            }),
          );
          if (ok) {
            dirtyRef.current = true;
            setDirty(true);
            refreshAfterMutation({ syncCaret: false });
          }
          return ok;
        } catch (err) {
          console.warn('[studio] updateStyle failed:', err);
          return false;
        }
      },
      [refreshAfterMutation],
    );

    const deleteStyleById = useCallback(
      (id: number): boolean => {
        const doc = docRef.current;
        if (!doc) return false;
        try {
          const ok = doc.deleteStyle(id);
          if (ok) {
            dirtyRef.current = true;
            setDirty(true);
            refreshAfterMutation({ syncCaret: false });
          }
          return ok;
        } catch (err) {
          console.warn('[studio] deleteStyle failed:', err);
          return false;
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Footnotes — chunk 13. Insert a footnote at the current caret and
     * (optionally) populate its body in one shot. The IR's `insertFootnote`
     * returns `{ok, ctrlIdx, ...}`; we read ctrlIdx so the body insertion
     * can target the new footnote without a separate getFootnoteInfo round-
     * trip.
     */
    const insertFootnoteAtCaret = useCallback(
      (text: string): void => {
        const doc = docRef.current;
        if (!doc) return;
        const c = caretRef.current;
        try {
          const raw = doc.insertFootnote(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
          );
          // IR response shape: { ok, paraIdx, controlIdx, footnoteNumber }.
          // We need controlIdx for the body insertion.
          const result = JSON.parse(raw) as {
            controlIdx?: number;
            paraIdx?: number;
          };
          const targetPara = result.paraIdx ?? c.paragraphIndex;
          if (text.length > 0 && typeof result.controlIdx === 'number') {
            doc.insertTextInFootnote(
              c.sectionIndex,
              targetPara,
              result.controlIdx,
              0 /* first paragraph in the footnote */,
              0 /* offset 0 */,
              text,
            );
          }
          // Footnote body lives off-page; spilling content can re-paginate
          // so we still call the full refresh.
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          // The IR panics on docs with no footnote area defined (e.g. the
          // blank seed). Surface as a soft failure so the UI can show an
          // error toast — caller catches via the dialog flow.
          console.warn('[studio] insertFootnote failed:', err);
          throw err;
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Bookmarks — chunk 12. Targets a specific (sec, para, charOffset)
     * with a user-supplied name. The IR returns `{ok, ctrlIdx, ...}`;
     * `ctrlIdx` is what subsequent rename/delete calls need.
     */
    const addBookmarkAtCaret = useCallback((name: string): void => {
      const doc = docRef.current;
      if (!doc) return;
      const c = caretRef.current;
      try {
        doc.addBookmark(c.sectionIndex, c.paragraphIndex, c.charOffset, name);
        // Bookmarks don't change visible content, but they do mutate the IR
        // — so save state must reflect them. We don't re-paginate.
        dirtyRef.current = true;
        setDirty(true);
      } catch (err) {
        console.warn('[studio] addBookmark failed:', err);
      }
    }, []);

    const deleteBookmarkAt = useCallback(
      (sec: number, para: number, ctrlIdx: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.deleteBookmark(sec, para, ctrlIdx);
          dirtyRef.current = true;
          setDirty(true);
        } catch (err) {
          console.warn('[studio] deleteBookmark failed:', err);
        }
      },
      [],
    );

    const renameBookmarkAt = useCallback(
      (sec: number, para: number, ctrlIdx: number, newName: string): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.renameBookmark(sec, para, ctrlIdx, newName);
          dirtyRef.current = true;
          setDirty(true);
        } catch (err) {
          console.warn('[studio] renameBookmark failed:', err);
        }
      },
      [],
    );

    /**
     * Header / footer wrappers — chunk 11. HF edits live outside the body
     * caret stream, so we pass `syncCaret: false`. The IR returns
     * `{ok, exists, kind, applyTo, ...}` JSON; UI-facing helpers parse
     * what they need and discard the rest.
     */
    const setHeaderFooterText = useCallback(
      (
        sectionIdx: number,
        isHeader: boolean,
        applyTo: number,
        text: string,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          // Drop any previous slot first so we don't append to old content.
          const existing = JSON.parse(
            doc.getHeaderFooter(sectionIdx, isHeader, applyTo),
          ) as { exists?: boolean };
          if (existing.exists) {
            doc.deleteHeaderFooter(sectionIdx, isHeader, applyTo);
          }
          if (text.length === 0) {
            // Empty input ⇒ leave the slot deleted.
            refreshAfterMutation({ syncCaret: false });
            return;
          }
          doc.createHeaderFooter(sectionIdx, isHeader, applyTo);
          // chunk 35 — multi-line support. Split on \n and insert each
          // line as its own paragraph via splitParagraphInHeaderFooter.
          // The lib's `insertTextInHeaderFooter` is per-paragraph; \n in
          // text is treated as a literal char, not a paragraph break.
          const lines = text.split('\n');
          let paraIdx = 0;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.length > 0) {
              doc.insertTextInHeaderFooter(
                sectionIdx,
                isHeader,
                applyTo,
                paraIdx,
                0,
                line,
              );
            }
            // After the last line, no trailing split — otherwise we leave
            // an empty paragraph at the end.
            if (i < lines.length - 1) {
              doc.splitParagraphInHeaderFooter(
                sectionIdx,
                isHeader,
                applyTo,
                paraIdx,
                line.length,
              );
              paraIdx += 1;
            }
          }
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setHeaderFooterText failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Toggle a list (numbered / bulleted) on the caret's current paragraph.
     * Calling toggle on a paragraph that already has the same kind of list
     * removes it (headType: 'None'). Selection-aware: applies to every
     * paragraph in the range.
     */
    const toggleList = useCallback(
      (kind: 'number' | 'bullet'): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          const numId =
            kind === 'number'
              ? doc.ensureDefaultNumbering()
              : doc.ensureDefaultBullet('•');
          const targetHead = kind === 'number' ? 'Number' : 'Bullet';
          const sel = selectionRef.current;
          // Decide on/off by checking the caret's paragraph current headType.
          const c = caretRef.current;
          const cur = JSON.parse(
            doc.getParaPropertiesAt(c.sectionIndex, c.paragraphIndex),
          ) as { headType?: string };
          const turnOn = cur.headType !== targetHead;
          const propsJson = JSON.stringify(
            turnOn
              ? { headType: targetHead, numberingId: numId }
              : { headType: 'None' },
          );
          if (sel) {
            const r = sortRange(sel.anchor, sel.focus);
            for (let p = r.startPara; p <= r.endPara; p++) {
              doc.applyParaFormat(sel.anchor.sectionIndex, p, propsJson);
            }
          } else {
            doc.applyParaFormat(c.sectionIndex, c.paragraphIndex, propsJson);
          }
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] toggleList failed:', err);
        }
      },
      [refreshAfterMutation, sortRange],
    );

    /**
     * Insert a hard page break at the caret. Splits the current paragraph
     * if the caret is mid-text. Subsequent edits land on the new page.
     */
    const insertPageBreak = useCallback((): void => {
      const doc = docRef.current;
      if (!doc) return;
      const c = caretRef.current;
      try {
        doc.insertPageBreak(c.sectionIndex, c.paragraphIndex, c.charOffset);
        refreshAfterMutation();
      } catch (err) {
        console.warn('[studio] insertPageBreak failed:', err);
      }
    }, [refreshAfterMutation]);

    /**
     * Insert a table (rows × cols) at the caret. The new table is the
     * first child of a freshly-inserted paragraph. Edits inside cells go
     * through `*InCell` IPC variants in a future chunk; for now the
     * inserted table is a static grid.
     */
    const insertTable = useCallback(
      (rows: number, cols: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        if (!Number.isInteger(rows) || rows < 1 || rows > 100) return;
        if (!Number.isInteger(cols) || cols < 1 || cols > 100) return;
        const c = caretRef.current;
        try {
          doc.createTable(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
            rows,
            cols,
          );
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] createTable failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Insert an image at the caret. The bytes payload comes either from
     * the toolbar's hidden `<input type="file">` or from a drag-and-drop
     * event (`e.dataTransfer.files[0]`). We measure the natural pixel
     * size via an in-memory `<img>`, convert to HWPUNIT (1 inch = 7200,
     * so 1 px @ 96 DPI ≈ 75 HWPUNIT), and clamp the display width to
     * the typical page text-area width (~166 mm ≈ 47k HWPUNIT) so a
     * full-resolution screenshot doesn't overflow the page.
     */
    const insertImage = useCallback(
      async (
        bytes: Uint8Array,
        ext: string,
        description = '',
      ): Promise<void> => {
        const doc = docRef.current;
        if (!doc) return;
        const lcExt = ext.toLowerCase().replace(/^\./, '');
        // Measure natural size via an in-memory Image element. Use a
        // blob URL so we don't re-encode the bytes.
        const blob = new Blob([new Uint8Array(bytes)], {
          type: `image/${lcExt}`,
        });
        const url = URL.createObjectURL(blob);
        let natW = 0;
        let natH = 0;
        try {
          await new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              natW = img.naturalWidth || 1;
              natH = img.naturalHeight || 1;
              resolve();
            };
            img.onerror = () => reject(new Error('image decode failed'));
            img.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        const HWPUNIT_PER_PX = 75; // 1px @ 96 DPI ≈ 75 HWPUNIT
        const MAX_W = 47_000; // ~ page text width (HWPUNIT)
        let displayW = natW * HWPUNIT_PER_PX;
        let displayH = natH * HWPUNIT_PER_PX;
        if (displayW > MAX_W) {
          const scale = MAX_W / displayW;
          displayW = MAX_W;
          displayH = displayH * scale;
        }
        const c = caretRef.current;
        try {
          // insertPicture targets the outer paragraph; cell-internal
          // image insert is a follow-up (no insertPictureInCell yet).
          doc.insertPicture(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
            new Uint8Array(bytes),
            Math.round(displayW),
            Math.round(displayH),
            natW,
            natH,
            lcExt,
            description,
          );
          refreshAfterMutation();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('[studio] insertPicture failed:', err);
          window.alert(`이미지 삽입 실패: ${msg}`);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * View toggles — show control codes (¶ marks etc), transparent
     * borders. The doc's render output changes accordingly so we re-render.
     */
    const setShowControlCodes = useCallback(
      (on: boolean): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.setShowControlCodes(on);
          setShowControlCodesState(on);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setShowControlCodes failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const setShowTransparentBorders = useCallback(
      (on: boolean): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.setShowTransparentBorders(on);
          setShowTransparentBordersState(on);
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] setShowTransparentBorders failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Copy the current selection (or no-op when empty) to BOTH the
     * internal clipboard (preserves formatting for round-trip via
     * pasteInternal) and the system clipboard (plain text — so the user
     * can paste in another app). Returns true if anything was copied.
     */
    const copySelection = useCallback(async (): Promise<boolean> => {
      const doc = docRef.current;
      const sel = selectionRef.current;
      if (!doc || !sel) return false;
      const r = sortRange(sel.anchor, sel.focus);
      if (r.empty) return false;
      try {
        const result = JSON.parse(
          doc.copySelection(
            sel.anchor.sectionIndex,
            r.startPara,
            r.startOffset,
            r.endPara,
            r.endOffset,
          ),
        ) as { ok: boolean; text?: string };
        if (!result.ok) return false;
        const text = result.text ?? doc.getClipboardText();
        await window.api.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn('[studio] copySelection failed:', err);
        return false;
      }
    }, [sortRange]);

    /**
     * Cut = Copy + delete-selection. No-op when no selection.
     */
    const cutSelection = useCallback(async (): Promise<boolean> => {
      const ok = await copySelection();
      if (!ok) return false;
      if (deleteSelectionIfAny()) {
        refreshAfterMutation();
        return true;
      }
      return false;
    }, [copySelection, deleteSelectionIfAny, refreshAfterMutation]);

    /**
     * Iterate every paragraph in every section, indexOf-searching each
     * paragraph's text for the query. Builds a flat list of matches. Big
     * docs may take a few hundred ms — Phase 1 minimal. Future optimization:
     * incremental search per typed char, debounce, or maintain a section
     * text cache.
     */
    const runFindSearch = useCallback((query: string): void => {
      const doc = docRef.current;
      if (!doc || !query) {
        setFindMatches([]);
        setFindIndex(0);
        setFindHighlightsByPage({});
        return;
      }
      // Build the paragraph text cache on first run after the doc loads
      // (or after a mutation cleared it). Entries are stored already-
      // lowercased so the inner loop only needs indexOf on a primitive.
      if (!findTextCacheRef.current) {
        const cache = new Map<string, string>();
        try {
          const sectionCount = doc.getSectionCount();
          for (let s = 0; s < sectionCount; s++) {
            const paraCount = doc.getParagraphCount(s);
            for (let p = 0; p < paraCount; p++) {
              const text = doc.getTextRange(s, p, 0, 1_000_000);
              if (!text) continue;
              cache.set(`${s}:${p}`, text.toLowerCase());
            }
          }
        } catch (err) {
          console.warn('[studio] find cache build failed:', err);
        }
        findTextCacheRef.current = cache;
      }
      const lc = query.toLowerCase();
      const matches: {
        sectionIndex: number;
        paragraphIndex: number;
        offset: number;
        length: number;
      }[] = [];
      const cache = findTextCacheRef.current;
      for (const [key, haystack] of cache) {
        const colon = key.indexOf(':');
        const s = Number(key.slice(0, colon));
        const p = Number(key.slice(colon + 1));
        let from = 0;
        while (from <= haystack.length - lc.length) {
          const idx = haystack.indexOf(lc, from);
          if (idx === -1) break;
          matches.push({
            sectionIndex: s,
            paragraphIndex: p,
            offset: idx,
            length: query.length,
          });
          from = idx + Math.max(1, lc.length);
        }
      }
      setFindMatches(matches);
      setFindIndex(0);
    }, []);

    /**
     * Project the matches list to per-page rect overlays. The active match
     * (findIndex) is flagged so the renderer can color it differently.
     */
    const refreshFindHighlights = useCallback(
      (matches: typeof findMatches, activeIdx: number): void => {
        const doc = docRef.current;
        if (!doc || matches.length === 0) {
          setFindHighlightsByPage({});
          return;
        }
        const grouped: Record<
          number,
          {
            x: number;
            y: number;
            width: number;
            height: number;
            isActive: boolean;
          }[]
        > = {};
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          try {
            const rects = JSON.parse(
              doc.getSelectionRects(
                m.sectionIndex,
                m.paragraphIndex,
                m.offset,
                m.paragraphIndex,
                m.offset + m.length,
              ),
            ) as {
              pageIndex: number;
              x: number;
              y: number;
              width: number;
              height: number;
            }[];
            for (const r of rects) {
              (grouped[r.pageIndex] ??= []).push({
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                isActive: i === activeIdx,
              });
            }
          } catch {
            /* skip a paragraph that fails (no layout) */
          }
        }
        setFindHighlightsByPage(grouped);
      },
      [],
    );

    /**
     * Scroll the active match's page into view, set caret to the start of
     * the match. Called after navigation between matches.
     */
    const focusFindMatch = useCallback(
      (matches: typeof findMatches, idx: number): void => {
        const m = matches[idx];
        if (!m) return;
        const doc = docRef.current;
        if (!doc) return;
        // Move caret + selection to the match, so subsequent edits target it.
        caretRef.current = {
          sectionIndex: m.sectionIndex,
          paragraphIndex: m.paragraphIndex,
          charOffset: m.offset,
        };
        try {
          const rect = JSON.parse(
            doc.getCursorRect(m.sectionIndex, m.paragraphIndex, m.offset),
          ) as { pageIndex: number; x: number; y: number; height: number };
          const pageEl = pageRefsRef.current[rect.pageIndex];
          pageEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          setCursorRect(rect);
        } catch {
          /* keep previous */
        }
      },
      [],
    );

    const findNext = useCallback((): void => {
      if (findMatches.length === 0) return;
      const next = (findIndex + 1) % findMatches.length;
      setFindIndex(next);
      refreshFindHighlights(findMatches, next);
      focusFindMatch(findMatches, next);
    }, [findMatches, findIndex, refreshFindHighlights, focusFindMatch]);

    const findPrev = useCallback((): void => {
      if (findMatches.length === 0) return;
      const prev = (findIndex - 1 + findMatches.length) % findMatches.length;
      setFindIndex(prev);
      refreshFindHighlights(findMatches, prev);
      focusFindMatch(findMatches, prev);
    }, [findMatches, findIndex, refreshFindHighlights, focusFindMatch]);

    const openFind = useCallback((): void => {
      setFindOpen(true);
      // Prime with current selection text if any (so users can hit ⌘F to
      // search the selected word).
      const sel = selectionRef.current;
      if (sel) {
        const r = sortRange(sel.anchor, sel.focus);
        if (
          !r.empty &&
          r.startPara === r.endPara &&
          r.endOffset - r.startOffset < 200
        ) {
          const doc = docRef.current;
          if (doc) {
            try {
              const text = doc.getTextRange(
                sel.anchor.sectionIndex,
                r.startPara,
                r.startOffset,
                r.endOffset - r.startOffset,
              );
              if (text) {
                setFindQuery(text);
                runFindSearch(text);
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
      // Move focus to the input on next tick so the caret lands inside.
      setTimeout(() => findInputRef.current?.focus(), 0);
    }, [sortRange, runFindSearch]);

    const closeFind = useCallback((): void => {
      setFindOpen(false);
      setFindMatches([]);
      setFindIndex(0);
      setFindHighlightsByPage({});
      setReplaceFeedback(null);
      // Return focus to the scroll container so keyboard editing resumes.
      scrollRef.current?.focus();
    }, []);

    /**
     * Open the find bar with replace focused — chunk 7. Same surface as
     * `openFind` but shifts focus to the replace input. Triggered by
     * ⌘H / Ctrl+H or the Edit menu's "바꾸기…" entry.
     */
    const openReplace = useCallback((): void => {
      setFindOpen(true);
      setReplaceFeedback(null);
      setTimeout(() => replaceInputRef.current?.focus(), 0);
    }, []);

    /**
     * Run a single replace (replaceOne) or replace-all (replaceAll) on the
     * IR via @rhwp/core. We delegate to the library rather than splicing
     * matches ourselves so case-handling, multi-paragraph spans, and any
     * future regex/whole-word options stay consistent with what the lib
     * does internally.
     *
     * `replacementOverride` lets callers (e2e debug surface) inject a value
     * without first round-tripping through React state — same UI buttons
     * use the state-driven path with `undefined`.
     *
     * After the mutation:
     *   - Find paragraph cache is invalidated (text changed)
     *   - refreshAfterMutation re-reads page count + marks dirty
     *   - runFindSearch(query) re-fires to populate updated match list
     */
    const applyReplace = useCallback(
      (all: boolean, replacementOverride?: string): void => {
        const doc = docRef.current;
        if (!doc) return;
        const query = findQuery;
        if (query.length === 0) return;
        const replacement =
          replacementOverride !== undefined
            ? replacementOverride
            : replaceQuery;
        try {
          // Library is case-insensitive when the third arg is false — matches
          // our own find cache behavior (we lowercase both sides).
          const raw = all
            ? doc.replaceAll(query, replacement, false)
            : doc.replaceOne(query, replacement, false);
          // The IR returns a JSON status string; we parse defensively because
          // the lib doesn't expose a typed schema for this. The {count}
          // shape is what 0.7.9 returns; falling back to "1 match replaced"
          // for replaceOne keeps the UI honest if shape changes.
          let count = all ? null : 1;
          try {
            const parsed = JSON.parse(raw) as { count?: number };
            if (typeof parsed.count === 'number') count = parsed.count;
          } catch {
            /* ignore — feedback text falls back to a generic message */
          }
          // Invalidate the find text cache before re-running the search
          // — the cached lowercase strings still hold the old matches.
          findTextCacheRef.current = null;
          refreshAfterMutation();
          runFindSearch(query);
          setReplaceFeedback(
            count == null ? (all ? '모두 바꿈' : '바꿈') : `${count}건 바꿈`,
          );
        } catch (err) {
          console.warn('[studio] replace failed:', err);
          setReplaceFeedback(
            err instanceof Error ? `에러: ${err.message}` : '에러',
          );
        }
      },
      [findQuery, replaceQuery, refreshAfterMutation, runFindSearch],
    );

    const replaceCurrent = useCallback(
      (override?: string): void => applyReplace(false, override),
      [applyReplace],
    );
    const replaceAllMatches = useCallback(
      (override?: string): void => applyReplace(true, override),
      [applyReplace],
    );

    // Recompute highlight rects whenever matches or active index change.
    useEffect(() => {
      if (findOpen) {
        refreshFindHighlights(findMatches, findIndex);
      }
    }, [findOpen, findMatches, findIndex, refreshFindHighlights]);

    // After matches first arrive, jump to the first one.
    const matchCount = findMatches.length;
    useEffect(() => {
      if (findOpen && matchCount > 0) {
        focusFindMatch(findMatches, 0);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matchCount, findOpen]);

    /**
     * Paste at caret. If a selection is active it's deleted first
     * (matching standard editor UX). Source priority:
     *   1. System clipboard text matches internal clipboard text → use
     *      pasteInternal (preserves formatting for in-app round-trips)
     *   2. Else system clipboard plain text → insertText (lossy on rich
     *      sources but reliable cross-app)
     *   3. Else internal clipboard text only → pasteInternal
     */
    const pasteAtCaret = useCallback(async (): Promise<boolean> => {
      const doc = docRef.current;
      if (!doc) return false;
      try {
        if (deleteSelectionIfAny()) {
          // After deleteRange caret is at the start of the deleted range.
          const cc = JSON.parse(
            doc.getCaretPosition(),
          ) as typeof caretRef.current;
          caretRef.current = cc;
        }
        const c = caretRef.current;
        const systemText = await window.api.clipboard.readText();
        const hasInternal = doc.hasInternalClipboard();
        const internalText = hasInternal ? doc.getClipboardText() : '';
        const useInternal = hasInternal && systemText === internalText;
        if (useInternal) {
          const result = JSON.parse(
            doc.pasteInternal(c.sectionIndex, c.paragraphIndex, c.charOffset),
          ) as { ok: boolean; paraIdx: number; charOffset: number };
          if (result.ok) {
            // pasteInternal doesn't auto-advance the IR caret — sync ours.
            caretRef.current = {
              sectionIndex: c.sectionIndex,
              paragraphIndex: result.paraIdx,
              charOffset: result.charOffset,
            };
            refreshAfterMutation();
            return true;
          }
        }
        if (systemText) {
          doc.insertText(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
            systemText,
          );
          refreshAfterMutation();
          return true;
        }
        return false;
      } catch (err) {
        console.warn('[studio] paste failed:', err);
        return false;
      }
    }, [deleteSelectionIfAny, refreshAfterMutation]);

    /**
     * Capture the active selection as an excerpt — chunk 22 hoist.
     * Single-paragraph only (multi-paragraph excerpts need span anchors,
     * deferred to chunk 28). Lifted out of useImperativeHandle so the
     * HTML5 drag handler on selection rects can share it.
     */
    const captureExcerpt = useCallback((): {
      sectionIndex: number;
      startParagraphIndex: number;
      startOffset: number;
      endParagraphIndex: number;
      endOffset: number;
      text: string;
    } | null => {
      const doc = docRef.current;
      if (!doc) return null;
      const sel = selectionRef.current;
      if (!sel) return null;
      if (sel.anchor.sectionIndex !== sel.focus.sectionIndex) return null;
      const range = sortRange(sel.anchor, sel.focus);
      if (range.empty) return null;
      const sec = sel.anchor.sectionIndex;
      try {
        // chunk 28 — multi-paragraph spans. For the start paragraph
        // read [startOffset, paragraphEnd]; for the end paragraph read
        // [0, endOffset]; for paragraphs in between read the whole
        // text. Join with '\n' so the captured `text` round-trips
        // through prompt serialization with paragraph boundaries
        // visible to the model.
        const parts: string[] = [];
        if (range.startPara === range.endPara) {
          parts.push(
            doc.getTextRange(
              sec,
              range.startPara,
              range.startOffset,
              range.endOffset - range.startOffset,
            ),
          );
        } else {
          // First paragraph (offset → end of paragraph)
          const firstLen = doc.getParagraphLength(sec, range.startPara);
          parts.push(
            doc.getTextRange(
              sec,
              range.startPara,
              range.startOffset,
              Math.max(0, firstLen - range.startOffset),
            ),
          );
          // Middle paragraphs (whole text)
          for (let p = range.startPara + 1; p < range.endPara; p++) {
            const len = doc.getParagraphLength(sec, p);
            parts.push(doc.getTextRange(sec, p, 0, len));
          }
          // Last paragraph (0 → endOffset)
          if (range.endOffset > 0) {
            parts.push(
              doc.getTextRange(sec, range.endPara, 0, range.endOffset),
            );
          }
        }
        const text = parts.join('\n');
        if (text.length === 0) return null;
        return {
          sectionIndex: sec,
          startParagraphIndex: range.startPara,
          startOffset: range.startOffset,
          endParagraphIndex: range.endPara,
          endOffset: range.endOffset,
          text,
        };
      } catch (err) {
        console.warn('[studio] captureExcerpt failed:', err);
        return null;
      }
    }, [sortRange]);

    useImperativeHandle(
      ref,
      () => ({
        // exportHwp (CFB), not exportHwpx — see electron/hwp/converter.ts:
        // @rhwp/core v0.7.8's HWPX round-trip drops image references; HWP
        // round-trip preserves them.
        exportBytes: async () => {
          if (!docRef.current) throw new Error('Document not loaded');
          return docRef.current.exportHwp();
        },
        toggleCharFormat: (key: CharFormatKey) => {
          toggleCharFormat(key);
        },
        undo: () => undo(),
        canUndo: () => historyRef.current.index > 0,
        redo: () => redo(),
        copy: () => copySelection(),
        cut: () => cutSelection(),
        paste: () => pasteAtCaret(),
        openFind: () => openFind(),
        openReplace: () => openReplace(),
        applyAlignment: (a: ParaAlignment) => applyAlignment(a),
        applyFontSizePt: (pt: number) => applyFontSizePt(pt),
        applyTextColor: (hex: string) => applyTextColor(hex),
        getPageDef: (sectionIdx = 0) => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(doc.getPageDef(sectionIdx)) as Record<
              string,
              unknown
            >;
          } catch {
            return null;
          }
        },
        applyPageDef: (props, sectionIdx = 0) =>
          applyPageDef(props, sectionIdx),
        getHeaderFooter: (sectionIdx, isHeader, applyTo) => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(
              doc.getHeaderFooter(sectionIdx, isHeader, applyTo),
            ) as Record<string, unknown>;
          } catch {
            return null;
          }
        },
        setHeaderFooterText: (sectionIdx, isHeader, applyTo, text) =>
          setHeaderFooterText(sectionIdx, isHeader, applyTo, text),
        addBookmarkAtCaret: (name) => addBookmarkAtCaret(name),
        getBookmarks: () => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            const raw = JSON.parse(doc.getBookmarks()) as
              | Record<string, unknown>[]
              | { bookmarks?: Record<string, unknown>[] };
            if (Array.isArray(raw)) return raw;
            if (Array.isArray(raw?.bookmarks)) return raw.bookmarks;
            return null;
          } catch {
            return null;
          }
        },
        deleteBookmarkAt: (sec, para, ctrlIdx) =>
          deleteBookmarkAt(sec, para, ctrlIdx),
        renameBookmarkAt: (sec, para, ctrlIdx, newName) =>
          renameBookmarkAt(sec, para, ctrlIdx, newName),
        insertFootnoteAtCaret: (text) => insertFootnoteAtCaret(text),
        createNamedStyle: (name, englishName) =>
          createNamedStyle(name, englishName),
        renameStyle: (id, name, englishName) =>
          renameStyle(id, name, englishName),
        deleteStyleById: (id) => deleteStyleById(id),
        getStyleListJson: () => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(doc.getStyleList()) as Record<string, unknown>[];
          } catch {
            return null;
          }
        },
        renderEquationSvg: (script, fontSizeHwpunit = 1000, color = 0) =>
          renderEquationSvg(script, fontSizeHwpunit, color),
        createRectShapeAtCaret: (widthHwpunit, heightHwpunit, opts) =>
          createRectShapeAtCaret(widthHwpunit, heightHwpunit, opts),
        applyHtmlAtCaret: (html) => applyHtmlAtCaret(html),
        exportDocumentHtml: (maxParagraphs = 50) => {
          const doc = docRef.current;
          if (!doc) return '';
          try {
            const paraCount = doc.getParagraphCount(0);
            const lastPara = Math.min(paraCount - 1, maxParagraphs - 1);
            if (lastPara < 0) return '';
            // End offset: a sentinel large enough to cover any paragraph.
            return doc.exportSelectionHtml(0, 0, 0, lastPara, 1_000_000);
          } catch (err) {
            console.warn('[studio] exportDocumentHtml failed:', err);
            return '';
          }
        },
        isDirty: () => dirtyRef.current,
        getActiveCellContext: () => {
          const c = caretRef.current.cell;
          if (!c) return null;
          return {
            sectionIndex: caretRef.current.sectionIndex,
            parentParaIdx: c.parentParaIndex,
            controlIdx: c.controlIndex,
            cellIdx: c.cellIndex,
          };
        },
        getTableProps: (sec, parentPara, ctrl) =>
          getTableProps(sec, parentPara, ctrl),
        setTableProps: (sec, parentPara, ctrl, props) =>
          setTableProps(sec, parentPara, ctrl, props),
        getCellProps: (sec, parentPara, ctrl, cellIdx) =>
          getCellProps(sec, parentPara, ctrl, cellIdx),
        setCellProps: (sec, parentPara, ctrl, cellIdx, props) =>
          setCellProps(sec, parentPara, ctrl, cellIdx, props),
        applyCellStyle: (sec, parentPara, ctrl, cell, cellPara, styleId) => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(
              doc.applyCellStyle(
                sec,
                parentPara,
                ctrl,
                cell,
                cellPara,
                styleId,
              ),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch (err) {
            console.warn('[studio] applyCellStyle failed:', err);
            return false;
          }
        },
        evaluateTableFormula: (
          sec,
          parentPara,
          ctrl,
          targetRow,
          targetCol,
          formula,
          writeResult,
        ) => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            const json = doc.evaluateTableFormula(
              sec,
              parentPara,
              ctrl,
              targetRow,
              targetCol,
              formula,
              writeResult,
            );
            const parsed = JSON.parse(json) as Record<string, unknown>;
            // Only mark dirty if we actually wrote into the cell — pure
            // evaluation (preview) leaves the doc untouched.
            if (writeResult && parsed['ok']) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
            }
            return parsed;
          } catch (err) {
            console.warn('[studio] evaluateTableFormula failed:', err);
            return null;
          }
        },
        getPictureProps: (sec, parentPara, ctrl) => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(
              doc.getPictureProperties(sec, parentPara, ctrl),
            ) as Record<string, unknown>;
          } catch (err) {
            console.warn('[studio] getPictureProperties failed:', err);
            return null;
          }
        },
        setPictureProps: (sec, parentPara, ctrl, props) => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(
              doc.setPictureProperties(
                sec,
                parentPara,
                ctrl,
                JSON.stringify(props),
              ),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch (err) {
            console.warn('[studio] setPictureProperties failed:', err);
            return false;
          }
        },
        enumeratePictures: () => {
          const doc = docRef.current;
          if (!doc) return [];
          const out: {
            sectionIdx: number;
            parentParaIdx: number;
            controlIdx: number;
            label: string;
          }[] = [];
          // Section 0 only — multi-section enumeration left for when
          // the doc shell supports it (chunk 1 fixture has 1 section).
          let paraCount: number;
          try {
            paraCount = doc.getParagraphCount(0);
          } catch {
            return [];
          }
          for (let p = 0; p < paraCount; p++) {
            let raw: string;
            try {
              raw = doc.getControlTextPositions(0, p);
            } catch {
              continue;
            }
            let entries: { controlIdx?: number; controlIndex?: number }[];
            try {
              entries = JSON.parse(raw) as typeof entries;
              if (!Array.isArray(entries)) continue;
            } catch {
              continue;
            }
            for (const entry of entries) {
              const cidx =
                typeof entry.controlIdx === 'number'
                  ? entry.controlIdx
                  : typeof entry.controlIndex === 'number'
                    ? entry.controlIndex
                    : -1;
              if (cidx < 0) continue;
              // Probe by trying getPictureProperties — succeeds only
              // for picture controls. Cheaper than introducing a
              // separate kind-discrimination IR call.
              try {
                JSON.parse(doc.getPictureProperties(0, p, cidx));
                out.push({
                  sectionIdx: 0,
                  parentParaIdx: p,
                  controlIdx: cidx,
                  label: `단락 ${p} · ctrl ${cidx}`,
                });
              } catch {
                /* not a picture, skip */
              }
            }
          }
          return out;
        },
        deletePictureControl: (sec, parentPara, ctrl) => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(
              doc.deletePictureControl(sec, parentPara, ctrl),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch (err) {
            console.warn('[studio] deletePictureControl failed:', err);
            return false;
          }
        },
        beginUndoGroup: () => {
          undoGroupDepthRef.current += 1;
        },
        endUndoGroup: () => {
          undoGroupDepthRef.current = Math.max(
            0,
            undoGroupDepthRef.current - 1,
          );
          // Only push a snapshot when we exit the outermost group AND
          // some mutation actually ran (dirty flag flipped or layout
          // changed — pushHistory's saveSnapshot is cheap so we always
          // push at end-of-group).
          if (undoGroupDepthRef.current === 0) {
            pushHistory();
          }
        },
        copyControl: (sec, para, ctrl) => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(doc.copyControl(sec, para, ctrl)) as {
              ok?: boolean;
            };
            return Boolean(r.ok);
          } catch (err) {
            console.warn('[studio] copyControl failed:', err);
            return false;
          }
        },
        copyControlAtCaret: (): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          const c = caretRef.current;
          // Case 1: caret is inside a table cell — copy the table.
          if (c.cell) {
            try {
              const r = JSON.parse(
                doc.copyControl(
                  c.sectionIndex,
                  c.cell.parentParaIndex,
                  c.cell.controlIndex,
                ),
              ) as { ok?: boolean };
              return Boolean(r.ok);
            } catch {
              return false;
            }
          }
          // Case 2: caret is in body — try to find a control at the
          // current paragraph and copy the first one.
          try {
            const raw = doc.getControlTextPositions(
              c.sectionIndex,
              c.paragraphIndex,
            );
            const entries = JSON.parse(raw) as {
              controlIdx?: number;
              controlIndex?: number;
            }[];
            const first = entries[0];
            if (!first) return false;
            const cidx =
              typeof first.controlIdx === 'number'
                ? first.controlIdx
                : typeof first.controlIndex === 'number'
                  ? first.controlIndex
                  : -1;
            if (cidx < 0) return false;
            const r = JSON.parse(
              doc.copyControl(c.sectionIndex, c.paragraphIndex, cidx),
            ) as { ok?: boolean };
            return Boolean(r.ok);
          } catch {
            return false;
          }
        },
        pasteControlAtCurrentCaret: (): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          const c = caretRef.current;
          // pasteControl wants a body caret; if currently in a cell
          // we still target the caret's section/para/charOffset
          // (rhwp lets pasteControl work from any caret).
          try {
            const r = JSON.parse(
              doc.pasteControl(c.sectionIndex, c.paragraphIndex, c.charOffset),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        pasteControlAt: (sec, para, charOffset) => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(doc.pasteControl(sec, para, charOffset)) as {
              ok?: boolean;
            };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch (err) {
            console.warn('[studio] pasteControl failed:', err);
            return false;
          }
        },
        scrollToParagraph: (sectionIdx: number, paraIdx: number) => {
          const doc = docRef.current;
          if (!doc) return;
          try {
            caretRef.current = {
              sectionIndex: sectionIdx,
              paragraphIndex: paraIdx,
              charOffset: 0,
            };
            const rect = JSON.parse(
              doc.getCursorRect(sectionIdx, paraIdx, 0),
            ) as { pageIndex: number; x: number; y: number; height: number };
            const pageEl = pageRefsRef.current[rect.pageIndex];
            pageEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setCursorRect(rect);
          } catch (err) {
            console.warn('[studio] scrollToParagraph failed:', err);
          }
        },
        getOutline: () => {
          const doc = docRef.current;
          if (!doc) return [];
          const headingByStyleId = new Map<number, number>();
          for (const s of styleList) {
            const koMatch = s.name.match(/^제목\s*(\d+)?/);
            const enMatch = s.englishName?.match(/^Heading\s*(\d+)?/i);
            const m = koMatch ?? enMatch;
            if (m) {
              const level = m[1] ? Math.min(6, parseInt(m[1], 10)) : 1;
              headingByStyleId.set(s.id, level);
            }
          }
          if (headingByStyleId.size === 0) return [];
          const items: {
            paragraphIndex: number;
            level: number;
            text: string;
          }[] = [];
          try {
            const SECTION = 0;
            const paraCount = doc.getParagraphCount(SECTION);
            const cap = Math.min(paraCount, 1000);
            for (let p = 0; p < cap; p++) {
              const at = JSON.parse(doc.getStyleAt(SECTION, p)) as {
                id?: number;
              };
              if (typeof at.id !== 'number') continue;
              const level = headingByStyleId.get(at.id);
              if (!level) continue;
              const len = doc.getParagraphLength(SECTION, p);
              const text =
                len > 0
                  ? doc.getTextRange(SECTION, p, 0, Math.min(len, 200))
                  : '';
              items.push({
                paragraphIndex: p,
                level,
                text: text.trim() || '(제목 없음)',
              });
              if (items.length >= 200) break;
            }
          } catch (err) {
            console.warn('[studio] getOutline failed:', err);
          }
          return items;
        },
        snapshotParagraphs: () => {
          const doc = docRef.current;
          const map = new Map<number, string>();
          if (!doc) return map;
          try {
            const SECTION = 0;
            const paraCount = doc.getParagraphCount(SECTION);
            const cap = Math.min(paraCount, 1000);
            for (let p = 0; p < cap; p++) {
              const len = doc.getParagraphLength(SECTION, p);
              const text = len > 0 ? doc.getTextRange(SECTION, p, 0, len) : '';
              // Cheap fingerprint — length + first 40 + last 40 chars.
              // Collisions are rare enough at the para level for diff
              // visibility purposes.
              const fp = `${len}|${text.slice(0, 40)}|${text.slice(-40)}`;
              map.set(p, fp);
            }
          } catch (err) {
            console.warn('[studio] snapshotParagraphs failed:', err);
          }
          return map;
        },
        markChangedParagraphsSince: (before: Map<number, string>) => {
          const doc = docRef.current;
          if (!doc) return;
          const changed: number[] = [];
          try {
            const SECTION = 0;
            const paraCount = doc.getParagraphCount(SECTION);
            const cap = Math.min(paraCount, 1000);
            for (let p = 0; p < cap; p++) {
              const len = doc.getParagraphLength(SECTION, p);
              const text = len > 0 ? doc.getTextRange(SECTION, p, 0, len) : '';
              const fp = `${len}|${text.slice(0, 40)}|${text.slice(-40)}`;
              const prior = before.get(p);
              if (prior === undefined || prior !== fp) changed.push(p);
            }
          } catch (err) {
            console.warn('[studio] markChangedParagraphs failed:', err);
            return;
          }
          if (changed.length === 0) return;
          // Resolve each paragraph to per-page rects via
          // getSelectionRects(p, 0, p, len) — same path as the
          // selection highlight uses.
          const grouped: Record<
            number,
            { x: number; y: number; width: number; height: number }[]
          > = {};
          for (const p of changed) {
            try {
              const len = doc.getParagraphLength(0, p);
              if (len === 0) continue;
              const rects = JSON.parse(
                doc.getSelectionRects(0, p, 0, p, len),
              ) as {
                pageIndex: number;
                x: number;
                y: number;
                width: number;
                height: number;
              }[];
              for (const r of rects) {
                (grouped[r.pageIndex] ??= []).push({
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                });
              }
            } catch {
              /* skip — IR may have shifted */
            }
          }
          setChangedParaRects(grouped);
          if (changedParaTimerRef.current !== null) {
            window.clearTimeout(changedParaTimerRef.current);
          }
          changedParaTimerRef.current = window.setTimeout(() => {
            setChangedParaRects({});
            changedParaTimerRef.current = null;
          }, 15_000);
        },
        // chunk 20 — excerpt capture + stale verification. Selection
        // must be non-empty AND single-paragraph; multi-paragraph
        // excerpts need a span anchor model that the IR's
        // getTextRange (single-para) doesn't support yet.
        captureExcerpt,
        verifyExcerpt: (anchor, expected) => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            const sec = anchor.sectionIndex;
            const paraCount = doc.getParagraphCount(sec);
            // Bounds check on both ends — paragraphs may have been deleted.
            if (
              anchor.startParagraphIndex >= paraCount ||
              anchor.endParagraphIndex >= paraCount ||
              anchor.startParagraphIndex > anchor.endParagraphIndex
            ) {
              const relocated = relocateExcerpt(doc, expected);
              return relocated
                ? { status: 'stale-relocated', newAnchor: relocated }
                : { status: 'stale-missing' };
            }
            // Re-read the slice the same way captureExcerpt did, then
            // compare to expected. Mismatch falls into relocation. The
            // relocator only handles single-paragraph hits (rare for
            // multi-para excerpts), so spans that move tend to surface
            // as stale-missing — acceptable: user re-selects.
            const parts: string[] = [];
            if (anchor.startParagraphIndex === anchor.endParagraphIndex) {
              const paraLen = doc.getParagraphLength(
                sec,
                anchor.startParagraphIndex,
              );
              if (anchor.endOffset > paraLen) {
                const relocated = relocateExcerpt(doc, expected);
                return relocated
                  ? { status: 'stale-relocated', newAnchor: relocated }
                  : { status: 'stale-missing' };
              }
              parts.push(
                doc.getTextRange(
                  sec,
                  anchor.startParagraphIndex,
                  anchor.startOffset,
                  anchor.endOffset - anchor.startOffset,
                ),
              );
            } else {
              const firstLen = doc.getParagraphLength(
                sec,
                anchor.startParagraphIndex,
              );
              if (anchor.startOffset > firstLen) {
                return { status: 'stale-missing' };
              }
              parts.push(
                doc.getTextRange(
                  sec,
                  anchor.startParagraphIndex,
                  anchor.startOffset,
                  Math.max(0, firstLen - anchor.startOffset),
                ),
              );
              for (
                let p = anchor.startParagraphIndex + 1;
                p < anchor.endParagraphIndex;
                p++
              ) {
                const len = doc.getParagraphLength(sec, p);
                parts.push(doc.getTextRange(sec, p, 0, len));
              }
              const endLen = doc.getParagraphLength(
                sec,
                anchor.endParagraphIndex,
              );
              if (anchor.endOffset > endLen) {
                return { status: 'stale-missing' };
              }
              if (anchor.endOffset > 0) {
                parts.push(
                  doc.getTextRange(
                    sec,
                    anchor.endParagraphIndex,
                    0,
                    anchor.endOffset,
                  ),
                );
              }
            }
            const current = parts.join('\n');
            if (current === expected) return { status: 'fresh' };
            const relocated = relocateExcerpt(doc, expected);
            return relocated
              ? { status: 'stale-relocated', newAnchor: relocated }
              : { status: 'stale-missing' };
          } catch (err) {
            console.warn('[studio] verifyExcerpt failed:', err);
            return null;
          }
        },
      }),
      [
        captureExcerpt,
        getCellProps,
        getTableProps,
        pushHistory,
        refreshAfterMutation,
        setCellProps,
        setTableProps,
        toggleCharFormat,
        undo,
        redo,
        copySelection,
        cutSelection,
        pasteAtCaret,
        openFind,
        openReplace,
        applyAlignment,
        applyFontSizePt,
        applyTextColor,
        applyPageDef,
        setHeaderFooterText,
        addBookmarkAtCaret,
        deleteBookmarkAt,
        renameBookmarkAt,
        insertFootnoteAtCaret,
        createNamedStyle,
        renameStyle,
        deleteStyleById,
        renderEquationSvg,
        createRectShapeAtCaret,
        applyHtmlAtCaret,
        styleList,
      ],
    );

    /**
     * Compute word bounds around a char offset within a paragraph. A "word"
     * here is a contiguous run of non-whitespace, non-punctuation chars.
     * Works for ASCII and Korean/CJK because we exclude whitespace and
     * Unicode punctuation rather than relying on \w (ASCII-only).
     */
    const findWordBoundsAt = useCallback(
      (
        sec: number,
        para: number,
        offset: number,
      ): { startOffset: number; endOffset: number } | null => {
        const doc = docRef.current;
        if (!doc) return null;
        try {
          const len = doc.getParagraphLength(sec, para);
          if (len === 0) return { startOffset: 0, endOffset: 0 };
          const text = doc.getTextRange(sec, para, 0, len);
          if (!text) return { startOffset: 0, endOffset: 0 };
          const isSep = (ch: string): boolean => /[\s\p{P}\p{S}]/u.test(ch);
          const probe = Math.min(Math.max(0, offset), text.length);
          if (probe < text.length && isSep(text[probe])) {
            return { startOffset: probe, endOffset: probe };
          }
          let s = probe;
          while (s > 0 && !isSep(text[s - 1])) s--;
          let e = probe;
          while (e < text.length && !isSep(text[e])) e++;
          return { startOffset: s, endOffset: e };
        } catch {
          return null;
        }
      },
      [],
    );

    /**
     * Step the offset by one word in a direction (-1 = backward, +1 = forward).
     * Used by Cmd/Ctrl+Shift+Arrow word-wise selection extend.
     */
    const stepWordOffset = useCallback(
      (sec: number, para: number, offset: number, dir: -1 | 1): number => {
        const doc = docRef.current;
        if (!doc) return offset;
        try {
          const len = doc.getParagraphLength(sec, para);
          if (len === 0) return offset;
          const text = doc.getTextRange(sec, para, 0, len);
          if (!text) return offset;
          const isSep = (ch: string): boolean => /[\s\p{P}\p{S}]/u.test(ch);
          let i = Math.min(Math.max(0, offset), text.length);
          if (dir === 1) {
            while (i < text.length && isSep(text[i])) i++;
            while (i < text.length && !isSep(text[i])) i++;
          } else {
            while (i > 0 && isSep(text[i - 1])) i--;
            while (i > 0 && !isSep(text[i - 1])) i--;
          }
          return i;
        } catch {
          return offset;
        }
      },
      [],
    );

    /**
     * Caret-move helper used by every nav branch in `handleKeyDown`. Handles
     * the four pieces every move repeats: (1) update caretRef, (2) extend
     * the existing selection when shift is held (or anchor a new one at
     * `prior` if there was none), (3) collapse any selection on plain nav,
     * (4) refresh the visual cursor + toolbar pressed-state.
     *
     * Replaces ~6 inline copies of the same pattern; future nav bindings
     * (PageUp/Down with caret movement, etc.) plug in here too. The keymap
     * dispatch-table refactor (P2-1 ROADMAP) is the bigger move; this is a
     * proof-of-concept that the pattern extracts cleanly.
     */
    const commitCaretMove = useCallback(
      (
        nextCaret: {
          sectionIndex: number;
          paragraphIndex: number;
          charOffset: number;
        },
        prior: {
          sectionIndex: number;
          paragraphIndex: number;
          charOffset: number;
        },
        shift: boolean,
        sel0: typeof selection,
      ): void => {
        caretRef.current = { ...caretRef.current, ...nextCaret };
        if (shift) {
          const sel = sel0 ?? { anchor: prior, focus: prior };
          const next = { ...sel, focus: nextCaret };
          setSelection(next);
          refreshSelectionRects(next);
        } else if (sel0) {
          clearSelection();
        }
        refreshCursorRect();
        refreshActiveFormat();
      },
      [
        clearSelection,
        refreshActiveFormat,
        refreshCursorRect,
        refreshSelectionRects,
        setSelection,
      ],
    );

    /**
     * Keyboard input. ASCII typing routes through here; Korean IME composition
     * routes through `compositionend` (the browser delivers the final composed
     * string in `event.data`). Caret nav (arrow keys / Home) is local to our
     * caretRef — `@rhwp/core` has no public cursor-move API.
     */
    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>): void => {
        // Skip composing keystrokes — the IME owns them, and compositionend
        // will deliver the final text. keyCode 229 is the historical signal
        // for "IME is processing this key" on browsers that haven't set
        // isComposing yet.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;

        const doc = docRef.current;
        if (!doc) return;
        const c = caretRef.current;

        // Caret navigation — purely local. No doc API for cursor movement;
        // we adjust charOffset and recompute cursorRect via getCursorRect.
        // Shift+arrow extends selection (creates one if none), plain arrow
        // collapses any selection to the new caret position.
        // Read from selectionRef rather than the closure'd state so we
        // see updates from external drivers (e2e debug API) before the
        // next render attaches a fresh handler.
        const sel0 = selectionRef.current;
        // Word-wise navigation: Cmd/Ctrl + (Shift?) + Arrow Left/Right
        // moves the caret to the prev/next word boundary. With Shift this
        // extends the current selection. Without Shift it collapses any
        // selection to the new position.
        const isWordKey =
          (e.metaKey || e.ctrlKey) &&
          !e.altKey &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight');
        if (isWordKey) {
          const dir: -1 | 1 = e.key === 'ArrowLeft' ? -1 : 1;
          const nextOff = stepWordOffset(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
            dir,
          );
          commitCaretMove({ ...c, charOffset: nextOff }, c, e.shiftKey, sel0);
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowLeft') {
          if (c.charOffset > 0) {
            commitCaretMove(
              { ...c, charOffset: c.charOffset - 1 },
              c,
              e.shiftKey,
              sel0,
            );
          } else if (!e.shiftKey && sel0) {
            clearSelection();
          }
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowRight') {
          commitCaretMove(
            { ...c, charOffset: c.charOffset + 1 },
            c,
            e.shiftKey,
            sel0,
          );
          e.preventDefault();
          return;
        }
        // Visual-line ArrowUp/Down — IR has no line concept (paragraphs may
        // wrap), so we walk via cursor geometry: take the current cursor
        // rect, step y by ±lineHeight, and hitTest the same x to find the
        // offset on the previous/next visual line. Falls through to the
        // adjacent page when stepping off the current page's bounds.
        // In-cell caret is not yet supported here — cells use a separate
        // hit-test path; punt to no-op until cell-line nav v2.
        if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !c.cell) {
          const rect = cursorRect;
          if (!rect) {
            e.preventDefault();
            return;
          }
          const dirDown = e.key === 'ArrowDown';
          // Step half a line height past the line so we land squarely in the
          // adjacent line, not on the boundary.
          const step = rect.height * 1.4;
          let targetPage = rect.pageIndex;
          let targetY = dirDown ? rect.y + step : rect.y - step;
          const pageH = pageDims?.h ?? 0;
          if (dirDown && targetY > pageH && targetPage + 1 < pageCount) {
            targetPage += 1;
            targetY = targetY - pageH;
          } else if (!dirDown && targetY < 0 && targetPage > 0) {
            targetPage -= 1;
            targetY = pageH + targetY;
          }
          let hit: {
            sectionIndex: number;
            paragraphIndex: number;
            charOffset: number;
          } | null;
          try {
            hit = JSON.parse(doc.hitTest(targetPage, rect.x, targetY)) as {
              sectionIndex: number;
              paragraphIndex: number;
              charOffset: number;
            };
          } catch {
            hit = null;
          }
          if (hit) {
            commitCaretMove(
              {
                sectionIndex: hit.sectionIndex,
                paragraphIndex: hit.paragraphIndex,
                charOffset: hit.charOffset,
              },
              c,
              e.shiftKey,
              sel0,
            );
          }
          e.preventDefault();
          return;
        }
        // Esc during an active mouse drag — cancel and roll back the
        // selection to its pre-drag state. Also closes the find bar
        // (handled separately further below if Find is open).
        if (e.key === 'Escape' && draggingRef.current) {
          dragCleanupRef.current?.();
          dragCleanupRef.current = null;
          draggingRef.current = false;
          const origin = dragOriginSelectionRef.current;
          if (origin) {
            setSelection(origin);
            refreshSelectionRects(origin);
          } else {
            clearSelection();
          }
          dragOriginSelectionRef.current = null;
          e.preventDefault();
          return;
        }
        if (e.key === 'Home') {
          // Cmd/Ctrl + Home → jump to start of document (chunk 12).
          if (e.metaKey || e.ctrlKey) {
            commitCaretMove(
              { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 },
              c,
              e.shiftKey,
              sel0,
            );
            scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            e.preventDefault();
            return;
          }
          // Plain Home → start of current line/paragraph.
          commitCaretMove({ ...c, charOffset: 0 }, c, e.shiftKey, sel0);
          e.preventDefault();
          return;
        }
        if (e.key === 'End') {
          // Cmd/Ctrl + End → jump to end of document.
          if (e.metaKey || e.ctrlKey) {
            try {
              const lastSec = doc.getSectionCount() - 1;
              const lastPara = doc.getParagraphCount(lastSec) - 1;
              const lastOffset = doc.getParagraphLength(lastSec, lastPara);
              commitCaretMove(
                {
                  sectionIndex: lastSec,
                  paragraphIndex: lastPara,
                  charOffset: lastOffset,
                },
                c,
                e.shiftKey,
                sel0,
              );
              const scroll = scrollRef.current;
              if (scroll) {
                scroll.scrollTo({
                  top: scroll.scrollHeight,
                  behavior: 'smooth',
                });
              }
            } catch (err) {
              console.warn('[studio] cmd+end nav failed:', err);
            }
            e.preventDefault();
            return;
          }
          // Plain End → end of current paragraph.
          try {
            const len = doc.getParagraphLength(
              c.sectionIndex,
              c.paragraphIndex,
            );
            commitCaretMove({ ...c, charOffset: len }, c, e.shiftKey, sel0);
          } catch {
            /* keep caret */
          }
          e.preventDefault();
          return;
        }
        if (e.key === 'PageUp' || e.key === 'PageDown') {
          // Page Up/Down — scroll the viewer by one viewport height. We
          // don't try to move the caret in lockstep (text-flow heuristics
          // would be needed); the user can click to reposition after.
          const scroll = scrollRef.current;
          if (scroll) {
            const delta =
              e.key === 'PageDown' ? scroll.clientHeight : -scroll.clientHeight;
            scroll.scrollBy({ top: delta, behavior: 'smooth' });
          }
          e.preventDefault();
          return;
        }

        // Undo / Redo: Cmd/Ctrl + Z (undo), Cmd/Ctrl + Shift + Z (redo).
        // Cmd+Y is a Windows alternative for redo — accept it too.
        if ((e.metaKey || e.ctrlKey) && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === 'z') {
            if (e.shiftKey) {
              redo();
            } else {
              undo();
            }
            e.preventDefault();
            return;
          }
          if (k === 'y' && !e.shiftKey) {
            redo();
            e.preventDefault();
            return;
          }
          // Clipboard shortcuts. Use void to discard the promise — keydown
          // returns synchronously; the actual op completes asynchronously.
          if (!e.shiftKey && k === 'c') {
            void copySelection();
            e.preventDefault();
            return;
          }
          if (!e.shiftKey && k === 'x') {
            void cutSelection();
            e.preventDefault();
            return;
          }
          if (!e.shiftKey && k === 'v') {
            void pasteAtCaret();
            e.preventDefault();
            return;
          }
          if (!e.shiftKey && k === 'f') {
            openFind();
            e.preventDefault();
            return;
          }
          if (!e.shiftKey && k === 'h') {
            openReplace();
            e.preventDefault();
            return;
          }
          // Cmd/Ctrl+A — select all body text in the active section.
          // Without preventDefault the browser falls back to selecting
          // every text node in the chrome (toolbar, sidebar, status bar);
          // user-visible symptom is "the whole program flashes blue."
          // We restrict to section 0 because the IR's selection model is
          // single-section. Multi-section docs are rare in practice.
          if (!e.shiftKey && k === 'a') {
            try {
              const sec = c.sectionIndex;
              const lastPara = doc.getParagraphCount(sec) - 1;
              if (lastPara < 0) {
                e.preventDefault();
                return;
              }
              const lastOffset = doc.getParagraphLength(sec, lastPara);
              const start = {
                sectionIndex: sec,
                paragraphIndex: 0,
                charOffset: 0,
              };
              const end = {
                sectionIndex: sec,
                paragraphIndex: lastPara,
                charOffset: lastOffset,
              };
              caretRef.current = end;
              setSelection({ anchor: start, focus: end });
              refreshSelectionRects({ anchor: start, focus: end });
              refreshCursorRect();
              refreshActiveFormat();
            } catch (err) {
              console.warn('[studio] select-all failed:', err);
            }
            e.preventDefault();
            return;
          }
        }

        // Format shortcuts: Cmd/Ctrl + B/I/U toggle the current paragraph.
        // Must come before the generic modifier early-return.
        if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
          const k = e.key.toLowerCase();
          if (k === 'b' || k === 'i' || k === 'u') {
            toggleCharFormat(
              k === 'b' ? 'bold' : k === 'i' ? 'italic' : 'underline',
            );
            e.preventDefault();
            return;
          }
        }

        // Tab / Shift+Tab — when the caret is inside a table cell, jump
        // to the next / previous cell. Outside a cell we let the default
        // (focus traversal) happen.
        if (
          e.key === 'Tab' &&
          c.cell &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey
        ) {
          const dir = e.shiftKey ? -1 : 1;
          try {
            const dims = JSON.parse(
              doc.getTableDimensions(
                c.sectionIndex,
                c.cell.parentParaIndex,
                c.cell.controlIndex,
              ),
            ) as { rowCount: number; colCount: number; cellCount: number };
            const total = dims.cellCount;
            const next = (((c.cell.cellIndex + dir) % total) + total) % total;
            const nextCaret = {
              ...c,
              charOffset: 0,
              cell: { ...c.cell, cellIndex: next, cellParaIndex: 0 },
            };
            caretRef.current = nextCaret;
            refreshCursorRect();
          } catch {
            /* table not available — fall through */
          }
          e.preventDefault();
          return;
        }

        // Don't intercept other browser shortcuts (Ctrl+S, Cmd+R, etc.).
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'Backspace') {
          if (deleteSelectionIfAny()) {
            refreshAfterMutation();
          } else if (c.charOffset > 0) {
            deleteAtCaret(c.charOffset - 1, 1);
            refreshAfterMutation({ syncCaret: !c.cell });
          }
          e.preventDefault();
        } else if (e.key === 'Delete') {
          if (deleteSelectionIfAny()) {
            refreshAfterMutation();
          } else {
            try {
              deleteAtCaret(c.charOffset, 1);
              refreshAfterMutation({ syncCaret: !c.cell });
            } catch {
              /* ignore — past end */
            }
          }
          e.preventDefault();
        } else if (e.key === 'Enter') {
          if (deleteSelectionIfAny()) {
            // After delete, caret is at the start of the previous selection.
            // Selection currently can't span into a cell (v1) so we use the
            // outer insertText here and re-read the IR caret.
            const cc = JSON.parse(
              doc.getCaretPosition(),
            ) as typeof caretRef.current;
            doc.insertText(
              cc.sectionIndex,
              cc.paragraphIndex,
              cc.charOffset,
              '\n',
            );
          } else {
            insertAtCaret('\n');
          }
          refreshAfterMutation({ syncCaret: !c.cell });
          e.preventDefault();
        } else if (
          e.key === '/' &&
          !c.cell &&
          c.charOffset === 0 &&
          (() => {
            try {
              return (
                doc.getParagraphLength(c.sectionIndex, c.paragraphIndex) === 0
              );
            } catch {
              return false;
            }
          })()
        ) {
          // chunk 64 — slash menu. Opening on an empty body paragraph
          // means the literal `/` never enters the IR. The menu's
          // command picker calls back into ViewerHandle methods
          // (applyStyle / toggleList / insertPageBreak) that already
          // know how to operate on the current caret.
          const rect = cursorRect;
          if (rect) {
            const pageEl = pageRefsRef.current[rect.pageIndex];
            const pr = pageEl?.getBoundingClientRect();
            const x = (pr?.left ?? 0) + rect.x * zoom;
            const y = (pr?.top ?? 0) + (rect.y + rect.height) * zoom + 4;
            setSlashMenu({
              x,
              y,
              sectionIndex: c.sectionIndex,
              paragraphIndex: c.paragraphIndex,
            });
            e.preventDefault();
            return;
          }
          // No cursor rect yet (rare) — fall through to literal `/`.
        }
        if (e.key.length === 1) {
          // Single printable char, no modifier — ASCII fast path. Korean
          // IME composition is handled by compositionend; we won't reach
          // this branch with isComposing=true.
          if (deleteSelectionIfAny()) {
            const cc = JSON.parse(
              doc.getCaretPosition(),
            ) as typeof caretRef.current;
            doc.insertText(
              cc.sectionIndex,
              cc.paragraphIndex,
              cc.charOffset,
              e.key,
            );
          } else {
            insertAtCaret(e.key);
          }
          refreshAfterMutation({ syncCaret: !c.cell });
          e.preventDefault();
        }
      },
      [
        refreshAfterMutation,
        refreshCursorRect,
        refreshActiveFormat,
        toggleCharFormat,
        clearSelection,
        refreshSelectionRects,
        deleteSelectionIfAny,
        setSelection,
        undo,
        redo,
        copySelection,
        cutSelection,
        pasteAtCaret,
        openFind,
        openReplace,
        stepWordOffset,
        insertAtCaret,
        deleteAtCaret,
        cursorRect,
        pageDims,
        pageCount,
        commitCaretMove,
        zoom,
      ],
    );

    const handleCompositionStart = useCallback(() => {
      composingRef.current = true;
    }, []);

    const handleCompositionEnd = useCallback(
      (e: ReactCompositionEvent<HTMLDivElement>) => {
        composingRef.current = false;
        const text = e.data;
        const doc = docRef.current;
        if (!text || !doc) return;
        try {
          if (deleteSelectionIfAny()) {
            const cc = JSON.parse(
              doc.getCaretPosition(),
            ) as typeof caretRef.current;
            doc.insertText(
              cc.sectionIndex,
              cc.paragraphIndex,
              cc.charOffset,
              text,
            );
            refreshAfterMutation();
          } else {
            const inCell = !!caretRef.current.cell;
            insertAtCaret(text);
            refreshAfterMutation({ syncCaret: !inCell });
          }
        } catch (err) {
          console.warn('[studio] compositionend insertText failed:', err);
        }
      },
      [refreshAfterMutation, deleteSelectionIfAny, insertAtCaret],
    );

    /**
     * hitTest the click coords (page-local SVG space, zoom-adjusted) and
     * return the resulting caret. Returns null if the test failed.
     *
     * The doc populates `parentParaIndex` / `controlIndex` / `cellIndex` /
     * `cellParaIndex` when the click lands inside a table cell — those
     * fields are absent for plain-text clicks.
     */
    interface HitTestResult {
      sectionIndex: number;
      paragraphIndex: number;
      charOffset: number;
      parentParaIndex?: number;
      controlIndex?: number;
      cellIndex?: number;
      cellParaIndex?: number;
      cursorRect?: {
        pageIndex: number;
        x: number;
        y: number;
        height: number;
      };
    }
    const hitTestAt = useCallback(
      (
        idx: number,
        clientX: number,
        clientY: number,
        target: HTMLElement,
      ): HitTestResult | null => {
        const doc = docRef.current;
        if (!doc) return null;
        const rect = target.getBoundingClientRect();
        const x = (clientX - rect.left) / zoom;
        const y = (clientY - rect.top) / zoom;
        try {
          return JSON.parse(doc.hitTest(idx, x, y)) as HitTestResult;
        } catch (err) {
          console.warn('[studio] hitTest failed:', err);
          return null;
        }
      },
      [zoom],
    );

    /**
     * mousedown on a page: hitTest → set caret + clear any prior selection
     * + start drag. anchor/focus both initialized to the clicked caret;
     * mousemove updates focus.
     *
     * Click-count behavior:
     *   1 — caret-only (existing)
     *   2 — select the word at the click position
     *   3 — select the entire paragraph
     */
    const handlePageMouseDown = useCallback(
      (idx: number, e: ReactMouseEvent<HTMLDivElement>): void => {
        if (e.button !== 0) return; // primary only
        // Move focus to the scroll container so subsequent keystrokes
        // (Ctrl+A, arrow keys, etc.) hit our `handleKeyDown` instead of
        // whatever button/input was last focused. Without this, Ctrl+A
        // falls through to the browser default and selects every visible
        // text node in the chrome.
        scrollRef.current?.focus({ preventScroll: true });
        // Snapshot caret BEFORE we mutate caretRef below — Shift+click
        // without prior selection anchors at this position.
        const priorCaret = { ...caretRef.current };
        const result = hitTestAt(idx, e.clientX, e.clientY, e.currentTarget);
        if (!result) return;
        // Cell info present when the click lands inside a table cell.
        const cell =
          result.controlIndex !== undefined &&
          result.cellIndex !== undefined &&
          result.cellParaIndex !== undefined &&
          result.parentParaIndex !== undefined
            ? {
                parentParaIndex: result.parentParaIndex,
                controlIndex: result.controlIndex,
                cellIndex: result.cellIndex,
                cellParaIndex: result.cellParaIndex,
              }
            : undefined;
        const baseCaret = {
          sectionIndex: result.sectionIndex,
          paragraphIndex: result.paragraphIndex,
          charOffset: result.charOffset,
          cell,
        };
        // For now, double/triple-click + drag-select are disabled when
        // the click lands in a cell — selection model in cells is v2.
        if (cell) {
          caretRef.current = baseCaret;
          if (result.cursorRect) {
            setCursorRect(result.cursorRect);
          } else {
            refreshCursorRect();
          }
          // Cell formatting follow-up (v2): for now we just clear the
          // outer selection so existing format toggles don't accidentally
          // apply to outer paragraphs while the caret is in a cell.
          setSelection(null);
          setSelectionRectsByPage({});
          draggingRef.current = false;
          return;
        }
        if (e.detail === 3) {
          // Triple click → entire paragraph.
          const doc = docRef.current;
          if (doc) {
            try {
              const len = doc.getParagraphLength(
                baseCaret.sectionIndex,
                baseCaret.paragraphIndex,
              );
              const start = { ...baseCaret, charOffset: 0 };
              const end = { ...baseCaret, charOffset: len };
              caretRef.current = end;
              setSelection({ anchor: start, focus: end });
              refreshSelectionRects({ anchor: start, focus: end });
              refreshCursorRect();
              refreshActiveFormat();
              draggingRef.current = false;
              return;
            } catch {
              /* fall through to single-click default */
            }
          }
        }
        if (e.detail === 2) {
          // Double click → word at offset.
          const w = findWordBoundsAt(
            baseCaret.sectionIndex,
            baseCaret.paragraphIndex,
            baseCaret.charOffset,
          );
          if (w && w.endOffset > w.startOffset) {
            const start = { ...baseCaret, charOffset: w.startOffset };
            const end = { ...baseCaret, charOffset: w.endOffset };
            caretRef.current = end;
            setSelection({ anchor: start, focus: end });
            refreshSelectionRects({ anchor: start, focus: end });
            refreshCursorRect();
            refreshActiveFormat();
            draggingRef.current = false;
            return;
          }
        }
        caretRef.current = baseCaret;
        if (result.cursorRect) {
          setCursorRect(result.cursorRect);
        } else {
          refreshCursorRect();
        }
        refreshActiveFormat();
        // Shift+click extends the existing selection (or creates one
        // anchored at the previous caret) — matches Word/한컴/PDF readers.
        // Plain click resets the selection.
        const sel0 = selectionRef.current;
        const initSel =
          e.shiftKey && sel0
            ? { anchor: sel0.anchor, focus: baseCaret }
            : e.shiftKey
              ? { anchor: priorCaret, focus: baseCaret }
              : { anchor: baseCaret, focus: baseCaret };
        // Capture the pre-drag selection so Esc can revert.
        dragOriginSelectionRef.current = e.shiftKey && sel0 ? sel0 : null;
        setSelection(initSel);
        if (e.shiftKey) {
          refreshSelectionRects(initSel);
        } else {
          setSelectionRectsByPage({});
        }
        draggingRef.current = true;

        // PDF-style drag: attach window-level listeners so the drag survives
        // (a) crossing the gap between pages, (b) leaving the scroll
        // container, and (c) mouseup outside any page. Without these, the
        // per-page `onMouseLeave` would prematurely commit the selection
        // the moment the cursor left the originating page.
        const lastClient = { x: e.clientX, y: e.clientY };
        let autoScrollRaf: number | null = null;
        const AUTO_SCROLL_ZONE = 36; // px from edge that triggers scroll
        const AUTO_SCROLL_MAX_SPEED = 24; // px per frame at edge
        const tickAutoScroll = (): void => {
          autoScrollRaf = null;
          if (!draggingRef.current) return;
          const scroller = scrollRef.current;
          if (!scroller) return;
          const sr = scroller.getBoundingClientRect();
          let dy = 0;
          if (lastClient.y < sr.top + AUTO_SCROLL_ZONE) {
            const ratio = Math.min(
              1,
              (sr.top + AUTO_SCROLL_ZONE - lastClient.y) / AUTO_SCROLL_ZONE,
            );
            dy = -Math.ceil(ratio * AUTO_SCROLL_MAX_SPEED);
          } else if (lastClient.y > sr.bottom - AUTO_SCROLL_ZONE) {
            const ratio = Math.min(
              1,
              (lastClient.y - (sr.bottom - AUTO_SCROLL_ZONE)) /
                AUTO_SCROLL_ZONE,
            );
            dy = Math.ceil(ratio * AUTO_SCROLL_MAX_SPEED);
          }
          if (dy !== 0) {
            scroller.scrollBy({ top: dy });
            // Re-trigger hit-test against the new scroll position so the
            // selection grows even when the user holds the mouse still
            // near the edge.
            applyPointerToSelection(lastClient.x, lastClient.y);
            autoScrollRaf = requestAnimationFrame(tickAutoScroll);
          }
        };
        const applyPointerToSelection = (cx: number, cy: number): void => {
          const refs = pageRefsRef.current;
          let pageIdx = -1;
          let pageEl: HTMLElement | null = null;
          for (let i = 0; i < refs.length; i++) {
            const el = refs[i];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            if (cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom) {
              pageIdx = i;
              pageEl = el;
              break;
            }
          }
          if (pageIdx < 0 || !pageEl) return;
          const moveResult = hitTestAt(pageIdx, cx, cy, pageEl);
          if (!moveResult) return;
          const focus = {
            sectionIndex: moveResult.sectionIndex,
            paragraphIndex: moveResult.paragraphIndex,
            charOffset: moveResult.charOffset,
          };
          caretRef.current = focus;
          if (moveResult.cursorRect) setCursorRect(moveResult.cursorRect);
          setSelection((prev) => {
            if (!prev) return null;
            const next = { ...prev, focus };
            refreshSelectionRects(next);
            return next;
          });
        };
        const onWinMove = (ev: MouseEvent): void => {
          if (!draggingRef.current) return;
          lastClient.x = ev.clientX;
          lastClient.y = ev.clientY;
          applyPointerToSelection(ev.clientX, ev.clientY);
          // Auto-scroll if the cursor is close to the scroll container's
          // top/bottom edge. We only kick the rAF loop when not already
          // running; the loop self-renews while the cursor stays in zone.
          if (autoScrollRaf === null) {
            autoScrollRaf = requestAnimationFrame(tickAutoScroll);
          }
        };
        const cleanup = (): void => {
          document.removeEventListener('mousemove', onWinMove);
          document.removeEventListener('mouseup', onWinUp);
          if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf);
          autoScrollRaf = null;
          dragCleanupRef.current = null;
        };
        const onWinUp = (): void => {
          cleanup();
          if (!draggingRef.current) return;
          draggingRef.current = false;
          dragOriginSelectionRef.current = null;
          setSelection((prev) => {
            if (!prev) return null;
            const empty =
              prev.anchor.paragraphIndex === prev.focus.paragraphIndex &&
              prev.anchor.charOffset === prev.focus.charOffset;
            if (empty) {
              setSelectionRectsByPage({});
              return null;
            }
            return prev;
          });
          // Sync toolbar to the focus position once the drag commits.
          refreshActiveFormat();
        };
        dragCleanupRef.current = cleanup;
        document.addEventListener('mousemove', onWinMove);
        document.addEventListener('mouseup', onWinUp);
      },
      [
        hitTestAt,
        refreshCursorRect,
        refreshActiveFormat,
        setSelection,
        findWordBoundsAt,
        refreshSelectionRects,
      ],
    );

    /**
     * Right-click on a page →
     *   1. If it lands inside a table cell, open the cell context menu.
     *   2. Else if there's an active body selection, open the AI menu
     *      (chunk 56) — the menu items wrap the selection in a prompt
     *      template and call `onAiCommand` (AppShell wires it to
     *      `ChatPanelHandle.prefillAndSend`).
     *   3. Else fall through (no native menu).
     */
    const handlePageContextMenu = useCallback(
      (idx: number, e: ReactMouseEvent<HTMLDivElement>): void => {
        const result = hitTestAt(idx, e.clientX, e.clientY, e.currentTarget);
        if (!result) return;
        const inCell =
          result.controlIndex !== undefined &&
          result.cellIndex !== undefined &&
          result.parentParaIndex !== undefined;
        if (!inCell) {
          // chunk 56 — body right-click with active selection opens the
          // AI command menu. We forward only the menu position; the
          // menu component reads the current selection text via
          // captureExcerptText() lazily.
          const sel = selectionRef.current;
          const hasNonEmptySel =
            sel !== null &&
            !(
              sel.anchor.paragraphIndex === sel.focus.paragraphIndex &&
              sel.anchor.charOffset === sel.focus.charOffset
            );
          if (hasNonEmptySel) {
            e.preventDefault();
            setAiMenu({ x: e.clientX, y: e.clientY });
          }
          return;
        }
        e.preventDefault();
        const doc = docRef.current;
        if (!doc) return;
        // TS narrowing doesn't survive across the inCell check — pin the
        // cell fields here so the rest of the block sees `number`.
        const parentParaIndex = result.parentParaIndex!;
        const controlIndex = result.controlIndex!;
        const cellIndex = result.cellIndex!;
        const cellParaIndex = result.cellParaIndex ?? 0;
        try {
          const dims = JSON.parse(
            doc.getTableDimensions(
              result.sectionIndex,
              parentParaIndex,
              controlIndex,
            ),
          ) as { rowCount: number; colCount: number; cellCount: number };
          // Move caret into the right-clicked cell so subsequent ops act
          // on it. (Matches Word/한컴: right-click selects the cell.)
          caretRef.current = {
            sectionIndex: result.sectionIndex,
            paragraphIndex: 0,
            charOffset: 0,
            cell: {
              parentParaIndex,
              controlIndex,
              cellIndex,
              cellParaIndex,
            },
          };
          setSelection(null);
          setSelectionRectsByPage({});
          setCellMenu({
            x: e.clientX,
            y: e.clientY,
            sectionIndex: result.sectionIndex,
            parentParaIndex,
            controlIndex,
            cellIndex,
            rowCount: dims.rowCount,
            colCount: dims.colCount,
          });
        } catch {
          /* not a table cell or dims unavailable */
        }
      },
      [hitTestAt, setSelection],
    );

    const insertTableRowAt = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        rowIdx: number,
        below: boolean,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.insertTableRow(sec, parentPara, ctrl, rowIdx, below);
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] insertTableRow failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const insertTableColumnAt = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        colIdx: number,
        right: boolean,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.insertTableColumn(sec, parentPara, ctrl, colIdx, right);
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] insertTableColumn failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const deleteTableRowAt = useCallback(
      (sec: number, parentPara: number, ctrl: number, rowIdx: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.deleteTableRow(sec, parentPara, ctrl, rowIdx);
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] deleteTableRow failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const deleteTableColumnAt = useCallback(
      (sec: number, parentPara: number, ctrl: number, colIdx: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.deleteTableColumn(sec, parentPara, ctrl, colIdx);
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] deleteTableColumn failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Merge a rectangular range of cells into one (chunk 9). Use case from
     * the context menu: merge the right-hand or below neighbor into the
     * current cell. The caller passes the rectangle in cell coordinates;
     * the IR collapses them to a single cell whose content is the original
     * top-left cell's content (other cell text is dropped — this matches
     * 한컴 한글's "셀 합치기" behavior).
     */
    const mergeCells = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        startRow: number,
        startCol: number,
        endRow: number,
        endCol: number,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.mergeTableCells(
            sec,
            parentPara,
            ctrl,
            startRow,
            startCol,
            endRow,
            endCol,
          );
          // Caret was inside one of the merged cells; cell coords are now
          // stale. Drop the cell pointer — the user can click into the
          // merged cell to re-anchor.
          caretRef.current = { ...caretRef.current, cell: undefined };
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] mergeTableCells failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Split a single cell into N×M smaller cells (chunk 9). The default
     * context-menu invocation is 2×2; the IR also supports 1×N (vertical
     * split) and N×1 (horizontal split) via the same call.
     */
    const splitCellInto = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        row: number,
        col: number,
        nRows: number,
        mCols: number,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.splitTableCellInto(
            sec,
            parentPara,
            ctrl,
            row,
            col,
            nRows,
            mCols,
            true /* equalRowHeight */,
            false /* mergeFirst — start fresh */,
          );
          caretRef.current = { ...caretRef.current, cell: undefined };
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] splitTableCellInto failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Restore a previously-merged cell back to its constituent cells. Calls
     * the IR's `splitTableCell` which knows the original geometry from the
     * merge metadata; if the cell wasn't merged this is a no-op (with a
     * warning logged from the IR).
     */
    const unmergeCell = useCallback(
      (
        sec: number,
        parentPara: number,
        ctrl: number,
        row: number,
        col: number,
      ): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.splitTableCell(sec, parentPara, ctrl, row, col);
          caretRef.current = { ...caretRef.current, cell: undefined };
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] splitTableCell failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    const deleteWholeTable = useCallback(
      (sec: number, parentPara: number, ctrl: number): void => {
        const doc = docRef.current;
        if (!doc) return;
        try {
          doc.deleteTableControl(sec, parentPara, ctrl);
          // Caret was inside the cell — clear cell info now that the
          // table's gone.
          caretRef.current = { ...caretRef.current, cell: undefined };
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] deleteTableControl failed:', err);
        }
      },
      [refreshAfterMutation],
    );

    /**
     * Test/dev hook on `window.__studioDebug` so e2e specs can drive
     * mutations + read state without going through real input UI (which
     * lands in chunk 4-B). Production builds also keep this — the surface
     * is small and non-destructive.
     */
    useEffect(() => {
      if (phase !== 'ready') return;
      // With multiple StudioViewers mounted (tab system), only the active
      // one claims `window.__studioDebug` — otherwise N viewers race to
      // overwrite a single global and tests / DevTools see nondeterministic
      // state.
      if (!isActive) return;
      const debug = {
        insertText: (
          sectionIdx: number,
          paraIdx: number,
          charOffset: number,
          text: string,
        ): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.insertText(sectionIdx, paraIdx, charOffset, text);
          refreshAfterMutation();
          return result;
        },
        deleteText: (
          sectionIdx: number,
          paraIdx: number,
          charOffset: number,
          count: number,
        ): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.deleteText(sectionIdx, paraIdx, charOffset, count);
          refreshAfterMutation();
          return result;
        },
        // @rhwp/core 0.7.9 — paragraph-level IR ops. Distinct from text-level
        // insertText/deleteText: these add or remove an entire paragraph node,
        // shifting the indices of subsequent paragraphs by 1.
        insertParagraph: (sectionIdx: number, paraIdx: number): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.insertParagraph(sectionIdx, paraIdx);
          // Page count can change because a new blank paragraph may push
          // content past a page boundary; refreshAfterMutation re-reads it.
          refreshAfterMutation();
          return result;
        },
        deleteParagraph: (sectionIdx: number, paraIdx: number): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.deleteParagraph(sectionIdx, paraIdx);
          refreshAfterMutation();
          return result;
        },
        getParagraphCount: (sectionIdx: number): number => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          return doc.getParagraphCount(sectionIdx);
        },
        getParagraphLength: (sectionIdx: number, paraIdx: number): number => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          return doc.getParagraphLength(sectionIdx, paraIdx);
        },
        getTextRange: (
          sectionIdx: number,
          paraIdx: number,
          startOffset: number,
          endOffset: number,
        ): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          return doc.getTextRange(sectionIdx, paraIdx, startOffset, endOffset);
        },
        getCaretPosition: (): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          return doc.getCaretPosition();
        },
        exportBytes: (): Uint8Array => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          // HWP, not HWPX — see imperative handle comment.
          return doc.exportHwp();
        },
        getPageCount: (): number => pageCount,
        isDirty: (): boolean => dirtyRef.current,
        getCaret: (): {
          sectionIndex: number;
          paragraphIndex: number;
          charOffset: number;
        } => ({ ...caretRef.current }),
        focusViewer: (): void => {
          scrollRef.current?.focus();
        },
        toggleCharFormat: (key: CharFormatKey): void => {
          toggleCharFormat(key);
        },
        applyStyle: (styleId: number): void => {
          applyParagraphStyle(styleId);
        },
        getActiveFormat: () => ({ ...activeFormat }),
        getStyleList: () => [...styleList],
        // Selection helpers (chunk 5b). Set anchor and focus directly so
        // tests can drive range ops without simulating mouse drag.
        setSelection: (
          anchorPara: number,
          anchorOff: number,
          focusPara: number,
          focusOff: number,
        ): void => {
          const sel = {
            anchor: {
              sectionIndex: 0,
              paragraphIndex: anchorPara,
              charOffset: anchorOff,
            },
            focus: {
              sectionIndex: 0,
              paragraphIndex: focusPara,
              charOffset: focusOff,
            },
          };
          caretRef.current = sel.focus;
          setSelection(sel);
          refreshSelectionRects(sel);
          refreshCursorRect();
          refreshActiveFormat();
        },
        getSelection: () => {
          // Read from the ref so multiple synchronous setSelection calls
          // (e.g. e2e loops) see the latest value without waiting for
          // React to flush state updates.
          const sel = selectionRef.current;
          if (!sel) return null;
          const r = sortRange(sel.anchor, sel.focus);
          return r.empty ? null : r;
        },
        clearSelection: (): void => {
          clearSelection();
        },
        undo: (): void => undo(),
        redo: (): void => redo(),
        canUndo: (): boolean => historyRef.current.index > 0,
        canRedo: (): boolean =>
          historyRef.current.index < historyRef.current.entries.length - 1,
        historyDepth: (): { index: number; size: number } => ({
          index: historyRef.current.index,
          size: historyRef.current.entries.length,
        }),
        copy: () => copySelection(),
        cut: () => cutSelection(),
        paste: () => pasteAtCaret(),
        openFind: (initialQuery?: string): void => {
          openFind();
          if (typeof initialQuery === 'string' && initialQuery) {
            setFindQuery(initialQuery);
            runFindSearch(initialQuery);
          }
        },
        closeFind: (): void => closeFind(),
        findNext: (): void => findNext(),
        findPrev: (): void => findPrev(),
        getFindState: (): {
          open: boolean;
          query: string;
          matchCount: number;
          activeIndex: number;
          replaceQuery: string;
          replaceFeedback: string | null;
        } => ({
          open: findOpen,
          query: findQuery,
          matchCount: findMatches.length,
          activeIndex: findIndex,
          replaceQuery,
          replaceFeedback,
        }),
        // Replace surface — chunk 7. e2e drives these via __studioDebug
        // (Playwright clicks too, but the direct hooks make assertions
        // simpler when verifying IR-side outcomes). Optional override arg
        // bypasses React state so tests don't have to wait for a state
        // round-trip after `setReplaceQuery`.
        openReplace: (): void => openReplace(),
        setReplaceQuery: (text: string): void => setReplaceQuery(text),
        replaceCurrent: (override?: string): void => replaceCurrent(override),
        replaceAll: (override?: string): void => replaceAllMatches(override),
        applyAlignment: (a: ParaAlignment): void => applyAlignment(a),
        applyFontSizePt: (pt: number): void => applyFontSizePt(pt),
        applyTextColor: (hex: string): void => applyTextColor(hex),
        // Paragraph-shape ops — chunk 8 (line spacing / indent / spacing).
        applyLineSpacing: (percent: number): void => applyLineSpacing(percent),
        stepIndent: (dir: 'increase' | 'decrease'): void => stepIndent(dir),
        applyParaSpacing: (before: number, after: number): void =>
          applyParaSpacing(before, after),
        getParaProps: (sectionIdx: number, paraIdx: number): unknown => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          return JSON.parse(doc.getParaPropertiesAt(sectionIdx, paraIdx));
        },
        // Raw escape hatch — lets e2e probes try alternate prop key names
        // when the lib's input schema diverges from its output schema.
        applyParaPropsRaw: (
          sectionIdx: number,
          paraIdx: number,
          propsJson: string,
        ): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.applyParaFormat(sectionIdx, paraIdx, propsJson);
          refreshAfterMutation({ syncCaret: false });
          return result;
        },
        // Click-count selection synthesis for e2e — Playwright's
        // mouse.dblclick simulates two mousedowns but the resulting
        // e.detail isn't always 2 in Electron. These helpers emulate the
        // viewer's response directly.
        selectWordAt: (sec: number, para: number, offset: number): void => {
          const w = findWordBoundsAt(sec, para, offset);
          if (!w) return;
          const start = {
            sectionIndex: sec,
            paragraphIndex: para,
            charOffset: w.startOffset,
          };
          const end = {
            sectionIndex: sec,
            paragraphIndex: para,
            charOffset: w.endOffset,
          };
          caretRef.current = end;
          setSelection({ anchor: start, focus: end });
          refreshSelectionRects({ anchor: start, focus: end });
          refreshCursorRect();
          refreshActiveFormat();
        },
        selectParagraph: (sec: number, para: number): void => {
          const doc = docRef.current;
          if (!doc) return;
          try {
            const len = doc.getParagraphLength(sec, para);
            const start = {
              sectionIndex: sec,
              paragraphIndex: para,
              charOffset: 0,
            };
            const end = {
              sectionIndex: sec,
              paragraphIndex: para,
              charOffset: len,
            };
            caretRef.current = end;
            setSelection({ anchor: start, focus: end });
            refreshSelectionRects({ anchor: start, focus: end });
            refreshCursorRect();
            refreshActiveFormat();
          } catch {
            /* ignore */
          }
        },
        stepWordOffset: (
          sec: number,
          para: number,
          offset: number,
          dir: -1 | 1,
        ): number => stepWordOffset(sec, para, offset, dir),
        // Cell editing v1 — drive the caret into a cell directly so e2e
        // can verify cell-typing without simulating a click that lands
        // exactly on a cell rect.
        enterCell: (
          sec: number,
          parentParaIndex: number,
          controlIndex: number,
          cellIndex: number,
          cellParaIndex: number,
          charOffset: number = 0,
        ): void => {
          caretRef.current = {
            sectionIndex: sec,
            paragraphIndex: 0,
            charOffset,
            cell: {
              parentParaIndex,
              controlIndex,
              cellIndex,
              cellParaIndex,
            },
          };
          setSelection(null);
          setSelectionRectsByPage({});
          refreshCursorRect();
        },
        exitCell: (): void => {
          caretRef.current = {
            ...caretRef.current,
            cell: undefined,
          };
          refreshCursorRect();
        },
        getCellText: (
          sec: number,
          parentParaIndex: number,
          controlIndex: number,
          cellIndex: number,
          cellParaIndex: number,
        ): string => {
          const doc = docRef.current;
          if (!doc) return '';
          try {
            return doc.getTextInCell(
              sec,
              parentParaIndex,
              controlIndex,
              cellIndex,
              cellParaIndex,
              0,
              1_000_000,
            );
          } catch {
            return '';
          }
        },
        getCaretCell: () => caretRef.current.cell ?? null,
        // Cell row/col ops for e2e (skip the right-click flow and
        // exercise the IPC + refresh path directly).
        insertTableRow: (
          sec: number,
          parentPara: number,
          ctrl: number,
          rowIdx: number,
          below: boolean,
        ): void => insertTableRowAt(sec, parentPara, ctrl, rowIdx, below),
        insertTableColumn: (
          sec: number,
          parentPara: number,
          ctrl: number,
          colIdx: number,
          right: boolean,
        ): void => insertTableColumnAt(sec, parentPara, ctrl, colIdx, right),
        deleteTableRow: (
          sec: number,
          parentPara: number,
          ctrl: number,
          rowIdx: number,
        ): void => deleteTableRowAt(sec, parentPara, ctrl, rowIdx),
        deleteTableColumn: (
          sec: number,
          parentPara: number,
          ctrl: number,
          colIdx: number,
        ): void => deleteTableColumnAt(sec, parentPara, ctrl, colIdx),
        getTableDimensions: (
          sec: number,
          parentPara: number,
          ctrl: number,
        ): { rowCount: number; colCount: number; cellCount: number } | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(
              doc.getTableDimensions(sec, parentPara, ctrl),
            ) as { rowCount: number; colCount: number; cellCount: number };
          } catch {
            return null;
          }
        },
        // Cell merge / split — chunk 9.
        mergeCells: (
          sec: number,
          parentPara: number,
          ctrl: number,
          startRow: number,
          startCol: number,
          endRow: number,
          endCol: number,
        ): void =>
          mergeCells(sec, parentPara, ctrl, startRow, startCol, endRow, endCol),
        splitCellInto: (
          sec: number,
          parentPara: number,
          ctrl: number,
          row: number,
          col: number,
          nRows: number,
          mCols: number,
        ): void => splitCellInto(sec, parentPara, ctrl, row, col, nRows, mCols),
        unmergeCell: (
          sec: number,
          parentPara: number,
          ctrl: number,
          row: number,
          col: number,
        ): void => unmergeCell(sec, parentPara, ctrl, row, col),
        // Page setup — chunk 10.
        getPageDef: (sectionIdx = 0): Record<string, unknown> | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(doc.getPageDef(sectionIdx)) as Record<
              string,
              unknown
            >;
          } catch {
            return null;
          }
        },
        applyPageDef: (props: Record<string, unknown>, sectionIdx = 0): void =>
          applyPageDef(props, sectionIdx),
        // HTML export + paste with paragraph-shape decomposition — chunk 18.
        applyHtmlAtCaret: (html: string): void => applyHtmlAtCaret(html),
        // chunk 20 — excerpt capture + stale verify mirror the
        // ViewerHandle entries so e2e specs can drive the chip flow
        // without needing to script real selection drags.
        scrollToParagraph: (sectionIdx: number, paraIdx: number) => {
          const doc = docRef.current;
          if (!doc) return;
          try {
            // Place caret at the paragraph's start and reuse the same
            // scroll-to-rect path as Find.
            caretRef.current = {
              sectionIndex: sectionIdx,
              paragraphIndex: paraIdx,
              charOffset: 0,
            };
            const rect = JSON.parse(
              doc.getCursorRect(sectionIdx, paraIdx, 0),
            ) as { pageIndex: number; x: number; y: number; height: number };
            const pageEl = pageRefsRef.current[rect.pageIndex];
            pageEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setCursorRect(rect);
          } catch (err) {
            console.warn('[studio] scrollToParagraph failed:', err);
          }
        },
        getOutline: () => {
          const doc = docRef.current;
          if (!doc) return [];
          // Resolve heading styles by name. HWP convention is "제목 1",
          // "제목 2", "제목 3" — we also accept "Heading N" for HWPX
          // imports of foreign docs. Body styles ("바탕글" / "본문")
          // are skipped.
          const headingByStyleId = new Map<number, number>();
          for (const s of styleList) {
            const koMatch = s.name.match(/^제목\s*(\d+)?/);
            const enMatch = s.englishName?.match(/^Heading\s*(\d+)?/i);
            const m = koMatch ?? enMatch;
            if (m) {
              const level = m[1] ? Math.min(6, parseInt(m[1], 10)) : 1;
              headingByStyleId.set(s.id, level);
            }
          }
          if (headingByStyleId.size === 0) return [];
          const items: {
            paragraphIndex: number;
            level: number;
            text: string;
          }[] = [];
          try {
            const SECTION = 0;
            const paraCount = doc.getParagraphCount(SECTION);
            const cap = Math.min(paraCount, 1000);
            for (let p = 0; p < cap; p++) {
              const at = JSON.parse(doc.getStyleAt(SECTION, p)) as {
                id?: number;
              };
              if (typeof at.id !== 'number') continue;
              const level = headingByStyleId.get(at.id);
              if (!level) continue;
              const len = doc.getParagraphLength(SECTION, p);
              const text =
                len > 0
                  ? doc.getTextRange(SECTION, p, 0, Math.min(len, 200))
                  : '';
              items.push({
                paragraphIndex: p,
                level,
                text: text.trim() || '(제목 없음)',
              });
              if (items.length >= 200) break;
            }
          } catch (err) {
            console.warn('[studio] getOutline failed:', err);
          }
          return items;
        },
        captureExcerpt: () => captureExcerpt(),
        exportSelectionHtmlAt: (
          sec: number,
          startPara: number,
          startOff: number,
          endPara: number,
          endOff: number,
        ): string =>
          exportSelectionHtmlAt(sec, startPara, startOff, endPara, endOff),
        pasteHtmlAt: (
          sec: number,
          para: number,
          charOffset: number,
          html: string,
        ): void => pasteHtmlAt(sec, para, charOffset, html),
        // Shapes — chunk 15.
        createRectShapeAtCaret: (
          widthHwpunit: number,
          heightHwpunit: number,
          opts?: { treatAsChar?: boolean },
        ): { paraIdx: number; controlIdx: number } | null =>
          createRectShapeAtCaret(widthHwpunit, heightHwpunit, opts),
        getShapeProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
        ): Record<string, unknown> | null =>
          getShapeProps(sec, parentPara, ctrl),
        setShapeProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
          props: Record<string, unknown>,
        ): void => setShapeProps(sec, parentPara, ctrl, props),
        deleteShape: (sec: number, parentPara: number, ctrl: number): void =>
          deleteShape(sec, parentPara, ctrl),
        changeShapeZOrderAt: (
          sec: number,
          parentPara: number,
          ctrl: number,
          op: 'front' | 'back' | 'forward' | 'backward',
        ): void => changeShapeZOrderAt(sec, parentPara, ctrl, op),
        // Table / cell properties — chunk 17.
        getTableProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
        ): Record<string, unknown> | null =>
          getTableProps(sec, parentPara, ctrl),
        setTableProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
          props: Record<string, unknown>,
        ): void => setTableProps(sec, parentPara, ctrl, props),
        getCellProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
          cellIdx: number,
        ): Record<string, unknown> | null =>
          getCellProps(sec, parentPara, ctrl, cellIdx),
        setCellProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
          cellIdx: number,
          props: Record<string, unknown>,
        ): void => setCellProps(sec, parentPara, ctrl, cellIdx, props),
        // Cell style apply — chunk 23 (KNOWN_ISSUES L-006: lib has no
        // direct cell-color setter; this routes a pre-existing styleId).
        applyCellStyle: (
          sec: number,
          parentPara: number,
          ctrl: number,
          cell: number,
          cellPara: number,
          styleId: number,
        ): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(
              doc.applyCellStyle(
                sec,
                parentPara,
                ctrl,
                cell,
                cellPara,
                styleId,
              ),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        // Picture properties — chunk 24.
        getPictureProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
        ): Record<string, unknown> | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(
              doc.getPictureProperties(sec, parentPara, ctrl),
            ) as Record<string, unknown>;
          } catch {
            return null;
          }
        },
        setPictureProps: (
          sec: number,
          parentPara: number,
          ctrl: number,
          props: Record<string, unknown>,
        ): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(
              doc.setPictureProperties(
                sec,
                parentPara,
                ctrl,
                JSON.stringify(props),
              ),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        deletePictureControl: (
          sec: number,
          parentPara: number,
          ctrl: number,
        ): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(
              doc.deletePictureControl(sec, parentPara, ctrl),
            ) as { ok?: boolean };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        // Control clipboard — chunk 25.
        copyControl: (sec: number, para: number, ctrl: number): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(doc.copyControl(sec, para, ctrl)) as {
              ok?: boolean;
            };
            return Boolean(r.ok);
          } catch {
            return false;
          }
        },
        pasteControlAt: (
          sec: number,
          para: number,
          charOffset: number,
        ): boolean => {
          const doc = docRef.current;
          if (!doc) return false;
          try {
            const r = JSON.parse(doc.pasteControl(sec, para, charOffset)) as {
              ok?: boolean;
            };
            if (r.ok) {
              dirtyRef.current = true;
              setDirty(true);
              refreshAfterMutation({ syncCaret: false });
              return true;
            }
            return false;
          } catch {
            return false;
          }
        },
        // Bundled undo — chunk 27.
        beginUndoGroup: (): void => {
          undoGroupDepthRef.current += 1;
        },
        endUndoGroup: (): void => {
          undoGroupDepthRef.current = Math.max(
            0,
            undoGroupDepthRef.current - 1,
          );
          if (undoGroupDepthRef.current === 0) {
            pushHistory();
          }
        },
        // Equation preview — chunk 16.
        renderEquationSvg: (
          script: string,
          fontSizeHwpunit = 1000,
          color = 0,
        ): string => renderEquationSvg(script, fontSizeHwpunit, color),
        // Styles — chunk 14.
        createNamedStyle: (name: string, englishName?: string): number | null =>
          createNamedStyle(name, englishName),
        renameStyle: (
          id: number,
          name: string,
          englishName?: string,
        ): boolean => renameStyle(id, name, englishName),
        deleteStyleById: (id: number): boolean => deleteStyleById(id),
        getStyleListJson: (): Record<string, unknown>[] | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(doc.getStyleList()) as Record<string, unknown>[];
          } catch {
            return null;
          }
        },
        // Footnotes — chunk 13.
        insertFootnoteAtCaret: (text: string): void =>
          insertFootnoteAtCaret(text),
        // Raw probe surface — debug only, returns the IR's JSON string.
        insertFootnoteRaw: (
          sec: number,
          para: number,
          charOffset: number,
        ): string => {
          const doc = docRef.current;
          if (!doc) return '';
          return doc.insertFootnote(sec, para, charOffset);
        },
        getFootnoteInfoRaw: (
          sec: number,
          para: number,
          ctrlIdx: number,
        ): string => {
          const doc = docRef.current;
          if (!doc) return '';
          try {
            return doc.getFootnoteInfo(sec, para, ctrlIdx);
          } catch (err) {
            return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
        getFootnoteInfo: (
          sec: number,
          para: number,
          ctrlIdx: number,
        ): Record<string, unknown> | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(
              doc.getFootnoteInfo(sec, para, ctrlIdx),
            ) as Record<string, unknown>;
          } catch {
            return null;
          }
        },
        // Bookmarks — chunk 12.
        addBookmarkAtCaret: (name: string): void => addBookmarkAtCaret(name),
        getBookmarks: (): Record<string, unknown>[] | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            const raw = JSON.parse(doc.getBookmarks()) as
              | Record<string, unknown>[]
              | { bookmarks?: Record<string, unknown>[] };
            if (Array.isArray(raw)) return raw;
            if (Array.isArray(raw?.bookmarks)) return raw.bookmarks;
            return null;
          } catch {
            return null;
          }
        },
        deleteBookmarkAt: (sec: number, para: number, ctrlIdx: number): void =>
          deleteBookmarkAt(sec, para, ctrlIdx),
        renameBookmarkAt: (
          sec: number,
          para: number,
          ctrlIdx: number,
          newName: string,
        ): void => renameBookmarkAt(sec, para, ctrlIdx, newName),
        // Header / footer — chunk 11.
        setHeaderFooterText: (
          sectionIdx: number,
          isHeader: boolean,
          applyTo: number,
          text: string,
        ): void => setHeaderFooterText(sectionIdx, isHeader, applyTo, text),
        getHeaderFooter: (
          sectionIdx: number,
          isHeader: boolean,
          applyTo: number,
        ): Record<string, unknown> | null => {
          const doc = docRef.current;
          if (!doc) return null;
          try {
            return JSON.parse(
              doc.getHeaderFooter(sectionIdx, isHeader, applyTo),
            ) as Record<string, unknown>;
          } catch {
            return null;
          }
        },
        // Image insert hook for e2e — bytes encoded as base64 to keep
        // the test deterministic without needing real image files.
        insertImageBase64: async (
          base64: string,
          ext: string,
          description?: string,
        ): Promise<void> => {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          await insertImage(bytes, ext, description ?? '');
        },
        // Synthetic Korean IME helper for e2e — Playwright's keyboard.type
        // doesn't trigger real IME composition. This bypasses keydown to
        // exercise the same code path compositionend uses.
        injectComposedText: (text: string): void => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const c = caretRef.current;
          doc.insertText(c.sectionIndex, c.paragraphIndex, c.charOffset, text);
          // Mirror what handleCompositionEnd would do post-doc-mutation.
          cacheRef.current.clear();
          pageRefsRef.current.forEach((el, idx) => {
            const target = el?.querySelector('svg');
            if (target) {
              el!.innerHTML = '';
              renderPageInto(idx);
            }
          });
          try {
            caretRef.current = JSON.parse(
              doc.getCaretPosition(),
            ) as typeof caretRef.current;
            const cc = caretRef.current;
            setCursorRect(
              JSON.parse(
                doc.getCursorRect(
                  cc.sectionIndex,
                  cc.paragraphIndex,
                  cc.charOffset,
                ),
              ),
            );
          } catch {
            /* keep prev */
          }
          dirtyRef.current = true;
          setDirty(true);
        },
      };
      (window as Window & { __studioDebug?: typeof debug }).__studioDebug =
        debug;
      return () => {
        delete (window as Window & { __studioDebug?: typeof debug })
          .__studioDebug;
      };
    }, [
      captureExcerpt,
      phase,
      isActive,
      pageCount,
      pushHistory,
      refreshAfterMutation,
      renderPageInto,
      toggleCharFormat,
      applyParagraphStyle,
      activeFormat,
      styleList,
      selection,
      sortRange,
      refreshSelectionRects,
      refreshActiveFormat,
      refreshCursorRect,
      clearSelection,
      setSelection,
      undo,
      redo,
      copySelection,
      cutSelection,
      pasteAtCaret,
      openFind,
      closeFind,
      findNext,
      findPrev,
      runFindSearch,
      findOpen,
      findQuery,
      findMatches,
      findIndex,
      openReplace,
      replaceCurrent,
      replaceAllMatches,
      replaceQuery,
      replaceFeedback,
      applyAlignment,
      applyFontSizePt,
      applyTextColor,
      applyLineSpacing,
      stepIndent,
      applyParaSpacing,
      findWordBoundsAt,
      stepWordOffset,
      insertImage,
      insertTableRowAt,
      insertTableColumnAt,
      deleteTableRowAt,
      deleteTableColumnAt,
      mergeCells,
      splitCellInto,
      unmergeCell,
      applyPageDef,
      setHeaderFooterText,
      addBookmarkAtCaret,
      deleteBookmarkAt,
      renameBookmarkAt,
      insertFootnoteAtCaret,
      createNamedStyle,
      renameStyle,
      deleteStyleById,
      renderEquationSvg,
      getTableProps,
      setTableProps,
      getCellProps,
      setCellProps,
      createRectShapeAtCaret,
      getShapeProps,
      setShapeProps,
      deleteShape,
      changeShapeZOrderAt,
      exportSelectionHtmlAt,
      pasteHtmlAt,
      applyHtmlAtCaret,
    ]);

    // Effect 2: page indicator + mount window. On every scroll (rAF-
    // throttled) we (a) pick the topmost-visible page for the indicator
    // and (b) ensure SVGs are mounted only for pages within
    // ±VIEWPORT_BUFFER_PAGES of that page. Pages outside the window
    // have their SVG cleared (their cached SVG string stays in
    // cacheRef so re-mount on scroll-back is just a DOM parse, no
    // WASM `renderPageSvg` call).
    //
    // Inactive tab guard: when the viewer's container is `display:none`
    // (background tab), getBoundingClientRect returns all-zero rects.
    // Without this guard, every inactive tab would mount 11 pages on
    // first render — opening 30 tabs would mean 330 page renders.
    useEffect(() => {
      if (phase !== 'ready' || pageCount === 0) return;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;

      const VIEWPORT_BUFFER_PAGES = 5;

      let pending = false;
      const update = (): void => {
        pending = false;
        // Skip when the tab isn't visible — its layout isn't real.
        if (scrollEl.clientHeight === 0) return;
        const refs = pageRefsRef.current;
        const scrollRect = scrollEl.getBoundingClientRect();
        const probeY = scrollRect.top + scrollEl.clientHeight * 0.33;
        let best = 0;
        for (let i = 0; i < refs.length; i++) {
          const el = refs[i];
          if (!el) continue;
          const r = el.getBoundingClientRect();
          if (r.top > probeY) break;
          best = i;
        }
        setCurrentPage(best);

        const lo = Math.max(0, best - VIEWPORT_BUFFER_PAGES);
        const hi = Math.min(refs.length - 1, best + VIEWPORT_BUFFER_PAGES);
        for (let i = 0; i < refs.length; i++) {
          const el = refs[i];
          if (!el) continue;
          const inWindow = i >= lo && i <= hi;
          const hasSvg = el.firstElementChild?.tagName.toLowerCase() === 'svg';
          if (inWindow && !hasSvg) {
            renderPageInto(i);
          } else if (!inWindow && hasSvg) {
            // Clear DOM but keep cacheRef[i] so re-mount is fast.
            el.innerHTML = '';
          }
        }
      };
      const onScroll = (): void => {
        if (pending) return;
        pending = true;
        requestAnimationFrame(update);
      };
      update();
      scrollEl.addEventListener('scroll', onScroll, { passive: true });
      return () => {
        scrollEl.removeEventListener('scroll', onScroll);
      };
    }, [phase, pageCount, pageDims, zoom, renderPageInto, isActive]);

    const setZoomFit = useCallback(() => {
      if (!pageDims || !scrollRef.current) return;
      const containerWidth = scrollRef.current.clientWidth - PAGE_PADDING_PX;
      const fit = containerWidth / pageDims.w;
      setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit)));
    }, [pageDims]);

    const stepZoom = useCallback((dir: 'in' | 'out') => {
      setZoom((current) => {
        if (dir === 'in') {
          const next = ZOOM_LEVELS.find((z) => z > current) ?? ZOOM_MAX;
          return Math.min(ZOOM_MAX, next);
        }
        const lower = [...ZOOM_LEVELS].reverse().find((z) => z < current);
        return Math.max(ZOOM_MIN, lower ?? ZOOM_MIN);
      });
    }, []);

    const showToolbar = phase === 'ready' && pageDims !== null;

    // chunk 51 — recompute body text counters on dirty/pageCount/phase
    // changes with a 200ms debounce. The walk reads getParagraphCount
    // + getTextRange per paragraph for section 0 only; multi-section
    // docs are rare in practice and the IR's section model isn't
    // stable across versions for our use case.
    useEffect(() => {
      if (phase !== 'ready') return;
      let cancelled = false;
      const t = window.setTimeout(() => {
        if (cancelled) return;
        const doc = docRef.current;
        if (!doc) return;
        try {
          const SECTION = 0;
          const paraCount = doc.getParagraphCount(SECTION);
          let chars = 0;
          let words = 0;
          for (let p = 0; p < paraCount; p++) {
            const len = doc.getParagraphLength(SECTION, p);
            chars += len;
            if (len === 0) continue;
            const text = doc.getTextRange(SECTION, p, 0, len);
            // Word boundary on whitespace + Hangul/CJK char-as-word
            // (Korean text rarely has English-style word breaks within
            // a paragraph; counting whitespace-delimited tokens
            // approximates "어절" which matches the conventional
            // Korean word-count UX in 한컴 한글).
            const tokens = text.split(/\s+/).filter((w) => w.length > 0);
            words += tokens.length;
          }
          setDocStats({ chars, words, paragraphs: paraCount });
        } catch {
          /* keep previous counts */
        }
      }, 200);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }, [phase, dirty, pageCount]);

    return (
      <div
        className="relative flex h-full w-full flex-col"
        data-testid="studio-viewer"
      >
        {showToolbar && (
          <div className="flex h-10 items-center gap-1 border-b border-border px-3 text-xs">
            {/* History + zoom + page indicator moved to the bottom status bar
             *  (chunk 8). The top row is now editing-format only: B/I/U, align,
             *  font size/color, paragraph style, and the "더보기" toggle. */}
            <Button
              size="sm"
              variant={activeFormat.bold ? 'secondary' : 'ghost'}
              onClick={() => toggleCharFormat('bold')}
              aria-label="진하게"
              aria-pressed={activeFormat.bold}
              data-testid="studio-format-bold"
            >
              <Bold className="size-4" />
            </Button>
            <Button
              size="sm"
              variant={activeFormat.italic ? 'secondary' : 'ghost'}
              onClick={() => toggleCharFormat('italic')}
              aria-label="기울임"
              aria-pressed={activeFormat.italic}
              data-testid="studio-format-italic"
            >
              <Italic className="size-4" />
            </Button>
            <Button
              size="sm"
              variant={activeFormat.underline ? 'secondary' : 'ghost'}
              onClick={() => toggleCharFormat('underline')}
              aria-label="밑줄"
              aria-pressed={activeFormat.underline}
              data-testid="studio-format-underline"
            >
              <Underline className="size-4" />
            </Button>
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
            {/* Alignment buttons (chunk 10). applyParaFormat per paragraph. */}
            {(
              [
                ['left', AlignLeft, '왼쪽 정렬'],
                ['center', AlignCenter, '가운데 정렬'],
                ['right', AlignRight, '오른쪽 정렬'],
                ['justify', AlignJustify, '양쪽 정렬'],
              ] as const
            ).map(([a, Icon, label]) => (
              <Button
                key={a}
                size="sm"
                variant={activeFormat.alignment === a ? 'secondary' : 'ghost'}
                onClick={() => applyAlignment(a)}
                aria-label={label}
                aria-pressed={activeFormat.alignment === a}
                data-testid={`studio-align-${a}`}
              >
                <Icon className="size-4" />
              </Button>
            ))}
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
            {/* Font size dropdown — value in pt; converts to HWPUNIT on apply.
                We list common sizes; if the active size isn't in the preset
                list (custom), it appears as the first option so the select
                still reflects state. */}
            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs"
              value={Math.round(activeFormat.fontSize / 100)}
              onChange={(e) => applyFontSizePt(Number(e.target.value))}
              aria-label="글자 크기"
              data-testid="studio-font-size"
            >
              {(() => {
                const cur = Math.round(activeFormat.fontSize / 100);
                const seen = new Set(FONT_SIZE_PRESETS_PT);
                const list = seen.has(cur)
                  ? FONT_SIZE_PRESETS_PT
                  : [cur, ...FONT_SIZE_PRESETS_PT];
                return list.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}pt
                  </option>
                ));
              })()}
            </select>
            {/* Color picker — native <input type="color"> for arbitrary
                hex, plus 9 swatches for one-click access. */}
            <input
              type="color"
              className="h-7 w-7 cursor-pointer rounded border border-input bg-background p-0"
              value={activeFormat.textColor}
              onChange={(e) => applyTextColor(e.target.value)}
              aria-label="글자 색상"
              data-testid="studio-text-color"
            />
            {styleList.length > 0 && (
              <select
                className="ml-1 h-7 rounded border border-input bg-background px-2 text-xs"
                value={activeFormat.styleId}
                onChange={(e) => applyParagraphStyle(Number(e.target.value))}
                aria-label="문단 스타일"
                data-testid="studio-style-select"
              >
                {styleList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <Button
              size="sm"
              variant={toolbarExpanded ? 'secondary' : 'ghost'}
              onClick={() => setToolbarExpanded((v) => !v)}
              aria-label="더보기"
              aria-pressed={toolbarExpanded}
              data-testid="studio-toolbar-more"
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </div>
        )}

        {showToolbar && toolbarExpanded && (
          <div
            className="flex h-10 items-center gap-1 border-b border-border bg-card/30 px-3 text-xs"
            data-testid="studio-toolbar-row2"
          >
            {/* List toggles */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggleList('bullet')}
              aria-label="글머리 기호"
              data-testid="studio-toggle-bullet"
            >
              <List className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toggleList('number')}
              aria-label="번호 매기기"
              data-testid="studio-toggle-number"
            >
              <ListOrdered className="size-4" />
            </Button>
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
            {/* Page break + insert table */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => insertPageBreak()}
              aria-label="페이지 나누기"
              title="페이지 나누기"
              data-testid="studio-insert-page-break"
            >
              <SeparatorHorizontal className="size-4" />
            </Button>
            <div className="relative">
              <Button
                size="sm"
                variant={tablePickerOpen ? 'secondary' : 'ghost'}
                onClick={() => setTablePickerOpen((v) => !v)}
                aria-label="표 삽입"
                aria-pressed={tablePickerOpen}
                data-testid="studio-insert-table"
              >
                <Table2 className="size-4" />
              </Button>
              {tablePickerOpen && (
                <div
                  className="absolute left-0 top-full z-30 mt-1 w-44 rounded-md border border-border bg-popover p-2 text-xs shadow-md"
                  data-testid="studio-table-picker"
                >
                  <TablePicker
                    onPick={(rows, cols) => {
                      setTablePickerOpen(false);
                      insertTable(rows, cols);
                    }}
                    onCancel={() => setTablePickerOpen(false)}
                  />
                </div>
              )}
            </div>
            {/* Image insert — opens hidden file input. Uses File API
                directly (no IPC needed) so the same handler works for
                drag-and-drop drops on the scroll area. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => imageInputRef.current?.click()}
              aria-label="이미지 삽입"
              title="이미지 삽입"
              data-testid="studio-insert-image"
            >
              <ImageIcon className="size-4" />
            </Button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/bmp,image/webp"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ''; // allow re-picking the same file
                if (!f) return;
                void (async () => {
                  const buf = await f.arrayBuffer();
                  const ext = f.name.split('.').pop() ?? 'png';
                  await insertImage(new Uint8Array(buf), ext, f.name);
                })();
              }}
              data-testid="studio-image-input"
            />
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
            {/* View toggles */}
            <Button
              size="sm"
              variant={showControlCodes ? 'secondary' : 'ghost'}
              onClick={() => setShowControlCodes(!showControlCodes)}
              aria-label="조판 부호"
              aria-pressed={showControlCodes}
              data-testid="studio-toggle-controls"
            >
              <Pilcrow className="size-4" />
            </Button>
            <Button
              size="sm"
              variant={showTransparentBorders ? 'secondary' : 'ghost'}
              onClick={() => setShowTransparentBorders(!showTransparentBorders)}
              aria-label="투명 테두리"
              aria-pressed={showTransparentBorders}
              data-testid="studio-toggle-transparent"
            >
              <Square className="size-4" />
            </Button>
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
            {/* Paragraph spacing controls — chunk 8. */}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stepIndent('decrease')}
              aria-label="내어쓰기"
              data-testid="studio-indent-decrease"
            >
              <IndentDecrease className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stepIndent('increase')}
              aria-label="들여쓰기"
              data-testid="studio-indent-increase"
            >
              <IndentIncrease className="size-4" />
            </Button>
            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs"
              aria-label="줄 간격"
              data-testid="studio-line-spacing"
              defaultValue=""
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v > 0) applyLineSpacing(v);
                e.currentTarget.value = ''; // reset so the same option re-fires
              }}
            >
              <option value="" disabled>
                줄 간격
              </option>
              {LINE_SPACING_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <select
              className="h-7 rounded border border-input bg-background px-2 text-xs"
              aria-label="문단 간격"
              data-testid="studio-para-spacing"
              defaultValue=""
              onChange={(e) => {
                // Stored as before|after pairs, both in HWPUNIT (≈ 567/mm).
                // Presets: 0/0, 280/0 (≈0.5 line), 567/0 (≈1 line),
                // 567/567 (1 line both).
                const [before, after] = e.target.value.split(',').map(Number);
                applyParaSpacing(before, after);
                e.currentTarget.value = '';
              }}
            >
              <option value="" disabled>
                문단 간격
              </option>
              <option value="0,0">없음</option>
              <option value="280,0">위 0.5</option>
              <option value="567,0">위 1.0</option>
              <option value="567,567">위·아래 1.0</option>
            </select>
          </div>
        )}

        {findOpen && (
          <div
            className="flex flex-col gap-1 border-b border-border bg-card px-3 py-2 text-xs"
            data-testid="studio-find-bar"
          >
            <div className="flex items-center gap-2">
              <input
                ref={findInputRef}
                type="text"
                className="h-7 w-56 rounded border border-input bg-background px-2"
                placeholder="검색…"
                value={findQuery}
                onChange={(e) => {
                  setFindQuery(e.target.value);
                  runFindSearch(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    closeFind();
                    e.preventDefault();
                  } else if (e.key === 'Enter') {
                    if (e.shiftKey) findPrev();
                    else findNext();
                    e.preventDefault();
                  }
                }}
                data-testid="studio-find-input"
              />
              <span
                className="font-mono tabular-nums text-muted-foreground"
                data-testid="studio-find-count"
              >
                {findMatches.length === 0
                  ? findQuery
                    ? '0 / 0'
                    : ''
                  : `${findIndex + 1} / ${findMatches.length}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={findPrev}
                disabled={findMatches.length === 0}
                aria-label="이전 매치"
                data-testid="studio-find-prev"
              >
                <ChevronUp className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={findNext}
                disabled={findMatches.length === 0}
                aria-label="다음 매치"
                data-testid="studio-find-next"
              >
                <ChevronDown className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={closeFind}
                aria-label="닫기"
                data-testid="studio-find-close"
              >
                <X className="size-4" />
              </Button>
            </div>
            <div
              className="flex items-center gap-2"
              data-testid="studio-replace-row"
            >
              <input
                ref={replaceInputRef}
                type="text"
                className="h-7 w-56 rounded border border-input bg-background px-2"
                placeholder="바꿀 내용 (빈 값 = 삭제)"
                value={replaceQuery}
                onChange={(e) => setReplaceQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    closeFind();
                    e.preventDefault();
                  } else if (e.key === 'Enter') {
                    if (e.shiftKey) replaceAllMatches();
                    else replaceCurrent();
                    e.preventDefault();
                  }
                }}
                data-testid="studio-replace-input"
              />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => replaceCurrent()}
                disabled={findQuery.length === 0 || findMatches.length === 0}
                data-testid="studio-replace-one"
              >
                바꾸기
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => replaceAllMatches()}
                disabled={findQuery.length === 0 || findMatches.length === 0}
                data-testid="studio-replace-all"
              >
                모두 바꾸기
              </Button>
              {replaceFeedback ? (
                <span
                  className="text-muted-foreground"
                  data-testid="studio-replace-feedback"
                >
                  {replaceFeedback}
                </span>
              ) : null}
            </div>
          </div>
        )}

        <div
          ref={scrollRef}
          className={
            'relative flex-1 overflow-auto bg-muted/30 outline-none ' +
            (isImageDropTarget ? 'ring-2 ring-inset ring-ring' : '')
          }
          data-testid="studio-scroll"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onDragOver={(e) => {
            // Accept only when the drag carries an image file from
            // outside (Finder / Explorer). Internal folder-tree drags
            // use 'application/x-ahwp-path' which we ignore here.
            if (
              e.dataTransfer.types.includes('Files') &&
              !e.dataTransfer.types.includes('application/x-ahwp-path')
            ) {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setIsImageDropTarget(true);
            }
          }}
          onDragLeave={(e) => {
            // Only clear when the drag has left the scroll container —
            // children dispatch dragleave too as the cursor passes.
            if (e.currentTarget === e.target) setIsImageDropTarget(false);
          }}
          onDrop={(e) => {
            setIsImageDropTarget(false);
            const file = e.dataTransfer.files?.[0];
            if (!file || !file.type.startsWith('image/')) return;
            e.preventDefault();
            void (async () => {
              const buf = await file.arrayBuffer();
              const ext = file.name.split('.').pop() ?? 'png';
              await insertImage(new Uint8Array(buf), ext, file.name);
            })();
          }}
        >
          {pageDims && pageCount > 0 && (
            <div
              className="flex flex-col items-center"
              style={{
                gap: `${PAGE_GAP_PX}px`,
                padding: `${PAGE_GAP_PX}px`,
              }}
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  className="flex flex-col items-stretch"
                  data-testid="studio-page-wrap"
                >
                  {showRuler && (
                    <HorizontalRuler widthSvg={pageDims.w} zoom={zoom} />
                  )}
                  <div
                    // chunk 54 — page paper is always white, even in dark
                    // mode. The IR's SVG renderer hard-codes black text;
                    // matching `bg-background` would make text invisible
                    // on a dark theme. Chrome around the page (toolbar,
                    // sidebar, status bar) follows the theme normally.
                    className="relative cursor-text bg-[hsl(var(--paper))] text-[hsl(var(--paper-foreground))] shadow-md"
                    style={{
                      width: pageDims.w * zoom,
                      height: pageDims.h * zoom,
                    }}
                    onMouseDown={(e) => handlePageMouseDown(i, e)}
                    // Mouse move / up / leave are handled at the document
                    // level by listeners attached in handlePageMouseDown.
                    // This keeps drag selection consistent across page gaps
                    // and chrome (PDF-like behavior).
                    onContextMenu={(e) => handlePageContextMenu(i, e)}
                  >
                    {/* SVG mount target — kept as a separate child so the
                      cursor overlay survives renderPageInto's
                      el.replaceChildren(adopted) call. */}
                    <div
                      ref={(el) => {
                        pageRefsRef.current[i] = el;
                      }}
                      data-testid="studio-viewer-page"
                      data-page-idx={i}
                      className="absolute inset-0"
                    />
                    {/* chunk 57 — AI-applied paragraph highlight. A
                      thin amber stripe along the left edge of each
                      changed paragraph, fades after 15s. Pointer
                      events disabled so it doesn't intercept text
                      selection. */}
                    {(changedParaRects[i] ?? []).map((r, ri) => (
                      <div
                        key={`changed-${ri}`}
                        data-testid="studio-changed-stripe"
                        className="pointer-events-none absolute animate-pulse rounded-r bg-amber-400/60"
                        style={{
                          left: r.x * zoom,
                          top: r.y * zoom,
                          width: 3,
                          height: r.height * zoom,
                        }}
                      />
                    ))}
                    {/* Selection highlight overlay — one rect per visible
                      line in the selection range, computed via
                      getSelectionRects. */}
                    {(selectionRectsByPage[i] ?? []).map((r, ri) => (
                      <div
                        key={ri}
                        data-testid="studio-selection-rect"
                        // chunk 22 — selection rects are interactive so the
                        // user can grab them as a drag source. Mousedown
                        // here also passes through to text selection /
                        // caret movement via the page surface's pointer
                        // event, but HTML5 drag fires on its own threshold
                        // (no mouseup needed). This matches native browser
                        // text selection drag UX.
                        className="absolute cursor-grab bg-primary/25 active:cursor-grabbing"
                        draggable={isActive}
                        onDragStart={(e) => {
                          const cap = captureExcerpt();
                          if (!cap) {
                            e.preventDefault();
                            return;
                          }
                          const payload = {
                            docPath: path,
                            sectionIndex: cap.sectionIndex,
                            startParagraphIndex: cap.startParagraphIndex,
                            startOffset: cap.startOffset,
                            endParagraphIndex: cap.endParagraphIndex,
                            endOffset: cap.endOffset,
                            text: cap.text,
                          };
                          try {
                            e.dataTransfer.setData(
                              'application/x-ahwp-excerpt',
                              JSON.stringify(payload),
                            );
                            e.dataTransfer.setData('text/plain', cap.text);
                            e.dataTransfer.effectAllowed = 'copy';
                          } catch {
                            /* dataTransfer can throw under hardened CSP */
                          }
                        }}
                        style={{
                          left: r.x * zoom,
                          top: r.y * zoom,
                          width: r.width * zoom,
                          height: r.height * zoom,
                        }}
                      />
                    ))}
                    {/* Find match highlights (chunk 9). Active match rendered
                      with a stronger color so it stands out from the rest. */}
                    {(findHighlightsByPage[i] ?? []).map((r, ri) => (
                      <div
                        key={`fm-${ri}`}
                        data-testid={
                          r.isActive
                            ? 'studio-find-match-active'
                            : 'studio-find-match'
                        }
                        className={
                          'pointer-events-none absolute ' +
                          (r.isActive ? 'bg-amber-400/70' : 'bg-amber-300/35')
                        }
                        style={{
                          left: r.x * zoom,
                          top: r.y * zoom,
                          width: r.width * zoom,
                          height: r.height * zoom,
                        }}
                      />
                    ))}
                    {cursorRect && cursorRect.pageIndex === i && (
                      <div
                        data-testid="studio-cursor"
                        className="pointer-events-none absolute animate-pulse bg-foreground"
                        style={{
                          left: cursorRect.x * zoom,
                          top: cursorRect.y * zoom,
                          width: Math.max(1, zoom),
                          height: cursorRect.height * zoom,
                        }}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {cellMenu && (
          <CellContextMenu
            state={cellMenu}
            onClose={() => setCellMenu(null)}
            onInsertRowAbove={() =>
              insertTableRowAt(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                Math.floor(cellMenu.cellIndex / cellMenu.colCount),
                false,
              )
            }
            onInsertRowBelow={() =>
              insertTableRowAt(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                Math.floor(cellMenu.cellIndex / cellMenu.colCount),
                true,
              )
            }
            onInsertColLeft={() =>
              insertTableColumnAt(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                cellMenu.cellIndex % cellMenu.colCount,
                false,
              )
            }
            onInsertColRight={() =>
              insertTableColumnAt(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                cellMenu.cellIndex % cellMenu.colCount,
                true,
              )
            }
            onDeleteRow={() => {
              if (cellMenu.rowCount <= 1) {
                deleteWholeTable(
                  cellMenu.sectionIndex,
                  cellMenu.parentParaIndex,
                  cellMenu.controlIndex,
                );
              } else {
                deleteTableRowAt(
                  cellMenu.sectionIndex,
                  cellMenu.parentParaIndex,
                  cellMenu.controlIndex,
                  Math.floor(cellMenu.cellIndex / cellMenu.colCount),
                );
              }
            }}
            onDeleteCol={() => {
              if (cellMenu.colCount <= 1) {
                deleteWholeTable(
                  cellMenu.sectionIndex,
                  cellMenu.parentParaIndex,
                  cellMenu.controlIndex,
                );
              } else {
                deleteTableColumnAt(
                  cellMenu.sectionIndex,
                  cellMenu.parentParaIndex,
                  cellMenu.controlIndex,
                  cellMenu.cellIndex % cellMenu.colCount,
                );
              }
            }}
            onMergeRight={() => {
              const row = Math.floor(cellMenu.cellIndex / cellMenu.colCount);
              const col = cellMenu.cellIndex % cellMenu.colCount;
              mergeCells(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                row,
                col,
                row,
                col + 1,
              );
            }}
            onMergeBelow={() => {
              const row = Math.floor(cellMenu.cellIndex / cellMenu.colCount);
              const col = cellMenu.cellIndex % cellMenu.colCount;
              mergeCells(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                row,
                col,
                row + 1,
                col,
              );
            }}
            onSplit2x2={() => {
              const row = Math.floor(cellMenu.cellIndex / cellMenu.colCount);
              const col = cellMenu.cellIndex % cellMenu.colCount;
              splitCellInto(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                row,
                col,
                2,
                2,
              );
            }}
            onUnmerge={() => {
              const row = Math.floor(cellMenu.cellIndex / cellMenu.colCount);
              const col = cellMenu.cellIndex % cellMenu.colCount;
              unmergeCell(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
                row,
                col,
              );
            }}
            canMergeRight={
              (cellMenu.cellIndex % cellMenu.colCount) + 1 < cellMenu.colCount
            }
            canMergeBelow={
              Math.floor(cellMenu.cellIndex / cellMenu.colCount) + 1 <
              cellMenu.rowCount
            }
            onDeleteTable={() =>
              deleteWholeTable(
                cellMenu.sectionIndex,
                cellMenu.parentParaIndex,
                cellMenu.controlIndex,
              )
            }
            onOpenTableProps={onOpenTableProps}
            onOpenCellProps={onOpenCellProps}
            onOpenCellStylePicker={onOpenCellStylePicker}
            onOpenFormula={onOpenFormula}
          />
        )}

        {aiMenu && onAiCommand && (
          <AiCommandMenu
            x={aiMenu.x}
            y={aiMenu.y}
            onClose={() => setAiMenu(null)}
            onPick={(template) => {
              const ex = captureExcerpt();
              if (!ex) {
                setAiMenu(null);
                return;
              }
              const prompt = template.replace('{{TEXT}}', ex.text);
              onAiCommand(prompt);
              setAiMenu(null);
            }}
          />
        )}

        {slashMenu && (
          <SlashMenu
            x={slashMenu.x}
            y={slashMenu.y}
            onClose={() => {
              setSlashMenu(null);
              scrollRef.current?.focus({ preventScroll: true });
            }}
            onPick={(id) => {
              // Re-position caret onto the slash-menu's source
              // paragraph (in case the user clicked elsewhere first).
              caretRef.current = {
                ...caretRef.current,
                sectionIndex: slashMenu.sectionIndex,
                paragraphIndex: slashMenu.paragraphIndex,
                charOffset: 0,
              };
              if (id === 'list-bullet') {
                toggleList('bullet');
              } else if (id === 'list-number') {
                toggleList('number');
              } else if (id === 'page-break') {
                insertPageBreak();
              } else {
                // heading-1 / -2 / -3: resolve the styleId from the
                // doc's style list. If the doc has no matching style
                // we silently no-op — adding heading styles is a
                // separate flow (스타일 관리 다이얼로그).
                const level =
                  id === 'heading-1' ? 1 : id === 'heading-2' ? 2 : 3;
                const target =
                  styleList.find(
                    (s) =>
                      s.name === `제목 ${level}` ||
                      s.englishName === `Heading ${level}`,
                  ) ?? null;
                if (target) {
                  applyParagraphStyle(target.id);
                }
              }
              setSlashMenu(null);
              scrollRef.current?.focus({ preventScroll: true });
            }}
          />
        )}

        {phase !== 'ready' && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {phase === 'mounting' && '@rhwp/core 초기화 중…'}
              {phase === 'reading' && '파일 읽는 중…'}
              {phase === 'rendering' && '문서 파싱 중…'}
            </span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 px-6 text-center">
            <AlertTriangle className="size-8 text-destructive" />
            <div className="text-sm font-medium">파일을 열지 못했습니다</div>
            <pre className="max-w-md whitespace-pre-wrap text-xs text-muted-foreground">
              {error}
            </pre>
          </div>
        )}

        {showToolbar && (
          <div
            className="flex h-9 items-center gap-1 border-t border-border bg-card px-3 text-xs"
            data-testid="studio-statusbar"
          >
            <Button
              size="sm"
              variant="ghost"
              onClick={() => undo()}
              disabled={!canUndo}
              aria-label="실행 취소"
              data-testid="studio-undo"
            >
              <Undo2 className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => redo()}
              disabled={!canRedo}
              aria-label="다시 실행"
              data-testid="studio-redo"
            >
              <Redo2 className="size-4" />
            </Button>
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stepZoom('out')}
              aria-label="축소"
              data-testid="studio-zoom-out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span
              className="min-w-[3.5rem] text-center font-mono text-muted-foreground"
              data-testid="studio-zoom-level"
            >
              {Math.round(zoom * 100)}%
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stepZoom('in')}
              aria-label="확대"
              data-testid="studio-zoom-in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setZoom(1)}
              data-testid="studio-zoom-reset"
            >
              100%
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={setZoomFit}
              aria-label="너비 맞춤"
              data-testid="studio-zoom-fit"
            >
              <Maximize2 className="size-4" />
            </Button>
            <span
              className="ml-auto text-muted-foreground"
              data-testid="studio-doc-stats"
              title={`단어 ${docStats.words.toLocaleString()} · 글자 ${docStats.chars.toLocaleString()} · 단락 ${docStats.paragraphs.toLocaleString()}`}
            >
              {docStats.words.toLocaleString()} 단어 ·{' '}
              {docStats.chars.toLocaleString()} 글자
            </span>
            {dirty && (
              <span
                className="ml-2 text-amber-500"
                data-testid="studio-dirty-indicator"
                title="저장되지 않은 변경사항"
              >
                ●
              </span>
            )}
            <span
              className="ml-2 text-muted-foreground"
              data-testid="studio-page-indicator"
            >
              {currentPage + 1} / {pageCount}
            </span>
          </div>
        )}
      </div>
    );
  },
);
