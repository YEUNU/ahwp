/**
 * `useTabManagement` — Phase R3 (2차) refactor (REFACTORING_PLAN.md).
 *
 * AppShell.tsx 의 tab 관리 (open / close / pin / reorder /
 * close-others / close-right / copy-path / reveal) 를 hook 으로 분해.
 * 외부 동작 1:1 동일 — chunk 52 autosave recovery / chunk 55 pin /
 * drag-reorder 모두 보존.
 */
import {
  useCallback,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { type TabDescriptor } from '@/app/TabBar';

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

export interface TabManagementHandle {
  tabsState: TabState[];
  setTabsState: Dispatch<SetStateAction<TabState[]>>;
  activeIndex: number;
  setActiveIndex: Dispatch<SetStateAction<number>>;
  activeTab: TabState | null;
  openTab: (path: string) => void;
  replaceTabPath: (oldPath: string, newPath: string) => void;
  closeTab: (index: number) => void;
  togglePinTab: (index: number) => void;
  reorderTab: (from: number, to: number) => void;
  closeOtherTabs: (keepIndex: number) => void;
  closeTabsToRight: (index: number) => void;
  copyTabPath: (index: number) => void;
  revealTab: (index: number) => void;
  /** 0.7.46 — 탭의 unsaved-dirty 플래그 설정. AI 쓰기 도구가 성공하면
   *  true, 저장 시 false. 변경 없으면 no-op (re-render 회피). */
  setTabDirty: (key: string, dirty: boolean) => void;
}

export function useTabManagement(): TabManagementHandle {
  const [tabsState, setTabsState] = useState<TabState[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const activeTab: TabState | null =
    activeIndex >= 0 && activeIndex < tabsState.length
      ? tabsState[activeIndex]
      : null;

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
          // the file:save flow handles HWPX routing + watcher
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
      setTabsState((prev) => {
        const srcIdx = prev.findIndex((t) => t.path === oldPath);
        if (srcIdx === -1) return prev;
        // If another tab already holds newPath (Save As onto an already-open
        // file), it now points at the file we just overwrote. Drop it so the
        // one-tab-per-path invariant holds, keeping the renamed source tab as
        // the canonical tab for newPath. (Without this, two tabs share a path
        // and every path-keyed lookup silently resolves to only the first.)
        const dupIdx = prev.findIndex(
          (t, i) => i !== srcIdx && t.path === newPath,
        );
        const renamed = prev.map((t, i) =>
          i === srcIdx ? { ...t, path: newPath } : t,
        );
        const next =
          dupIdx === -1 ? renamed : renamed.filter((_, i) => i !== dupIdx);
        if (dupIdx !== -1) {
          const srcKey = prev[srcIdx].key;
          setActiveIndex((curIdx) => {
            const prevActiveKey = prev[curIdx]?.key;
            const byKey = next.findIndex((t) => t.key === prevActiveKey);
            if (byKey >= 0) return byKey; // active tab survived
            return next.findIndex((t) => t.key === srcKey); // it was the dropped dup
          });
        }
        return next;
      });
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
      setActiveIndex((curIdx) => {
        const cur = next[curIdx];
        if (!cur) return curIdx;
        return sorted.findIndex((t) => t.key === cur.key);
      });
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
      const next = [...prev.slice(0, index + 1), ...pinnedRight];
      // Chase the active tab by identity (a preserved pinned tab to the right
      // survives but shifts position) — a bare clamp would silently focus a
      // different surviving tab. Mirrors closeOtherTabs.
      setActiveIndex((curIdx) => {
        const activeKey = prev[curIdx]?.key;
        const ni = next.findIndex((t) => t.key === activeKey);
        return ni >= 0 ? ni : Math.min(curIdx, next.length - 1);
      });
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

  const setTabDirty = useCallback((key: string, dirty: boolean): void => {
    setTabsState((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx < 0 || prev[idx].dirty === dirty) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], dirty };
      return next;
    });
  }, []);

  return {
    tabsState,
    setTabsState,
    activeIndex,
    setActiveIndex,
    activeTab,
    openTab,
    replaceTabPath,
    closeTab,
    togglePinTab,
    reorderTab,
    closeOtherTabs,
    closeTabsToRight,
    copyTabPath,
    revealTab,
    setTabDirty,
  };
}
