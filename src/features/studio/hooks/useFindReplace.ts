/**
 * `useFindReplace` — Phase R1.3 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 의 chunk 9 (찾기) + chunk 7 (바꾸기) 를 hook 으로
 * 분해. state · refs · callbacks · 두 effects 모두 hook 안으로
 * 이전. 외부 contract (openFind / openReplace / runFindSearch /
 * findNext / findPrev / closeFind / replaceCurrent / replaceAllMatches)
 * 동작은 추출 전과 동일.
 *
 * 의존:
 *   - docRef, caretRef, pageRefsRef, selectionRef, scrollRef,
 *     findTextCacheRef — caller-side refs (StudioViewer 가 보유).
 *   - sortRange, refreshAfterMutation — caller callbacks.
 *   - setCursorRect — caller useState setter.
 *
 * Latest-ref 패턴으로 returned callback identity 안정화 — 호출자
 * useImperativeHandle / useEffect dep 배열에 churn 없이 들어간다.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import type { RhwpDoc } from '@/lib/rhwp-core';
import type {
  LifecycleCaret,
  LifecycleCursorRect,
} from './useDocumentLifecycle';

export interface FindMatch {
  sectionIndex: number;
  paragraphIndex: number;
  offset: number;
  length: number;
}

export interface FindHighlightRect {
  x: number;
  y: number;
  width: number;
  height: number;
  isActive: boolean;
}

export interface FindSelectionPoint {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
}

export interface FindSelection {
  anchor: FindSelectionPoint;
  focus: FindSelectionPoint;
}

export interface FindSortedRange {
  startPara: number;
  startOffset: number;
  endPara: number;
  endOffset: number;
  empty: boolean;
}

export type FindSortRange = (
  a: { paragraphIndex: number; charOffset: number },
  b: { paragraphIndex: number; charOffset: number },
) => FindSortedRange;

export interface UseFindReplaceOptions {
  docRef: MutableRefObject<RhwpDoc | null>;
  caretRef: MutableRefObject<LifecycleCaret>;
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  selectionRef: MutableRefObject<FindSelection | null>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  findTextCacheRef: MutableRefObject<Map<string, string> | null>;
  sortRange: FindSortRange;
  refreshAfterMutation: () => void;
  setCursorRect: (v: LifecycleCursorRect | null) => void;
}

export interface FindReplaceHandle {
  // state
  findOpen: boolean;
  findQuery: string;
  findMatches: FindMatch[];
  findIndex: number;
  findHighlightsByPage: Record<number, FindHighlightRect[]>;
  replaceQuery: string;
  replaceFeedback: string | null;
  // refs (for JSX)
  findInputRef: MutableRefObject<HTMLInputElement | null>;
  replaceInputRef: MutableRefObject<HTMLInputElement | null>;
  // input setters
  setFindQuery: (v: string) => void;
  setReplaceQuery: (v: string) => void;
  // actions
  runFindSearch: (q: string) => void;
  findNext: () => void;
  findPrev: () => void;
  openFind: () => void;
  closeFind: () => void;
  openReplace: () => void;
  replaceCurrent: (override?: string) => void;
  replaceAllMatches: (override?: string) => void;
}

export function useFindReplace(opts: UseFindReplaceOptions): FindReplaceHandle {
  // Find (chunk 9). When `findOpen=true` a small search bar overlays
  // the toolbar. Matches are computed by iterating sections+paragraphs
  // and indexOf-searching their text. Each match becomes a {s,p,off,len}
  // tuple; the active one is highlighted distinctly and brought into view.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [findHighlightsByPage, setFindHighlightsByPage] = useState<
    Record<number, FindHighlightRect[]>
  >({});
  const findInputRef = useRef<HTMLInputElement | null>(null);
  // Replace UI state — chunk 7. ⌘H opens the bar with replace focused;
  // ⌘F keeps the search-only entry point. The replace string can be empty
  // (= delete matches), so we don't gate the buttons on emptiness.
  const [replaceQuery, setReplaceQuery] = useState('');
  const [replaceFeedback, setReplaceFeedback] = useState<string | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);

  // Stash latest opts in a ref so returned callbacks stay stable.
  const optsRef = useRef(opts);
  useLayoutEffect(() => {
    optsRef.current = opts;
  });

  /**
   * Search the doc for `query` (case-insensitive, lib's behavior).
   * Builds a paragraph-text cache lazily, then indexOf-scans it.
   */
  const runFindSearch = useCallback((query: string): void => {
    const o = optsRef.current;
    const doc = o.docRef.current;
    if (!doc || !query) {
      setFindMatches([]);
      setFindIndex(0);
      setFindHighlightsByPage({});
      return;
    }
    // Build the paragraph text cache on first run after the doc loads
    // (or after a mutation cleared it). Entries are stored already-
    // lowercased so the inner loop only needs indexOf on a primitive.
    if (!o.findTextCacheRef.current) {
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
      o.findTextCacheRef.current = cache;
    }
    const lc = query.toLowerCase();
    const matches: FindMatch[] = [];
    const cache = o.findTextCacheRef.current;
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
    (matches: FindMatch[], activeIdx: number): void => {
      const o = optsRef.current;
      const doc = o.docRef.current;
      if (!doc || matches.length === 0) {
        setFindHighlightsByPage({});
        return;
      }
      const grouped: Record<number, FindHighlightRect[]> = {};
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
    (matches: FindMatch[], idx: number): void => {
      const m = matches[idx];
      if (!m) return;
      const o = optsRef.current;
      const doc = o.docRef.current;
      if (!doc) return;
      // Move caret + selection to the match, so subsequent edits target it.
      o.caretRef.current = {
        sectionIndex: m.sectionIndex,
        paragraphIndex: m.paragraphIndex,
        charOffset: m.offset,
      };
      try {
        const rect = JSON.parse(
          doc.getCursorRect(m.sectionIndex, m.paragraphIndex, m.offset),
        ) as LifecycleCursorRect;
        const pageEl = o.pageRefsRef.current[rect.pageIndex];
        pageEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        o.setCursorRect(rect);
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
    const o = optsRef.current;
    const sel = o.selectionRef.current;
    if (sel) {
      const r = o.sortRange(sel.anchor, sel.focus);
      if (
        !r.empty &&
        r.startPara === r.endPara &&
        r.endOffset - r.startOffset < 200
      ) {
        const doc = o.docRef.current;
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
    // chunk 82 — React 19 batches setState updates more aggressively
    // than 18, so a setTimeout 0 fires before the find-bar input is
    // mounted (findInputRef.current === null). useLayoutEffect on
    // findOpen handles focus reliably after commit; this setTimeout
    // is kept as a fallback for legacy autofocus paths.
    setTimeout(() => findInputRef.current?.focus(), 0);
  }, [runFindSearch]);

  // chunk 82 — autofocus the find input when the bar opens. React 19
  // commits the DOM before useLayoutEffect runs, so the ref is bound.
  useEffect(() => {
    if (!findOpen) return;
    findInputRef.current?.focus();
  }, [findOpen]);

  const closeFind = useCallback((): void => {
    setFindOpen(false);
    setFindMatches([]);
    setFindIndex(0);
    setFindHighlightsByPage({});
    setReplaceFeedback(null);
    // Return focus to the scroll container so keyboard editing resumes.
    optsRef.current.scrollRef.current?.focus();
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
      const o = optsRef.current;
      const doc = o.docRef.current;
      if (!doc) return;
      const query = findQuery;
      if (query.length === 0) return;
      const replacement =
        replacementOverride !== undefined ? replacementOverride : replaceQuery;
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
        o.findTextCacheRef.current = null;
        o.refreshAfterMutation();
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
    [findQuery, replaceQuery, runFindSearch],
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

  return {
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
  };
}
