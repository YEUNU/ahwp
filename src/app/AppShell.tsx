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
import { TabBar, type TabDescriptor } from '@/features/studio/TabBar';
import type { ViewerHandle } from '@/features/studio/types';
import { ThemeToggle } from './theme-toggle';

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
    setTabsState((prev) => {
      const existing = prev.findIndex((t) => t.path === path);
      if (existing >= 0) {
        setActiveIndex(existing);
        return prev;
      }
      const next: TabState[] = [
        ...prev,
        { path, dirty: false, key: makeTabKey() },
      ];
      setActiveIndex(next.length - 1);
      return next;
    });
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

  // Close a tab. If dirty, prompt the user first.
  const closeTab = useCallback((index: number): void => {
    setTabsState((prev) => {
      const tab = prev[index];
      if (!tab) return prev;
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
  }, [activeTab, exportBytes, replaceTabPath]);

  const saveAsCurrent = useCallback(async () => {
    const tab = activeTab;
    const bytes = await exportBytes();
    if (!bytes) return;
    const defaultPath = tab ? correctExtension(tab.path, 'hwpx') : undefined;
    const result = await window.api.file.saveAs({ bytes, defaultPath });
    if (result) {
      if (tab) replaceTabPath(tab.path, result.path);
      else openTab(result.path);
    }
  }, [activeTab, exportBytes, replaceTabPath, openTab]);

  // ⌘W / Ctrl+W: close the active tab. Bound at the document level
  // because the StudioViewer's keydown handler doesn't run when the
  // user's focus is outside the scroll container (e.g. on a tab button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 'w') {
          if (activeIndex >= 0) {
            closeTab(activeIndex);
            e.preventDefault();
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, closeTab]);

  useEffect(() => {
    return window.api.onMenuAction((action: MenuAction) => {
      const handle = activeViewerRef();
      if (action === 'file:new') {
        void newDocument();
      } else if (action === 'file:open') {
        void openFromDialog();
      } else if (action === 'file:save') {
        void saveCurrent();
      } else if (action === 'file:save-as') {
        void saveAsCurrent();
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
      }
    });
  }, [
    activeViewerRef,
    newDocument,
    openFromDialog,
    saveCurrent,
    saveAsCurrent,
  ]);

  return (
    <>
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
      <PanelGroup
        direction="horizontal"
        autoSaveId="ahwp:shell"
        className="h-screen bg-background text-foreground"
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
            <div className="flex h-12 items-center justify-between border-b border-border px-6">
              <span className="truncate text-sm text-muted-foreground">
                {activeTab?.path ?? 'ahwp'}
              </span>
              <ThemeToggle />
            </div>
            {tabsState.length > 0 && (
              <TabBar
                tabs={tabsState}
                activeIndex={activeIndex}
                onActivate={setActiveIndex}
                onClose={closeTab}
              />
            )}
            <div className="relative flex-1 overflow-hidden">
              {tabsState.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
                  <h1 className="text-2xl font-semibold">Hello, ahwp</h1>
                  <p className="text-sm text-muted-foreground">
                    새 문서를 만들거나 좌측 패널에 파일을 끌어 놓으세요.
                  </p>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => void newDocument()}
                      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                      data-testid="welcome-new-doc"
                    >
                      새 문서
                    </button>
                    <button
                      type="button"
                      onClick={() => void openFromDialog()}
                      className="rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                      data-testid="welcome-open"
                    >
                      파일 열기
                    </button>
                  </div>
                  {pingError && (
                    <pre className="mt-4 max-w-md text-xs text-destructive">
                      {pingError}
                    </pre>
                  )}
                  {!pingError && !pingResult && (
                    <span className="mt-4 text-xs text-muted-foreground">
                      초기화 중…
                    </span>
                  )}
                </div>
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
              <ChatPanel onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </aside>
        </Panel>
      </PanelGroup>
    </>
  );
}
