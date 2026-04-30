import {
  AlertTriangle,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  Italic,
  Loader2,
  Maximize2,
  Redo2,
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
import type { CharFormatKey, ViewerHandle } from './types';

interface StudioViewerProps {
  path: string;
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
interface ParaProps {
  alignment?: ParaAlignment;
}

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

/** Parse <svg width="X" height="Y"> or fall back to viewBox last two numbers. */
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
  function StudioViewer({ path }, ref) {
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
    const caretRef = useRef<{
      sectionIndex: number;
      paragraphIndex: number;
      charOffset: number;
    }>({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });
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

      // Reset everything for a fresh path.
      cache.clear();
      pageRefs.current = [];
      dirtyRef.current = false;
      setDirty(false);
      historyRef.current = { entries: [], index: -1 };
      setCanUndo(false);
      setCanRedo(false);

      (async () => {
        try {
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
        const rect = JSON.parse(
          doc.getCursorRect(c.sectionIndex, c.paragraphIndex, c.charOffset),
        ) as {
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
          // No selection — fall back to whole-paragraph at caret.
          const c = caretRef.current;
          doc.applyCharFormat(
            c.sectionIndex,
            c.paragraphIndex,
            0,
            PARAGRAPH_END_SENTINEL,
            propsJson,
          );
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyCharFormat failed:', err);
        }
      },
      [activeFormat, refreshAfterMutation, sortRange],
    );

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
     * Apply paragraph alignment. Spans the selection's paragraphs when a
     * selection is active, otherwise just the caret's paragraph.
     */
    const applyAlignment = useCallback(
      (alignment: ParaAlignment): void => {
        const doc = docRef.current;
        if (!doc) return;
        const sel = selectionRef.current;
        const propsJson = JSON.stringify({ alignment } satisfies ParaProps);
        try {
          if (sel) {
            const r = sortRange(sel.anchor, sel.focus);
            for (let p = r.startPara; p <= r.endPara; p++) {
              doc.applyParaFormat(sel.anchor.sectionIndex, p, propsJson);
            }
          } else {
            const c = caretRef.current;
            doc.applyParaFormat(c.sectionIndex, c.paragraphIndex, propsJson);
          }
          refreshAfterMutation({ syncCaret: false });
        } catch (err) {
          console.warn('[studio] applyParaFormat failed:', err);
        }
      },
      [refreshAfterMutation, sortRange],
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
          doc.applyCharFormat(
            c.sectionIndex,
            c.paragraphIndex,
            0,
            PARAGRAPH_END_SENTINEL,
            propsJson,
          );
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
      const lc = query.toLowerCase();
      const matches: {
        sectionIndex: number;
        paragraphIndex: number;
        offset: number;
        length: number;
      }[] = [];
      try {
        const sectionCount = doc.getSectionCount();
        for (let s = 0; s < sectionCount; s++) {
          const paraCount = doc.getParagraphCount(s);
          for (let p = 0; p < paraCount; p++) {
            const text = doc.getTextRange(s, p, 0, 1_000_000);
            if (!text) continue;
            const haystack = text.toLowerCase();
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
        }
      } catch (err) {
        console.warn('[studio] find iteration failed:', err);
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
      // Return focus to the scroll container so keyboard editing resumes.
      scrollRef.current?.focus();
    }, []);

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
        redo: () => redo(),
        copy: () => copySelection(),
        cut: () => cutSelection(),
        paste: () => pasteAtCaret(),
        openFind: () => openFind(),
        applyAlignment: (a: ParaAlignment) => applyAlignment(a),
        applyFontSizePt: (pt: number) => applyFontSizePt(pt),
        applyTextColor: (hex: string) => applyTextColor(hex),
      }),
      [
        toggleCharFormat,
        undo,
        redo,
        copySelection,
        cutSelection,
        pasteAtCaret,
        openFind,
        applyAlignment,
        applyFontSizePt,
        applyTextColor,
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
          const nextCaret = { ...c, charOffset: nextOff };
          caretRef.current = nextCaret;
          if (e.shiftKey) {
            const sel = sel0 ?? { anchor: c, focus: c };
            const next = { ...sel, focus: nextCaret };
            setSelection(next);
            refreshSelectionRects(next);
          } else if (sel0) {
            clearSelection();
          }
          refreshCursorRect();
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowLeft') {
          if (c.charOffset > 0) {
            const nextCaret = { ...c, charOffset: c.charOffset - 1 };
            caretRef.current = nextCaret;
            if (e.shiftKey) {
              const sel = sel0 ?? { anchor: c, focus: c };
              const next = { ...sel, focus: nextCaret };
              setSelection(next);
              refreshSelectionRects(next);
            } else if (sel0) {
              clearSelection();
            }
            refreshCursorRect();
          } else if (!e.shiftKey && sel0) {
            clearSelection();
          }
          e.preventDefault();
          return;
        }
        if (e.key === 'ArrowRight') {
          const nextCaret = { ...c, charOffset: c.charOffset + 1 };
          caretRef.current = nextCaret;
          if (e.shiftKey) {
            const sel = sel0 ?? { anchor: c, focus: c };
            const next = { ...sel, focus: nextCaret };
            setSelection(next);
            refreshSelectionRects(next);
          } else if (sel0) {
            clearSelection();
          }
          refreshCursorRect();
          e.preventDefault();
          return;
        }
        if (e.key === 'Home') {
          const nextCaret = { ...c, charOffset: 0 };
          caretRef.current = nextCaret;
          if (e.shiftKey) {
            const sel = sel0 ?? { anchor: c, focus: c };
            const next = { ...sel, focus: nextCaret };
            setSelection(next);
            refreshSelectionRects(next);
          } else if (sel0) {
            clearSelection();
          }
          refreshCursorRect();
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

        // Don't intercept other browser shortcuts (Ctrl+S, Cmd+R, etc.).
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'Backspace') {
          if (deleteSelectionIfAny()) {
            refreshAfterMutation();
          } else if (c.charOffset > 0) {
            doc.deleteText(
              c.sectionIndex,
              c.paragraphIndex,
              c.charOffset - 1,
              1,
            );
            refreshAfterMutation();
          }
          e.preventDefault();
        } else if (e.key === 'Delete') {
          if (deleteSelectionIfAny()) {
            refreshAfterMutation();
          } else {
            try {
              doc.deleteText(c.sectionIndex, c.paragraphIndex, c.charOffset, 1);
              refreshAfterMutation();
            } catch {
              /* ignore — past end */
            }
          }
          e.preventDefault();
        } else if (e.key === 'Enter') {
          if (deleteSelectionIfAny()) {
            // After delete, caret is at the start of the previous selection.
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
            doc.insertText(
              c.sectionIndex,
              c.paragraphIndex,
              c.charOffset,
              '\n',
            );
          }
          refreshAfterMutation();
          e.preventDefault();
        } else if (e.key.length === 1) {
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
            doc.insertText(
              c.sectionIndex,
              c.paragraphIndex,
              c.charOffset,
              e.key,
            );
          }
          refreshAfterMutation();
          e.preventDefault();
        }
      },
      [
        refreshAfterMutation,
        refreshCursorRect,
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
        stepWordOffset,
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
          } else {
            const c = caretRef.current;
            doc.insertText(
              c.sectionIndex,
              c.paragraphIndex,
              c.charOffset,
              text,
            );
          }
          refreshAfterMutation();
        } catch (err) {
          console.warn('[studio] compositionend insertText failed:', err);
        }
      },
      [refreshAfterMutation, deleteSelectionIfAny],
    );

    /**
     * hitTest the click coords (page-local SVG space, zoom-adjusted) and
     * return the resulting caret. Returns null if the test failed.
     */
    const hitTestAt = useCallback(
      (
        idx: number,
        clientX: number,
        clientY: number,
        target: HTMLElement,
      ): {
        sectionIndex: number;
        paragraphIndex: number;
        charOffset: number;
        cursorRect?: {
          pageIndex: number;
          x: number;
          y: number;
          height: number;
        };
      } | null => {
        const doc = docRef.current;
        if (!doc) return null;
        const rect = target.getBoundingClientRect();
        const x = (clientX - rect.left) / zoom;
        const y = (clientY - rect.top) / zoom;
        try {
          return JSON.parse(doc.hitTest(idx, x, y)) as {
            sectionIndex: number;
            paragraphIndex: number;
            charOffset: number;
            cursorRect?: {
              pageIndex: number;
              x: number;
              y: number;
              height: number;
            };
          };
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
        const result = hitTestAt(idx, e.clientX, e.clientY, e.currentTarget);
        if (!result) return;
        const baseCaret = {
          sectionIndex: result.sectionIndex,
          paragraphIndex: result.paragraphIndex,
          charOffset: result.charOffset,
        };
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
        // Reset selection — anchor at click, drag will extend focus.
        setSelection({ anchor: baseCaret, focus: baseCaret });
        setSelectionRectsByPage({});
        draggingRef.current = true;
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

    const handlePageMouseMove = useCallback(
      (idx: number, e: ReactMouseEvent<HTMLDivElement>): void => {
        if (!draggingRef.current) return;
        const result = hitTestAt(idx, e.clientX, e.clientY, e.currentTarget);
        if (!result) return;
        const focus = {
          sectionIndex: result.sectionIndex,
          paragraphIndex: result.paragraphIndex,
          charOffset: result.charOffset,
        };
        caretRef.current = focus;
        if (result.cursorRect) {
          setCursorRect(result.cursorRect);
        }
        setSelection((prev) => {
          if (!prev) return null;
          const next = { ...prev, focus };
          refreshSelectionRects(next);
          return next;
        });
      },
      [hitTestAt, refreshSelectionRects, setSelection],
    );

    const handlePageMouseUp = useCallback((): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      // If the drag never moved (anchor === focus), drop the empty selection
      // so caret-only behaviors don't accidentally trip the selection path.
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
    }, [setSelection]);

    /**
     * Test/dev hook on `window.__studioDebug` so e2e specs can drive
     * mutations + read state without going through real input UI (which
     * lands in chunk 4-B). Production builds also keep this — the surface
     * is small and non-destructive.
     */
    useEffect(() => {
      if (phase !== 'ready') return;
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
          if (!selection) return null;
          const r = sortRange(selection.anchor, selection.focus);
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
        } => ({
          open: findOpen,
          query: findQuery,
          matchCount: findMatches.length,
          activeIndex: findIndex,
        }),
        applyAlignment: (a: ParaAlignment): void => applyAlignment(a),
        applyFontSizePt: (pt: number): void => applyFontSizePt(pt),
        applyTextColor: (hex: string): void => applyTextColor(hex),
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
      phase,
      pageCount,
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
      applyAlignment,
      applyFontSizePt,
      applyTextColor,
      findWordBoundsAt,
      stepWordOffset,
    ]);

    // Effect 2: IntersectionObserver — lazy render visible pages, track current.
    useEffect(() => {
      if (phase !== 'ready' || !pageDims || pageCount === 0) return;

      const scrollEl = scrollRef.current;
      const pageRefs = pageRefsRef;
      let observer: IntersectionObserver | null = null;

      // Defer one tick so refs are populated after the placeholder render.
      const raf = requestAnimationFrame(() => {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const idx = Number(
                entry.target.getAttribute('data-page-idx') ?? '-1',
              );
              if (idx < 0) continue;
              if (entry.isIntersecting) {
                renderPageInto(idx);
              }
            }
            // Update current page = the most-visible entry.
            const visible = entries
              .filter((e) => e.isIntersecting)
              .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
            if (visible.length > 0) {
              const idx = Number(
                visible[0].target.getAttribute('data-page-idx') ?? '-1',
              );
              if (idx >= 0) setCurrentPage(idx);
            }
          },
          { root: scrollEl, rootMargin: '400px', threshold: [0, 0.5] },
        );

        pageRefs.current.forEach((el) => {
          if (el && observer) observer.observe(el);
        });

        // Force-render page 0 immediately (in case observer doesn't fire yet).
        renderPageInto(0);
      });

      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
      };
    }, [phase, pageDims, pageCount, renderPageInto]);

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

    return (
      <div
        className="relative flex h-full w-full flex-col"
        data-testid="studio-viewer"
      >
        {showToolbar && (
          <div className="flex h-10 items-center gap-1 border-b border-border px-3 text-xs">
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
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
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
            <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
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
            {dirty && (
              <span
                className="ml-auto mr-2 text-amber-500"
                data-testid="studio-dirty-indicator"
                title="저장되지 않은 변경사항"
              >
                ●
              </span>
            )}
            <span
              className={
                dirty
                  ? 'text-muted-foreground'
                  : 'ml-auto text-muted-foreground'
              }
              data-testid="studio-page-indicator"
            >
              {currentPage + 1} / {pageCount}
            </span>
          </div>
        )}

        {findOpen && (
          <div
            className="flex items-center gap-2 border-b border-border bg-card px-3 py-2 text-xs"
            data-testid="studio-find-bar"
          >
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
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-muted/30 outline-none"
          data-testid="studio-scroll"
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
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
                  className="relative cursor-text bg-background shadow-md"
                  style={{
                    width: pageDims.w * zoom,
                    height: pageDims.h * zoom,
                  }}
                  onMouseDown={(e) => handlePageMouseDown(i, e)}
                  onMouseMove={(e) => handlePageMouseMove(i, e)}
                  onMouseUp={handlePageMouseUp}
                  onMouseLeave={handlePageMouseUp}
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
                  {/* Selection highlight overlay — one rect per visible
                      line in the selection range, computed via
                      getSelectionRects. */}
                  {(selectionRectsByPage[i] ?? []).map((r, ri) => (
                    <div
                      key={ri}
                      data-testid="studio-selection-rect"
                      className="pointer-events-none absolute bg-primary/25"
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
              ))}
            </div>
          )}
        </div>

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
      </div>
    );
  },
);
