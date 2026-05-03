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
  useRef,
  useState,
  type CompositionEvent as ReactCompositionEvent,
} from 'react';
import { Button } from '@/components/ui/button';
// `ensureRhwpCore` 는 R1.1 에서 useDocumentLifecycle 로 이동.
import { HwpDocument } from '@/lib/rhwp-core';
import { type PageDims } from '@/features/studio/utils/page-dims';
// `relocateExcerpt` 는 R1.8 에서 useViewerHandle 로 이동.
import { callCellOp } from '@/features/studio/utils/cell-op';
import { useDocumentLifecycle } from '@/features/studio/hooks/useDocumentLifecycle';
import { useUndoHistory } from '@/features/studio/hooks/useUndoHistory';
import { useFindReplace } from '@/features/studio/hooks/useFindReplace';
import { useKeyboardShortcuts } from '@/features/studio/hooks/useKeyboardShortcuts';
import { PaperPage } from './PaperPage';
import { useViewerHandle } from '@/features/studio/hooks/useViewerHandle';
import { useDebugSurface } from '@/features/studio/hooks/useDebugSurface';
import { usePageMouseHandlers } from '@/features/studio/hooks/usePageMouseHandlers';
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

// `PageDims` 는 R1.0 에서 `utils/page-dims.ts` 로 추출됨.

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
// `relocateExcerpt` + `RELOCATE_PARA_SCAN_LIMIT` + `DocReadOnly` 는
// `src/features/studio/utils/relocate-excerpt.ts` 로 추출됨 (R1.0
// refactor). 본 파일은 import 만.
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
  // Open timestamp — used as a debounce so the same right-click gesture
  // that mounted us doesn't immediately close us via outside-mousedown.
  // Any mousedown landing within 100ms of mount is the trigger event;
  // anything later is genuine user input. Initialized inside the
  // mount effect to keep render pure.
  const openedAtRef = useRef(0);
  useEffect(() => {
    openedAtRef.current = performance.now();
    const onDown = (e: MouseEvent): void => {
      if (performance.now() - openedAtRef.current < 100) return;
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
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
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
      className="fixed z-50 min-w-40 rounded-md border border-border bg-popover py-1 shadow-md"
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
  const openedAtRef = useRef(0);
  useEffect(() => {
    openedAtRef.current = performance.now();
    const onDown = (e: MouseEvent): void => {
      if (performance.now() - openedAtRef.current < 100) return;
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
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="studio-ai-context-menu"
      className="fixed z-50 min-w-48 rounded-md border border-border bg-popover py-1 shadow-md"
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
 *
 * R1.7 — `HorizontalRuler` 는 `PaperPage.tsx` 로 이전.
 */

// `parsePageDimensions` + `PageDims` 는 `src/features/studio/utils/page-dims.ts`
// 로 추출됨 (R1.0 refactor). 본 파일은 import 만.

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
      // Phase E — nested table 경로. 길이 1이면 top-level (기존),
      // 2+면 중첩 (셀 안 표 안 셀...). 마지막 segment의 controlIndex /
      // cellIndex / cellParaIndex가 위 단일-level 필드와 동일.
      path?: Array<{
        controlIndex: number;
        cellIndex: number;
        cellParaIndex: number;
      }>;
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
        cell?: {
          parentParaIndex: number;
          controlIndex: number;
          cellIndex: number;
          cellParaIndex: number;
          // Phase E — nested 표 경로. 길이 1이면 top-level 표 (기존 동작),
          // 길이 > 1이면 중첩 (셀 안 표 안 셀...). 첫 요소는 가장 바깥
          // 표의 cell info, 마지막 요소는 현재 caret의 cell info.
          path?: Array<{
            controlIndex: number;
            cellIndex: number;
            cellParaIndex: number;
          }>;
        };
      };
      focus: {
        sectionIndex: number;
        paragraphIndex: number;
        charOffset: number;
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
    // Per-page bounding boxes for controls (tables for v1) that the
    // drag passed over. Rendered as a tinted overlay so the user sees
    // the object as "selected" alongside the surrounding text rects.
    // Collected during applyPointerToSelection's control-hit branch
    // and cleared on body mousedown / Esc / drag-collapse.
    const [selectedControlBboxes, setSelectedControlBboxes] = useState<
      Record<number, { x: number; y: number; width: number; height: number }[]>
    >({});
    // Phase A — multi-cell block highlights. Populated when drag
    // starts in cell A and crosses into cell B of the same table:
    // we switch from char-level cell selection to Hancom-style
    // cell-block selection (selection unit = whole cells). Each
    // entry is a cell bbox rectangle. Computed via getTableCellBboxes
    // by filtering cells inside the rectangular row/column range
    // spanned by anchor.cell and focus.cell.
    const [cellBlockHighlights, setCellBlockHighlights] = useState<
      Record<number, { x: number; y: number; width: number; height: number }[]>
    >({});
    // Phase D 2차 — 마퀴 모드 (도형 탭 영역 선택). 모드 활성 시
    // mousedown+drag는 텍스트 selection 대신 사각형 마퀴를 그림.
    // mouseup 시 마퀴와 겹치는 표를 selectedControlBboxes로 highlight.
    // 토글: ⌘⇧M / Esc로 종료.
    const [marqueeMode, setMarqueeMode] = useState(false);
    // 진행 중인 marquee rect — scrollRef-relative 좌표. null이면 안
    // 그리는 중. JSX에서 overlay 렌더에 사용.
    const [marqueeRect, setMarqueeRect] = useState<{
      x: number;
      y: number;
      w: number;
      h: number;
    } | null>(null);
    const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
    // Phase D — 불연속 셀 추적. Ctrl+클릭으로 추가된 cells (rectangle
    // range 외 추가). M/S/format ops iteration 시 사용. Plain mousedown /
    // Esc / drag 시작 시 모두 리셋.
    const discontiguousCellsRef = useRef<
      Array<{
        parentParaIndex: number;
        controlIndex: number;
        cellIndex: number;
      }>
    >([]);
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
    // Cell-drag context. When mousedown lands inside a table cell, we
    // enable drag selection scoped to that cell — anchor and focus
    // both stay inside it. Set in handlePageMouseDown's cell branch,
    // cleared on mouseup / Esc / mousedown outside cell.
    const cellDragRef = useRef<{
      parentParaIndex: number;
      controlIndex: number;
      cellIndex: number;
      cellParaIndex: number;
    } | null>(null);
    // Sticky cell-block 모드. cell drag 중 cursor가 anchor 셀을 벗어나
    // 다른 셀로 진입한 적이 한 번이라도 있으면 true. 이후 cursor가
    // anchor 셀로 되돌아와도 char-level selection으로 toggle 안 함
    // (highlight 깜빡임 방지) — 한컴 reference 동작.
    // mousedown(셀)에서 false로 reset, mouseup에서 항상 false.
    const cellDragStickyRef = useRef(false);
    // F5 press counter — Hancom convention: F5 1×=current cell block,
    // F5 2×=확장 모드(arrow로 cell block 확장), F5 3×=표 전체 block.
    // Reset whenever caret moves or any non-F5 key fires.
    const f5PressCountRef = useRef(0);
    const f5LastPressRef = useRef(0);
    // Phase B-2.5 — F5 확장 모드 활성 여부. true면 화살표가 셀 단위로
    // cell-block의 focus 셀을 이동해 block 범위 확장. mousedown / Esc /
    // F5 외 다른 키 / 셀 밖으로 caret 이동 시 자동 해제.
    // ref + state 듀얼 트래킹 — keydown handler는 동기 ref 읽기,
    // 상태바 indicator는 state 구독 (B-2.6).
    const cellBlockExtendModeRef = useRef(false);
    const [cellBlockExtendMode, setCellBlockExtendModeState] = useState(false);
    const setCellBlockExtendMode = useCallback((v: boolean): void => {
      cellBlockExtendModeRef.current = v;
      setCellBlockExtendModeState(v);
    }, []);
    // F3 press counter (본문 block) — 1×=block extend mode (현재
    // Shift+arrow와 동등 동작이라 noop), 2×=단어 선택 (=더블클릭),
    // 3×=단락 선택 (=트리플클릭), 4×=문서 전체 선택 (=⌘A).
    const f3PressCountRef = useRef(0);
    const f3LastPressRef = useRef(0);
    // Undo/Redo (chunk 7). The doc IR exposes snapshot save/restore as a
    // bidirectional stack: each saveSnapshot returns an integer id; we
    // record IDs in chronological order along with an index pointer to
    // the "current" entry. New mutations after an undo discard the redo
    // tail. R1.2 — bookkeeping moved to useUndoHistory; the ref + state
    // stay here because the doc-load effect / __studioDebug also read
    // them, and React state setters live with their useState anyway.
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
    // Find/Replace (chunk 9 + 7) — state · refs · callbacks · effects 모두
    // R1.3 에서 useFindReplace hook 으로 이전. 호출은 sortRange /
    // refreshAfterMutation 등 dependencies 가 모두 정의된 뒤 (아래) 에서.
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

    // Effect 1: load doc, render page 0, prime cache, seed UI state.
    // 본 effect 의 ~150 라인 본체는 R1.1 refactor 에서 useDocumentLifecycle
    // 로 분해 (utils 가 아닌 hook — useEffect + 의존 ref/setter 조합).
    useDocumentLifecycle({
      path,
      docRef,
      caretRef,
      cacheRef,
      pageRefsRef,
      dirtyRef,
      historyRef,
      findTextCacheRef,
      setDirty,
      setCanUndo,
      setCanRedo,
      setError,
      setPhase,
      setCursorRect,
      setStyleList,
      setActiveFormat,
      setPageCount,
      setPageDims,
    });

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
        let rectJson: string;
        if (c.cell) {
          // R6 — Phase E nested table 분기 callCellOp 통합.
          rectJson = callCellOp(
            c.cell,
            c.sectionIndex,
            doc.getCursorRectInCell.bind(doc),
            doc.getCursorRectByPath.bind(doc),
            c.charOffset,
          );
        } else {
          rectJson = doc.getCursorRect(
            c.sectionIndex,
            c.paragraphIndex,
            c.charOffset,
          );
        }
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
        // Cell-internal selection: both anchor and focus must live in
        // the same cell + same cell-paragraph. Route to
        // getSelectionRectsInCell. Cross-cell or cell↔body selection
        // is not yet supported (cell selection v1 — anchor.cell ===
        // focus.cell required at the same cellParaIndex).
        const ac = sel.anchor.cell;
        const fc = sel.focus.cell;
        if (
          ac &&
          fc &&
          ac.parentParaIndex === fc.parentParaIndex &&
          ac.controlIndex === fc.controlIndex &&
          ac.cellIndex === fc.cellIndex &&
          ac.cellParaIndex === fc.cellParaIndex
        ) {
          if (sel.anchor.charOffset === sel.focus.charOffset) {
            setSelectionRectsByPage({});
            return;
          }
          const startOff = Math.min(
            sel.anchor.charOffset,
            sel.focus.charOffset,
          );
          const endOff = Math.max(sel.anchor.charOffset, sel.focus.charOffset);
          try {
            const rects = JSON.parse(
              doc.getSelectionRectsInCell(
                sel.anchor.sectionIndex,
                ac.parentParaIndex,
                ac.controlIndex,
                ac.cellIndex,
                ac.cellParaIndex,
                startOff,
                ac.cellParaIndex,
                endOff,
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
            console.warn('[studio] getSelectionRectsInCell failed:', err);
            setSelectionRectsByPage({});
          }
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
          // @rhwp/core 0.7.9 bug — for a selection that crosses a
          // wrapped paragraph boundary the per-line rects can come
          // back with the SAME y for the first and the wrapped
          // continuation line(s). Visual symptom: the wrapped line
          // appears blank because its rect is rendered on top of the
          // first line. Detect duplicate y per page and stagger them
          // down by the rect's own height so each wrapped line lands
          // at its true visual row. Real same-y segments (e.g. inline
          // controls splitting one line) are uncommon enough in HWP
          // body text that this heuristic is safe; we re-evaluate if
          // the lib publishes a fix.
          const fixedRects = (() => {
            const byPage = new Map<
              number,
              { x: number; y: number; width: number; height: number }[]
            >();
            // Stable order ensures same-y duplicates appear in source
            // order (first-encountered = first line, next = wrapped).
            for (const rect of rects) {
              const arr = byPage.get(rect.pageIndex) ?? [];
              arr.push({
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
              });
              byPage.set(rect.pageIndex, arr);
            }
            for (const arr of byPage.values()) {
              const seenY = new Map<number, number>(); // original y → cumulative shift
              for (const rect of arr) {
                const orig = rect.y;
                const shift = seenY.get(orig);
                if (shift !== undefined) {
                  rect.y = orig + shift + rect.height;
                  seenY.set(orig, shift + rect.height);
                } else {
                  seenY.set(orig, 0);
                }
              }
            }
            return byPage;
          })();
          const grouped: Record<
            number,
            { x: number; y: number; width: number; height: number }[]
          > = {};
          for (const [pageIndex, arr] of fixedRects) {
            grouped[pageIndex] = arr;
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
      setSelectedControlBboxes({});
      setCellBlockHighlights({});
      discontiguousCellsRef.current = [];
    }, [setSelection]);

    /**
     * Phase A — multi-cell block highlight refresh. Computes the cell
     * bbox rectangles spanned by [anchor.cell, focus.cell] of the same
     * table and stores them per-page. Caller must guarantee both
     * anchor.cell and focus.cell exist + share parentParaIndex /
     * controlIndex (= same table). When focus.cell.cellIndex differs
     * from anchor.cell.cellIndex this is the active rendering path —
     * the inner-cell text-rect path (refreshSelectionRects via
     * getSelectionRectsInCell) is skipped because IR's per-line
     * rect API only handles same-cell selections.
     */
    const refreshCellBlockHighlights = useCallback(
      (sel: typeof selection): void => {
        const doc = docRef.current;
        if (!doc || !sel) {
          setCellBlockHighlights({});
          return;
        }
        const ac = sel.anchor.cell;
        const fc = sel.focus.cell;
        if (
          !ac ||
          !fc ||
          ac.parentParaIndex !== fc.parentParaIndex ||
          ac.controlIndex !== fc.controlIndex
        ) {
          setCellBlockHighlights({});
          return;
        }
        try {
          // Phase E — nested table 지원. anchor.cell.path 길이가 2+이면
          // 중첩 표 내부 cell이므로 ByPath API 사용. path는 hitTest가
          // 채워준 (controlIndex/cellIndex/cellParaIndex) 체인. 우리는
          // 가장 안쪽 표의 cells가 필요하므로 path 전체를 path_json으로
          // 전달 (마지막 segment에서 안쪽 표 식별).
          const isNested =
            !!ac.path && ac.path.length > 1 && !!fc.path && fc.path.length > 1;
          const cellsJson = isNested
            ? doc.getTableCellBboxesByPath(
                sel.anchor.sectionIndex,
                ac.parentParaIndex,
                JSON.stringify(ac.path!.slice(0, -1)),
              )
            : doc.getTableCellBboxes(
                sel.anchor.sectionIndex,
                ac.parentParaIndex,
                ac.controlIndex,
              );
          const cells = JSON.parse(cellsJson) as {
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
          }[];
          const anchorCell = cells.find((c) => c.cellIdx === ac.cellIndex);
          const focusCell = cells.find((c) => c.cellIdx === fc.cellIndex);
          if (!anchorCell || !focusCell) {
            setCellBlockHighlights({});
            return;
          }
          const minRow = Math.min(anchorCell.row, focusCell.row);
          const maxRow = Math.max(
            anchorCell.row + anchorCell.rowSpan - 1,
            focusCell.row + focusCell.rowSpan - 1,
          );
          const minCol = Math.min(anchorCell.col, focusCell.col);
          const maxCol = Math.max(
            anchorCell.col + anchorCell.colSpan - 1,
            focusCell.col + focusCell.colSpan - 1,
          );
          const grouped: Record<
            number,
            { x: number; y: number; width: number; height: number }[]
          > = {};
          for (const c of cells) {
            const cRowEnd = c.row + c.rowSpan - 1;
            const cColEnd = c.col + c.colSpan - 1;
            // Cell intersects the rectangle iff both row and col
            // ranges overlap.
            if (
              cRowEnd >= minRow &&
              c.row <= maxRow &&
              cColEnd >= minCol &&
              c.col <= maxCol
            ) {
              (grouped[c.pageIndex] ??= []).push({
                x: c.x,
                y: c.y,
                width: c.w,
                height: c.h,
              });
            }
          }
          setCellBlockHighlights(grouped);
        } catch (err) {
          console.warn('[studio] getTableCellBboxes failed:', err);
          setCellBlockHighlights({});
        }
      },
      [],
    );

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
      // chunk UX-fix #4 — caret in a cell: the IR has no
      // `getCharPropertiesAtInCell` getter, so we can't read the
      // cell-paragraph's char shape directly. Reading body coords with
      // a cell caret returns wrong data (parent-paragraph default).
      // Keep the last-known activeFormat instead — better than showing
      // a stale body value as if it were the cell's format.
      if (c.cell) return;
      // chunk UX-fix #4 — when a selection is active, read the format
      // at the START of the selection (in document order). This matches
      // the Word/Pages convention "what would a Bold toggle apply to":
      // the user selected those chars, so the toolbar should show
      // their format, not the format at the focus end (which after a
      // top-down drag is the format AFTER the selection).
      // The IR's char-properties at offset N is the *trailing* format
      // (i.e. format of char at index N-1), so we read at startOffset+1
      // to land inside the first selected character. Caret-only mode
      // reads at the caret's offset directly (existing behavior).
      let readPara = c.paragraphIndex;
      let readOffset = c.charOffset;
      const sel = selectionRef.current;
      if (sel) {
        const r = sortRange(sel.anchor, sel.focus);
        if (!r.empty) {
          readPara = r.startPara;
          // startOffset is 0-based "before this char". Add 1 to land
          // inside the first selected char. If startOffset == endOffset
          // we'd be empty (handled above by `r.empty`).
          readOffset = r.startOffset + 1;
        }
      }
      try {
        const cp = JSON.parse(
          doc.getCharPropertiesAt(c.sectionIndex, readPara, readOffset),
        ) as CharProps;
        const at = JSON.parse(doc.getStyleAt(c.sectionIndex, readPara)) as {
          id: number;
        };
        let alignment: ParaAlignment = 'left';
        try {
          const pp = JSON.parse(
            doc.getParaPropertiesAt(c.sectionIndex, readPara),
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
    }, [sortRange]);

    // R1.2 — undo/redo 스택 + grouping bracket → useUndoHistory hook.
    // The hook owns saveSnapshot/restoreSnapshot/discardSnapshot calls,
    // history index bookkeeping, redo-tail discard, depth-cap, dirty/
    // canUndo/canRedo flag updates, and group depth counting. Caller-side
    // post-restore cleanup (selection drop + cursor / format refresh) is
    // passed in via `afterRestore`.
    const afterRestore = useCallback((): void => {
      setSelection(null);
      setSelectionRectsByPage({});
      refreshCursorRect();
      refreshActiveFormat();
    }, [setSelection, refreshCursorRect, refreshActiveFormat]);

    const { pushHistory, undo, redo, beginUndoGroup, endUndoGroup } =
      useUndoHistory({
        docRef,
        historyRef,
        undoGroupDepthRef,
        cacheRef,
        pageRefsRef,
        caretRef,
        dirtyRef,
        setCanUndo,
        setCanRedo,
        setDirty,
        renderPageInto,
        afterRestore,
      });

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
            // Phase D — caret 셀 + Ctrl+클릭으로 추가된 불연속 셀 모두에
            // 같은 char format을 일괄 적용 (cell-block selection이 자체
            // selection state로 표현 안 되는 부분 보완).
            const targetCells = [
              {
                parentParaIndex: c.cell.parentParaIndex,
                controlIndex: c.cell.controlIndex,
                cellIndex: c.cell.cellIndex,
                cellParaIndex: c.cell.cellParaIndex,
              },
              ...discontiguousCellsRef.current.map((d) => ({
                parentParaIndex: d.parentParaIndex,
                controlIndex: d.controlIndex,
                cellIndex: d.cellIndex,
                cellParaIndex: 0,
              })),
            ];
            // Dedupe by cellIndex within same table.
            const seen = new Set<string>();
            for (const t of targetCells) {
              const key = `${t.parentParaIndex}:${t.controlIndex}:${t.cellIndex}:${t.cellParaIndex}`;
              if (seen.has(key)) continue;
              seen.add(key);
              doc.applyCharFormatInCell(
                c.sectionIndex,
                t.parentParaIndex,
                t.controlIndex,
                t.cellIndex,
                t.cellParaIndex,
                0,
                PARAGRAPH_END_SENTINEL,
                propsJson,
              );
            }
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
        // R6 — Phase E nested table 분기를 callCellOp 으로 일원화.
        callCellOp(
          c.cell,
          c.sectionIndex,
          doc.insertTextInCell.bind(doc),
          doc.insertTextInCellByPath.bind(doc),
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
        // R6 — Phase E nested table 분기를 callCellOp 으로 일원화.
        callCellOp(
          c.cell,
          c.sectionIndex,
          doc.deleteTextInCell.bind(doc),
          doc.deleteTextInCellByPath.bind(doc),
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
      // chunk 32 — cell-block selection (anchor.cell ≠ focus.cell, 같은 표
      // 안)이면 TSV로 직렬화 (cells \t, rows \n) — Excel/Word/한컴
      // 스프레드시트 호환 paste 형식.
      const ac = sel.anchor.cell;
      const fc = sel.focus.cell;
      const cellBlockActive =
        ac &&
        fc &&
        ac.parentParaIndex === fc.parentParaIndex &&
        ac.controlIndex === fc.controlIndex &&
        (ac.cellIndex !== fc.cellIndex ||
          ac.cellParaIndex !== fc.cellParaIndex);
      if (cellBlockActive) {
        try {
          const isNested = !!ac.path && ac.path.length > 1;
          const cellsJson = isNested
            ? doc.getTableCellBboxesByPath(
                sel.anchor.sectionIndex,
                ac.parentParaIndex,
                JSON.stringify(ac.path!.slice(0, -1)),
              )
            : doc.getTableCellBboxes(
                sel.anchor.sectionIndex,
                ac.parentParaIndex,
                ac.controlIndex,
              );
          const cells = JSON.parse(cellsJson) as {
            cellIdx: number;
            row: number;
            col: number;
            rowSpan: number;
            colSpan: number;
          }[];
          const anchorCell = cells.find((c) => c.cellIdx === ac.cellIndex);
          const focusCell = cells.find((c) => c.cellIdx === fc.cellIndex);
          if (!anchorCell || !focusCell) return false;
          const minRow = Math.min(anchorCell.row, focusCell.row);
          const maxRow = Math.max(
            anchorCell.row + anchorCell.rowSpan - 1,
            focusCell.row + focusCell.rowSpan - 1,
          );
          const minCol = Math.min(anchorCell.col, focusCell.col);
          const maxCol = Math.max(
            anchorCell.col + anchorCell.colSpan - 1,
            focusCell.col + focusCell.colSpan - 1,
          );
          const rows: string[] = [];
          for (let r = minRow; r <= maxRow; r++) {
            const cols: string[] = [];
            for (let c = minCol; c <= maxCol; c++) {
              // Find cell at (r, c) — match by row & col (handle merged cells:
              // pick the cell whose row-range and col-range cover (r, c)).
              const target = cells.find(
                (cell) =>
                  cell.row <= r &&
                  cell.row + cell.rowSpan - 1 >= r &&
                  cell.col <= c &&
                  cell.col + cell.colSpan - 1 >= c,
              );
              if (!target) {
                cols.push('');
                continue;
              }
              // Build full cell text: paragraphs joined by \n.
              try {
                const paraCount = doc.getCellParagraphCount(
                  sel.anchor.sectionIndex,
                  ac.parentParaIndex,
                  ac.controlIndex,
                  target.cellIdx,
                );
                const paras: string[] = [];
                for (let cp = 0; cp < paraCount; cp++) {
                  const len = doc.getCellParagraphLength(
                    sel.anchor.sectionIndex,
                    ac.parentParaIndex,
                    ac.controlIndex,
                    target.cellIdx,
                    cp,
                  );
                  if (len === 0) {
                    paras.push('');
                    continue;
                  }
                  const txt = doc.getTextInCell(
                    sel.anchor.sectionIndex,
                    ac.parentParaIndex,
                    ac.controlIndex,
                    target.cellIdx,
                    cp,
                    0,
                    len,
                  );
                  paras.push(txt);
                }
                cols.push(paras.join('\n'));
              } catch {
                cols.push('');
              }
            }
            rows.push(cols.join('\t'));
          }
          const tsv = rows.join('\n');
          await window.api.clipboard.writeText(tsv);
          return true;
        } catch (err) {
          console.warn('[studio] cell-block copy failed:', err);
          return false;
        }
      }
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

    // R1.3 — Find/Replace (chunk 9 + 7) → useFindReplace hook. State /
    // refs / callbacks / 두 effects 모두 hook 안으로 이전.
    const {
      findOpen,
      findQuery,
      findMatches,
      findIndex,
      findHighlightsByPage,
      replaceQuery,
      replaceFeedback,
      findInputRef,
      replaceInputRef,
      setFindQuery,
      setReplaceQuery,
      runFindSearch,
      findNext,
      findPrev,
      openFind,
      closeFind,
      openReplace,
      replaceCurrent,
      replaceAllMatches,
    } = useFindReplace({
      docRef,
      caretRef,
      pageRefsRef,
      selectionRef,
      scrollRef,
      findTextCacheRef,
      sortRange,
      refreshAfterMutation,
      setCursorRect,
    });

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
        // chunk 32 — TSV(셀 \t / 행 \n) cell-block paste. caret이 셀 안 +
        // clipboard text가 multi-cell (\t 포함 또는 multi-line) 형태면
        // 시작 셀(caret 위치) 부터 row/col 격자에 분배해서 채움. 표 경계
        // 밖은 무시.
        const isMultiCell =
          (systemText.includes('\t') || systemText.includes('\n')) &&
          c.cell !== undefined;
        if (isMultiCell && c.cell) {
          const cell = c.cell;
          try {
            const isNested = !!cell.path && cell.path.length > 1;
            const cellsJson = isNested
              ? doc.getTableCellBboxesByPath(
                  c.sectionIndex,
                  cell.parentParaIndex,
                  JSON.stringify(cell.path!.slice(0, -1)),
                )
              : doc.getTableCellBboxes(
                  c.sectionIndex,
                  cell.parentParaIndex,
                  cell.controlIndex,
                );
            const cells = JSON.parse(cellsJson) as {
              cellIdx: number;
              row: number;
              col: number;
              rowSpan: number;
              colSpan: number;
            }[];
            const startCell = cells.find((x) => x.cellIdx === cell.cellIndex);
            if (startCell) {
              const rows = systemText.split('\n');
              let didPaste = false;
              for (let dr = 0; dr < rows.length; dr++) {
                const cols = rows[dr].split('\t');
                for (let dc = 0; dc < cols.length; dc++) {
                  const targetRow = startCell.row + dr;
                  const targetCol = startCell.col + dc;
                  const target = cells.find(
                    (x) =>
                      x.row <= targetRow &&
                      x.row + x.rowSpan - 1 >= targetRow &&
                      x.col <= targetCol &&
                      x.col + x.colSpan - 1 >= targetCol,
                  );
                  if (!target) continue; // out of bounds
                  // Clear existing text + insert new.
                  try {
                    const paraCount = doc.getCellParagraphCount(
                      c.sectionIndex,
                      cell.parentParaIndex,
                      cell.controlIndex,
                      target.cellIdx,
                    );
                    // Delete existing content in cell para 0.
                    const len0 = doc.getCellParagraphLength(
                      c.sectionIndex,
                      cell.parentParaIndex,
                      cell.controlIndex,
                      target.cellIdx,
                      0,
                    );
                    if (len0 > 0) {
                      doc.deleteTextInCell(
                        c.sectionIndex,
                        cell.parentParaIndex,
                        cell.controlIndex,
                        target.cellIdx,
                        0,
                        0,
                        len0,
                      );
                    }
                    // Drop extra paragraphs beyond para 0 (ignore best-effort).
                    void paraCount;
                    if (cols[dc].length > 0) {
                      doc.insertTextInCell(
                        c.sectionIndex,
                        cell.parentParaIndex,
                        cell.controlIndex,
                        target.cellIdx,
                        0,
                        0,
                        cols[dc],
                      );
                    }
                    didPaste = true;
                  } catch {
                    /* per-cell failure ignored */
                  }
                }
              }
              if (didPaste) {
                refreshAfterMutation();
                return true;
              }
            }
          } catch (err) {
            console.warn('[studio] cell-block paste failed:', err);
            // Fall through to text paste.
          }
        }
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

    // R1.8 — ViewerHandle imperative handle (~1180 라인) → useViewerHandle.
    useViewerHandle(ref, {
      docRef,
      caretRef,
      dirtyRef,
      pageRefsRef,
      historyRef,
      changedParaTimerRef,
      setDirty,
      setCursorRect,
      setChangedParaRects,
      activeFormat,
      styleList,
      captureExcerpt,
      getCellProps,
      getTableProps,
      refreshAfterMutation,
      setCellProps,
      setTableProps,
      toggleCharFormat,
      undo,
      redo,
      beginUndoGroup,
      endUndoGroup,
      copySelection,
      cutSelection,
      pasteAtCaret,
      openFind,
      openReplace,
      applyAlignment,
      applyFontSizePt,
      applyTextColor,
      applyParaProps,
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
    });

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
     *
     * R1.4 — 1100-라인 본체는 `useKeyboardShortcuts` hook 으로 이전.
     * 외부 contract / 동작 1:1 동일.
     */
    const handleKeyDown = useKeyboardShortcuts({
      docRef,
      caretRef,
      selectionRef,
      cellBlockExtendModeRef,
      marqueeStartRef,
      draggingRef,
      dragCleanupRef,
      cellDragRef,
      dragOriginSelectionRef,
      f5LastPressRef,
      f5PressCountRef,
      f3LastPressRef,
      f3PressCountRef,
      discontiguousCellsRef,
      scrollRef,
      pageRefsRef,
      setSelection,
      setSelectionRectsByPage,
      setSelectedControlBboxes,
      setCellBlockHighlights,
      setCellBlockExtendMode,
      setMarqueeMode,
      setMarqueeRect,
      setSlashMenu,
      cursorRect,
      pageDims,
      pageCount,
      zoom,
      marqueeMode,
      refreshAfterMutation,
      refreshCursorRect,
      refreshActiveFormat,
      refreshCellBlockHighlights,
      refreshSelectionRects,
      toggleCharFormat,
      clearSelection,
      deleteSelectionIfAny,
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
      commitCaretMove,
      findWordBoundsAt,
    });

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
      // Phase E — IR이 hit이 nested table 안일 때 외부 → 내부 cell 체인을
      // 채워서 반환. 길이 1 = top-level, 2+ = 중첩. ByPath API 사용 시
      // JSON.stringify해서 path_json 인자로 전달.
      cellPath?: Array<{
        controlIndex: number;
        cellIndex: number;
        cellParaIndex: number;
      }>;
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
     *
     * R1.5 + R1.6 — handlePageMouseDown (~785 라인 selection 모델 +
     * cell drag) + handlePageContextMenu (~73 라인) → usePageMouseHandlers.
     */
    const { handlePageMouseDown, handlePageContextMenu } = usePageMouseHandlers(
      {
        docRef,
        caretRef,
        selectionRef,
        scrollRef,
        pageRefsRef,
        marqueeStartRef,
        draggingRef,
        dragCleanupRef,
        cellDragRef,
        dragOriginSelectionRef,
        cellBlockExtendModeRef,
        cellDragStickyRef,
        discontiguousCellsRef,
        setSelection,
        setSelectionRectsByPage,
        setSelectedControlBboxes,
        setCellBlockHighlights,
        setMarqueeRect,
        setCellMenu,
        setAiMenu,
        setSlashMenu,
        setCursorRect,
        setCellBlockExtendMode,
        marqueeMode,
        zoom,
        hitTestAt,
        sortRange,
        clearSelection,
        refreshSelectionRects,
        refreshCellBlockHighlights,
        refreshCursorRect,
        refreshActiveFormat,
        findWordBoundsAt,
      },
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
     *
     * R1.8 — ~970-라인 본체는 useDebugSurface hook 으로 이전.
     */
    useDebugSurface({
      phase,
      isActive,
      pageCount,
      docRef,
      caretRef,
      dirtyRef,
      pageRefsRef,
      historyRef,
      selectionRef,
      cellBlockExtendModeRef,
      undoGroupDepthRef,
      f5LastPressRef,
      f5PressCountRef,
      f3LastPressRef,
      f3PressCountRef,
      discontiguousCellsRef,
      scrollRef,
      composingRef,
      changedParaTimerRef,
      cacheRef,
      findTextCacheRef,
      setDirty,
      setCursorRect,
      setChangedParaRects,
      setMarqueeMode,
      setMarqueeRect,
      setSelectedControlBboxes,
      setCellBlockHighlights,
      setSelectionRectsByPage,
      setSlashMenu,
      setCellBlockExtendMode,
      setSelection,
      setFindQuery,
      setReplaceQuery,
      activeFormat,
      styleList,
      selection,
      findOpen,
      findQuery,
      findMatches,
      findIndex,
      replaceQuery,
      replaceFeedback,
      captureExcerpt,
      pushHistory,
      refreshAfterMutation,
      renderPageInto,
      toggleCharFormat,
      applyParagraphStyle,
      sortRange,
      refreshSelectionRects,
      refreshActiveFormat,
      refreshCursorRect,
      refreshCellBlockHighlights,
      clearSelection,
      undo,
      redo,
      beginUndoGroup,
      endUndoGroup,
      copySelection,
      cutSelection,
      pasteAtCaret,
      openFind,
      closeFind,
      findNext,
      findPrev,
      runFindSearch,
      openReplace,
      replaceCurrent,
      replaceAllMatches,
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
    });

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
            'relative flex-1 overflow-auto bg-muted/30 outline-hidden ' +
            (isImageDropTarget ? 'ring-2 ring-inset ring-ring' : '')
          }
          data-testid="studio-scroll"
          data-studio-pane="true"
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
          {/* Phase D 2차 — 마퀴 모드 활성 시 시각 hint + 진행 중인 rect */}
          {marqueeMode && (
            <div
              data-testid="studio-marquee-mode"
              className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2 rounded bg-primary/80 px-3 py-1 text-xs font-medium text-primary-foreground shadow-sm"
            >
              개체 선택 모드 (Esc 해제 / 드래그로 표 영역 선택)
            </div>
          )}
          {marqueeRect && (
            <div
              data-testid="studio-marquee-rect"
              className="pointer-events-none absolute z-40 border-2 border-dashed border-primary bg-primary/10"
              style={{
                left: marqueeRect.x,
                top: marqueeRect.y,
                width: marqueeRect.w,
                height: marqueeRect.h,
              }}
            />
          )}
          {pageDims && pageCount > 0 && (
            <div
              className="flex flex-col items-center"
              style={{
                gap: `${PAGE_GAP_PX}px`,
                padding: `${PAGE_GAP_PX}px`,
              }}
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <PaperPage
                  key={i}
                  pageIndex={i}
                  widthSvg={pageDims.w}
                  heightSvg={pageDims.h}
                  zoom={zoom}
                  showRuler={!!showRuler}
                  isActive={isActive}
                  path={path}
                  pageRefsRef={pageRefsRef}
                  changedParaRects={changedParaRects[i] ?? []}
                  selectionRects={selectionRectsByPage[i] ?? []}
                  controlBboxes={selectedControlBboxes[i] ?? []}
                  cellBlockHighlights={cellBlockHighlights[i] ?? []}
                  findHighlights={findHighlightsByPage[i] ?? []}
                  cursorRect={cursorRect}
                  onMouseDown={handlePageMouseDown}
                  onContextMenu={handlePageContextMenu}
                  captureExcerpt={captureExcerpt}
                />
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
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-xs">
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
              className="min-w-14 text-center font-mono text-muted-foreground"
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
            {cellBlockExtendMode && (
              <span
                className="ml-auto rounded bg-primary/15 px-2 py-0.5 text-primary"
                data-testid="studio-cell-block-mode"
                title="화살표 키로 셀 블록을 확장 / Esc로 해제 / Enter로 편집 모드 복귀"
              >
                셀 블록 모드 (F5)
              </span>
            )}
            <span
              className={
                cellBlockExtendMode
                  ? 'ml-2 text-muted-foreground'
                  : 'ml-auto text-muted-foreground'
              }
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
