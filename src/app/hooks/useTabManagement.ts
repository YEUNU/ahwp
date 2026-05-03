/**
 * `useTabManagement` — Phase R3 (2차) refactor (REFACTORING_PLAN.md).
 *
 * AppShell.tsx 의 tab 관리 (open / close / pin / reorder /
 * close-others / close-right / copy-path / reveal / dirty-change /
 * ref callback) 를 hook 으로 분해. 외부 동작 1:1 동일 — chunk 52
 * autosave recovery / chunk 55 pin / drag-reorder 모두 보존.
 *
 * `viewerRefsRef` 는 hook 내부에서 보유 — close 시 자동 cleanup.
 * `activeViewerRef()` getter 와 `dirtyCallbacks` map 도 hook 이 노출.
 */
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefCallback,
  type SetStateAction,
} from 'react';
import { type TabDescriptor } from '@/features/studio/TabBar';
import type { ViewerHandle } from '@/features/studio/types';

export interface TabState extends TabDescriptor {
  /** Stable React key — survives re-orderings (tabs aren't reorderable
   * yet, but this also distinguishes two tabs at the same path which we
   * disallow today). */
  key: string;
}

let tabKeyCounter = 0;
export function makeTabKey(): string {
  tabKeyCounter += 1;
  return `tab-${tabKeyCounter}`;
}

export interface UseTabManagementOptions {
  /** Side effect on dirty-change — bumps outline refresh signal so the
   * TOC sidebar re-fetches without polling. */
  setOutlineKey: Dispatch<SetStateAction<number>>;
}

export interface TabManagementHandle {
  tabsState: TabState[];
  setTabsState: Dispatch<SetStateAction<TabState[]>>;
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  activeTab: TabState | null;
  viewerRefsRef: React.MutableRefObject<Map<string, ViewerHandle | null>>;
  activeViewerRef: () => ViewerHandle | null;
  openTab: (path: string) => void;
  replaceTabPath: (oldPath: string, newPath: string) => void;
  closeTab: (index: number) => void;
  togglePinTab: (index: number) => void;
  reorderTab: (from: number, to: number) => void;
  closeOtherTabs: (keepIndex: number) => void;
  closeTabsToRight: (index: number) => void;
  copyTabPath: (index: number) => void;
  revealTab: (index: number) => void;
  handleDirtyChange: (key: string, dirty: boolean) => void;
  refCallbackFor: (key: string) => RefCallback<ViewerHandle>;
  dirtyCallbacks: Map<string, (dirty: boolean) => void>;
}

export function useTabManagement(
  opts: UseTabManagementOptions,
): TabManagementHandle {
  const { setOutlineKey } = opts;

  const [tabsState, setTabsState] = useState<TabState[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const viewerRefsRef = useRef<Map<string, ViewerHandle | null>>(new Map());

  const activeTab: TabState | null =
    activeIndex >= 0 && activeIndex < tabsState.length
      ? tabsState[activeIndex]
      : null;

  const activeViewerRef = useCallback((): ViewerHandle | null => {
    if (!activeTab) return null;
    return viewerRefsRef.current.get(activeTab.key) ?? null;
  }, [activeTab]);

  // Add a new tab for `path` (or focus an existing one). Returns the
  // index of the resulting active tab.
  const openTab = useCallback((path: string): void => {
    let isNewTab = false;
    setTabsState((prev) => {
      const existing = prev.findIndex((t) => t.path === path);
      if (existing >= 0) {
        setActiveIndex(existing);
        return prev;
      }
      isNewTab = true;
      const next: TabState[] = [
        ...prev,
        { path, dirty: false, key: makeTabKey() },
      ];
      setActiveIndex(next.length - 1);
      return next;
    });
    // chunk 52 — auto-save recovery. After a fresh tab mount, check if
    // an `<path>.ahwp-draft` sidecar exists from a previous crashed
    // session. Skip temp paths (file:new scratch files) — drafts are
    // never written for those.
    if (isNewTab && !path.includes('/temp/') && !path.includes('\\temp\\')) {
      void (async () => {
        const has = await window.api.file.hasDraft(path);
        if (!has) return;
        const fname = path.split(/[\\/]/).pop() ?? path;
        const ok = window.confirm(
          `'${fname}' 파일에 자동 저장된 변경사항이 있습니다. 복구하시겠습니까?\n\n취소하면 자동 저장 사본이 삭제됩니다.`,
        );
        if (ok) {
          // Load the draft bytes, save them through the regular path so
          // the file:save flow handles HWPX routing + .bak + watcher
          // suppression, then bump the tab key to remount the viewer
          // off the freshly-saved content.
          try {
            const bytes = await window.api.file.loadDraft(path);
            if (bytes) {
              await window.api.file.save({ path, bytes });
              setTabsState((prev) =>
                prev.map((t) =>
                  t.path === path ? { ...t, key: makeTabKey() } : t,
                ),
              );
            }
          } catch (err) {
            console.warn('[autosave] recovery failed:', err);
          }
        }
        // Either way (recovered or declined), the draft is no longer
        // useful — drop it so we don't keep prompting on every open.
        await window.api.file.clearDraft(path);
      })();
    }
  }, []);

  // Replace the path of a tab — used after Save As or after the main
  // process auto-routes the extension (.hwpx → .hwp). Doesn't open a
  // new tab; the underlying viewer keeps its mounted state.
  const replaceTabPath = useCallback(
    (oldPath: string, newPath: string): void => {
      if (oldPath === newPath) return;
      setTabsState((prev) =>
        prev.map((t) => (t.path === oldPath ? { ...t, path: newPath } : t)),
      );
    },
    [],
  );

  // Close a tab. If dirty, prompt the user first. Pinned tabs (chunk 55)
  // are protected here too — closing requires explicit confirmation
  // even when clean.
  const closeTab = useCallback((index: number): void => {
    setTabsState((prev) => {
      const tab = prev[index];
      if (!tab) return prev;
      if (tab.pinned) {
        const ok = window.confirm('고정된 탭입니다. 정말로 닫으시겠습니까?');
        if (!ok) return prev;
      }
      if (tab.dirty) {
        const ok = window.confirm(
          '저장하지 않은 변경사항이 있습니다. 정말로 닫으시겠습니까?',
        );
        if (!ok) return prev;
      }
      viewerRefsRef.current.delete(tab.key);
      const next = prev.filter((_, i) => i !== index);
      // Activate the previous tab (or the next one if we closed the first).
      setActiveIndex((curIdx) => {
        if (next.length === 0) return -1;
        if (curIdx > index) return curIdx - 1;
        if (curIdx === index) return Math.min(index, next.length - 1);
        return curIdx;
      });
      return next;
    });
  }, []);

  // chunk 55 — toggle a tab's pinned flag. Pinned tabs sort to the
  // left of unpinned tabs and survive bulk close-others / close-right.
  const togglePinTab = useCallback((index: number): void => {
    setTabsState((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const target = prev[index];
      const willPin = !target.pinned;
      const next = prev.map((t, i) =>
        i === index ? { ...t, pinned: willPin } : t,
      );
      // Re-sort so all pinned tabs come first, preserving relative order
      // within each group. Active index follows the moved tab.
      const indexed = next.map((t, i) => ({ t, i }));
      indexed.sort((a, b) => {
        const ap = a.t.pinned ? 0 : 1;
        const bp = b.t.pinned ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return a.i - b.i;
      });
      const sorted = indexed.map((x) => x.t);
      const newIdx = sorted.findIndex((t) => t.key === target.key);
      setActiveIndex((curIdx) => {
        const cur = next[curIdx];
        if (!cur) return curIdx;
        return sorted.findIndex((t) => t.key === cur.key);
      });
      void newIdx;
      return sorted;
    });
  }, []);

  // Phase 1 잔여 — drag-reorder + context menu.
  const reorderTab = useCallback((from: number, to: number): void => {
    setTabsState((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length)
        return prev;
      if (from === to) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Keep the same logical tab active by chasing the moved id.
      setActiveIndex((curIdx) => {
        if (curIdx === from) return to;
        // Closing a tab on either side may shift the active index.
        if (from < curIdx && to >= curIdx) return curIdx - 1;
        if (from > curIdx && to <= curIdx) return curIdx + 1;
        return curIdx;
      });
      return next;
    });
  }, []);

  const closeOtherTabs = useCallback((keepIndex: number): void => {
    setTabsState((prev) => {
      const keep = prev[keepIndex];
      if (!keep) return prev;
      // chunk 55 — pinned tabs (and the keep target) survive the bulk
      // close. Confirm only on the dirty subset that's actually about
      // to disappear.
      const willClose = prev.filter((t, i) => i !== keepIndex && !t.pinned);
      const willKeep = prev.filter((t, i) => i === keepIndex || t.pinned);
      if (willClose.length === 0) return prev;
      const dirtyNames = willClose
        .filter((t) => t.dirty)
        .map((t) => t.path.split(/[/\\]/).pop() ?? t.path);
      if (dirtyNames.length > 0) {
        const ok = window.confirm(
          `저장하지 않은 변경사항이 있는 탭을 닫습니다 (${dirtyNames.length}개). 계속하시겠습니까?`,
        );
        if (!ok) return prev;
      }
      for (const t of willClose) viewerRefsRef.current.delete(t.key);
      // Re-locate the active tab (keep target) within the shrunken array.
      const newIdx = willKeep.findIndex((t) => t.key === keep.key);
      setActiveIndex(newIdx >= 0 ? newIdx : 0);
      return willKeep;
    });
  }, []);

  const closeTabsToRight = useCallback((index: number): void => {
    setTabsState((prev) => {
      if (index < 0 || index >= prev.length - 1) return prev;
      // chunk 55 — pinned tabs to the right are preserved.
      const right = prev.slice(index + 1);
      const willClose = right.filter((t) => !t.pinned);
      const pinnedRight = right.filter((t) => t.pinned);
      if (willClose.length === 0) return prev;
      const dirtyNames = willClose
        .filter((t) => t.dirty)
        .map((t) => t.path.split(/[/\\]/).pop() ?? t.path);
      if (dirtyNames.length > 0) {
        const ok = window.confirm(
          `저장하지 않은 변경사항이 있는 탭을 닫습니다 (${dirtyNames.length}개). 계속하시겠습니까?`,
        );
        if (!ok) return prev;
      }
      for (const t of willClose) viewerRefsRef.current.delete(t.key);
      const next = [...prev.slice(0, index + 1), ...pinnedRight];
      setActiveIndex((curIdx) => Math.min(curIdx, next.length - 1));
      return next;
    });
  }, []);

  const copyTabPath = useCallback((index: number): void => {
    setTabsState((prev) => {
      const tab = prev[index];
      if (tab) {
        void window.api.clipboard.writeText(tab.path);
      }
      return prev;
    });
  }, []);

  const revealTab = useCallback((index: number): void => {
    setTabsState((prev) => {
      const tab = prev[index];
      if (tab) {
        void window.api.folder.reveal(tab.path);
      }
      return prev;
    });
  }, []);

  const handleDirtyChange = useCallback(
    (key: string, dirty: boolean): void => {
      setTabsState((prev) => {
        const idx = prev.findIndex((t) => t.key === key);
        if (idx < 0) return prev;
        if (prev[idx].dirty === dirty) return prev;
        const next = [...prev];
        next[idx] = { ...next[idx], dirty };
        return next;
      });
      // chunk 58 — bump the outline refresh signal so the TOC sidebar
      // re-fetches without polling. The sidebar is cheap (single IR walk
      // bounded to 1k paragraphs).
      setOutlineKey((v) => v + 1);
    },
    [setOutlineKey],
  );

  // Stable ref-callback factory per tab key. Each StudioViewer's ref
  // funnels into our Map.
  const refCallbackFor = useCallback(
    (key: string): RefCallback<ViewerHandle> =>
      (handle) => {
        if (handle) {
          viewerRefsRef.current.set(key, handle);
        } else {
          viewerRefsRef.current.delete(key);
        }
      },
    [],
  );

  // Memoized dirty-change callback per tab key (avoids re-attaching on
  // every parent render).
  const dirtyCallbacks = useMemo(() => {
    const m = new Map<string, (dirty: boolean) => void>();
    for (const t of tabsState) {
      m.set(t.key, (dirty) => handleDirtyChange(t.key, dirty));
    }
    return m;
  }, [tabsState, handleDirtyChange]);

  return {
    tabsState,
    setTabsState,
    activeIndex,
    setActiveIndex,
    activeTab,
    viewerRefsRef,
    activeViewerRef,
    openTab,
    replaceTabPath,
    closeTab,
    togglePinTab,
    reorderTab,
    closeOtherTabs,
    closeTabsToRight,
    copyTabPath,
    revealTab,
    handleDirtyChange,
    refCallbackFor,
    dirtyCallbacks,
  };
}
