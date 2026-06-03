import { FolderInput } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// chunk 86 — RP v2 유지 (v4 재시도 결과 동일 layout 회귀: chat-history
// popover 의 flex-1 truncate button 이 0px 로 hidden). v4 의 새 Group
// 인라인 스타일이 deeply-nested flex children 을 collapse 시키는 듯.
// lib upstream issue 추적 후 재시도.
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { PingResponse } from '@shared/api';
import { isReadOnlyTool } from '@shared/ai-tools';
import { dedupeCellTargets, patchFormatToLibProps } from '@shared/ai-patches';
import { ChatPanel, type ChatPanelHandle } from '@/features/chat/ChatPanel';
import { runTools } from '@/features/chat/tools';
import { primaryModifier } from '@/lib/platform';
import { useDispatchMenuAction } from '@/app/hooks/useDispatchMenuAction';
import {
  useTabManagement,
  makeTabKey,
  type TabState,
} from '@/app/hooks/useTabManagement';
import { useNotice } from '@/app/hooks/useNotice';
import { useSaveFlow } from '@/app/hooks/useSaveFlow';
import {
  CommandPalette,
  type CommandItem,
} from '@/features/cmdk/CommandPalette';
import { buildActionItems } from '@/features/cmdk/items';
// `ShortcutsDialog` 와 `AboutDialog` 는 SettingsDialog 의 탭으로 통합 (UI/UX
// align). view:shortcuts / view:about 메뉴 액션은 settingsTab 을 설정하고
// settingsOpen 을 true 로.
import { FolderTree } from '@/features/files/FolderTree';
import { SearchPanel } from '@/features/files/SearchPanel';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
// Phase 7 E2 — 자체 StudioViewer + 부속 dialog 들을 모두 폐기. 편집 UI 는
// rhwp-studio iframe 이 자체 제공. ahwp 는 RhwpEditor (iframe 마운트)
// + AI Chat panel 만 책임.
import { RhwpEditor } from '@/features/rhwp-studio/RhwpEditor';
import { TabBar } from '@/app/TabBar';
import { TitleBar } from './TitleBar';
import { UpdateBanner } from '@/features/updater/UpdateBanner';
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

// `TabState` / `makeTabKey` 는 R3 (2차) 에서 useTabManagement 로 이동.

/**
 * chunk 66 — true when focus is inside an editable element (chat
 * input / rename input / dialog text fields). Used to suppress global
 * ⌘W / ⌘K / ⌘/ / ⌘⇧F / Alt+P bindings so they don't
 * hijack keystrokes the user actually wants delivered to the field
 * (e.g. ⌘W = "delete word backward" in macOS text inputs).
 *
 * StudioViewer doesn't use contentEditable — it's a custom viewer
 * with synthesized caret + IME composition handlers. So a plain
 * INPUT/TEXTAREA check is sufficient; we add `isContentEditable` as
 * defense in depth.
 */
function isEditableFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export default function AppShell() {
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  // Settings is the single home for AI 공급자 / 단축키 / 정보 / 일반.
  // `settingsTab` lets menu actions (view:about / view:shortcuts) route
  // to the right tab on open.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<
    'general' | 'ai' | 'shortcuts' | 'about'
  >('ai');
  // 0.7.43 — 페이지 설정 / 머리말꼬리말 / 책갈피 / 각주 / 스타일 / 수식 /
  // 도형 / 그림 속성 / 룰러 / 버전 히스토리 다이얼로그는 모두 rhwp-studio
  // iframe 자체 메뉴바가 제공한다. 이전엔 ahwp 네이티브 메뉴 + ⌘K 에도 중복
  // 항목이 있었으나 parent state 가 죽어(discarded) 클릭해도 무동작이라 제거.
  // R3 (2차) — notice → useNotice hook.
  const { notice, showNotice, dismissNotice } = useNotice();
  // chunk 50 — command palette (⌘K). Open state lives here so any
  // sub-component (welcome screen, future help button) can also
  // trigger it.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Phase 7 E2 — 탭별 RhwpEditor handle 추적. AI runTools 가 활성 탭의
  // bridge 를 직접 잡고 BridgeIrHelper 로 wrap. handle 은 onReady 가
  // fire 된 뒤에만 의미가 있음.
  const rhwpHandlesRef = useRef(
    new Map<
      string,
      import('@/features/rhwp-studio/RhwpEditor').RhwpEditorHandle
    >(),
  );
  // chunk 56 — ChatPanel imperative handle for cross-pane AI triggers
  // (right-click → AI command). The viewer's selection menu calls
  // `chatRef.current.prefillAndSend(prompt)` to fire a chat turn.
  const chatRef = useRef<ChatPanelHandle | null>(null);
  // chunk 60 — folder text search. ⌘⇧F toggles a search panel that
  // replaces the folder tree view; clicking a snippet opens the file
  // (existing tab if open) and scrolls to the matched paragraph.
  const [searchMode, setSearchMode] = useState(false);
  const sessionRestoredRef = useRef(false);

  // R3 (2차) — tab management → useTabManagement hook.
  const {
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
  } = useTabManagement();

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

  // (showNotice / dismissNotice now provided by useNotice hook above)

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
          const handle = rhwpHandlesRef.current.get(tab.key);
          if (!handle) continue;
          try {
            const bytes = await handle.exportHwp();
            if (!bytes) continue;
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

  // R3 (2차) — file open / new / save / saveAs / folder pick →
  // useSaveFlow hook.
  const {
    openFromDialog,
    openByPath,
    newDocument,
    openFolder,
    saveCurrent,
    saveAsCurrent,
  } = useSaveFlow({
    activeTab,
    openTab,
    replaceTabPath,
    setFolderRoot,
    showNotice,
    // 0.7.46 — 저장 성공 시 탭 dirty 해제 (AI 쓰기로 설정된 플래그).
    setTabDirty,
    // Phase 7 E2 — 활성 탭의 RhwpEditor handle 에서 직접 bytes 추출.
    // legacy viewer.exportBytes() 경로는 폐기. handle 이 아직 ready 안
    // 됐으면 null → useSaveFlow 가 대체 에러 처리.
    exportOverride: async (): Promise<Uint8Array | null> => {
      const key = activeTab?.key;
      if (!key) return null;
      const handle = rhwpHandlesRef.current.get(key);
      if (!handle) return null;
      return await handle.exportHwp();
    },
  });

  // ⌘W / Ctrl+W: close the active tab. Bound at the document level
  // because the StudioViewer's keydown handler doesn't run when the
  // user's focus is outside the scroll container (e.g. on a tab button).
  // ⌘K / Ctrl+K toggles the command palette (chunk 50) — same reason
  // it lives at document level: we want to open it from anywhere.
  //
  // chunk 66 — guard against editable focus. The chat input / rename
  // inputs / dialog form fields all sit inside the same window event
  // bubble, and a global ⌘W there used to close the active tab while
  // the user was typing (browser native ⌘W = close tab). Same for
  // ⌘K, ⌘/, ⌘⇧F, Alt+P. Editor shortcuts (⌘B/I/U/A/F/H/Z, F6 스타일,
  // Alt+L 글자모양, Alt+T 문단모양) are handled INSIDE the rhwp-studio
  // iframe — the parent no longer binds them (their old parent handlers
  // set discarded state after the dialogs moved into the iframe; removed
  // in 0.7.43). The viewer textarea/input is **not**
  // guarded out of bounds here because the user always wants ⌘W to
  // close the tab from the toolbar / page background; only editable
  // focus zones are excluded.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isEditableFocused()) return;
      if (primaryModifier(e) && !e.altKey && !e.shiftKey) {
        if (e.key.toLowerCase() === 'w') {
          if (activeIndex >= 0) {
            closeTab(activeIndex);
            e.preventDefault();
          }
        } else if (e.key.toLowerCase() === 'k') {
          setPaletteOpen((v) => !v);
          e.preventDefault();
        } else if (e.key === '/') {
          // chunk 53 — ⌘/ opens Settings 의 단축키 탭 (UI/UX align).
          setSettingsTab('shortcuts');
          setSettingsOpen(true);
          e.preventDefault();
        }
      } else if (
        primaryModifier(e) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'f'
      ) {
        // chunk 60 — ⌘⇧F opens cross-folder search.
        setSearchMode(true);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, closeTab]);

  // Single dispatch function for every MenuAction. Lifted out of the
  // onMenuAction useEffect so the command palette (chunk 50) can fire
  // the same actions through the same code path. The native menu and
  // ⌘K both feed into this.
  // R3 — dispatchMenuAction (~115 라인) + 메뉴 IPC 등록 effect →
  // useDispatchMenuAction hook.
  // Helper: open Settings on a specific tab. view:about / view:shortcuts
  // both reroute to Settings now (R3 + UI align — single home for all
  // app-level config / info).
  const openSettingsTab = useCallback(
    (tab: 'general' | 'ai' | 'shortcuts' | 'about') => {
      setSettingsTab(tab);
      setSettingsOpen(true);
    },
    [],
  );

  const dispatchMenuAction = useDispatchMenuAction({
    newDocument,
    openFromDialog,
    saveCurrent,
    saveAsCurrent,
    setSettingsOpen,
    openSettingsTab,
  });

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
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
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
        <UpdateBanner />
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
                {searchMode ? (
                  <SearchPanel
                    rootPath={folderRoot}
                    onClose={() => setSearchMode(false)}
                    onOpenAtParagraph={(p, paraIdx) => {
                      // Open (or focus) the file, then scroll to the
                      // paragraph after the rhwp-editor bridge is ready.
                      // We defer to a timeout so React commits the new
                      // active tab and the iframe bridge mounts before we
                      // reach for the handle.
                      openTab(p);
                      setTimeout(() => {
                        const tab = tabsState.find((t) => t.path === p);
                        const bridge = tab
                          ? (rhwpHandlesRef.current.get(tab.key)?.bridge ??
                            null)
                          : null;
                        void bridge
                          ?.invoke('scrollToParagraph', {
                            sectionIdx: 0,
                            paraIdx,
                          })
                          .catch(() => {
                            /* 구버전 vendor build — case 미존재 시 무해 */
                          });
                      }, 50);
                    }}
                  />
                ) : folderRoot ? (
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
            <main className="relative flex h-full flex-col">
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
              {/* 0.6.14 — Diff portal target moved from absolute overlay
                to a true side panel. ChatPanel portals GithubDiffPane
                here. Empty (display:none on inner pane) when no patches —
                editor takes full width. When patches exist the pane
                takes ~360px and editor shrinks accordingly. No overlap. */}
              <div className="relative flex flex-1 overflow-hidden">
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
                          <RhwpEditor
                            key={tab.key}
                            ref={(h) => {
                              if (h) rhwpHandlesRef.current.set(tab.key, h);
                              else rhwpHandlesRef.current.delete(tab.key);
                            }}
                            onReady={async (bridge) => {
                              try {
                                const buf = await window.api.file.read(
                                  tab.path,
                                );
                                await bridge.loadFile(buf, tab.path, true);
                              } catch (err) {
                                console.error(
                                  '[AppShell] rhwp-editor doc load failed:',
                                  err,
                                );
                              }
                            }}
                            onError={(err) => {
                              console.warn('[AppShell] RhwpEditor error:', err);
                            }}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
                {/* Diff side panel (portal target). Hidden when no
                  patches active — inner [data-empty="true"] sets
                  display:none via CSS. ChatPanel decides what to mount. */}
                <div
                  id="ahwp-editor-diff-overlay"
                  data-testid="editor-diff-overlay"
                  className="shrink-0 empty:hidden"
                  style={{ width: 380 }}
                />
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
              {/* chunk 73 — `min-h-0` propagates the resizable Panel's
                  height bound through the flex column so ChatPanel's
                  inner scroller doesn't grow past its allotted region.
                  Without it, long assistant messages pushed the input
                  form below the viewport. */}
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatPanel
                  ref={chatRef}
                  onOpenSettings={() => setSettingsOpen(true)}
                  openDocByPath={async (path) => {
                    // chunk 99 follow-up — switchTargetDoc 의 cross-doc
                    // auto-open. useSaveFlow.openByPath 가 0.6.2 부터
                    // boolean 반환 (editable 탭 mount 성공 = true,
                    // readable-only / unknown / 실패 = false). 이 값을
                    // 그대로 propagate — hook 이 신뢰하고 후속 단계 진행.
                    //
                    // 주의: PDF / DOCX 등 readable-only 는 false 반환 →
                    // AI 가 target-not-open 받음. 의도적 — non-HWP 는
                    // 편집 대상이 될 수 없음 (rhwp-studio 한계).
                    try {
                      return await openByPath(path);
                    } catch (err) {
                      console.warn('[appshell] openDocByPath threw:', err);
                      return false;
                    }
                  }}
                  runTools={async (
                    items: import('@shared/ai-tools').AhwpPreflightItem[],
                    targetPath?: string | null,
                    subAgentContext?: import('@/features/chat/tools').SubAgentContext,
                  ) => {
                    // Phase 3 chunk 50 — docId-aware routing. The chat
                    // turn pins a target path; tools dispatch through the
                    // active tab's live rhwp bridge (the BridgeIrHelper
                    // path). null targetPath = legacy / Manual "도구 실행".
                    // Phase 7 E2 — 활성 탭의 RhwpEditor handle 에서 직접
                    // bridge 추출. legacy __rhwpDebug fallback 은 폐기.
                    let bridge: import('@/lib/rhwp-bridge').RhwpBridge | null =
                      null;
                    const activeKey = activeTab?.key;
                    if (activeKey) {
                      const handle = rhwpHandlesRef.current.get(activeKey);
                      bridge = handle?.bridge ?? null;
                    }
                    if (!bridge) {
                      // rhwp bridge 미마운트 → 호출 불가.
                      if (targetPath) {
                        return items.map((it) => ({
                          ok: false,
                          tool: it.ok ? it.call.tool : it.tool,
                          reason: `target-doc-not-mounted:${targetPath}`,
                        }));
                      }
                      return [];
                    }
                    const helper = new (
                      await import('@/features/rhwp-studio/bridge-ir-helper')
                    ).BridgeIrHelper(bridge);
                    const results = await runTools(
                      null,
                      items,
                      helper,
                      subAgentContext,
                      // 0.7.20 — Inserty 데모 참고: AI form-fill 실시간 편집
                      // 위치 표시. write op 마다 채워지는 문단으로 iframe
                      // 편집 영역을 스크롤 (caret/포커스는 그대로 — 채팅
                      // 입력 포커스 유지).
                      (sec, para) => {
                        void bridge!
                          .invoke('scrollToParagraph', {
                            sectionIdx: sec,
                            paraIdx: para,
                          })
                          .catch(() => {
                            /* 구버전 vendor build — case 미존재 시 무해 */
                          });
                      },
                    );
                    // 0.7.46 — AI write 도구가 성공하면 활성 탭 dirty 표시.
                    // (vendor iframe 이 사용자 타이핑 dirty 를 부모로 안
                    // 보내므로 AI 쓰기만 감지 — 가장 정확한 비-vendor 신호.)
                    if (
                      activeKey &&
                      results.some((r) => r.ok && !isReadOnlyTool(r.tool))
                    ) {
                      setTabDirty(activeKey, true);
                    }
                    return results;
                  }}
                  activeDocPath={() => activeTab?.path ?? null}
                  getOpenDocs={() =>
                    tabsState.map((tab, idx) => ({
                      path: tab.path,
                      label: tab.path.split(/[/\\]/).pop() ?? tab.path,
                      isActive: idx === activeIndex,
                    }))
                  }
                  applyPatches={async (patches) => {
                    // Q5 Diff Viewer — apply a batch of patches in rhwp-mode
                    // via BridgeIrHelper. Body: deleteRange + insertText.
                    // Cell: invokeOk('deleteRangeInCell') + insertTextInCell
                    // + invokeOk('applyCharFormatInCell'). additionFormat →
                    // patchFormatToLibProps (size_hu / color int 변환).
                    //
                    // 0.5.x: bridge ops 가 async 라서 handler 도 async; 멀티
                    // 패치는 순차 실행 (paragraph index 가 앞 패치 결과에
                    // 영향받지 않도록 — 한 paragraph 단위 단일 op 가정).
                    const key = activeTab?.key;
                    const handle = key ? rhwpHandlesRef.current.get(key) : null;
                    const bridge = handle?.bridge ?? null;
                    if (!bridge) return patches.map(() => false);
                    const helper = new (
                      await import('@/features/rhwp-studio/bridge-ir-helper')
                    ).BridgeIrHelper(bridge);
                    const results: boolean[] = [];
                    // 0.6.14 — extract dedup decision to a pure helper
                    // (shared/ai-patches.dedupeCellTargets) so it's
                    // unit-testable. `allow[i] === false` means the i-th
                    // patch was a duplicate of an earlier cell target and
                    // must be rejected before any IR mutation.
                    const allow = dedupeCellTargets(patches);
                    for (let i = 0; i < patches.length; i++) {
                      const p = patches[i];
                      if (!allow[i]) {
                        const c = p.location.cell;
                        console.warn(
                          `[diff] rejected duplicate cell-target patch (sec=${p.location.sectionIndex}, para=${p.location.paragraphIndex}, cell=${c?.cellIndex}). Each cell can be targeted only once per batch.`,
                        );
                        results.push(false);
                        continue;
                      }
                      try {
                        const sec = p.location.sectionIndex;
                        const para = p.location.paragraphIndex;
                        const start = p.location.startOffset ?? 0;
                        const cell = p.location.cell;
                        const fmtProps = p.additionFormat
                          ? patchFormatToLibProps(p.additionFormat)
                          : null;
                        const insEnd = start + p.addition.length;

                        if (cell) {
                          // Cell-level. endOffset 없으면 deletion 길이로
                          // 대체 — lib 가 internally clamp.
                          let end = p.location.endOffset;
                          if (end === undefined) end = p.deletion.length;
                          if (p.deletion.length > 0) {
                            const okDel = await helper.invokeOk(
                              'deleteRangeInCell',
                              [
                                sec,
                                para,
                                cell.controlIndex,
                                cell.cellIndex,
                                cell.cellParagraphIndex,
                                start,
                                cell.cellParagraphIndex,
                                end,
                              ],
                            );
                            if (!okDel) {
                              results.push(false);
                              continue;
                            }
                          }
                          const okIns = await helper.insertTextInCell(
                            sec,
                            para,
                            cell.controlIndex,
                            cell.cellIndex,
                            cell.cellParagraphIndex,
                            start,
                            p.addition,
                          );
                          if (!okIns) {
                            results.push(false);
                            continue;
                          }
                          if (fmtProps && p.addition.length > 0) {
                            await helper.invokeOk('applyCharFormatInCell', [
                              sec,
                              para,
                              cell.controlIndex,
                              cell.cellIndex,
                              cell.cellParagraphIndex,
                              start,
                              insEnd,
                              JSON.stringify(fmtProps),
                            ]);
                          }
                          results.push(true);
                          continue;
                        }

                        // Body-level patch.
                        //
                        // 0.6.14 — guard: target paragraph anchors a table?
                        // model 이 cell coordinate 를 빠뜨려 body insert 로
                        // routing 되면 양식이 깨지므로 (heading 중복 / 폰트
                        // 오염 / 표 unfilled) 명시적으로 reject. model 은
                        // false 결과를 받고 다음 turn 에 cell-level 재발급.
                        try {
                          const dimRaw = await helper.invokeRead<unknown>(
                            'getTableDimensions',
                            [sec, para, 0],
                          );
                          let hasTable = false;
                          if (dimRaw != null) {
                            let dim: { ok?: boolean; cellCount?: number };
                            if (typeof dimRaw === 'string') {
                              try {
                                dim = JSON.parse(dimRaw);
                              } catch {
                                dim = {};
                              }
                            } else {
                              dim = dimRaw as {
                                ok?: boolean;
                                cellCount?: number;
                              };
                            }
                            hasTable =
                              dim.ok !== false && (dim.cellCount ?? 0) > 0;
                          }
                          if (hasTable) {
                            console.warn(
                              `[diff] rejected body patch at (sec=${sec}, para=${para}) — paragraph anchors a table. Patch must use location.cell.`,
                            );
                            results.push(false);
                            continue;
                          }
                        } catch {
                          /* getTableDimensions throw = no table here; proceed. */
                        }

                        let end = p.location.endOffset;
                        if (end === undefined) {
                          end = await helper.getParagraphLength(sec, para);
                        }
                        if (end > start) {
                          const okDel = await helper.deleteRange(
                            sec,
                            para,
                            start,
                            para,
                            end,
                          );
                          if (!okDel) {
                            results.push(false);
                            continue;
                          }
                        }
                        if (p.addition.length > 0) {
                          const okIns = await helper.insertText(
                            sec,
                            para,
                            start,
                            p.addition,
                          );
                          if (!okIns) {
                            results.push(false);
                            continue;
                          }
                          if (fmtProps) {
                            await helper.applyCharFormat(
                              sec,
                              para,
                              start,
                              insEnd,
                              fmtProps,
                            );
                          }
                        }
                        results.push(true);
                      } catch (err) {
                        console.warn('[diff] applyPatch failed:', err);
                        results.push(false);
                      }
                    }
                    // 0.6.14 — bridge writes bypass the native input-handler's
                    // `afterEdit()` which is what emits `document-changed` to
                    // trigger CanvasView.refreshPages(). Without this notify
                    // the IR is mutated correctly but the canvas keeps showing
                    // pre-edit content. Fire once per batch (not per patch) —
                    // canvas refresh is idempotent and we don't want N repaints.
                    if (results.some((r) => r)) {
                      try {
                        await bridge.invoke('notifyDocumentChanged', {
                          reason: 'ahwp-patches',
                        });
                      } catch (err) {
                        console.warn(
                          '[diff] notifyDocumentChanged failed (older vendor?):',
                          err,
                        );
                      }
                    }
                    // 0.7.46 — 패치 적용 성공 시 활성 탭 dirty 표시.
                    if (key && results.some(Boolean)) setTabDirty(key, true);
                    return results;
                  }}
                  previewPatch={(patch) => {
                    // Q5 확장 — "에디터에서 보기". 활성 탭의 rhwp bridge 로
                    // 해당 문단까지 스크롤.
                    const key = activeTab?.key;
                    const bridge = key
                      ? (rhwpHandlesRef.current.get(key)?.bridge ?? null)
                      : null;
                    void bridge
                      ?.invoke('scrollToParagraph', {
                        sectionIdx: patch.location.sectionIndex,
                        paraIdx: patch.location.paragraphIndex,
                      })
                      .catch(() => {
                        /* 구버전 vendor build — case 미존재 시 무해 */
                      });
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
