import { FolderInput } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// chunk 86 — RP v2 유지 (v4 재시도 결과 동일 layout 회귀: chat-history
// popover 의 flex-1 truncate button 이 0px 로 hidden). v4 의 새 Group
// 인라인 스타일이 deeply-nested flex children 을 collapse 시키는 듯.
// lib upstream issue 추적 후 재시도.
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { PingResponse } from '@shared/api';
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
import { BookmarkDialog } from '@/features/studio/BookmarkDialog';
import { EquationDialog } from '@/features/studio/EquationDialog';
import { FootnoteDialog } from '@/features/studio/FootnoteDialog';
import { HeaderFooterDialog } from '@/features/studio/HeaderFooterDialog';
import { PageSetupDialog } from '@/features/studio/PageSetupDialog';
import { ShapeDialog } from '@/features/studio/ShapeDialog';
import { OutlineSidebar } from '@/features/studio/OutlineSidebar';
import { StudioViewer } from '@/features/studio/StudioViewer';
import { VersionHistoryDialog } from '@/features/studio/VersionHistoryDialog';
import { StyleManagerDialog } from '@/features/studio/StyleManagerDialog';
import { CharFormatDialog } from '@/features/studio/CharFormatDialog';
import { ParaFormatDialog } from '@/features/studio/ParaFormatDialog';
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
import { TabBar } from '@/features/studio/TabBar';
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

// `TabState` / `makeTabKey` 는 R3 (2차) 에서 useTabManagement 로 이동.

/**
 * chunk 66 — true when focus is inside an editable element (chat
 * input / rename input / dialog text fields). Used to suppress global
 * ⌘W / ⌘K / ⌘/ / ⌘⇧F / ⌘⇧O / F6 / Alt+L|T|P bindings so they don't
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
  const [pageSetupOpen, setPageSetupOpen] = useState(false);
  const [hfOpen, setHfOpen] = useState(false);
  const [bookmarkOpen, setBookmarkOpen] = useState(false);
  const [footnoteOpen, setFootnoteOpen] = useState(false);
  const [styleManagerOpen, setStyleManagerOpen] = useState(false);
  const [charFormatOpen, setCharFormatOpen] = useState(false);
  const [charFormatInitial, setCharFormatInitial] = useState<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    instance: number;
  }>({ bold: false, italic: false, underline: false, instance: 0 });
  const [paraFormatOpen, setParaFormatOpen] = useState(false);
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
  // R3 (2차) — notice → useNotice hook.
  const { notice, showNotice, dismissNotice } = useNotice();
  // chunk 50 — command palette (⌘K). Open state lives here so any
  // sub-component (welcome screen, future help button) can also
  // trigger it.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // chunk 56 — ChatPanel imperative handle for cross-pane AI triggers
  // (right-click → AI command). The viewer's selection menu calls
  // `chatRef.current.prefillAndSend(prompt)` to fire a chat turn.
  const chatRef = useRef<ChatPanelHandle | null>(null);
  // chunk 60 — folder text search. ⌘⇧F toggles a search panel that
  // replaces the folder tree view; clicking a snippet opens the file
  // (existing tab if open) and scrolls to the matched paragraph.
  const [searchMode, setSearchMode] = useState(false);
  // chunk 58 — outline sidebar (TOC). ⌘⇧O toggles the right-edge
  // sidebar that lists "제목 1/2/3" headings extracted from the active
  // doc. `outlineKey` bumps when any tab's dirty flips so the sidebar
  // refreshes without polling.
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [outlineKey, setOutlineKey] = useState(0);
  // chunk 61 — ruler toggle. Drives StudioViewer's `showRuler` prop;
  // persisted across the session via localStorage so users don't have
  // to re-enable on every launch.
  const [showRuler, setShowRuler] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ahwp:show-ruler') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('ahwp:show-ruler', showRuler ? '1' : '0');
    } catch {
      /* localStorage can throw under hardened CSP */
    }
  }, [showRuler]);
  // chunk 53 — shortcut cheatsheet (⌘/) — 이제 Settings 의 단축키 탭으로
  // 라우팅. setSettingsTab('shortcuts') + setSettingsOpen(true).
  // chunk 62 — version history dialog.
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);
  const sessionRestoredRef = useRef(false);

  // R3 (2차) — tab management → useTabManagement hook.
  const {
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
    refCallbackFor,
    dirtyCallbacks,
  } = useTabManagement({ setOutlineKey });

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
    activeViewerRef,
    openTab,
    replaceTabPath,
    setFolderRoot,
    showNotice,
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
  // ⌘K, ⌘/, ⌘⇧F, ⌘⇧O, F6, Alt+L/T/P. Studio shortcuts (⌘B/I/U/A/F/H/Z)
  // already short-circuit inside StudioViewer's own onKeyDown — those
  // never bubbled to window. The viewer textarea/input is **not**
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
      } else if (
        primaryModifier(e) &&
        e.shiftKey &&
        !e.altKey &&
        e.key.toLowerCase() === 'o'
      ) {
        // chunk 58 — ⌘⇧O toggles the outline (TOC) sidebar.
        setOutlineOpen((v) => !v);
        e.preventDefault();
      } else if (
        // Phase B-5 — 한글 호환 본문 도움 단축키.
        e.key === 'F6' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        // F6 = 스타일 관리 다이얼로그 (한글 reflex).
        setStyleManagerOpen(true);
        e.preventDefault();
      } else if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'l'
      ) {
        // Alt+L = 글자 모양 다이얼로그 (Hancom reflex)
        const v = activeViewerRef();
        const af = v?.getActiveFormat() ?? {};
        setCharFormatInitial((prev) => ({
          bold: !!af.bold,
          italic: !!af.italic,
          underline: !!af.underline,
          instance: prev.instance + 1,
        }));
        setCharFormatOpen(true);
        e.preventDefault();
      } else if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 't'
      ) {
        // Alt+T = 문단 모양 다이얼로그 (Hancom reflex)
        setParaFormatOpen(true);
        e.preventDefault();
      } else if (
        e.altKey &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === 'p'
      ) {
        // Alt+P = PDF 내보내기 (한글에선 인쇄 — 우리는 PDF로 매핑,
        // 본 앱이 인쇄 자체 기능 없음). 동일 path로 dispatchMenuAction
        // 호출하여 기존 export-pdf 핸들러 재사용.
        const v = activeViewerRef();
        const html = v?.exportDocumentHtml(1000) ?? '';
        if (html.length === 0) {
          window.alert('내보낼 문서가 없습니다.');
        } else {
          void window.api.file.exportPdf({
            html,
            defaultPath: activeTab?.path,
          });
        }
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
    activeViewerRef,
    activeTab,
    newDocument,
    openFromDialog,
    saveCurrent,
    saveAsCurrent,
    setSettingsOpen,
    openSettingsTab,
    setPageSetupOpen,
    setHfOpen,
    setBookmarkOpen,
    setFootnoteOpen,
    setStyleManagerOpen,
    setEquationOpen,
    setShapeOpen,
    setPicturePropsOpen,
    setShowRuler,
    setVersionHistoryOpen,
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
      <VersionHistoryDialog
        open={versionHistoryOpen}
        onOpenChange={setVersionHistoryOpen}
        activePath={activeTab?.path ?? null}
        onRestore={async (p, filename) => {
          // chunk 62 — restore flow. Pull bytes from main, then route
          // through file.save so the regular save pipeline (HWPX route,
          // .bak, watcher suppression, draft clear, version creation
          // for the restored point) takes effect. Tab key bumps to
          // remount the viewer.
          const buf = await window.api.file.readVersion({ path: p, filename });
          if (!buf) {
            window.alert('해당 버전을 읽을 수 없습니다.');
            return;
          }
          await window.api.file.save({ path: p, bytes: buf });
          setTabsState((prev) =>
            prev.map((t) =>
              t.path === p ? { ...t, key: makeTabKey(), dirty: false } : t,
            ),
          );
          showNotice('이전 버전으로 복원되었습니다.', 'info');
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialTab={settingsTab}
      />
      <PageSetupDialog
        open={pageSetupOpen}
        onOpenChange={setPageSetupOpen}
        getCurrentPageDef={() =>
          activeViewerRef()?.getPageDef() as
            | import('@shared/rhwp-types').RhwpPageDef
            | null
        }
        onApply={(props) =>
          activeViewerRef()?.applyPageDef(props as Record<string, unknown>)
        }
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
      <CharFormatDialog
        key={charFormatInitial.instance}
        open={charFormatOpen}
        onOpenChange={setCharFormatOpen}
        viewerRef={activeViewerRef}
        initial={{
          bold: charFormatInitial.bold,
          italic: charFormatInitial.italic,
          underline: charFormatInitial.underline,
        }}
      />
      <ParaFormatDialog
        open={paraFormatOpen}
        onOpenChange={setParaFormatOpen}
        viewerRef={activeViewerRef}
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
                {searchMode ? (
                  <SearchPanel
                    rootPath={folderRoot}
                    onClose={() => setSearchMode(false)}
                    onOpenAtParagraph={(p, paraIdx) => {
                      // Open (or focus) the file, then scroll to the
                      // paragraph after the viewer mounts. We defer the
                      // scroll to a microtask so React commits the new
                      // active tab before we reach for the handle.
                      openTab(p);
                      setTimeout(() => {
                        const v = activeViewerRef();
                        v?.scrollToParagraph(0, paraIdx);
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
                          <StudioViewer
                            path={tab.path}
                            isActive={isActive}
                            onDirtyChange={dirtyCallbacks.get(tab.key)}
                            ref={refCallbackFor(tab.key)}
                            showRuler={showRuler}
                            onOpenTableProps={() => setTablePropsOpen(true)}
                            onOpenCellProps={() => setCellPropsOpen(true)}
                            onOpenCellStylePicker={() =>
                              setCellStylePickerOpen(true)
                            }
                            onAiCommand={(prompt) => {
                              // chunk 56 — viewer's selection menu fires a
                              // composed AI prompt; we forward to the
                              // ChatPanel imperative handle so the request
                              // streams immediately. Skip if no handle yet
                              // (panel not mounted) — that should never
                              // happen at this point of the flow.
                              chatRef.current?.prefillAndSend(prompt);
                            }}
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
                {outlineOpen && tabsState.length > 0 && (
                  <OutlineSidebar
                    getViewer={activeViewerRef}
                    refreshKey={outlineKey + (activeIndex << 8)}
                    onClose={() => setOutlineOpen(false)}
                  />
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
              {/* chunk 73 — `min-h-0` propagates the resizable Panel's
                  height bound through the flex column so ChatPanel's
                  inner scroller doesn't grow past its allotted region.
                  Without it, long assistant messages pushed the input
                  form below the viewport. */}
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChatPanel
                  ref={chatRef}
                  onOpenSettings={() => setSettingsOpen(true)}
                  getDocHtml={() =>
                    // chunk 74 — `exportDocumentHtml()` defaults to 50
                    // paragraphs which on a 100p+ doc only captures the
                    // title page / TOC. The model then replies "문서를
                    // 받지 못했습니다" because the body looks empty. Pass
                    // 1000 to match the menu HTML-export and PDF paths.
                    // The provider truncates at the token cap if the
                    // payload is too large.
                    activeViewerRef()?.exportDocumentHtml(1000) ?? ''
                  }
                  applyHtml={(html) => {
                    // chunk 57 — bracket the AI apply with a
                    // paragraph snapshot so we can highlight changed
                    // paragraphs with an amber stripe for ~15s.
                    const v = activeViewerRef();
                    if (!v) return;
                    const before = v.snapshotParagraphs();
                    v.applyHtmlAtCaret(html);
                    v.markChangedParagraphsSince(before);
                  }}
                  applyHtmlReplaceSection={(html, target) => {
                    // chunk 99 follow-up — outline-aware section replace.
                    // Same snapshot-bracket as applyHtml for the changed-
                    // paragraph stripe.
                    const v = activeViewerRef();
                    if (!v) return;
                    const before = v.snapshotParagraphs();
                    v.applyHtmlReplaceSection(html, target);
                    v.markChangedParagraphsSince(before);
                  }}
                  getOutline={() => activeViewerRef()?.getOutline() ?? []}
                  openDocByPath={async (path) => {
                    // chunk 99 follow-up — switchTargetDoc 가 닫힌 path
                    // 받았을 때 자동 open + tab mount + viewer ref 등록.
                    // useSaveFlow.openByPath 재사용 (file:open-by-path
                    // IPC + openTab). 새 viewer 가 mount 되어 다음
                    // viewerRefsRef lookup 에 잡히면 true.
                    try {
                      await openByPath(path);
                      // tab + viewer mount 가 React 렌더 사이클에 의존
                      // 하므로 hook 측에서 setTimeout(50) 으로 양보.
                      // 여기선 단순 ack.
                      return true;
                    } catch (err) {
                      console.warn('[appshell] openDocByPath threw:', err);
                      return false;
                    }
                  }}
                  runTools={async (items, targetPath) => {
                    // Phase 3 chunk 50 — docId-aware routing. If the
                    // chat turn pinned a target path, look up the
                    // matching mounted viewer (it stays mounted with
                    // display:none even when the user switches tabs).
                    // null targetPath = legacy / Manual "도구 실행"
                    // button → fall back to active viewer.
                    const lookupByPath = (p: string) => {
                      const tab = tabsState.find((t) => t.path === p);
                      return tab
                        ? (viewerRefsRef.current.get(tab.key) ?? null)
                        : null;
                    };
                    const v = targetPath
                      ? lookupByPath(targetPath)
                      : activeViewerRef();
                    if (!v) {
                      if (targetPath) {
                        return items.map((it) => ({
                          ok: false,
                          tool: it.ok ? it.call.tool : it.tool,
                          reason: `target-doc-not-mounted:${targetPath}`,
                        }));
                      }
                      return [];
                    }
                    const before = v.snapshotParagraphs();
                    const results = await runTools(v, items);
                    v.markChangedParagraphsSince(before);
                    return results;
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
                  applyPatches={(patches) => {
                    // Q5 Diff Viewer — apply a batch of patches as a single
                    // grouped-undo turn. Per-patch: irDeleteRange to remove
                    // the existing range, then irInsertText with addition.
                    // Whole-paragraph patches (no startOffset/endOffset)
                    // use irGetTextRange to discover paragraph length first.
                    const v = activeViewerRef();
                    if (!v) return patches.map(() => false);
                    v.beginUndoGroup();
                    const results = patches.map((p) => {
                      try {
                        const sec = p.location.sectionIndex;
                        const para = p.location.paragraphIndex;
                        const start = p.location.startOffset ?? 0;
                        let end = p.location.endOffset;
                        if (end === undefined) {
                          // Whole-paragraph — find current length via the
                          // text range read tool (caps at 4096 bytes which
                          // is plenty for a paragraph).
                          const txt = v.irGetTextRange(
                            sec,
                            para,
                            0,
                            para,
                            10_000,
                          );
                          end = (txt ?? '').length;
                        }
                        const okDel = v.irDeleteRange(
                          sec,
                          para,
                          start,
                          para,
                          end,
                        );
                        if (!okDel) return false;
                        const okIns = v.irInsertText(
                          sec,
                          para,
                          start,
                          p.addition,
                        );
                        if (!okIns) return false;
                        // Q5 확장 — additionFormat 이 있으면 삽입한
                        // 영역에 char format 적용. 같은 undo group 안.
                        if (p.additionFormat) {
                          const insEnd = start + p.addition.length;
                          v.irApplyCharFormat(
                            sec,
                            para,
                            start,
                            insEnd,
                            p.additionFormat as Record<string, unknown>,
                          );
                        }
                        return true;
                      } catch (err) {
                        console.warn('[diff] applyPatch failed:', err);
                        return false;
                      }
                    });
                    v.endUndoGroup();
                    return results;
                  }}
                  previewPatch={(patch) => {
                    // Q5 확장 — "에디터에서 보기". 스크롤 + caret 이동.
                    const v = activeViewerRef();
                    if (!v) return;
                    v.scrollToParagraph(
                      patch.location.sectionIndex,
                      patch.location.paragraphIndex,
                    );
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
