/**
 * `useViewerHandle` — Phase R1.8 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 ~1180-라인 ViewerHandle `useImperativeHandle`
 * 본체를 hook 으로 분해. 외부 contract / 동작 1:1 동일 — exportBytes
 * / undo·redo·canUndo / clipboard / find·replace / format / page def
 * / header·footer / bookmark / footnote / style / equation / shape /
 * picture / table·cell props·style / formula / control clipboard /
 * scrollToParagraph / outline / paragraph snapshot / changed-stripe /
 * captureExcerpt·verifyExcerpt / IR ops 30+ 개 / Read tools 9 개 모두
 * 보존. 70+ 메서드.
 */
import { useImperativeHandle, type ForwardedRef } from 'react';
import type { RhwpDoc } from '@/lib/rhwp-core';
import { relocateExcerpt } from '@/features/studio/utils/relocate-excerpt';
import type { CharFormatKey, ViewerHandle } from '../types';
import type { RhwpStyleAt } from '@shared/rhwp-types';
import type { LifecycleCursorRect } from './useDocumentLifecycle';

type ParaAlignment = 'left' | 'center' | 'right' | 'justify';

interface ParaProps {
  alignment?: ParaAlignment;
  lineSpacing?: number;
  lineSpacingType?: 'Percent' | 'Fixed' | 'AtLeast';
  spacingBefore?: number;
  spacingAfter?: number;
  marginLeft?: number;
  marginRight?: number;
  indent?: number;
}

interface ActiveFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  styleId: number;
  fontSize: number;
  textColor: string;
  alignment: ParaAlignment;
}

interface StyleListItem {
  id: number;
  name: string;
  englishName: string;
  type: number;
  paraShapeId: number;
  charShapeId: number;
}

interface HandleCellLocation {
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

interface HandleCaret {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
  cell?: HandleCellLocation;
}

interface ChangedParaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UseViewerHandleOptions {
  // refs
  docRef: React.MutableRefObject<RhwpDoc | null>;
  caretRef: React.MutableRefObject<HandleCaret>;
  dirtyRef: React.MutableRefObject<boolean>;
  pageRefsRef: React.MutableRefObject<(HTMLDivElement | null)[]>;
  historyRef: React.MutableRefObject<{ entries: number[]; index: number }>;
  changedParaTimerRef: React.MutableRefObject<number | null>;
  // setters
  setDirty: (v: boolean) => void;
  setCursorRect: (v: LifecycleCursorRect | null) => void;
  setChangedParaRects: React.Dispatch<
    React.SetStateAction<Record<number, ChangedParaRect[]>>
  >;
  // state
  activeFormat: ActiveFormat;
  styleList: StyleListItem[];
  // callbacks
  captureExcerpt: () => {
    sectionIndex: number;
    startParagraphIndex: number;
    startOffset: number;
    endParagraphIndex: number;
    endOffset: number;
    text: string;
  } | null;
  getCellProps: (
    sec: number,
    parentPara: number,
    ctrl: number,
    cellIdx: number,
  ) => Record<string, unknown> | null;
  getTableProps: (
    sec: number,
    parentPara: number,
    ctrl: number,
  ) => Record<string, unknown> | null;
  refreshAfterMutation: (opts?: { syncCaret?: boolean }) => void;
  setCellProps: (
    sec: number,
    parentPara: number,
    ctrl: number,
    cellIdx: number,
    props: Record<string, unknown>,
  ) => void;
  setTableProps: (
    sec: number,
    parentPara: number,
    ctrl: number,
    props: Record<string, unknown>,
  ) => void;
  toggleCharFormat: (key: CharFormatKey) => void;
  undo: () => void;
  redo: () => void;
  beginUndoGroup: () => void;
  endUndoGroup: () => void;
  copySelection: () => Promise<boolean>;
  cutSelection: () => Promise<boolean>;
  pasteAtCaret: () => Promise<boolean>;
  openFind: () => void;
  openReplace: () => void;
  applyAlignment: (a: ParaAlignment) => void;
  applyFontSizePt: (pt: number) => void;
  applyTextColor: (hex: string) => void;
  applyParaProps: (props: ParaProps) => void;
  applyPageDef: (props: Record<string, unknown>, sectionIdx?: number) => void;
  setHeaderFooterText: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
    text: string,
  ) => void;
  addBookmarkAtCaret: (name: string) => void;
  deleteBookmarkAt: (sec: number, para: number, ctrlIdx: number) => void;
  renameBookmarkAt: (
    sec: number,
    para: number,
    ctrlIdx: number,
    newName: string,
  ) => void;
  insertFootnoteAtCaret: (text: string) => void;
  createNamedStyle: (name: string, englishName?: string) => number | null;
  renameStyle: (id: number, name: string, englishName?: string) => boolean;
  deleteStyleById: (id: number) => boolean;
  renderEquationSvg: (
    script: string,
    fontSizeHwpunit?: number,
    color?: number,
  ) => string;
  createRectShapeAtCaret: (
    widthHwpunit: number,
    heightHwpunit: number,
    opts?: { treatAsChar?: boolean },
  ) => { paraIdx: number; controlIdx: number } | null;
  applyHtmlAtCaret: (html: string) => void;
  applyHtmlReplaceSection: (
    html: string,
    target: { startParaIdx: number; endParaIdxExclusive: number },
  ) => void;
}

export function useViewerHandle(
  ref: ForwardedRef<ViewerHandle>,
  opts: UseViewerHandleOptions,
): void {
  const {
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
    applyHtmlReplaceSection,
  } = opts;

  // R5 — Agent ir* tool wrappers 의 try/catch 보일러플레이트 일원화.
  // mutate variant 는 doc 가 없으면 false, throw 잡고 false. read
  // variant 는 doc 가 없으면 null, throw 잡고 null + console.warn.
  const irMutate = (label: string, fn: (doc: RhwpDoc) => void): boolean => {
    const doc = docRef.current;
    if (!doc) return false;
    try {
      fn(doc);
      refreshAfterMutation();
      return true;
    } catch (err) {
      console.warn(`[studio] ${label}:`, err);
      return false;
    }
  };
  const irRead = <T>(label: string, fn: (doc: RhwpDoc) => T): T | null => {
    const doc = docRef.current;
    if (!doc) return null;
    try {
      return fn(doc);
    } catch (err) {
      console.warn(`[studio] ${label}:`, err);
      return null;
    }
  };

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
      getActiveFormat: () => ({ ...activeFormat }),
      applyParaProps: (props: Record<string, unknown>) =>
        applyParaProps(props as ParaProps),
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
      applyPageDef: (props, sectionIdx = 0) => applyPageDef(props, sectionIdx),
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
      applyHtmlReplaceSection: (html, target) =>
        applyHtmlReplaceSection(html, target),
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
            doc.applyCellStyle(sec, parentPara, ctrl, cell, cellPara, styleId),
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
      // R1.2 — depth-counted bracket lives in useUndoHistory.
      beginUndoGroup,
      endUndoGroup,
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
          // "제목 N" / "Heading N" — 표준 한컴 / 워드 호환 헤딩 스타일.
          // "개요 N" — Korean outline style (blank.hwpx 기본 + 많은
          // 사업계획서 양식에서 채용). 둘 다 picked up — 매칭은 number
          // prefix 만 비교라 false positive 위험 미미.
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
      // Phase 3 chunks 45~49 — Agent tool 카탈로그 thin wrappers. lib API
      // 1:1 매핑. mutation 후 refreshAfterMutation() 으로 viewer/dirty 동기화.
      // 부분 성공 모델 유지 — `irMutate` helper 가 throw 를 잡고 false
      // 반환 (다음 op 계속). R5 에서 helper 도입으로 보일러플레이트 일원화.
      irInsertText: (sec, para, charOffset, text) =>
        irMutate('irInsertText', (doc) =>
          doc.insertText(sec, para, charOffset, text),
        ),
      irDeleteRange: (sec, sp, so, ep, eo) =>
        irMutate('irDeleteRange', (doc) =>
          doc.deleteRange(sec, sp, so, ep, eo),
        ),
      irInsertParagraph: (sec, para) =>
        irMutate('irInsertParagraph', (doc) => doc.insertParagraph(sec, para)),
      irDeleteParagraph: (sec, para) =>
        irMutate('irDeleteParagraph', (doc) => doc.deleteParagraph(sec, para)),
      irMergeParagraph: (sec, para) =>
        irMutate('irMergeParagraph', (doc) => doc.mergeParagraph(sec, para)),
      irApplyCharFormat: (sec, para, so, eo, props) =>
        irMutate('irApplyCharFormat', (doc) =>
          doc.applyCharFormat(sec, para, so, eo, JSON.stringify(props)),
        ),
      irApplyStyle: (sec, para, styleId) =>
        irMutate('irApplyStyle', (doc) => doc.applyStyle(sec, para, styleId)),
      irCreateTable: (sec, para, charOffset, rowCount, colCount) =>
        irMutate('irCreateTable', (doc) =>
          doc.createTable(sec, para, charOffset, rowCount, colCount),
        ),
      irInsertTableRow: (sec, ppara, ctrl, rowIdx, below) =>
        irMutate('irInsertTableRow', (doc) =>
          doc.insertTableRow(sec, ppara, ctrl, rowIdx, below),
        ),
      irInsertTableColumn: (sec, ppara, ctrl, colIdx, right) =>
        irMutate('irInsertTableColumn', (doc) =>
          doc.insertTableColumn(sec, ppara, ctrl, colIdx, right),
        ),
      irDeleteTableRow: (sec, ppara, ctrl, rowIdx) =>
        irMutate('irDeleteTableRow', (doc) =>
          doc.deleteTableRow(sec, ppara, ctrl, rowIdx),
        ),
      irDeleteTableColumn: (sec, ppara, ctrl, colIdx) =>
        irMutate('irDeleteTableColumn', (doc) =>
          doc.deleteTableColumn(sec, ppara, ctrl, colIdx),
        ),
      irMergeTableCells: (sec, ppara, ctrl, sr, sc, er, ec) =>
        irMutate('irMergeTableCells', (doc) =>
          doc.mergeTableCells(sec, ppara, ctrl, sr, sc, er, ec),
        ),
      irSplitTableCellInto: (
        sec,
        ppara,
        ctrl,
        r,
        c,
        nr,
        mc,
        eqRow,
        mergeFirst,
      ) =>
        irMutate('irSplitTableCellInto', (doc) =>
          doc.splitTableCellInto(
            sec,
            ppara,
            ctrl,
            r,
            c,
            nr,
            mc,
            eqRow,
            mergeFirst,
          ),
        ),
      irUnmergeCell: (sec, ppara, ctrl, r, c) =>
        irMutate('irUnmergeCell', (doc) =>
          doc.splitTableCell(sec, ppara, ctrl, r, c),
        ),
      irDeleteTableControl: (sec, ppara, ctrl) =>
        irMutate('irDeleteTableControl', (doc) =>
          doc.deleteTableControl(sec, ppara, ctrl),
        ),
      irSetShapeProperties: (sec, ppara, ctrl, props) =>
        irMutate('irSetShapeProperties', (doc) =>
          doc.setShapeProperties(sec, ppara, ctrl, JSON.stringify(props)),
        ),
      irDeleteShapeControl: (sec, ppara, ctrl) =>
        irMutate('irDeleteShapeControl', (doc) =>
          doc.deleteShapeControl(sec, ppara, ctrl),
        ),
      irChangeShapeZOrder: (sec, ppara, ctrl, op) =>
        irMutate('irChangeShapeZOrder', (doc) =>
          doc.changeShapeZOrder(sec, ppara, ctrl, op),
        ),
      irInsertPicture: (sec, para, co, b64, w, h, nw, nh, ext, desc) =>
        irMutate('irInsertPicture', (doc) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          doc.insertPicture(sec, para, co, bytes, w, h, nw, nh, ext, desc);
        }),
      irInsertPageBreak: (sec, para, charOffset) =>
        irMutate('irInsertPageBreak', (doc) =>
          doc.insertPageBreak(sec, para, charOffset),
        ),
      irInsertColumnBreak: (sec, para, charOffset) =>
        irMutate('irInsertColumnBreak', (doc) =>
          doc.insertColumnBreak(sec, para, charOffset),
        ),
      irSetColumnDef: (sec, count, type, sameWidth, spacing) =>
        irMutate('irSetColumnDef', (doc) =>
          doc.setColumnDef(sec, count, type, sameWidth, spacing),
        ),
      irSetSectionDef: (sec, props) =>
        irMutate('irSetSectionDef', (doc) =>
          doc.setSectionDef(sec, JSON.stringify(props)),
        ),
      irSetPageHide: (sec, para, hH, hF, hM, hB, hFi, hPN) =>
        irMutate('irSetPageHide', (doc) =>
          doc.setPageHide(sec, para, hH, hF, hM, hB, hFi, hPN),
        ),
      irApplyHfTemplate: (sec, isHeader, applyTo, templateId) =>
        irMutate('irApplyHfTemplate', (doc) =>
          doc.applyHfTemplate(sec, isHeader, applyTo, templateId),
        ),
      irCreateHeaderFooter: (sec, isHeader, applyTo) =>
        irMutate('irCreateHeaderFooter', (doc) =>
          doc.createHeaderFooter(sec, isHeader, applyTo),
        ),
      irDeleteHeaderFooter: (sec, isHeader, applyTo) =>
        irMutate('irDeleteHeaderFooter', (doc) =>
          doc.deleteHeaderFooter(sec, isHeader, applyTo),
        ),
      // Phase 3 chunk 51 — read-only tools. Agent 능동 검사용.
      irGetStyleAt: (sec, para) =>
        irRead('irGetStyleAt', (doc) => {
          const atJson = JSON.parse(doc.getStyleAt(sec, para)) as RhwpStyleAt;
          const styleId = atJson.styleId ?? 0;
          const detail = JSON.parse(doc.getStyleDetail(styleId)) as Record<
            string,
            unknown
          >;
          return { ...detail, styleId };
        }),
      irGetCharPropertiesAt: (sec, para, charOffset) =>
        irRead(
          'irGetCharPropertiesAt',
          (doc) =>
            JSON.parse(
              doc.getCharPropertiesAt(sec, para, charOffset),
            ) as Record<string, unknown>,
        ),
      irGetParaPropertiesAt: (sec, para) =>
        irRead(
          'irGetParaPropertiesAt',
          (doc) =>
            JSON.parse(doc.getParaPropertiesAt(sec, para)) as Record<
              string,
              unknown
            >,
        ),
      irGetTextRange: (sec, sp, so, ep, eo) =>
        irRead('irGetTextRange', (doc) => {
          const parts: string[] = [];
          if (sp === ep) {
            parts.push(doc.getTextRange(sec, sp, so, eo));
          } else {
            const len0 = doc.getParagraphLength(sec, sp);
            parts.push(doc.getTextRange(sec, sp, so, len0));
            for (let p = sp + 1; p < ep; p++) {
              const lp = doc.getParagraphLength(sec, p);
              parts.push(doc.getTextRange(sec, p, 0, lp));
            }
            parts.push(doc.getTextRange(sec, ep, 0, eo));
          }
          const out = parts.join('\n');
          // Hard cap at 4096 bytes to prevent huge dumps in tool results.
          const enc = new TextEncoder().encode(out);
          if (enc.length > 4096) {
            return new TextDecoder().decode(enc.slice(0, 4096)) + '…[trimmed]';
          }
          return out;
        }),
      irGetCaretPosition: () => {
        const c = caretRef.current;
        return {
          sectionIndex: c.sectionIndex,
          paragraphIndex: c.paragraphIndex,
          charOffset: c.charOffset,
          cell: c.cell ?? null,
        };
      },
      irFindInDocument: (query, maxResults = 50) => {
        if (query.length === 0) return [];
        return (
          irRead('irFindInDocument', (doc) => {
            const out: {
              sectionIdx: number;
              paragraphIdx: number;
              charOffset: number;
            }[] = [];
            const sec = 0;
            const paraCount = doc.getParagraphCount(sec);
            for (let p = 0; p < paraCount; p++) {
              if (out.length >= maxResults) break;
              const len = doc.getParagraphLength(sec, p);
              if (len === 0) continue;
              let text: string;
              try {
                text = doc.getTextRange(sec, p, 0, len);
              } catch {
                continue;
              }
              let from = 0;
              while (out.length < maxResults) {
                const idx = text.indexOf(query, from);
                if (idx < 0) break;
                out.push({
                  sectionIdx: sec,
                  paragraphIdx: p,
                  charOffset: idx,
                });
                from = idx + query.length;
              }
            }
            return out;
          }) ?? []
        );
      },
      irGetCellInfo: (sec, ppara, ctrl, cellIdx) =>
        irRead(
          'irGetCellInfo',
          (doc) =>
            JSON.parse(doc.getCellInfo(sec, ppara, ctrl, cellIdx)) as Record<
              string,
              unknown
            >,
        ),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
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
      activeFormat,
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
      applyHtmlReplaceSection,
      styleList,
    ],
  );
}
