/**
 * `useUndoHistory` — Phase R1.2 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 undo/redo 스택 (chunk 7) + grouping bracket
 * (chunk 27) 을 hook 으로 분해.
 *   - `pushHistory()` — 현재 doc 상태를 saveSnapshot 으로 적재. redo
 *     tail 폐기 + cap 초과 시 oldest discard. group depth > 0 이면
 *     no-op (intermediate snapshot 삼킴).
 *   - `restoreToIndex(idx)` — 해당 entry 로 doc 복구 + 페이지 SVG
 *     재렌더 + caret 동기화 + dirty/canUndo/canRedo 갱신. 마지막에
 *     `afterRestore()` 콜백으로 caller-side cleanup (선택 영역 / 커서
 *     사각 / 활성 서식) 위임.
 *   - `undo()` / `redo()` — restoreToIndex 의 thin wrapper.
 *   - `beginUndoGroup()` / `endUndoGroup()` — depth 기반 nesting. 가장
 *     바깥 group 종료 시 pushHistory 1회.
 *
 * Latest-ref 패턴으로 returned callback 들이 stable identity — 호출자
 * 측 useCallback 의 dep 배열에 안전하게 들어간다. 외부 contract /
 * 동작은 추출 전과 동일.
 */
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from 'react';
import type { RhwpDoc } from '@/lib/rhwp-core';
import type { LifecycleCaret } from './useDocumentLifecycle';

export const HISTORY_CAP = 100;

export interface UndoHistoryState {
  entries: number[];
  /** Index of the current (latest applied) snapshot in `entries`. -1 = empty. */
  index: number;
}

export interface UseUndoHistoryOptions {
  docRef: MutableRefObject<RhwpDoc | null>;
  historyRef: MutableRefObject<UndoHistoryState>;
  undoGroupDepthRef: MutableRefObject<number>;
  cacheRef: MutableRefObject<Map<number, string>>;
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  caretRef: MutableRefObject<LifecycleCaret>;
  dirtyRef: MutableRefObject<boolean>;
  setCanUndo: (v: boolean) => void;
  setCanRedo: (v: boolean) => void;
  setDirty: (v: boolean) => void;
  /** Re-render the SVG into a single page slot. Hook 은 cache.clear() +
   * innerHTML reset 까지 처리하고 마지막에 이 콜백을 호출. */
  renderPageInto: (idx: number) => void;
  /** restoreSnapshot 직후 caller-side 정리. StudioViewer 에선
   * setSelection(null) + setSelectionRectsByPage({}) +
   * refreshCursorRect() + refreshActiveFormat() 묶음. */
  afterRestore: () => void;
}

export interface UndoHistoryHandle {
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  restoreToIndex: (targetIndex: number) => void;
  beginUndoGroup: () => void;
  endUndoGroup: () => void;
}

export function useUndoHistory(opts: UseUndoHistoryOptions): UndoHistoryHandle {
  // Stash latest opts in a ref so returned callbacks have stable identity.
  // Caller's downstream useCallbacks can list our handle entries in their
  // dep arrays without re-creation churn each render. useLayoutEffect (not
  // a render-time mutation) keeps eslint react-hooks/refs satisfied; it
  // runs synchronously after commit, before any handler can fire.
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  const pushHistory = useCallback((): void => {
    const o = optsRef.current;
    const doc = o.docRef.current;
    if (!doc) return;
    // chunk 27 — when an undo group is active, swallow intermediate
    // snapshots. endUndoGroup() will push a single one.
    if (o.undoGroupDepthRef.current > 0) return;
    try {
      const id = doc.saveSnapshot();
      const h = o.historyRef.current;
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
      o.setCanUndo(h.index > 0);
      o.setCanRedo(h.index < h.entries.length - 1);
    } catch (err) {
      console.warn('[studio] saveSnapshot failed:', err);
    }
  }, []);

  const restoreToIndex = useCallback((targetIndex: number): void => {
    const o = optsRef.current;
    const doc = o.docRef.current;
    const h = o.historyRef.current;
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
      o.cacheRef.current.clear();
      o.pageRefsRef.current.forEach((el, idx) => {
        if (el?.firstElementChild?.tagName.toLowerCase() === 'svg') {
          el.innerHTML = '';
          o.renderPageInto(idx);
        }
      });
      try {
        o.caretRef.current = JSON.parse(
          doc.getCaretPosition(),
        ) as LifecycleCaret;
      } catch {
        /* keep previous */
      }
      // Selection is renderer-side state (not in the doc IR snapshot).
      // Drop it — restoring to a different point shouldn't carry over a
      // possibly-now-invalid range. Caller-supplied: also refreshes
      // cursor rect / active format.
      o.afterRestore();
      // Dirty: the *baseline* (index 0) is the loaded-from-disk state,
      // so being there means clean. Anything else is dirty.
      const dirty = h.index !== 0;
      o.dirtyRef.current = dirty;
      o.setDirty(dirty);
      o.setCanUndo(h.index > 0);
      o.setCanRedo(h.index < h.entries.length - 1);
    } catch (err) {
      console.warn('[studio] restoreSnapshot failed:', err);
    }
  }, []);

  const undo = useCallback((): void => {
    restoreToIndex(optsRef.current.historyRef.current.index - 1);
  }, [restoreToIndex]);

  const redo = useCallback((): void => {
    restoreToIndex(optsRef.current.historyRef.current.index + 1);
  }, [restoreToIndex]);

  const beginUndoGroup = useCallback((): void => {
    optsRef.current.undoGroupDepthRef.current += 1;
  }, []);

  const endUndoGroup = useCallback((): void => {
    const o = optsRef.current;
    o.undoGroupDepthRef.current = Math.max(0, o.undoGroupDepthRef.current - 1);
    // Only push a snapshot when we exit the outermost group AND
    // some mutation actually ran (dirty flag flipped or layout
    // changed — pushHistory's saveSnapshot is cheap so we always
    // push at end-of-group).
    if (o.undoGroupDepthRef.current === 0) {
      pushHistory();
    }
  }, [pushHistory]);

  return {
    pushHistory,
    undo,
    redo,
    restoreToIndex,
    beginUndoGroup,
    endUndoGroup,
  };
}
