import { FolderInput } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefCallback,
} from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { MenuAction, PingResponse } from '@shared/api';
import { correctExtension } from '@shared/format';
import { ChatPanel } from '@/features/chat/ChatPanel';
import { runTools } from '@/features/chat/tools';
import {
  CommandPalette,
  type CommandItem,
} from '@/features/cmdk/CommandPalette';
import { buildActionItems } from '@/features/cmdk/items';
import { ShortcutsDialog } from '@/features/cmdk/ShortcutsDialog';
import { FolderTree } from '@/features/files/FolderTree';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { BookmarkDialog } from '@/features/studio/BookmarkDialog';
import { EquationDialog } from '@/features/studio/EquationDialog';
import { FootnoteDialog } from '@/features/studio/FootnoteDialog';
import { HeaderFooterDialog } from '@/features/studio/HeaderFooterDialog';
import { PageSetupDialog } from '@/features/studio/PageSetupDialog';
import { ShapeDialog } from '@/features/studio/ShapeDialog';
import { StudioViewer } from '@/features/studio/StudioViewer';
import { StyleManagerDialog } from '@/features/studio/StyleManagerDialog';
import {
  CellPropsDialog,
  TablePropsDialog,
  type CellPropsContext,
  type TablePropsContext,
} from '@/features/studio/TableCellPropsDialog';
import {
  PicturePropsDialog,
  type PictureRef,
} from '@/features/studio/PicturePropsDialog';
import {
  CellStylePickerDialog,
  type CellStylePickerCtx,
  type StyleOption,
} from '@/features/studio/CellStylePickerDialog';
import {
  TableFormulaDialog,
  type FormulaCellContext,
} from '@/features/studio/TableFormulaDialog';
import { TabBar, type TabDescriptor } from '@/features/studio/TabBar';
import type { ViewerHandle } from '@/features/studio/types';
import { TitleBar } from './TitleBar';
import { WelcomePane } from './WelcomePane';

/**
 * Multi-tab editor shell.
 *
 * - One StudioViewer mounts per tab. Inactive tabs are hidden via CSS
 *   (`display:none`) rather than unmounted, so each tab keeps its
 *   HwpDocument + undo history while the user switches around.
 * - Only the active tab claims `window.__studioDebug` (StudioViewer's
 *   `isActive` prop gates that effect).
 * - Per-tab dirty state lives in `tabsState`; viewers push updates via
 *   the `onDirtyChange` prop.
 * - Session.openTabPaths persists the tab list; on launch each is
 *   re-mounted and `lastActivePath` is the activated tab.
 */

interface TabState extends TabDescriptor {
  /** Stable React key — survives re-orderings (tabs aren't reorderable
   * yet, but this also distinguishes two tabs at the same path which we
   * disallow today). */
  key: string;
}

let tabKeyCounter = 0;
function makeTabKey(): string {
  tabKeyCounter += 1;
  return `tab-${tabKeyCounter}`;
}

export default function AppShell() {
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [tabsState, setTabsState] = useState<TabState[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [hfOpen, setHfOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [styleManagerOpen, setStyleManagerOpen] = useState(false);
  const [equationOpen, setEquationOpen] = useState(false);
  const [shapeOpen, setShapeOpen] = useState(false);
  // chunk 38 — table / cell properties dialogs.
  const [tablePropsOpen, setTablePropsOpen] = useState(false);
  const [cellPropsOpen, setCellPropsOpen] = useState(false);
  // chunk 39 — picture properties dialog.
  const [picturePropsOpen, setPicturePropsOpen] = useState(false);
  // chunk 42 — cell style picker (KNOWN_ISSUES L-006 workaround).
  const [cellStylePickerOpen, setCellStylePickerOpen] = useState(false);
  // chunk 34 — table-formula recalc dialog. Captures the right-clicked
  // cell's coords at open time; the dialog state only carries the ctx
  // until apply / cancel.
  const [formulaOpen, setFormulaOpen] = useState(false);
  const [formulaCtx, setFormulaCtx] = useState<FormulaCellContext | null>(null);
  // Lightweight in-app notice — surfaces non-fatal save-time messages
  // (e.g. "saved as .hwp because .hwpx round-trip is lossy"). Auto-clears
  // after a short delay; see `showNotice` below.
  const [notice, setNotice] = useState<{
    kind: 'info' | 'warn';
    text: string;
  } | null>(null);
  const noticeTimerRef = useRef<number | null>(null);
  // chunk 50 — command palette (⌘K). Open state lives here so any
  // sub-component (welcome screen, future help button) can also
  // trigger it.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // chunk 53 — shortcut cheatsheet (⌘/).
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // viewerRef per tab (by key). The active tab's viewer is what menu /
  // shortcut actions target.
  const viewerRefsRef = useRef<Map<string, ViewerHandle | null>>(new Map());
  const sessionRestoredRef = useRef(false);

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

  const handleDirtyChange = useCallback((key: string, dirty: boolean): void => {
    setTabsState((prev) => {
      const idx = prev.findIndex((t) => t.key === key);
      if (idx < 0) return prev;
      if (prev[idx].dirty === dirty) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], dirty };
      return next;
    });
  }, []);

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

  useEffect(() => {
    void (async () => {
      try {
        const res = await window.api.ping({ message: 'hello from renderer' });
        setPingResult(res);
      } catch (err) {
        setPingError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  // Workspace restoration.
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    void (async () => {
      const session = await window.api.session.get();
      if (session.lastFolderPath) {
        setFolderRoot(session.lastFolderPath);
      }
      const open = (session.openTabPaths ?? []).filter(Boolean);
      if (open.length > 0) {
        // Verify each path; drop any that are gone.
        const verified: string[] = [];
        for (const p of open) {
          const r = await window.api.file.openByPath(p);
          if (r) verified.push(r.path);
        }
        const restored: TabState[] = verified.map((p) => ({
          path: p,
          dirty: false,
          key: makeTabKey(),
        }));
        if (restored.length > 0) {
          setTabsState(restored);
          // Pick the previously active path; fallback to the first tab.
          const activePath = session.lastActivePath ?? null;
          const activeIdx =
            activePath != null
              ? Math.max(
                  0,
                  restored.findIndex((t) => t.path === activePath),
                )
              : 0;
          setActiveIndex(activeIdx);
        }
      } else if (session.lastActivePath) {
        // Legacy session (pre-tabs) — promote it into a single tab.
        const r = await window.api.file.openByPath(session.lastActivePath);
        if (r) {
          setTabsState([{ path: r.path, dirty: false, key: makeTabKey() }]);
          setActiveIndex(0);
        }
      }
    })();
  }, []);

  // Persist session whenever the tab set / active index / folder changes.
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    void window.api.session.set({
      lastActivePath: activeTab?.path ?? null,
      lastFolderPath: folderRoot,
      openTabPaths: tabsState.map((t) => t.path),
    });
  }, [tabsState, activeTab, folderRoot]);

  // Surfaces a non-fatal message inline at the top of the app for
  // ~5 seconds — used for save-time notices (HWPX → HWP route),
  // external-change conflicts, etc. Replaces any in-flight notice; the
  // timer auto-clears unless `dismissNotice` is called sooner.
  const showNotice = useCallback(
    (text: string, kind: 'info' | 'warn' = 'info'): void => {
      setNotice({ kind, text });
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;
      }, 5000);
    },
    [],
  );
  const dismissNotice = useCallback(() => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(null);
  }, []);

  // External file watcher — keep main's chokidar tracking exactly the
  // currently open tab paths. Resends the full list on every tab change,
  // which main treats idempotently (rebuilds the watcher).
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    void window.api.file.watchPaths(tabsState.map((t) => t.path));
  }, [tabsState]);

  // chunk 52 — auto-save dirty tabs to `<path>.ahwp-draft` every 60s.
  // Skips temp paths (`file:new` scratch files in userData/temp), since
  // those have no stable path to recover to. The renderer initiates
  // because main has no view of which tab is dirty.
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    const t = window.setInterval(() => {
      void (async () => {
        for (const tab of tabsState) {
          if (!tab.dirty) continue;
          // file:new temp paths live under userData and have no
          // recoverable destination — skip them. Sidecar drafts only
          // make sense alongside user-saved files.
          if (tab.path.includes('/temp/') || tab.path.includes('\\temp\\')) {
            continue;
          }
          const handle = viewerRefsRef.current.get(tab.key);
          if (!handle) continue;
          try {
            const bytes = await handle.exportBytes();
            await window.api.file.saveDraft({ path: tab.path, bytes });
          } catch (err) {
            console.warn('[autosave] failed for', tab.path, err);
          }
        }
      })();
    }, 60_000);
    return () => window.clearInterval(t);
  }, [tabsState]);

  // React to off-app file modifications:
  //   - !dirty → silently bump the tab key so the viewer remounts and
  //     re-reads the file from disk.
  //   - dirty  → surface a notice; user keeps in-memory edits unless
  //     they explicitly act. (No prompt UI in this round; the notice
  //     is enough to avoid silent data loss.)
  useEffect(() => {
    const off = window.api.file.onExternalChange((evt) => {
      setTabsState((prev) => {
        const idx = prev.findIndex((t) => t.path === evt.path);
        if (idx < 0) return prev;
        const tab = prev[idx];
        const fname = evt.path.split(/[\\/]/).pop() ?? evt.path;
        if (evt.type === 'unlink') {
          showNotice(`'${fname}' 파일이 외부에서 삭제되었습니다.`, 'warn');
          return prev;
        }
        if (tab.dirty) {
          showNotice(
            `'${fname}' 파일이 외부에서 변경되었습니다. 저장 시 외부 변경분을 덮어쓰게 됩니다.`,
            'warn',
          );
          return prev;
        }
        // Clean tab: remount viewer to re-read disk content.
        const next = [...prev];
        next[idx] = { ...tab, key: makeTabKey() };
        showNotice(
          `'${fname}' 파일이 외부에서 변경되어 다시 불러왔습니다.`,
          'info',
        );
        return next;
      });
    });
    return off;
  }, [showNotice]);

  const openFromDialog = useCallback(async () => {
    const result = await window.api.file.open();
    if (result) openTab(result.path);
  }, [openTab]);

  const openByPath = useCallback(
    async (path: string) => {
      const result = await window.api.file.openByPath(path);
      if (result) openTab(result.path);
    },
    [openTab],
  );

  const newDocument = useCallback(async () => {
    const result = await window.api.file.new();
    openTab(result.path);
  }, [openTab]);

  const openFolder = useCallback(async () => {
    const picked = await window.api.folder.pick();
    if (picked) setFolderRoot(picked);
  }, []);

  const exportBytes = useCallback(async (): Promise<Uint8Array | null> => {
    const handle = activeViewerRef();
    if (!handle) return null;
    const t0 = performance.now();
    const bytes = await handle.exportBytes();
    console.info(
      `[ahwp] export ${(bytes.byteLength / 1024 / 1024).toFixed(2)}MB in ${(performance.now() - t0).toFixed(0)}ms`,
    );
    return bytes;
  }, [activeViewerRef]);

  const saveCurrent = useCallback(async () => {
    const tab = activeTab;
    if (!tab) return;
    const bytes = await exportBytes();
    if (!bytes) return;
    const result = await window.api.file.save({ path: tab.path, bytes });
    if (result.path !== tab.path) replaceTabPath(tab.path, result.path);
    // chunk 52 — explicit save invalidates the auto-save draft.
    void window.api.file.clearDraft(tab.path);
    if (result.path !== tab.path) {
      void window.api.file.clearDraft(result.path);
    }
    if (result.routedFrom) {
      // The user requested .hwpx but @rhwp/core's HWPX round-trip drops
      // images (KNOWN_ISSUES L-001), so file:save auto-routes to .hwp.
      // Tell them so they don't go looking for a missing .hwpx.
      showNotice(
        `'.hwpx' 저장은 라이브러리 한계로 일시 비활성화되어 있어 ${result.path.split(/[\\/]/).pop()} 로 저장했습니다.`,
        'warn',
      );
    }
  }, [activeTab, exportBytes, replaceTabPath, showNotice]);

  const saveAsCurrent = useCallback(async () => {
    const tab = activeTab;
    const bytes = await exportBytes();
    if (!bytes) return;
    const defaultPath = tab ? correctExtension(tab.path, 'hwpx') : undefined;
    const result = await window.api.file.saveAs({ bytes, defaultPath });
    if (result) {
      if (tab) replaceTabPath(tab.path, result.path);
      else openTab(result.path);
      void window.api.file.clearDraft(result.path);
      if (tab) void window.api.file.clearDraft(tab.path);
      if (result.routedFrom) {
        showNotice(
          `'.hwpx' 저장은 라이브러리 한계로 일시 비활성화되어 있어 ${result.path.split(/[\\/]/).pop()} 로 저장했습니다.`,
          'warn',
        );
      }
    }
  }, [activeTab, exportBytes, replaceTabPath, openTab, showNotice]);

  // ⌘W / Ctrl+W: close the active tab. Bound at the document level
  // because the StudioViewer's keydown handler doesn't run when the
  // user's focus is outside the scroll container (e.g. on a tab button).
  // ⌘K / Ctrl+K toggles the command palette (chunk 50) — same reason
  // it lives at document level: we want to open it from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 'w') {
          if (activeIndex >= 0) {
            closeTab(activeIndex);
            e.preventDefault();
          }
        } else if (e.key.toLowerCase() === 'k') {
          setPaletteOpen((v) => !v);
          e.preventDefault();
        } else if (e.key === '/') {
          // chunk 53 — ⌘/ toggles the shortcuts cheatsheet.
          setShortcutsOpen((v) => !v);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, closeTab]);

  // Single dispatch function for every MenuAction. Lifted out of the
  // onMenuAction useEffect so the command palette (chunk 50) can fire
  // the same actions through the same code path. The native menu and
  // ⌘K both feed into this.
  const dispatchMenuAction = useCallback(
    (action: MenuAction): void => {
      const handle = activeViewerRef();
      if (action === 'file:new') {
        void newDocument();
      } else if (action === 'file:open') {
        void openFromDialog();
      } else if (action === 'file:save') {
        void saveCurrent();
      } else if (action === 'file:save-as') {
        void saveAsCurrent();
      } else if (action === 'file:export-html') {
        const v = activeViewerRef();
        const html = v?.exportDocumentHtml(1000) ?? '';
        if (html.length === 0) {
          window.alert('내보낼 문서가 없습니다.');
        } else {
          void window.api.file.exportHtml({
            html,
            defaultPath: activeTab?.path,
          });
        }
      } else if (action === 'edit:undo') {
        handle?.undo();
      } else if (action === 'edit:redo') {
        handle?.redo();
      } else if (action === 'edit:copy') {
        void handle?.copy();
      } else if (action === 'edit:cut') {
        void handle?.cut();
      } else if (action === 'edit:paste') {
        void handle?.paste();
      } else if (action === 'edit:find') {
        handle?.openFind();
      } else if (action === 'edit:replace') {
        handle?.openReplace();
      } else if (action === 'edit:copy-control') {
        handle?.copyControlAtCaret();
      } else if (action === 'edit:paste-control') {
        handle?.pasteControlAtCurrentCaret();
      } else if (
        action === 'format:bold' ||
        action === 'format:italic' ||
        action === 'format:underline'
      ) {
        const key = action.split(':')[1] as 'bold' | 'italic' | 'underline';
        handle?.toggleCharFormat(key);
      } else if (action === 'view:settings') {
        setSettingsOpen(true);
      } else if (action === 'view:page-setup') {
        setPageSetupOpen(true);
      } else if (action === 'insert:header-footer') {
        setHfOpen(true);
      } else if (action === 'insert:bookmark') {
        setBookmarkOpen(true);
      } else if (action === 'insert:footnote') {
        setFootnoteOpen(true);
      } else if (action === 'view:style-manager') {
        setStyleManagerOpen(true);
      } else if (action === 'insert:equation') {
        setEquationOpen(true);
      } else if (action === 'insert:shape') {
        setShapeOpen(true);
      } else if (action === 'view:picture-props') {
        setPicturePropsOpen(true);
      }
    },
    [
      activeTab?.path,
      activeViewerRef,
      newDocument,
      openFromDialog,
      saveCurrent,
      saveAsCurrent,
    ],
  );

  useEffect(() => {
    return window.api.onMenuAction(dispatchMenuAction);
  }, [dispatchMenuAction]);

  // Build the command-palette item list. The lint rule `react-hooks/refs`
  // flags passing dispatchMenuAction (or anything closing over the
  // dispatch ref) into a helper during render — even though the callbacks
  // only fire on user click. We work around it by deriving the action
  // items from a stable factory that only takes MenuAction strings, and
  // resolving them through a ref-backed stable dispatcher inside the
  // run callback at click time.
  const dispatchRef = useRef(dispatchMenuAction);
  useEffect(() => {
    dispatchRef.current = dispatchMenuAction;
  }, [dispatchMenuAction]);
  const paletteItems = useMemo<CommandItem[]>(() => {
    // dispatch fires on user click, not during render
    const items: CommandItem[] =
      // eslint-disable-next-line react-hooks/refs
      buildActionItems((action) => dispatchRef.current(action));
    // Tabs — let the user jump to an open document.
    for (let i = 0; i < tabsState.length; i++) {
      const t = tabsState[i];
      const fname = t.path.split(/[\\/]/).pop() ?? t.path;
      items.push({
        id: `tab:${t.key}`,
        kind: 'tab',
        label: fname,
        hint: t.path,
        keywords: [fname, t.path],
        run: () => setActiveIndex(i),
      });
    }
    return items;
  }, [tabsState]);

  return (
    <>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <PageSetupDialog
        open={pageSetupOpen}
        onOpenChange={setPageSetupOpen}
        getCurrentPageDef={() => activeViewerRef()?.getPageDef() ?? null}
        onApply={(props) => activeViewerRef()?.applyPageDef(props)}
      />
      <HeaderFooterDialog
        open={hfOpen}
        onOpenChange={setHfOpen}
        getCurrent={(sec, isHeader, applyTo) =>
          activeViewerRef()?.getHeaderFooter(sec, isHeader, applyTo) ?? null
        }
        onApply={(sec, isHeader, applyTo, text) =>
          activeViewerRef()?.setHeaderFooterText(sec, isHeader, applyTo, text)
        }
      />
      <BookmarkDialog
        open={bookmarkOpen}
        onOpenChange={setBookmarkOpen}
        getBookmarks={() => activeViewerRef()?.getBookmarks() ?? null}
        onAdd={(name) => activeViewerRef()?.addBookmarkAtCaret(name)}
        onDelete={(sec, para, ctrlIdx) =>
          activeViewerRef()?.deleteBookmarkAt(sec, para, ctrlIdx)
        }
      />
      <FootnoteDialog
        open={footnoteOpen}
        onOpenChange={setFootnoteOpen}
        onInsert={(text) => activeViewerRef()?.insertFootnoteAtCaret(text)}
      />
      <StyleManagerDialog
        open={styleManagerOpen}
        onOpenChange={setStyleManagerOpen}
        getStyleList={() => activeViewerRef()?.getStyleListJson() ?? null}
        onCreate={(name, englishName) =>
          activeViewerRef()?.createNamedStyle(name, englishName) ?? null
        }
        onRename={(id, name, englishName) =>
          activeViewerRef()?.renameStyle(id, name, englishName) ?? false
        }
        onDelete={(id) => activeViewerRef()?.deleteStyleById(id) ?? false}
      />
      <EquationDialog
        open={equationOpen}
        onOpenChange={setEquationOpen}
        renderEquation={(script, fontSize, color) =>
          activeViewerRef()?.renderEquationSvg(script, fontSize, color) ?? ''
        }
      />
      <ShapeDialog
        open={shapeOpen}
        onOpenChange={setShapeOpen}
        onInsert={(width, height, opts) =>
          activeViewerRef()?.createRectShapeAtCaret(width, height, opts) ?? null
        }
      />
      <TablePropsDialog
        open={tablePropsOpen}
        onOpenChange={setTablePropsOpen}
        getCurrent={() => {
          const v = activeViewerRef();
          if (!v) return null;
          const c = v.getActiveCellContext();
          if (!c) return null;
          const props = v.getTableProps(
            c.sectionIndex,
            c.parentParaIdx,
            c.controlIdx,
          );
          if (!props) return null;
          const ctx: TablePropsContext = {
            sectionIdx: c.sectionIndex,
            parentParaIdx: c.parentParaIdx,
            controlIdx: c.controlIdx,
          };
          return { ctx, props };
        }}
        onApply={(ctx, props) => {
          activeViewerRef()?.setTableProps(
            ctx.sectionIdx,
            ctx.parentParaIdx,
            ctx.controlIdx,
            props,
          );
        }}
      />
      <PicturePropsDialog
        open={picturePropsOpen}
        onOpenChange={setPicturePropsOpen}
        enumeratePictures={() => {
          const v = activeViewerRef();
          if (!v) return [];
          return v.enumeratePictures().map((p) => ({
            sectionIdx: p.sectionIdx,
            parentParaIdx: p.parentParaIdx,
            controlIdx: p.controlIdx,
            label: p.label,
          }));
        }}
        getProps={(ref: PictureRef) =>
          activeViewerRef()?.getPictureProps(
            ref.sectionIdx,
            ref.parentParaIdx,
            ref.controlIdx,
          ) ?? null
        }
        onApply={(ref, props) => {
          activeViewerRef()?.setPictureProps(
            ref.sectionIdx,
            ref.parentParaIdx,
            ref.controlIdx,
            props,
          );
        }}
        onDelete={(ref) => {
          activeViewerRef()?.deletePictureControl(
            ref.sectionIdx,
            ref.parentParaIdx,
            ref.controlIdx,
          );
        }}
      />
      <CellStylePickerDialog
        open={cellStylePickerOpen}
        onOpenChange={setCellStylePickerOpen}
        getCurrentCell={() => {
          const v = activeViewerRef();
          if (!v) return null;
          const c = v.getActiveCellContext();
          if (!c) return null;
          const ctx: CellStylePickerCtx = {
            sectionIdx: c.sectionIndex,
            parentParaIdx: c.parentParaIdx,
            controlIdx: c.controlIdx,
            cellIdx: c.cellIdx,
          };
          return ctx;
        }}
        getStyles={() => {
          const v = activeViewerRef();
          if (!v) return [];
          const list = v.getStyleListJson() ?? [];
          return list
            .map((s): StyleOption | null => {
              const id = (s as { id?: unknown }).id;
              const name = (s as { name?: unknown }).name;
              const englishName = (s as { englishName?: unknown }).englishName;
              if (typeof id !== 'number' || typeof name !== 'string')
                return null;
              return {
                id,
                name,
                englishName:
                  typeof englishName === 'string' ? englishName : undefined,
              };
            })
            .filter((x): x is StyleOption => x !== null);
        }}
        onApply={(ctx, styleId) => {
          activeViewerRef()?.applyCellStyle(
            ctx.sectionIdx,
            ctx.parentParaIdx,
            ctx.controlIdx,
            ctx.cellIdx,
            0, // cellPara — apply to the first para of the cell
            styleId,
          );
        }}
      />
      <TableFormulaDialog
        open={formulaOpen}
        onOpenChange={setFormulaOpen}
        ctx={formulaCtx}
        onEvaluate={(ctx, formula, writeResult) => {
          const v = activeViewerRef();
          if (!v) return null;
          return v.evaluateTableFormula(
            ctx.sectionIndex,
            ctx.parentParaIdx,
            ctx.controlIdx,
            ctx.targetRow,
            ctx.targetCol,
            formula,
            writeResult,
          );
        }}
      />
      <CellPropsDialog
        open={cellPropsOpen}
        onOpenChange={setCellPropsOpen}
        getCurrent={() => {
          const v = activeViewerRef();
          if (!v) return null;
          const c = v.getActiveCellContext();
          if (!c) return null;
          const props = v.getCellProps(
            c.sectionIndex,
            c.parentParaIdx,
            c.controlIdx,
            c.cellIdx,
          );
          if (!props) return null;
          const ctx: CellPropsContext = {
            sectionIdx: c.sectionIndex,
            parentParaIdx: c.parentParaIdx,
            controlIdx: c.controlIdx,
            cellIdx: c.cellIdx,
          };
          return { ctx, props };
        }}
        onApply={(ctx, props) => {
          activeViewerRef()?.setCellProps(
            ctx.sectionIdx,
            ctx.parentParaIdx,
            ctx.controlIdx,
            ctx.cellIdx,
            props,
          );
        }}
      />
      <div className="flex h-screen flex-col bg-background text-foreground">
        <TitleBar
          activeFileName={
            activeTab
              ? (activeTab.path.split(/[/\\]/).pop() ?? activeTab.path)
              : ''
          }
          dirty={activeTab?.dirty ?? false}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        {notice && (
          <div
            data-testid="app-notice"
            data-kind={notice.kind}
            role="status"
            className={
              'flex items-center justify-between gap-3 border-b px-4 py-2 text-xs ' +
              (notice.kind === 'warn'
                ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200')
            }
          >
            <span className="truncate">{notice.text}</span>
            <button
              type="button"
              onClick={dismissNotice}
              className="shrink-0 rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
              aria-label="알림 닫기"
              data-testid="app-notice-dismiss"
            >
              ✕
            </button>
          </div>
        )}
        <PanelGroup
          direction="horizontal"
          autoSaveId="ahwp:shell"
          className="flex-1"
        >
          <Panel
            id="files"
            order={1}
            defaultSize={18}
            minSize={12}
            maxSize={40}
            className="border-r border-border bg-card"
          >
            <aside className="flex h-full flex-col">
              <div className="flex h-12 items-center justify-between gap-2 border-b border-border px-3">
                <h2
                  className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  title={folderRoot ?? undefined}
                  data-testid="folder-tree-root-label"
                >
                  {folderRoot ? folderRoot.split('/').pop() : '폴더'}
                </h2>
                <button
                  type="button"
                  onClick={() => void openFolder()}
                  className="rounded p-1 hover:bg-muted"
                  aria-label="폴더 열기"
                  title="폴더 열기"
                  data-testid="folder-tree-open"
                >
                  <FolderInput className="size-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                {folderRoot ? (
                  <FolderTree
                    rootPath={folderRoot}
                    activePath={activeTab?.path ?? null}
                    onOpenPath={openByPath}
                  />
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
                    <p>열린 폴더가 없습니다.</p>
                    <button
                      type="button"
                      onClick={() => void openFolder()}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                      data-testid="folder-tree-empty-open"
                    >
                      폴더 열기
                    </button>
                  </div>
                )}
              </div>
            </aside>
          </Panel>

          <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring data-[resize-handle-state=drag]:bg-ring" />

          <Panel id="editor" order={2} defaultSize={56} minSize={30}>
            <main className="flex h-full flex-col">
              {tabsState.length > 0 && (
                <TabBar
                  tabs={tabsState}
                  activeIndex={activeIndex}
                  onActivate={setActiveIndex}
                  onClose={closeTab}
                  onReorder={reorderTab}
                  onCloseOthers={closeOtherTabs}
                  onCloseRight={closeTabsToRight}
                  onCopyPath={copyTabPath}
                  onReveal={revealTab}
                  onTogglePin={togglePinTab}
                />
              )}
              <div className="relative flex-1 overflow-hidden">
                {tabsState.length === 0 ? (
                  <WelcomePane
                    onNewDoc={() => void newDocument()}
                    onOpen={() => void openFromDialog()}
                    onOpenPath={(p) => void openByPath(p)}
                    pingError={pingError}
                    pingResult={pingResult}
                  />
                ) : (
                  tabsState.map((tab, idx) => {
                    const isActive = idx === activeIndex;
                    return (
                      <div
                        key={tab.key}
                        // Mount every tab; hide inactive ones with display:none
                        // so they keep their HwpDocument + edit state. We use
                        // `style.display` rather than `hidden` because some
                        // children rely on layout (refs/sizes) computed at mount.
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: isActive ? 'block' : 'none',
                        }}
                        data-testid="studio-tab-pane"
                        data-tab-key={tab.key}
                        data-tab-active={isActive ? 'true' : 'false'}
                      >
                        <StudioViewer
                          path={tab.path}
                          isActive={isActive}
                          onDirtyChange={dirtyCallbacks.get(tab.key)}
                          ref={refCallbackFor(tab.key)}
                          onOpenTableProps={() => setTablePropsOpen(true)}
                          onOpenCellProps={() => setCellPropsOpen(true)}
                          onOpenCellStylePicker={() =>
                            setCellStylePickerOpen(true)
                          }
                          onOpenFormula={() => {
                            // Resolve the right-clicked cell coords into
                            // a row/col pair via the table dimensions
                            // exposed on the active viewer. The cell
                            // context menu has already moved caret into
                            // the cell, so getActiveCellContext returns
                            // the click's coordinates.
                            const v = activeViewerRef();
                            if (!v) return;
                            const cell = v.getActiveCellContext();
                            if (!cell) return;
                            const tableProps = v.getTableProps(
                              cell.sectionIndex,
                              cell.parentParaIdx,
                              cell.controlIdx,
                            );
                            const colCount =
                              typeof tableProps?.['colCount'] === 'number'
                                ? (tableProps['colCount'] as number)
                                : 1;
                            const targetRow = Math.floor(
                              cell.cellIdx / colCount,
                            );
                            const targetCol = cell.cellIdx % colCount;
                            setFormulaCtx({
                              sectionIndex: cell.sectionIndex,
                              parentParaIdx: cell.parentParaIdx,
                              controlIdx: cell.controlIdx,
                              targetRow,
                              targetCol,
                            });
                            setFormulaOpen(true);
                          }}
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </main>
          </Panel>

          <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring data-[resize-handle-state=drag]:bg-ring" />

          <Panel
            id="chat"
            order={3}
            defaultSize={26}
            minSize={18}
            maxSize={50}
            className="border-l border-border bg-card"
          >
            <aside className="flex h-full flex-col">
              <div className="flex h-12 items-center border-b border-border px-4">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  챗봇
                </h2>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChatPanel
                  onOpenSettings={() => setSettingsOpen(true)}
                  getDocHtml={() =>
                    activeViewerRef()?.exportDocumentHtml() ?? ''
                  }
                  applyHtml={(html) =>
                    activeViewerRef()?.applyHtmlAtCaret(html)
                  }
                  runTools={(items) => {
                    const v = activeViewerRef();
                    if (!v) return [];
                    return runTools(v, items);
                  }}
                  captureExcerpt={() =>
                    activeViewerRef()?.captureExcerpt() ?? null
                  }
                  activeDocPath={() => activeTab?.path ?? null}
                  verifyExcerpt={(anchor, expected) =>
                    activeViewerRef()?.verifyExcerpt(anchor, expected) ?? null
                  }
                  getOpenDocs={() =>
                    tabsState.map((tab, idx) => ({
                      path: tab.path,
                      label: tab.path.split(/[/\\]/).pop() ?? tab.path,
                      isActive: idx === activeIndex,
                    }))
                  }
                  getDocOutline={(path) => {
                    // Look up the (still-mounted) viewer for this tab and
                    // pull a short HTML outline. Inactive viewers stay
                    // mounted (display:none), so reading their IR is just
                    // a method call. 20 paragraphs trades cost vs context.
                    const tab = tabsState.find((t) => t.path === path);
                    if (!tab) return '';
                    const ref = viewerRefsRef.current.get(tab.key);
                    return ref?.exportDocumentHtml(20) ?? '';
                  }}
                  undoLastApply={() => {
                    // chunk 29 — "되돌리기" button on apply/run-tools.
                    // Routes through the active viewer's undo stack;
                    // chunk 27 grouped undo guarantees the entire AI
                    // turn collapses into one entry, so a single click
                    // reverses every op the model just applied.
                    const v = activeViewerRef();
                    if (!v) return false;
                    if (!v.canUndo()) return false;
                    v.undo();
                    return true;
                  }}
                />
              </div>
            </aside>
          </Panel>
        </PanelGroup>
      </div>
    </>
  );
}
