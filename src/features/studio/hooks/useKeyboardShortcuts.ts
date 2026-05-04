/**
 * `useKeyboardShortcuts` — Phase R1.4 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 1100-라인 `handleKeyDown` 콜백을 hook 으로
 * 분해. 외부 동작 1:1 이식 — Hancom 호환 키맵 / F-key cell block /
 * cell merge·split / table nav / page nav / undo·redo / clipboard /
 * find·replace / format toggle / select-all / printable insert /
 * Korean IME guard 모두 동일.
 *
 * Latest-ref 패턴으로 returned `handleKeyDown` 이 stable identity —
 * 호출자 onKeyDown prop 이 매 render 새 함수로 갈리는 것 방지.
 *
 * 의존이 매우 많아 (45+ 심볼) opts 인터페이스가 비대하지만, 각
 * 항목은 StudioViewer 가 이미 보유한 ref/setter/callback 일대일
 * 매핑. 추출 전후 동작 동일하므로 회귀 0 이 목표.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { primaryModifier } from '@/lib/platform';
import { HwpDocument } from '@/lib/rhwp-core';
import type { LifecycleCursorRect } from './useDocumentLifecycle';
import type { RhwpHitTest } from '@shared/rhwp-types';

type RhwpDoc = InstanceType<typeof HwpDocument>;

export interface KeyboardCellRef {
  parentParaIndex: number;
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
  path?: Array<{
    controlIndex: number;
    cellIndex: number;
    cellParaIndex: number;
  }>;
}

export interface KeyboardCaret {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  cell?: KeyboardCellRef;
}

export interface KeyboardSelection {
  anchor: KeyboardCaret;
  focus: KeyboardCaret;
}

export interface KeyboardCellBboxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface KeyboardSelectionRectsByPage {
  [page: number]: KeyboardCellBboxRect[];
}

export interface KeyboardCellHighlights {
  [page: number]: KeyboardCellBboxRect[];
}

export interface KeyboardDiscontiguousCell {
  parentParaIndex: number;
  controlIndex: number;
  cellIndex: number;
}

export interface KeyboardCellDragInfo {
  parentParaIndex: number;
  controlIndex: number;
  cellIndex: number;
  cellParaIndex: number;
}

export interface KeyboardSlashMenu {
  x: number;
  y: number;
  sectionIndex: number;
  paragraphIndex: number;
}

export interface KeyboardMarqueeStart {
  x: number;
  y: number;
}

export interface KeyboardPageDims {
  w: number;
  h: number;
}

export interface UseKeyboardShortcutsOptions {
  // refs
  docRef: MutableRefObject<RhwpDoc | null>;
  caretRef: MutableRefObject<KeyboardCaret>;
  selectionRef: MutableRefObject<KeyboardSelection | null>;
  cellBlockExtendModeRef: MutableRefObject<boolean>;
  marqueeStartRef: MutableRefObject<KeyboardMarqueeStart | null>;
  draggingRef: MutableRefObject<boolean>;
  dragCleanupRef: MutableRefObject<(() => void) | null>;
  cellDragRef: MutableRefObject<KeyboardCellDragInfo | null>;
  dragOriginSelectionRef: MutableRefObject<KeyboardSelection | null>;
  f5LastPressRef: MutableRefObject<number>;
  f5PressCountRef: MutableRefObject<number>;
  f3LastPressRef: MutableRefObject<number>;
  f3PressCountRef: MutableRefObject<number>;
  discontiguousCellsRef: MutableRefObject<KeyboardDiscontiguousCell[]>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  // setters
  setSelection: (
    next:
      | KeyboardSelection
      | null
      | ((prev: KeyboardSelection | null) => KeyboardSelection | null),
  ) => void;
  setSelectionRectsByPage: Dispatch<
    SetStateAction<KeyboardSelectionRectsByPage>
  >;
  setSelectedControlBboxes: Dispatch<
    SetStateAction<KeyboardSelectionRectsByPage>
  >;
  setCellBlockHighlights: Dispatch<SetStateAction<KeyboardCellHighlights>>;
  setCellBlockExtendMode: (v: boolean) => void;
  setMarqueeMode: Dispatch<SetStateAction<boolean>>;
  setMarqueeRect: (
    v: { pageIndex: number; x: number; y: number; w: number; h: number } | null,
  ) => void;
  setSlashMenu: Dispatch<SetStateAction<KeyboardSlashMenu | null>>;
  // state
  cursorRect: LifecycleCursorRect | null;
  pageDims: KeyboardPageDims | null;
  pageCount: number;
  zoom: number;
  marqueeMode: boolean;
  // callbacks
  refreshAfterMutation: (opts?: { syncCaret?: boolean }) => void;
  refreshCursorRect: () => void;
  refreshActiveFormat: () => void;
  refreshCellBlockHighlights: (sel: KeyboardSelection) => void;
  refreshSelectionRects: (sel: KeyboardSelection) => void;
  toggleCharFormat: (key: 'bold' | 'italic' | 'underline') => void;
  clearSelection: () => void;
  deleteSelectionIfAny: () => boolean;
  undo: () => void;
  redo: () => void;
  copySelection: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  pasteAtCaret: () => Promise<boolean>;
  openFind: () => void;
  openReplace: () => void;
  stepWordOffset: (
    sec: number,
    para: number,
    off: number,
    dir: -1 | 1,
  ) => number;
  insertAtCaret: (text: string) => void;
  deleteAtCaret: (offset: number, length: number) => void;
  commitCaretMove: (
    next: KeyboardCaret,
    prev: KeyboardCaret,
    extend: boolean,
    sel0: KeyboardSelection | null,
  ) => void;
  findWordBoundsAt: (
    sec: number,
    para: number,
    off: number,
  ) => { startOffset: number; endOffset: number } | null;
}

export function useKeyboardShortcuts(
  opts: UseKeyboardShortcutsOptions,
): (e: ReactKeyboardEvent<HTMLDivElement>) => void {
  // Stash latest opts in a ref so the returned callback has stable
  // identity. useLayoutEffect (not a render-time mutation) keeps
  // eslint react-hooks/refs satisfied.
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  return useCallback((e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // Pull the entire opts surface into local consts at the top so the
    // body below can stay verbatim from the original handler — refs
    // and callbacks have stable identity once captured per-event.
    const {
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
    } = optsRef.current;

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
    // Phase B-2.5 — F5 확장 모드: arrow가 cell-block의 focus 셀을
    // row/col 단위로 이동시켜 block 범위 확장. 본문 arrow 핸들러
    // 보다 먼저 검사해야 cell context에서 confused 안 됨.
    if (
      cellBlockExtendModeRef.current &&
      (e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown')
    ) {
      const cur = selectionRef.current;
      if (
        cur &&
        cur.anchor.cell &&
        cur.focus.cell &&
        cur.anchor.cell.parentParaIndex === cur.focus.cell.parentParaIndex &&
        cur.anchor.cell.controlIndex === cur.focus.cell.controlIndex
      ) {
        try {
          const ac = cur.anchor.cell;
          const fc = cur.focus.cell;
          const cells = JSON.parse(
            doc.getTableCellBboxes(
              cur.anchor.sectionIndex,
              ac.parentParaIndex,
              ac.controlIndex,
            ),
          ) as {
            cellIdx: number;
            row: number;
            col: number;
            rowSpan: number;
            colSpan: number;
          }[];
          const fCell = cells.find((x) => x.cellIdx === fc.cellIndex);
          if (fCell) {
            const dr =
              e.key === 'ArrowDown'
                ? fCell.rowSpan
                : e.key === 'ArrowUp'
                  ? -1
                  : 0;
            const dc =
              e.key === 'ArrowRight'
                ? fCell.colSpan
                : e.key === 'ArrowLeft'
                  ? -1
                  : 0;
            const targetR = fCell.row + dr;
            const targetC = fCell.col + dc;
            const next = cells.find(
              (x) =>
                targetR >= x.row &&
                targetR <= x.row + x.rowSpan - 1 &&
                targetC >= x.col &&
                targetC <= x.col + x.colSpan - 1,
            );
            if (next) {
              const newFocus = {
                sectionIndex: cur.focus.sectionIndex,
                paragraphIndex: 0,
                charOffset: 0,
                cell: {
                  parentParaIndex: fc.parentParaIndex,
                  controlIndex: fc.controlIndex,
                  cellIndex: next.cellIdx,
                  cellParaIndex: 0,
                },
              };
              const newSel = { anchor: cur.anchor, focus: newFocus };
              caretRef.current = newFocus;
              setSelection(newSel);
              refreshCellBlockHighlights(newSel);
            }
          }
        } catch (err) {
          console.warn('[studio] cell-block extension failed:', err);
        }
        e.preventDefault();
        return;
      }
      // No valid cell selection — exit extension mode.
      setCellBlockExtendMode(false);
    }
    // Word-wise navigation: Cmd/Ctrl + (Shift?) + Arrow Left/Right
    // moves the caret to the prev/next word boundary. With Shift this
    // extends the current selection. Without Shift it collapses any
    // selection to the new position.
    const isWordKey =
      primaryModifier(e) &&
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
    if (e.key === 'ArrowLeft' && !c.cell) {
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
    if (e.key === 'ArrowRight' && !c.cell) {
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
      let hit: RhwpHitTest | null;
      try {
        hit = JSON.parse(
          doc.hitTest(targetPage, rect.x, targetY),
        ) as RhwpHitTest;
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
    // Esc — clears selection in two scenarios:
    // 1) Active drag: cancel and roll back to pre-drag state
    //    (or clear if there was none).
    // 2) Post-drag (selection committed but no longer dragging):
    //    just clear the selection. Without this branch the user
    //    had no keyboard way to dismiss a stale selection — the
    //    `&& draggingRef.current` guard meant ESC silently no-op'd
    //    after mouseup.
    // Phase D 2차 — ⌘⇧M (Cmd+Shift+M) 토글 마퀴 모드.
    if (
      primaryModifier(e) &&
      e.shiftKey &&
      !e.altKey &&
      e.key.toLowerCase() === 'm'
    ) {
      setMarqueeMode((v) => !v);
      setMarqueeRect(null);
      marqueeStartRef.current = null;
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      // 마퀴 모드 활성 시 ESC = 모드 종료.
      if (marqueeMode) {
        setMarqueeMode(false);
        setMarqueeRect(null);
        marqueeStartRef.current = null;
        setSelectedControlBboxes({});
        e.preventDefault();
        return;
      }
      if (draggingRef.current) {
        dragCleanupRef.current?.();
        dragCleanupRef.current = null;
        draggingRef.current = false;
        cellDragRef.current = null;
        setCellBlockExtendMode(false);
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
      if (selectionRef.current) {
        setCellBlockExtendMode(false);
        clearSelection();
        e.preventDefault();
        return;
      }
    }
    // Phase B-2 — Hancom 호환 cell/row/column block 단축키.
    // F5 = 현재 셀 (3번 연속 = 표 전체), F7 = 칸(열), F8 = 줄(행).
    // Mac 변환 매핑: ⌘⌥B (cell) / ⌘⌥C (column) / ⌘⌥R (row) /
    // ⌘⌥T (whole table). 키보드 핸들러에서 둘 다 받음.
    const isCellBlockKey =
      e.key === 'F5' ||
      (e.metaKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b');
    const isWholeTableKey =
      e.metaKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 't';
    const isColumnBlockKey =
      e.key === 'F7' ||
      (e.metaKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c');
    const isRowBlockKey =
      e.key === 'F8' ||
      (e.metaKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'r');
    if (
      isCellBlockKey ||
      isWholeTableKey ||
      isColumnBlockKey ||
      isRowBlockKey
    ) {
      // F5 press counter — reset on any non-F5 key (here we
      // increment only for F5; ⌘⌥B/C/R/T short-circuit count).
      if (e.key === 'F5') {
        const now = performance.now();
        if (now - f5LastPressRef.current < 600) {
          f5PressCountRef.current += 1;
        } else {
          f5PressCountRef.current = 1;
        }
        f5LastPressRef.current = now;
      } else {
        f5PressCountRef.current = 0;
      }
      if (!c.cell) {
        // Outside a cell — F5/F7/F8 no-op (Hancom는 본문에선 동작 안 함).
        e.preventDefault();
        return;
      }
      const ci = c.cell;
      try {
        const cells = JSON.parse(
          doc.getTableCellBboxes(
            c.sectionIndex,
            ci.parentParaIndex,
            ci.controlIndex,
          ),
        ) as {
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
        const here = cells.find((x) => x.cellIdx === ci.cellIndex);
        if (!here) {
          e.preventDefault();
          return;
        }
        // (anchor, focus) cell pair → refreshCellBlockHighlights
        // computes the rectangle. Selection state도 업데이트해서
        // 확장 모드(B-2.5)가 anchor에서 시작하도록 함.
        let anchorCell = here;
        let focusCell = here;
        const f5x3 = isCellBlockKey && f5PressCountRef.current >= 3;
        if (isWholeTableKey || f5x3) {
          const minRow = Math.min(...cells.map((x) => x.row));
          const maxRow = Math.max(...cells.map((x) => x.row + x.rowSpan - 1));
          const minCol = Math.min(...cells.map((x) => x.col));
          const maxCol = Math.max(...cells.map((x) => x.col + x.colSpan - 1));
          anchorCell =
            cells.find((x) => x.row === minRow && x.col === minCol) ?? here;
          focusCell =
            cells.find(
              (x) =>
                x.row + x.rowSpan - 1 === maxRow &&
                x.col + x.colSpan - 1 === maxCol,
            ) ?? here;
          setCellBlockExtendMode(false);
          f5PressCountRef.current = 0;
        } else if (isColumnBlockKey) {
          const cStart = here.col;
          const cEnd = here.col + here.colSpan - 1;
          const inCol = cells.filter(
            (x) => x.col + x.colSpan - 1 >= cStart && x.col <= cEnd,
          );
          const minRow = Math.min(...inCol.map((x) => x.row));
          const maxRow = Math.max(...inCol.map((x) => x.row + x.rowSpan - 1));
          anchorCell = inCol.find((x) => x.row === minRow) ?? here;
          focusCell =
            inCol.find((x) => x.row + x.rowSpan - 1 === maxRow) ?? here;
          setCellBlockExtendMode(false);
        } else if (isRowBlockKey) {
          const rStart = here.row;
          const rEnd = here.row + here.rowSpan - 1;
          const inRow = cells.filter(
            (x) => x.row + x.rowSpan - 1 >= rStart && x.row <= rEnd,
          );
          const minCol = Math.min(...inRow.map((x) => x.col));
          const maxCol = Math.max(...inRow.map((x) => x.col + x.colSpan - 1));
          anchorCell = inRow.find((x) => x.col === minCol) ?? here;
          focusCell =
            inRow.find((x) => x.col + x.colSpan - 1 === maxCol) ?? here;
          setCellBlockExtendMode(false);
        } else if (isCellBlockKey) {
          // F5×1 = 현재 셀, F5×2 = 확장 모드 진입 (block 그대로).
          if (f5PressCountRef.current === 2) {
            setCellBlockExtendMode(true);
            // Block 자체는 그대로 두고 mode flag만 set.
          } else {
            setCellBlockExtendMode(false);
          }
        }
        const anchorCaret = {
          sectionIndex: c.sectionIndex,
          paragraphIndex: 0,
          charOffset: 0,
          cell: {
            parentParaIndex: ci.parentParaIndex,
            controlIndex: ci.controlIndex,
            cellIndex: anchorCell.cellIdx,
            cellParaIndex: 0,
          },
        };
        const focusCaret = {
          sectionIndex: c.sectionIndex,
          paragraphIndex: 0,
          charOffset: 0,
          cell: {
            parentParaIndex: ci.parentParaIndex,
            controlIndex: ci.controlIndex,
            cellIndex: focusCell.cellIdx,
            cellParaIndex: 0,
          },
        };
        const newSel = { anchor: anchorCaret, focus: focusCaret };
        caretRef.current = focusCaret;
        setSelection(newSel);
        setSelectionRectsByPage({});
        setSelectedControlBboxes({});
        refreshCellBlockHighlights(newSel);
      } catch (err) {
        console.warn('[studio] F-key cell block failed:', err);
      }
      e.preventDefault();
      return;
    }
    // Reset F5 counter on any other key (so non-F5 press breaks
    // the F5×3 chain). 단, 확장 모드 진행 중인 화살표 키는 카운터
    // 리셋하지 않음 (몇 번 확장해도 다시 F5 누르면 표 전체로
    // 즉시 도달 가능하게).
    if (
      e.key !== 'F5' &&
      !(
        cellBlockExtendModeRef.current &&
        (e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown')
      )
    ) {
      f5PressCountRef.current = 0;
    }
    // Phase B-1 — 한글 호환 본문 block 단축키 (F3 시리즈).
    // F3 1× = block mode entry (Shift+arrow와 동등이라 v1 no-op),
    // F3 2× = 단어 선택, F3 3× = 단락 선택, F3 4× = 문서 전체.
    // 셀 안 caret이면 fall-through (한글 reflex와 동일).
    if (e.key === 'F3' && !c.cell) {
      const now = performance.now();
      if (now - f3LastPressRef.current < 600) {
        f3PressCountRef.current += 1;
      } else {
        f3PressCountRef.current = 1;
      }
      f3LastPressRef.current = now;
      const count = f3PressCountRef.current;
      if (count === 2) {
        const w = findWordBoundsAt(
          c.sectionIndex,
          c.paragraphIndex,
          c.charOffset,
        );
        if (w && w.endOffset > w.startOffset) {
          const start = { ...c, charOffset: w.startOffset };
          const end = { ...c, charOffset: w.endOffset };
          caretRef.current = end;
          setSelection({ anchor: start, focus: end });
          refreshSelectionRects({ anchor: start, focus: end });
          refreshActiveFormat();
        }
      } else if (count === 3) {
        try {
          const len = doc.getParagraphLength(c.sectionIndex, c.paragraphIndex);
          const start = { ...c, charOffset: 0 };
          const end = { ...c, charOffset: len };
          caretRef.current = end;
          setSelection({ anchor: start, focus: end });
          refreshSelectionRects({ anchor: start, focus: end });
          refreshActiveFormat();
        } catch {
          /* ignore */
        }
      } else if (count >= 4) {
        try {
          const sec = c.sectionIndex;
          const lastPara = doc.getParagraphCount(sec) - 1;
          if (lastPara >= 0) {
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
            refreshActiveFormat();
          }
        } catch {
          /* ignore */
        }
      }
      // count === 1 은 v1에선 no-op (Shift+arrow가 같은 효과).
      e.preventDefault();
      return;
    }
    if (e.key !== 'F3') {
      f3PressCountRef.current = 0;
    }
    // Phase B-3 — 표 안 navigation 단축키:
    //   Tab / Shift+Tab → 다음/이전 셀로 caret 이동
    //   Ctrl+Tab → 셀 안에 탭 문자 삽입 (insertTextInCell)
    //   Alt+화살표 → 같은 표 안 row/col 단위 셀 이동
    //   Shift+ESC → 표 빠져나가기 (caret을 표 다음 본문 단락으로)
    // 셀 안 caret이 아니면 Tab 같은 키는 본문 동작 (탭 문자
    // 삽입 등)으로 fall through.
    if (c.cell) {
      const ci = c.cell;
      const moveCaretToCellByCellIdx = (newCellIdx: number): void => {
        const newCaret = {
          sectionIndex: c.sectionIndex,
          paragraphIndex: 0,
          charOffset: 0,
          cell: { ...ci, cellIndex: newCellIdx, cellParaIndex: 0 },
        };
        caretRef.current = newCaret;
        setSelection({ anchor: newCaret, focus: newCaret });
        setSelectionRectsByPage({});
        setCellBlockHighlights({});
        refreshCursorRect();
        refreshActiveFormat();
      };
      // Phase B-4 — 표 편집 단축키 (셀 안 caret 또는 셀 block 활성).
      // 줄/칸 추가·삭제 + 셀 합치기·나누기 라이브러리 API에 매핑.
      //   Ctrl+Enter → 현재 행 아래에 줄 추가 (insertTableRow below)
      //   Ctrl+Backspace → 현재 행 삭제 (deleteTableRow)
      //   Alt+Insert → 줄 추가 (Hancom: 셀 block 종류에 따라 row/col,
      //     v1은 row만 — Ctrl+Enter와 동일 동작)
      //   Alt+Delete → 줄 삭제 (Hancom: row/col, v1은 row만)
      //   M (cell-block 활성) → 셀 합치기 (mergeTableCells)
      //   S (cell-block 활성) → 셀 나누기 (splitTableCell)
      const isInsertRow =
        (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Enter') ||
        (e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'Insert');
      const isDeleteRow =
        (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Backspace') ||
        (e.altKey && !e.metaKey && !e.ctrlKey && e.key === 'Delete');
      if (isInsertRow || isDeleteRow) {
        try {
          const cells = JSON.parse(
            doc.getTableCellBboxes(
              c.sectionIndex,
              ci.parentParaIndex,
              ci.controlIndex,
            ),
          ) as { cellIdx: number; row: number; col: number }[];
          const here = cells.find((x) => x.cellIdx === ci.cellIndex);
          if (here) {
            if (isInsertRow) {
              doc.insertTableRow(
                c.sectionIndex,
                ci.parentParaIndex,
                ci.controlIndex,
                here.row,
                true /* below */,
              );
            } else {
              doc.deleteTableRow(
                c.sectionIndex,
                ci.parentParaIndex,
                ci.controlIndex,
                here.row,
              );
            }
            refreshAfterMutation({ syncCaret: false });
          }
        } catch (err) {
          console.warn('[studio] table row op failed:', err);
        }
        e.preventDefault();
        return;
      }
      // 셀 합치기 / 나누기 — 셀-block 활성 (selection에 다른 셀
      // 두 개의 anchor·focus가 같은 표) 시에만 동작.
      if (
        (e.key === 'm' || e.key === 'M' || e.key === 's' || e.key === 'S') &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        const cur = selectionRef.current;
        if (
          cur &&
          cur.anchor.cell &&
          cur.focus.cell &&
          cur.anchor.cell.parentParaIndex === cur.focus.cell.parentParaIndex &&
          cur.anchor.cell.controlIndex === cur.focus.cell.controlIndex
        ) {
          try {
            const ac = cur.anchor.cell;
            const fc = cur.focus.cell;
            const cells = JSON.parse(
              doc.getTableCellBboxes(
                cur.anchor.sectionIndex,
                ac.parentParaIndex,
                ac.controlIndex,
              ),
            ) as {
              cellIdx: number;
              row: number;
              col: number;
              rowSpan: number;
              colSpan: number;
            }[];
            const acCell = cells.find((x) => x.cellIdx === ac.cellIndex);
            const fcCell = cells.find((x) => x.cellIdx === fc.cellIndex);
            if (acCell && fcCell) {
              const startRow = Math.min(acCell.row, fcCell.row);
              const endRow = Math.max(
                acCell.row + acCell.rowSpan - 1,
                fcCell.row + fcCell.rowSpan - 1,
              );
              const startCol = Math.min(acCell.col, fcCell.col);
              const endCol = Math.max(
                acCell.col + acCell.colSpan - 1,
                fcCell.col + fcCell.colSpan - 1,
              );
              if (e.key === 'm' || e.key === 'M') {
                // M: 셀 합치기. 라이브러리는 startRow/Col~endRow/Col
                // rectangle만 받음. anchor·focus rectangle은 처리.
                // 불연속 셀 (Ctrl+클릭 추가본)은 mergeTableCells 한
                // 호출에 포함 불가 — discontiguous cells가 rectangle
                // 안에 들어오는 경우만 자동 포함됨. 그 외엔 무시.
                doc.mergeTableCells(
                  cur.anchor.sectionIndex,
                  ac.parentParaIndex,
                  ac.controlIndex,
                  startRow,
                  startCol,
                  endRow,
                  endCol,
                );
              } else {
                // S: 셀 나누기 — anchor/focus rectangle의 모든 셀에
                // 1×1 split 적용. 불연속 셀(Ctrl+클릭)도 동일하게
                // per-cell split 호출.
                const targetCells = cells.filter((cellInfo) => {
                  const inRect =
                    cellInfo.row + cellInfo.rowSpan - 1 >= startRow &&
                    cellInfo.row <= endRow &&
                    cellInfo.col + cellInfo.colSpan - 1 >= startCol &&
                    cellInfo.col <= endCol;
                  const inDiscontig = discontiguousCellsRef.current.some(
                    (d) =>
                      d.parentParaIndex === ac.parentParaIndex &&
                      d.controlIndex === ac.controlIndex &&
                      d.cellIndex === cellInfo.cellIdx,
                  );
                  return inRect || inDiscontig;
                });
                for (const tc of targetCells) {
                  doc.splitTableCell(
                    cur.anchor.sectionIndex,
                    ac.parentParaIndex,
                    ac.controlIndex,
                    tc.row,
                    tc.col,
                  );
                }
              }
              refreshAfterMutation({ syncCaret: false });
              setCellBlockHighlights({});
              setSelection(null);
              setCellBlockExtendMode(false);
              discontiguousCellsRef.current = [];
            }
          } catch (err) {
            console.warn('[studio] cell merge/split failed:', err);
          }
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        try {
          const cells = JSON.parse(
            doc.getTableCellBboxes(
              c.sectionIndex,
              ci.parentParaIndex,
              ci.controlIndex,
            ),
          ) as { cellIdx: number; row: number; col: number }[];
          // Row-major sort: row asc, col asc.
          cells.sort((a, b) =>
            a.row !== b.row ? a.row - b.row : a.col - b.col,
          );
          const idx = cells.findIndex((x) => x.cellIdx === ci.cellIndex);
          if (idx >= 0) {
            const dir = e.shiftKey ? -1 : 1;
            const nextIdx = idx + dir;
            if (nextIdx >= 0 && nextIdx < cells.length) {
              moveCaretToCellByCellIdx(cells[nextIdx].cellIdx);
            }
            // Edge of table: stay (Hancom creates a new row in
            // some cases; v1 doesn't auto-grow).
          }
        } catch (err) {
          console.warn('[studio] cell Tab nav failed:', err);
        }
        e.preventDefault();
        return;
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        const arrowDir =
          e.key === 'ArrowLeft'
            ? { dr: 0, dc: -1 }
            : e.key === 'ArrowRight'
              ? { dr: 0, dc: 1 }
              : e.key === 'ArrowUp'
                ? { dr: -1, dc: 0 }
                : e.key === 'ArrowDown'
                  ? { dr: 1, dc: 0 }
                  : null;
        if (arrowDir) {
          try {
            const cells = JSON.parse(
              doc.getTableCellBboxes(
                c.sectionIndex,
                ci.parentParaIndex,
                ci.controlIndex,
              ),
            ) as {
              cellIdx: number;
              row: number;
              col: number;
              rowSpan: number;
              colSpan: number;
            }[];
            const here = cells.find((x) => x.cellIdx === ci.cellIndex);
            if (here) {
              const targetR = here.row + arrowDir.dr * here.rowSpan;
              const targetC = here.col + arrowDir.dc * here.colSpan;
              // 가장 가까운 셀 (병합 셀이면 그 셀의 row/col 시작점이
              // targetR/targetC를 포함하는지 확인).
              const next = cells.find(
                (x) =>
                  targetR >= x.row &&
                  targetR <= x.row + x.rowSpan - 1 &&
                  targetC >= x.col &&
                  targetC <= x.col + x.colSpan - 1,
              );
              if (next) moveCaretToCellByCellIdx(next.cellIdx);
            }
          } catch (err) {
            console.warn('[studio] Alt+arrow cell nav failed:', err);
          }
          e.preventDefault();
          return;
        }
      }
      if (e.key === 'Escape' && e.shiftKey) {
        // 표 빠져나가기 — caret을 표가 속한 단락 바로 다음 단락의
        // 시작으로 (없으면 같은 단락 끝). cell-block highlight 정리.
        const sec = c.sectionIndex;
        const parentPara = ci.parentParaIndex;
        try {
          const paraCount = doc.getParagraphCount(sec);
          const nextPara =
            parentPara + 1 < paraCount
              ? { paragraphIndex: parentPara + 1, charOffset: 0 }
              : {
                  paragraphIndex: parentPara,
                  charOffset: doc.getParagraphLength(sec, parentPara),
                };
          const newCaret = {
            sectionIndex: sec,
            paragraphIndex: nextPara.paragraphIndex,
            charOffset: nextPara.charOffset,
          };
          caretRef.current = newCaret;
          setSelection({ anchor: newCaret, focus: newCaret });
          setSelectionRectsByPage({});
          setCellBlockHighlights({});
          setSelectedControlBboxes({});
          refreshCursorRect();
          refreshActiveFormat();
        } catch (err) {
          console.warn('[studio] Shift+Esc exit table failed:', err);
        }
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'Home') {
      // Cmd/Ctrl + Home → jump to start of document (chunk 12).
      if (primaryModifier(e)) {
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
      if (primaryModifier(e)) {
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
        const len = doc.getParagraphLength(c.sectionIndex, c.paragraphIndex);
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
    if (primaryModifier(e) && !e.altKey) {
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
    if (primaryModifier(e) && !e.altKey && !e.shiftKey) {
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
    if (e.key === 'Tab' && c.cell && !e.metaKey && !e.ctrlKey && !e.altKey) {
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
    // 여기는 platform-aware primaryModifier가 아니라 원래 OR 패턴
    // 유지 — "어떤 modifier든 잡혀있으면 typing으로 처리하지 말고
    // 흘려보낸다"가 의도. Mac에서 Ctrl+A를 잘못 'a' 입력으로
    // 해석하는 회귀 방지.
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
        doc.insertText(cc.sectionIndex, cc.paragraphIndex, cc.charOffset, '\n');
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
          return doc.getParagraphLength(c.sectionIndex, c.paragraphIndex) === 0;
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
  }, []);
}
