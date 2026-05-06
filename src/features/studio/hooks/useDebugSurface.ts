/**
 * `useDebugSurface` — Phase R1.8 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 ~970-라인 `__studioDebug` useEffect 를 hook 으로
 * 분해. 외부 contract / 동작 1:1 동일 — e2e specs 가 의존하는 mutation
 * + read API 80+ 개. tab system 에서 `isActive` 인 viewer 만 글로벌
 * 점유.
 *
 * Latest-ref 패턴 안 씀 — useEffect 의 deps 배열이 그대로 originality
 * 있어 R1.4 이전 스타일 유지. opts 가 워낙 많아 destructure 한 뒤
 * useEffect 본체 verbatim.
 */
import {
  useEffect,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import { HwpDocument, type RhwpDoc } from '@/lib/rhwp-core';
import type { CharFormatKey } from '../types';
import { enumerateEmptyFormFields } from '@/features/studio/utils/empty-form-fields';

type ParaAlignment = 'left' | 'center' | 'right' | 'justify';

// 임의 shape 의 ref / setter / state — 본 hook 은 모두 thin wrap. 정확
// 한 타입 추론은 caller 가 보유한 useState/useRef 가 결정.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMutableRef<T = any> = MutableRefObject<T>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySetState<T = any> = Dispatch<SetStateAction<T>>;

export interface UseDebugSurfaceOptions {
  // state gates
  phase: string;
  isActive: boolean;
  pageCount: number;
  // refs (mutated heavily — full list of those touched by debug body)
  docRef: MutableRefObject<RhwpDoc | null>;
  caretRef: AnyMutableRef;
  dirtyRef: MutableRefObject<boolean>;
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  historyRef: MutableRefObject<{ entries: number[]; index: number }>;
  selectionRef: AnyMutableRef;
  cellBlockExtendModeRef: MutableRefObject<boolean>;
  undoGroupDepthRef: MutableRefObject<number>;
  f5LastPressRef: MutableRefObject<number>;
  f5PressCountRef: MutableRefObject<number>;
  f3LastPressRef: MutableRefObject<number>;
  f3PressCountRef: MutableRefObject<number>;
  discontiguousCellsRef: AnyMutableRef;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  composingRef: MutableRefObject<boolean>;
  changedParaTimerRef: MutableRefObject<number | null>;
  cacheRef: MutableRefObject<Map<number, string>>;
  findTextCacheRef: MutableRefObject<Map<string, string> | null>;
  // setters
  setDirty: (v: boolean) => void;
  setCursorRect: AnySetState;
  setChangedParaRects: AnySetState;
  setMarqueeMode: AnySetState;
  setMarqueeRect: AnySetState;
  setSelectedControlBboxes: AnySetState;
  setCellBlockHighlights: AnySetState;
  setSelectionRectsByPage: AnySetState;
  setSlashMenu: AnySetState;
  setCellBlockExtendMode: (v: boolean) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setSelection: (next: any) => void;
  setFindQuery: (v: string) => void;
  setReplaceQuery: (v: string) => void;
  // state values
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeFormat: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  styleList: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  selection: any;
  findOpen: boolean;
  findQuery: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMatches: any;
  findIndex: number;
  replaceQuery: string;
  replaceFeedback: string | null;
  // callbacks (kept loose — body calls each as-is)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  captureExcerpt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pushHistory: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshAfterMutation: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderPageInto: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toggleCharFormat: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyParagraphStyle: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sortRange: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshSelectionRects: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshActiveFormat: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshCursorRect: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clearSelection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  undo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  redo: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  beginUndoGroup: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  endUndoGroup: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  copySelection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cutSelection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pasteAtCaret: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openFind: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  closeFind: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findNext: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findPrev: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runFindSearch: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  openReplace: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replaceCurrent: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  replaceAllMatches: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyAlignment: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyFontSizePt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyTextColor: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyLineSpacing: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stepIndent: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyParaSpacing: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findWordBoundsAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stepWordOffset: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertImage: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertTableRowAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertTableColumnAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteTableRowAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteTableColumnAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mergeCells: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  splitCellInto: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unmergeCell: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyPageDef: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setHeaderFooterText: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addBookmarkAtCaret: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteBookmarkAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renameBookmarkAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  insertFootnoteAtCaret: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createNamedStyle: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renameStyle: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteStyleById: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderEquationSvg: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTableProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setTableProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getCellProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCellProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createRectShapeAtCaret: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getShapeProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setShapeProps: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deleteShape: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  changeShapeZOrderAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exportSelectionHtmlAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pasteHtmlAt: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyHtmlAtCaret: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyHtmlReplaceSection: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  refreshCellBlockHighlights: any;
}

export function useDebugSurface(opts: UseDebugSurfaceOptions): void {
  const {
    phase,
    isActive,
    pageCount,
    docRef,
    caretRef,
    dirtyRef,
    pageRefsRef,
    historyRef,
    selectionRef,
    scrollRef,
    cacheRef,
    setDirty,
    setCursorRect,
    setSelectionRectsByPage,
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
    applyHtmlReplaceSection,
    refreshCellBlockHighlights,
  } = opts;

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
      // chunk 84 — alignment save→reopen 회귀 격리. 현재 doc 의 bytes
      // 를 export 한 뒤 fresh HwpDocument 로 재파싱해 같은 paragraph
      // props 를 읽는다. 우리 file IPC 를 거치지 않는 pure lib
      // roundtrip — 결과가 lib 한계인지 우리 흐름인지 분리해 준다.
      reparseAndReadParaProps: (
        sectionIdx: number,
        paraIdx: number,
      ): string => {
        const doc = docRef.current;
        if (!doc) throw new Error('Document not loaded');
        const bytes = doc.exportHwp();
        const fresh = new HwpDocument(bytes);
        try {
          return fresh.getParaPropertiesAt(sectionIdx, paraIdx);
        } finally {
          fresh.free();
        }
      },
      getPageCount: (): number => pageCount,
      isDirty: (): boolean => dirtyRef.current,
      // chunk 107: page-layer-tree JSON access for canvas-mode e2e
      // (image presence detection now that SVG <image> selectors are gone).
      getPageLayerTreeJson: (pageIdx: number): string => {
        const doc = docRef.current;
        if (!doc) return '';
        try {
          return doc.getPageLayerTree(pageIdx);
        } catch {
          return '';
        }
      },
      // Phase 6 follow-up: text-layout JSON access for L-004 tooltip
      // overlay design + e2e probes.
      getPageTextLayoutJson: (pageIdx: number): string => {
        const doc = docRef.current;
        if (!doc) return '';
        try {
          return doc.getPageTextLayout(pageIdx);
        } catch {
          return '';
        }
      },
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
      // chunk 84 — fresh read from the IR each call instead of the
      // React `activeFormat` state. The state is updated only after
      // refreshActiveFormat fires + a React render commits + this
      // useEffect re-binds the debug surface. In React 19 batching,
      // a synchronous test sequence (setSelection → getActiveFormat)
      // can read a stale closure. Reading via getCharPropertiesAt /
      // getParaPropertiesAt at call time avoids the lag — same code
      // path refreshActiveFormat uses, just without the round-trip
      // through React state.
      getActiveFormat: () => {
        const doc = docRef.current;
        if (!doc) return { ...activeFormat };
        const c = caretRef.current;
        if (c.cell) return { ...activeFormat };
        let readPara = c.paragraphIndex;
        let readOffset = c.charOffset;
        const sel = selectionRef.current;
        if (sel) {
          const r = sortRange(sel.anchor, sel.focus);
          if (!r.empty) {
            readPara = r.startPara;
            readOffset = r.startOffset + 1;
          }
        }
        try {
          const cp = JSON.parse(
            doc.getCharPropertiesAt(c.sectionIndex, readPara, readOffset),
          ) as {
            bold?: boolean;
            italic?: boolean;
            underline?: boolean;
            fontSize?: number;
            textColor?: string;
          };
          const at = JSON.parse(doc.getStyleAt(c.sectionIndex, readPara)) as {
            id?: number;
          };
          let alignment: 'left' | 'center' | 'right' | 'justify' = 'left';
          try {
            const pp = JSON.parse(
              doc.getParaPropertiesAt(c.sectionIndex, readPara),
            ) as { alignment?: string };
            if (
              pp.alignment === 'left' ||
              pp.alignment === 'center' ||
              pp.alignment === 'right' ||
              pp.alignment === 'justify'
            ) {
              alignment = pp.alignment;
            }
          } catch {
            /* keep default */
          }
          return {
            bold: !!cp.bold,
            italic: !!cp.italic,
            underline: !!cp.underline,
            styleId: at.id,
            fontSize: typeof cp.fontSize === 'number' ? cp.fontSize : 1000,
            textColor:
              typeof cp.textColor === 'string' ? cp.textColor : '#000000',
            alignment,
          };
        } catch {
          return { ...activeFormat };
        }
      },
      getStyleList: () => [...styleList],
      // Selection helpers (chunk 5b). Set anchor and focus directly so
      // tests can drive range ops without simulating mouse drag.
      setSelection: (
        anchorPara: number,
        anchorOff: number,
        focusPara: number,
        focusOff: number,
        opts?: {
          anchorCell?: {
            parentParaIndex: number;
            controlIndex: number;
            cellIndex: number;
            cellParaIndex: number;
          };
          focusCell?: {
            parentParaIndex: number;
            controlIndex: number;
            cellIndex: number;
            cellParaIndex: number;
          };
        },
      ): void => {
        const sel = {
          anchor: {
            sectionIndex: 0,
            paragraphIndex: anchorPara,
            charOffset: anchorOff,
            cell: opts?.anchorCell,
          },
          focus: {
            sectionIndex: 0,
            paragraphIndex: focusPara,
            charOffset: focusOff,
            cell: opts?.focusCell,
          },
        };
        caretRef.current = sel.focus;
        setSelection(sel);
        // chunk 32 — cell-block selection이면 char-level rect 대신
        // per-cell highlight 표시.
        const ac = sel.anchor.cell;
        const fc = sel.focus.cell;
        if (
          ac &&
          fc &&
          ac.parentParaIndex === fc.parentParaIndex &&
          ac.controlIndex === fc.controlIndex &&
          (ac.cellIndex !== fc.cellIndex ||
            ac.cellParaIndex !== fc.cellParaIndex)
        ) {
          refreshCellBlockHighlights(sel);
        } else {
          refreshSelectionRects(sel);
        }
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
      getCharProps: (
        sectionIdx: number,
        paraIdx: number,
        charOffset: number,
      ): unknown => {
        const doc = docRef.current;
        if (!doc) throw new Error('Document not loaded');
        return JSON.parse(
          doc.getCharPropertiesAt(sectionIdx, paraIdx, charOffset),
        );
      },
      getEmptyFormFields: (opts?: {
        sectionIdx?: number;
        maxResults?: number;
      }): unknown => {
        const doc = docRef.current;
        if (!doc) throw new Error('Document not loaded');
        return enumerateEmptyFormFields(doc, opts ?? {});
      },
      // 0.4.21 진단 — 빈 cell 발견 가능성 추적용. 처음 N paragraph 에서
      // 어떤 control 들이 있는지 + table dimensions 결과 dump.
      probeControls: (sectionIdx: number, maxParas: number): unknown => {
        const doc = docRef.current;
        if (!doc) throw new Error('Document not loaded');
        const out: {
          p: number;
          positions: string;
          tableDims: Record<number, string>;
        }[] = [];
        const cnt = Math.min(doc.getParagraphCount(sectionIdx), maxParas);
        for (let p = 0; p < cnt; p++) {
          let positions: string;
          try {
            positions = doc.getControlTextPositions(sectionIdx, p);
          } catch (err) {
            positions = `err:${(err as Error).message}`;
          }
          const tableDims: Record<number, string> = {};
          if (positions && positions !== '[]') {
            try {
              const parsed = JSON.parse(positions);
              if (Array.isArray(parsed)) {
                for (const pos of parsed) {
                  const ctrlIdx =
                    typeof pos?.controlIndex === 'number'
                      ? pos.controlIndex
                      : typeof pos?.controlIdx === 'number'
                        ? pos.controlIdx
                        : typeof pos?.index === 'number'
                          ? pos.index
                          : -1;
                  if (ctrlIdx < 0) continue;
                  try {
                    tableDims[ctrlIdx] = doc.getTableDimensions(
                      sectionIdx,
                      p,
                      ctrlIdx,
                    );
                  } catch (err) {
                    tableDims[ctrlIdx] = `err:${(err as Error).message}`;
                  }
                }
              }
            } catch {
              /* ignore */
            }
          }
          if (positions !== '[]' || Object.keys(tableDims).length > 0) {
            out.push({ p, positions, tableDims });
          }
        }
        return out;
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
          return JSON.parse(doc.getTableDimensions(sec, parentPara, ctrl)) as {
            rowCount: number;
            colCount: number;
            cellCount: number;
          };
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
      // chunk 99 follow-up — outline-aware section replace.
      applyHtmlReplaceSection: (
        html: string,
        target: { startParaIdx: number; endParaIdxExclusive: number },
      ): void => applyHtmlReplaceSection(html, target),
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
        // "제목 2", "제목 3"; "개요 N" 도 공통 outline 스타일 (blank.hwpx
        // 기본 + 사업계획서 양식에서 채용); "Heading N" 은 HWPX import.
        // Body styles ("바탕글" / "본문") 는 skip.
        const headingByStyleId = new Map<number, number>();
        for (const s of styleList) {
          const koMatch = s.name.match(/^제목\s*(\d+)?/);
          const koOutline = s.name.match(/^개요\s*(\d+)?/);
          const enMatch = s.englishName?.match(/^Heading\s*(\d+)?/i);
          const m = koMatch ?? koOutline ?? enMatch;
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
      ): Record<string, unknown> | null => getShapeProps(sec, parentPara, ctrl),
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
      ): Record<string, unknown> | null => getTableProps(sec, parentPara, ctrl),
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
            doc.applyCellStyle(sec, parentPara, ctrl, cell, cellPara, styleId),
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
      // Bundled undo — chunk 27. R1.2: hook-provided.
      beginUndoGroup,
      endUndoGroup,
      // Equation preview — chunk 16.
      renderEquationSvg: (
        script: string,
        fontSizeHwpunit = 1000,
        color = 0,
      ): string => renderEquationSvg(script, fontSizeHwpunit, color),
      // Styles — chunk 14.
      createNamedStyle: (name: string, englishName?: string): number | null =>
        createNamedStyle(name, englishName),
      renameStyle: (id: number, name: string, englishName?: string): boolean =>
        renameStyle(id, name, englishName),
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
          return JSON.parse(doc.getFootnoteInfo(sec, para, ctrlIdx)) as Record<
            string,
            unknown
          >;
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
        // chunk 107: canvas-only — re-render in place onto the pooled canvas.
        pageRefsRef.current.forEach((el, idx) => {
          if (el?.firstElementChild?.tagName.toLowerCase() === 'canvas') {
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
    (window as Window & { __studioDebug?: typeof debug }).__studioDebug = debug;
    return () => {
      delete (window as Window & { __studioDebug?: typeof debug })
        .__studioDebug;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    findOpen,
    findQuery,
    findMatches,
    findIndex,
    openReplace,
    replaceCurrent,
    replaceAllMatches,
    replaceQuery,
    replaceFeedback,
    setFindQuery,
    setReplaceQuery,
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
    applyHtmlReplaceSection,
  ]);
}
