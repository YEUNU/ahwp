/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * `usePageMouseHandlers` — Phase R1.5 + R1.6 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 `handlePageMouseDown` (~785 라인) +
 * `handlePageContextMenu` (~73 라인) 를 hook 으로 분해. R1.5
 * (selection 모델: drag/caret/auto-scroll/word·paragraph 클릭/marquee/
 * shift-extend) 와 R1.6 (cell drag: cell 안 caret 진입 + cell-block
 * 확장 + sticky mode + auto-scroll throttling — 0.2.89~0.2.92 fix
 * 시리즈 모두 보존) 가 같은 핸들러 안에 물리적으로 얽혀 있어 한
 * hook 으로 묶음.
 *
 * 외부 동작 / 내부 closure / 모든 ref·setter 호출 1:1 verbatim.
 * Latest-ref 패턴으로 returned callback identity 안정화.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import {
  clientToScroller,
  clientToPageWithRect,
  pageToScroller,
  pageYToClientY,
  type RhwpDoc,
} from '@/lib/rhwp-core';
import { primaryModifier } from '@/lib/platform';

// 임의 shape — caller 가 보유한 useState/useRef 가 정확한 타입을 결정.

type AnyMutableRef<T = any> = MutableRefObject<T>;

type AnySetState<T = any> = Dispatch<SetStateAction<T>>;

export interface UsePageMouseHandlersOptions {
  // refs
  docRef: MutableRefObject<RhwpDoc | null>;
  caretRef: AnyMutableRef;
  selectionRef: AnyMutableRef;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  marqueeStartRef: AnyMutableRef;
  draggingRef: MutableRefObject<boolean>;
  dragCleanupRef: MutableRefObject<(() => void) | null>;
  cellDragRef: AnyMutableRef;
  dragOriginSelectionRef: AnyMutableRef;
  cellBlockExtendModeRef: MutableRefObject<boolean>;
  cellDragStickyRef: AnyMutableRef;
  discontiguousCellsRef: AnyMutableRef;
  // setters
  setSelection: AnySetState;
  setSelectionRectsByPage: AnySetState;
  setSelectedControlBboxes: AnySetState;
  setCellBlockHighlights: AnySetState;
  setMarqueeRect: AnySetState;
  setCellMenu: AnySetState;
  setAiMenu: AnySetState;
  setSlashMenu: AnySetState;
  setCursorRect: AnySetState;
  setCellBlockExtendMode: (v: boolean) => void;
  // state
  marqueeMode: boolean;
  zoom: number;
  // callbacks

  hitTestAt: any;

  sortRange: any;

  clearSelection: any;

  refreshSelectionRects: any;

  refreshCellBlockHighlights: any;

  refreshCursorRect: any;

  refreshActiveFormat: any;

  findWordBoundsAt: any;
}

export interface PageMouseHandlersHandle {
  handlePageMouseDown: (
    idx: number,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  handlePageContextMenu: (
    idx: number,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
}

export function usePageMouseHandlers(
  opts: UsePageMouseHandlersOptions,
): PageMouseHandlersHandle {
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  const handlePageMouseDown = useCallback(
    (idx: number, e: ReactMouseEvent<HTMLDivElement>): void => {
      const {
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
        cellDragStickyRef,
        discontiguousCellsRef,
        setSelection,
        setSelectionRectsByPage,
        setSelectedControlBboxes,
        setCellBlockHighlights,
        setMarqueeRect,
        setCursorRect,
        setCellBlockExtendMode,
        marqueeMode,
        zoom,
        hitTestAt,
        refreshSelectionRects,
        refreshCellBlockHighlights,
        refreshCursorRect,
        refreshActiveFormat,
        findWordBoundsAt,
      } = optsRef.current;
      if (e.button !== 0) return; // primary only
      scrollRef.current?.focus({ preventScroll: true });
      // Phase D 2차 — 마퀴 모드 활성 시 텍스트/셀 selection 대신
      // 사각형 마퀴를 그림. mousedown은 시작점 저장만 하고 window
      // 레벨 listener에서 mousemove/up 처리.
      if (marqueeMode) {
        const scroller = scrollRef.current;
        if (!scroller) return;
        const start = clientToScroller(e.clientX, e.clientY, scroller);
        marqueeStartRef.current = { x: start.x, y: start.y };
        setMarqueeRect({ x: start.x, y: start.y, w: 0, h: 0 });
        setSelectedControlBboxes({});
        const onMove = (ev: MouseEvent): void => {
          if (!marqueeStartRef.current || !scrollRef.current) return;
          const m = clientToScroller(ev.clientX, ev.clientY, scrollRef.current);
          const cx = m.x;
          const cy = m.y;
          const sx = marqueeStartRef.current.x;
          const sy = marqueeStartRef.current.y;
          setMarqueeRect({
            x: Math.min(sx, cx),
            y: Math.min(sy, cy),
            w: Math.abs(cx - sx),
            h: Math.abs(cy - sy),
          });
        };
        const onUp = (): void => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          const m = marqueeStartRef.current;
          marqueeStartRef.current = null;
          // 끝났으면 마퀴 영역과 겹치는 표 enumerate.
          const final = (() => {
            if (!m || !scrollRef.current) return null;
            const sr2 = scrollRef.current.getBoundingClientRect();
            return {
              left: m.x,
              top: m.y,
              right: m.x,
              bottom: m.y,
              _sr: sr2,
            };
          })();
          void final;
          // marqueeRect의 최종값을 다시 읽기 위해 setMarqueeRect의
          // updater pattern 사용.
          setMarqueeRect((curr: any) => {
            if (!curr) return null;
            try {
              const doc = docRef.current;
              if (!doc) return null;
              const paraCount = doc.getParagraphCount(0);
              const grouped: Record<
                number,
                { x: number; y: number; width: number; height: number }[]
              > = {};
              for (let p = 0; p < paraCount; p++) {
                let raw: string;
                try {
                  raw = doc.getControlTextPositions(0, p);
                } catch {
                  continue;
                }
                let entries: {
                  controlIdx?: number;
                  controlIndex?: number;
                }[];
                try {
                  entries = JSON.parse(raw);
                  if (!Array.isArray(entries)) continue;
                } catch {
                  continue;
                }
                for (const ent of entries) {
                  const ci =
                    typeof ent.controlIdx === 'number'
                      ? ent.controlIdx
                      : typeof ent.controlIndex === 'number'
                        ? ent.controlIndex
                        : -1;
                  if (ci < 0) continue;
                  let bbox: {
                    pageIndex: number;
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                  };
                  try {
                    bbox = JSON.parse(doc.getTableBBox(0, p, ci));
                  } catch {
                    continue; // 표 아님 (이미지/도형은 lib L-008 blocker)
                  }
                  // bbox는 페이지 page-local 좌표. 마퀴 rect와 비교
                  // 하려면 페이지 element의 scrollRef-relative 위치를
                  // 더해야 함. pageRefsRef를 사용.
                  const pageEl = pageRefsRef.current[bbox.pageIndex];
                  if (!pageEl || !scrollRef.current) continue;
                  const tableTL = pageToScroller(
                    bbox.x,
                    bbox.y,
                    pageEl,
                    scrollRef.current,
                    zoom,
                  );
                  const tableLeft = tableTL.x;
                  const tableTop = tableTL.y;
                  const tableRight = tableLeft + bbox.width * zoom;
                  const tableBottom = tableTop + bbox.height * zoom;
                  const overlap =
                    tableLeft < curr.x + curr.w &&
                    tableRight > curr.x &&
                    tableTop < curr.y + curr.h &&
                    tableBottom > curr.y;
                  if (overlap) {
                    (grouped[bbox.pageIndex] ??= []).push({
                      x: bbox.x,
                      y: bbox.y,
                      width: bbox.width,
                      height: bbox.height,
                    });
                  }
                }
              }
              setSelectedControlBboxes(grouped);
            } catch (err) {
              console.warn('[studio] marquee enumerate failed:', err);
            }
            return null; // 마퀴 rect 제거 (highlight는 selectedControlBboxes로 표시)
          });
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
        return;
      }
      // Snapshot caret BEFORE we mutate caretRef below — Shift+click
      // without prior selection anchors at this position.
      const priorCaret = { ...caretRef.current };
      const result = hitTestAt(idx, e.clientX, e.clientY, e.currentTarget);
      if (!result) return;
      // Cell info present when the click lands inside a table cell.
      // Phase E: cellPath이 hit 결과에 있으면 셀 (top-level + nested 모두)
      // 그게 1단계면 기존 동작, 2단계 이상이면 ByPath API 사용 분기.
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
              path: result.cellPath,
            }
          : undefined;
      const baseCaret = {
        sectionIndex: result.sectionIndex,
        paragraphIndex: result.paragraphIndex,
        charOffset: result.charOffset,
        cell,
      };
      // Cell-internal drag selection (v1). When mousedown lands in a
      // cell we initialize anchor=focus=baseCaret with cell context
      // and enable drag scoped to that cell. Cross-cell drag is
      // out-of-scope (focus stays in the same cell + same cellParaIndex
      // — see applyPointerToSelection's cellDragRef branch). We still
      // skip the body-level double/triple-click handlers below since
      // word/paragraph selection inside a cell isn't wired yet.
      if (cell) {
        // Phase D — Cmd(Mac) / Ctrl(Win) +click on a cell adds it to
        // the existing cell-block highlights (불연속 셀 추가). 같은
        // 표 안의 기존 block에 추가만 하고 anchor/focus는 안 건드림.
        // Mac에서는 Ctrl+click이 secondary click (= 우클릭)으로
        // 변환되므로 ctrl 단독은 contextmenu로 빠지고 여기 안 옴 —
        // primaryModifier(e)는 Mac은 metaKey, Win은 ctrlKey만 true.
        const isDiscontiguousAdd =
          primaryModifier(e) &&
          !e.altKey &&
          !e.shiftKey &&
          (() => {
            const cur = selectionRef.current;
            return Boolean(
              cur &&
              cur.anchor.cell &&
              cur.focus.cell &&
              cur.anchor.cell.parentParaIndex === cell.parentParaIndex &&
              cur.anchor.cell.controlIndex === cell.controlIndex,
            );
          })();
        if (isDiscontiguousAdd) {
          const docNow = docRef.current;
          if (docNow) {
            try {
              const cells = JSON.parse(
                docNow.getTableCellBboxes(
                  baseCaret.sectionIndex,
                  cell.parentParaIndex,
                  cell.controlIndex,
                ),
              ) as {
                cellIdx: number;
                pageIndex: number;
                x: number;
                y: number;
                w: number;
                h: number;
              }[];
              const target = cells.find((x) => x.cellIdx === cell.cellIndex);
              if (target) {
                setCellBlockHighlights((prev: any) => {
                  const arr = prev[target.pageIndex] ?? [];
                  const exists = arr.some(
                    (b: any) =>
                      Math.abs(b.x - target.x) < 0.5 &&
                      Math.abs(b.y - target.y) < 0.5,
                  );
                  if (exists) return prev;
                  return {
                    ...prev,
                    [target.pageIndex]: [
                      ...arr,
                      {
                        x: target.x,
                        y: target.y,
                        width: target.w,
                        height: target.h,
                      },
                    ],
                  };
                });
                // ops iteration 용 ref에도 추가 (dedupe).
                const ref = discontiguousCellsRef.current;
                const dup = ref.some(
                  (x: any) =>
                    x.parentParaIndex === cell.parentParaIndex &&
                    x.controlIndex === cell.controlIndex &&
                    x.cellIndex === cell.cellIndex,
                );
                if (!dup) {
                  discontiguousCellsRef.current = [...ref, cell];
                }
              }
            } catch (err) {
              console.warn('[studio] discontiguous cell add failed:', err);
            }
          }
          // Discontiguous selection은 visual-only. drag는 비활성.
          cellDragRef.current = null;
          draggingRef.current = false;
          return;
        }
        // Plain click in cell — reset discontiguous list.
        discontiguousCellsRef.current = [];
        caretRef.current = baseCaret;
        if (result.cursorRect) {
          setCursorRect(result.cursorRect);
        } else {
          refreshCursorRect();
        }
        refreshActiveFormat();
        const initSel = { anchor: baseCaret, focus: baseCaret };
        setSelection(initSel);
        setSelectionRectsByPage({});
        setCellBlockHighlights({});
        setSelectedControlBboxes({});
        cellDragRef.current = cell;
        cellDragStickyRef.current = false;
        dragOriginSelectionRef.current = null;
        draggingRef.current = true;
        // Fall through to the shared drag listener attachment below
        // (skip body-only word/paragraph + shift-click handling).
      } else {
        cellDragRef.current = null;
        cellDragStickyRef.current = false;
      }
      if (!cell && e.detail === 3) {
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
      if (!cell && e.detail === 2) {
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
      if (!cell) {
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
        // New drag begins: drop any control bboxes / cell-block
        // highlights from a prior drag, exit cell-block extension mode.
        setSelectedControlBboxes({});
        setCellBlockHighlights({});
        setCellBlockExtendMode(false);
        draggingRef.current = true;
      }

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
            (lastClient.y - (sr.bottom - AUTO_SCROLL_ZONE)) / AUTO_SCROLL_ZONE,
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
        // 1. Try the page directly under the cursor first.
        let pageIdx = -1;
        let pageEl: HTMLElement | null = null;
        let hitX = cx;
        let hitY = cy;
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
        // 2. Fallback: pointer is in a page gap / off-edge. Pick the
        //    page nearest along the Y axis and clamp the hit-test to
        //    its bounds. This mirrors PDF/Word drag behavior — the
        //    selection extends to the page edge that the cursor is
        //    closest to (start if dragging up past page top, end if
        //    dragging down past page bottom).
        if (pageIdx < 0) {
          let bestDist = Infinity;
          for (let i = 0; i < refs.length; i++) {
            const el = refs[i];
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const dy =
              cy < r.top ? r.top - cy : cy > r.bottom ? cy - r.bottom : 0;
            if (dy < bestDist) {
              bestDist = dy;
              pageIdx = i;
              pageEl = el;
              // Clamp 1px inside the page rect so hitTest doesn't get
              // a boundary value that resolves to the wrong line.
              hitX = Math.max(r.left + 1, Math.min(r.right - 1, cx));
              hitY = Math.max(r.top + 1, Math.min(r.bottom - 1, cy));
            }
          }
        }
        if (pageIdx < 0 || !pageEl) return;
        const moveResult = hitTestAt(pageIdx, hitX, hitY, pageEl);
        if (!moveResult) return;
        // Cell-drag mode. Two sub-modes:
        //   (a) cursor stays in the SAME cell + same cellParaIndex →
        //       char-level selection (0.2.73 v1)
        //   (b) cursor crosses into a DIFFERENT cell of the same
        //       table → switch to Hancom-style cell-block mode
        //       (Phase A). Selection unit becomes whole cells; the
        //       in-cell text rect rendering is replaced by per-cell
        //       bbox highlights computed via getTableCellBboxes.
        //   (c) cursor leaves the table entirely → freeze focus
        //       (cross-table drag is not supported)
        const cd = cellDragRef.current;
        if (cd) {
          // 셀 boundary off-by-one 회피 — drag mousemove 시점에 한정.
          // lib hitTest는 x=cellLeftEdge에서 이전 cell을 right-inclusive로
          // 돌려줌. drag 중 cursor가 boundary에 짧게 떨어지면 focus가
          // 한 칸 뒤로 잡혔다 풀렸다 깜빡 — bbox로 click point가 어떤
          // 셀에 있는지 직접 확인해서 정정. 단발 click(mousedown)에는
          // 적용 안 함 — 사용자의 명시적 click 의도 존중 + 셀 진입
          // 보장.
          if (
            moveResult.controlIndex !== undefined &&
            moveResult.cellIndex !== undefined &&
            moveResult.parentParaIndex !== undefined &&
            (moveResult.cellPath?.length ?? 1) === 1 &&
            docRef.current
          ) {
            try {
              const cellsJson = docRef.current.getTableCellBboxes(
                moveResult.sectionIndex,
                moveResult.parentParaIndex,
                moveResult.controlIndex,
              );
              const cells = JSON.parse(cellsJson) as {
                cellIdx: number;
                x: number;
                y: number;
                w: number;
                h: number;
              }[];
              // page-local x,y 계산 — applyPointerToSelection scope에 hitX/hitY 있음.
              const local = clientToPageWithRect(
                hitX,
                hitY,
                pageEl.getBoundingClientRect(),
                zoom,
              );
              const localX = local.x;
              const localY = local.y;
              const correctCell = cells.find(
                (c) =>
                  localX >= c.x &&
                  localX < c.x + c.w &&
                  localY >= c.y &&
                  localY < c.y + c.h,
              );
              if (correctCell && correctCell.cellIdx !== moveResult.cellIndex) {
                moveResult.cellIndex = correctCell.cellIdx;
                if (moveResult.cellPath && moveResult.cellPath.length === 1) {
                  moveResult.cellPath[0].cellIndex = correctCell.cellIdx;
                }
              }
            } catch {
              /* bbox 조회 실패 — 원본 그대로 */
            }
          }
          const moveCell =
            moveResult.controlIndex !== undefined &&
            moveResult.cellIndex !== undefined &&
            moveResult.cellParaIndex !== undefined &&
            moveResult.parentParaIndex !== undefined
              ? {
                  parentParaIndex: moveResult.parentParaIndex,
                  controlIndex: moveResult.controlIndex,
                  cellIndex: moveResult.cellIndex,
                  cellParaIndex: moveResult.cellParaIndex,
                  path: moveResult.cellPath,
                }
              : undefined;
          // (c) outside table or different table — freeze.
          if (
            !moveCell ||
            moveCell.parentParaIndex !== cd.parentParaIndex ||
            moveCell.controlIndex !== cd.controlIndex
          ) {
            return;
          }
          const focus = {
            sectionIndex: moveResult.sectionIndex,
            paragraphIndex: moveResult.paragraphIndex,
            charOffset: moveResult.charOffset,
            cell: moveCell,
          };
          caretRef.current = focus;
          if (moveResult.cursorRect) setCursorRect(moveResult.cursorRect);
          // Crossed into a different cell? Switch to cell-block mode.
          const crossedNow =
            moveCell.cellIndex !== cd.cellIndex ||
            moveCell.cellParaIndex !== cd.cellParaIndex;
          // Sticky: 한 번 cross-cell 진입 후 anchor 셀 복귀해도
          // cell-block 유지 (highlight 깜빡임 방지). mousedown에서 false
          // reset이라 새 drag는 깨끗하게 시작.
          if (crossedNow) cellDragStickyRef.current = true;
          const useCellBlock = cellDragStickyRef.current;
          setSelection((prev: any) => {
            if (!prev) return null;
            const next = { ...prev, focus };
            if (useCellBlock) {
              // Cell-block mode: drop char-level rects, draw cell bboxes.
              setSelectionRectsByPage({});
              refreshCellBlockHighlights(next);
            } else {
              // Still inside anchor cell + never crossed: char-level select.
              setCellBlockHighlights({});
              refreshSelectionRects(next);
            }
            return next;
          });
          return;
        }
        // Cell-hit guard — when drag started at body level but the
        // cursor passes over a table during the drag, IR returns
        // cell-internal hit info (`controlIndex`/`cellIndex`/
        // `cellParaIndex`/`parentParaIndex`) and `paragraphIndex` is
        // **cell-local** (index of paragraph inside the cell), not
        // section-level. Using it directly snapped focus to section
        // para 0 — selection then spanned [section-para-0 ~ anchor],
        // which the user perceived as "everything below selected" /
        // "down-drag visual even when dragging up". Body-level drag
        // selection across cells isn't supported (cell selection v2
        // — see handlePageMouseDown's cell branch which disables drag).
        //
        // UX requirement: dragging across a control (table / image /
        // shape) should pull the entire object into the selection.
        // We do that by extending focus to the boundary of the body
        // paragraph that anchors the control (`parentParaIndex`).
        // Direction-aware: if we're dragging past the object (anchor
        // is above it), snap focus to the END of its parent
        // paragraph; if anchor is below, snap to the START. The
        // resulting [anchor → focus] range fully covers the parent
        // paragraph and any inline control(s) it carries.
        if (moveResult.controlIndex !== undefined) {
          const anchor = selectionRef.current?.anchor;
          const parentPara = moveResult.parentParaIndex;
          if (anchor !== undefined && parentPara !== undefined) {
            const goingDown = parentPara >= anchor.paragraphIndex;
            let charOffset = 0;
            if (goingDown) {
              const doc = docRef.current;
              if (doc) {
                try {
                  charOffset = doc.getParagraphLength(
                    moveResult.sectionIndex,
                    parentPara,
                  );
                } catch {
                  /* fall back to start of paragraph */
                }
              }
            }
            const focus = {
              sectionIndex: moveResult.sectionIndex,
              paragraphIndex: parentPara,
              charOffset,
            };
            caretRef.current = focus;
            setSelection((prev: any) => {
              if (!prev) return null;
              const next = { ...prev, focus };
              refreshSelectionRects(next);
              return next;
            });
            // Visual feedback: for tables we can fetch the full
            // bounding box and render an overlay so the table is
            // highlighted alongside the surrounding text. Tables
            // are the only control type with a published `getTableBBox`
            // in 0.7.9 — image/shape highlighting follows once the
            // lib publishes a unified bbox API.
            if (moveResult.controlIndex !== undefined) {
              const doc = docRef.current;
              if (doc) {
                try {
                  const bbox = JSON.parse(
                    doc.getTableBBox(
                      moveResult.sectionIndex,
                      parentPara,
                      moveResult.controlIndex,
                    ),
                  ) as {
                    pageIndex: number;
                    x: number;
                    y: number;
                    width: number;
                    height: number;
                  };
                  setSelectedControlBboxes((prev: any) => {
                    const arr = prev[bbox.pageIndex] ?? [];
                    const exists = arr.some(
                      (b: any) =>
                        Math.abs(b.x - bbox.x) < 0.5 &&
                        Math.abs(b.y - bbox.y) < 0.5,
                    );
                    if (exists) return prev;
                    return {
                      ...prev,
                      [bbox.pageIndex]: [
                        ...arr,
                        {
                          x: bbox.x,
                          y: bbox.y,
                          width: bbox.width,
                          height: bbox.height,
                        },
                      ],
                    };
                  });
                } catch {
                  /* not a table (image/shape) — skipped for now */
                }
              }
            }
          }
          return;
        }
        // Whitespace-jump guard — when the cursor lands in vertical
        // whitespace (margin / inter-paragraph gap), the IR snaps the
        // returned (paraIdx, charOffset) to the nearest text position
        // but often omits cursorRect (no text-box at click Y). Without
        // cursorRect the previous guard was bypassed and focus jumped
        // to wherever IR snapped — typically the section/page tail —
        // selecting "everything below". Derive the rect via
        // getCursorRect when missing, then reject any hit whose rect
        // lives more than 80px from the actual mouse Y. Use the rect's
        // own pageIndex (not the input pageEl) since the snap target
        // can land on a neighbouring page.
        let resultRect = moveResult.cursorRect;
        if (!resultRect) {
          const doc = docRef.current;
          if (doc) {
            try {
              resultRect = JSON.parse(
                doc.getCursorRect(
                  moveResult.sectionIndex,
                  moveResult.paragraphIndex,
                  moveResult.charOffset,
                ),
              ) as typeof resultRect;
            } catch {
              /* keep undefined — fall through without guarding */
            }
          }
        }
        if (resultRect) {
          const rectPageEl = pageRefsRef.current[resultRect.pageIndex];
          if (rectPageEl) {
            const hitClientY = pageYToClientY(resultRect.y, rectPageEl, zoom);
            if (Math.abs(hitClientY - cy) > 80) {
              return;
            }
          }
        }
        const focus = {
          sectionIndex: moveResult.sectionIndex,
          paragraphIndex: moveResult.paragraphIndex,
          charOffset: moveResult.charOffset,
        };
        caretRef.current = focus;
        if (resultRect) setCursorRect(resultRect);
        setSelection((prev: any) => {
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
        cellDragRef.current = null;
        cellDragStickyRef.current = false;
        dragOriginSelectionRef.current = null;
        setSelection((prev: any) => {
          if (!prev) return null;
          // 셀 cross-cell drag(anchor.cell ≠ focus.cell)은
          // paragraphIndex/charOffset이 둘 다 0이라도 비어있지 않음 —
          // 셀 블록 selection이 살아있어야 함. 셀 컨텍스트 다르면
          // empty 처리에서 제외.
          const ac = prev.anchor.cell;
          const fc = prev.focus.cell;
          const cellDifferent =
            ac &&
            fc &&
            (ac.cellIndex !== fc.cellIndex ||
              ac.cellParaIndex !== fc.cellParaIndex);
          const empty =
            !cellDifferent &&
            prev.anchor.paragraphIndex === prev.focus.paragraphIndex &&
            prev.anchor.charOffset === prev.focus.charOffset;
          if (empty) {
            setSelectionRectsByPage({});
            setSelectedControlBboxes({});
            setCellBlockHighlights({});
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
    [],
  );

  const handlePageContextMenu = useCallback(
    (idx: number, e: ReactMouseEvent<HTMLDivElement>): void => {
      const {
        docRef,
        caretRef,
        selectionRef,
        setSelection,
        setSelectionRectsByPage,
        setCellMenu,
        setAiMenu,
        hitTestAt,
      } = optsRef.current;
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
    [],
  );

  return { handlePageMouseDown, handlePageContextMenu };
}
