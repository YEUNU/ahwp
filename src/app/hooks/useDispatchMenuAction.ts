/**
 * `useDispatchMenuAction` — Phase R3 refactor (REFACTORING_PLAN.md).
 *
 * AppShell.tsx 의 `dispatchMenuAction` (네이티브 메뉴 + 명령 팔레트
 * 공통 entry point) 와 그 IPC 등록 effect 를 hook 으로 분해. 외부
 * 동작 1:1 동일.
 *
 * 호출자는 dispatcher 를 받아 paletteItems / 직접 호출에 사용 +
 * `dispatchRef.current = dispatcher` 패턴으로 mirror.
 */
import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MenuAction } from '@shared/api';
import type { ViewerHandle } from '@/features/studio/types';

export interface UseDispatchMenuActionOptions {
  activeViewerRef: () => ViewerHandle | null;
  activeTab: { path: string } | null;
  newDocument: () => Promise<void> | void;
  openFromDialog: () => Promise<void> | void;
  saveCurrent: () => Promise<void> | void;
  saveAsCurrent: () => Promise<void> | void;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  /** UI/UX align — view:about / view:shortcuts 메뉴 액션은 Settings 의
   * 해당 탭으로 라우팅. caller 가 setSettingsTab + setSettingsOpen 묶음
   * 처리 함수를 제공. */
  openSettingsTab: (tab: 'general' | 'ai' | 'shortcuts' | 'about') => void;
  setPageSetupOpen: Dispatch<SetStateAction<boolean>>;
  setHfOpen: Dispatch<SetStateAction<boolean>>;
  setBookmarkOpen: Dispatch<SetStateAction<boolean>>;
  setFootnoteOpen: Dispatch<SetStateAction<boolean>>;
  setStyleManagerOpen: Dispatch<SetStateAction<boolean>>;
  setEquationOpen: Dispatch<SetStateAction<boolean>>;
  setShapeOpen: Dispatch<SetStateAction<boolean>>;
  setPicturePropsOpen: Dispatch<SetStateAction<boolean>>;
  setShowRuler: Dispatch<SetStateAction<boolean>>;
  setVersionHistoryOpen: Dispatch<SetStateAction<boolean>>;
}

export function useDispatchMenuAction(
  opts: UseDispatchMenuActionOptions,
): (action: MenuAction) => void {
  const {
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
  } = opts;

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
      } else if (action === 'file:export-pdf') {
        // chunk 59 — same HTML pipeline as export-html, but main runs it
        // through Chrome's printToPDF instead of writing the source.
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
      } else if (action === 'edit:undo') {
        handle?.undo();
      } else if (action === 'edit:redo') {
        handle?.redo();
      } else if (
        action === 'edit:copy' ||
        action === 'edit:cut' ||
        action === 'edit:paste'
      ) {
        // Studio 에디터(가운데)가 활성일 때만 IR clipboard 사용,
        // 그 외(폴더 트리, 채팅, 입력창 등)에서는 표준 DOM clipboard로
        // 라우팅. activeElement가 [data-studio-pane]의 자손이면 Studio
        // 활성으로 본다 (Studio mousedown 시 scrollRef가 focus를 받음).
        const ae = document.activeElement;
        const inStudio = !!(
          ae && (ae as HTMLElement).closest?.('[data-studio-pane]')
        );
        if (inStudio) {
          if (action === 'edit:copy') void handle?.copy();
          else if (action === 'edit:cut') void handle?.cut();
          else void handle?.paste();
        } else {
          // document.execCommand는 deprecated이지만 input/textarea/일반
          // selection 모두에 대해 활성 element 기준으로 동작 — Electron
          // 에서 가장 호환성 좋은 fallback. 표준 Clipboard API는 paste 시
          // 권한 프롬프트가 필요해 적합하지 않다.
          const op =
            action === 'edit:copy'
              ? 'copy'
              : action === 'edit:cut'
                ? 'cut'
                : 'paste';
          try {
            document.execCommand(op);
          } catch {
            /* swallow — best-effort fallback */
          }
        }
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
      } else if (action === 'view:about') {
        openSettingsTab('about');
      } else if (action === 'view:page-setup') {
        setPageSetupOpen(true);
      } else if (action === 'insert:header-footer') {
        setHfOpen(true);
      } else if (action === 'insert:bookmark') {
        setBookmarkOpen(true);
      } else if (action === 'insert:footnote') {
        setFootnoteOpen(true);
      } else if (action === 'delete:footnote-at-cursor') {
        // 0.4.25 — lib 0.7.11. getFootnoteAtCursor → deleteFootnote.
        const v = activeViewerRef();
        if (!v) return;
        const caret = v.irGetCaretPosition() as {
          sectionIndex?: number;
          paragraphIndex?: number;
          charOffset?: number;
        } | null;
        if (!caret) return;
        const sec = caret.sectionIndex ?? 0;
        const para = caret.paragraphIndex ?? 0;
        const off = caret.charOffset ?? 0;
        const info = v.irGetFootnoteAtCursor(sec, para, off, 'backward') as {
          controlIdx?: number;
          paragraphIdx?: number;
        } | null;
        if (!info || typeof info.controlIdx !== 'number') return;
        v.irDeleteFootnote(sec, info.paragraphIdx ?? para, info.controlIdx);
      } else if (action === 'view:style-manager') {
        setStyleManagerOpen(true);
      } else if (action === 'insert:equation') {
        setEquationOpen(true);
      } else if (action === 'insert:shape') {
        setShapeOpen(true);
      } else if (action === 'view:picture-props') {
        setPicturePropsOpen(true);
      } else if (action === 'view:toggle-ruler') {
        setShowRuler((v) => !v);
      } else if (action === 'view:version-history') {
        setVersionHistoryOpen(true);
      } else if (action === 'app:new-window') {
        void window.api.newWindow();
      }
    },
    [
      activeTab?.path,
      activeViewerRef,
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
    ],
  );

  useEffect(() => {
    return window.api.onMenuAction(dispatchMenuAction);
  }, [dispatchMenuAction]);

  return dispatchMenuAction;
}
