/**
 * `useDispatchMenuAction` — Phase R3 refactor (REFACTORING_PLAN.md).
 *
 * AppShell.tsx 의 `dispatchMenuAction` (네이티브 메뉴 + 명령 팔레트
 * 공통 entry point) 와 그 IPC 등록 effect 를 hook 으로 분해.
 *
 * 0.7.45 — 편집/서식/내보내기 액션은 모두 (이미 제거된) 자체 StudioViewer
 * 핸들로 dispatch 되어 no-op 이었으므로 제거. 편집 UI 는 rhwp-studio
 * iframe 이 자체 메뉴/툴바/단축키로 제공한다. 남은 액션은 파일 작업 +
 * 클립보드 fallback + 설정/정보 + 새 창.
 */
import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MenuAction } from '@shared/api';

export interface UseDispatchMenuActionOptions {
  newDocument: () => Promise<void> | void;
  openFromDialog: () => Promise<void> | void;
  saveCurrent: () => Promise<void> | void;
  saveAsCurrent: () => Promise<void> | void;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  /** UI/UX align — view:about 메뉴 액션은 Settings 의 해당 탭으로 라우팅.
   * caller 가 setSettingsTab + setSettingsOpen 묶음 처리 함수를 제공. */
  openSettingsTab: (tab: 'general' | 'ai' | 'shortcuts' | 'about') => void;
}

export function useDispatchMenuAction(
  opts: UseDispatchMenuActionOptions,
): (action: MenuAction) => void {
  const {
    newDocument,
    openFromDialog,
    saveCurrent,
    saveAsCurrent,
    setSettingsOpen,
    openSettingsTab,
  } = opts;

  const dispatchMenuAction = useCallback(
    (action: MenuAction): void => {
      if (action === 'file:new') {
        void newDocument();
      } else if (action === 'file:open') {
        void openFromDialog();
      } else if (action === 'file:save') {
        void saveCurrent();
      } else if (action === 'file:save-as') {
        void saveAsCurrent();
      } else if (
        action === 'edit:copy' ||
        action === 'edit:cut' ||
        action === 'edit:paste'
      ) {
        // document.execCommand는 deprecated이지만 input/textarea/일반
        // selection 모두에 대해 활성 element 기준으로 동작 — Electron
        // 에서 가장 호환성 좋은 fallback. 표준 Clipboard API는 paste 시
        // 권한 프롬프트가 필요해 적합하지 않다. (가운데 에디터는
        // rhwp-studio iframe 이라 ⌘C/X/V 를 자체 처리한다.)
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
      } else if (action === 'view:settings') {
        setSettingsOpen(true);
      } else if (action === 'view:about') {
        openSettingsTab('about');
      } else if (action === 'app:new-window') {
        void window.api.newWindow();
      }
    },
    [
      newDocument,
      openFromDialog,
      saveCurrent,
      saveAsCurrent,
      setSettingsOpen,
      openSettingsTab,
    ],
  );

  useEffect(() => {
    return window.api.onMenuAction(dispatchMenuAction);
  }, [dispatchMenuAction]);

  return dispatchMenuAction;
}
