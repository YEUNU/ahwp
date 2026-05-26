/**
 * `useSaveFlow` — Phase R3 (2차) refactor (REFACTORING_PLAN.md).
 *
 * AppShell.tsx 의 file open / new / save / saveAs / folder open
 * 흐름을 hook 으로 분해. 외부 동작 1:1 동일 — chunk 52 autosave
 * draft clear / chunk 62 version snapshot / .hwpx → .hwp 자동
 * 라우팅 + notice 모두 보존.
 */
import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { correctExtension } from '@shared/format';
import { isEditable, isReadable } from '@shared/file-formats';
import type { ViewerHandle } from '@/features/chat/viewer-handle-types';
import type { TabState } from './useTabManagement';

export interface UseSaveFlowOptions {
  activeTab: TabState | null;
  activeViewerRef: () => ViewerHandle | null;
  openTab: (path: string) => void;
  replaceTabPath: (oldPath: string, newPath: string) => void;
  setFolderRoot: Dispatch<SetStateAction<string | null>>;
  showNotice: (text: string, kind?: 'info' | 'warn') => void;
  /**
   * Phase 7 E2c — `useRhwpEditor` 모드 등에서 활성 탭의 bytes 를 viewer
   * 대신 다른 경로로 얻고 싶을 때. non-null 반환 시 viewer.exportBytes
   * 를 건너뜀. AppShell 의 RhwpEditorHandle.exportHwp() 가 hook 으로
   * 들어온다.
   */
  exportOverride?: () => Promise<Uint8Array | null>;
}

export interface SaveFlowHandle {
  openFromDialog: () => Promise<void>;
  /** 0.6.2 — returns `true` 면 새 editable 탭이 mount 됨 (또는 이미 mount).
   *  PDF/DOCX 같은 readable-only 는 OS 위임 후 `false` (탭 아님).
   *  Unknown 확장자도 `false`. AI 의 switchTargetDoc auto-open 흐름이 이
   *  값을 신뢰. */
  openByPath: (path: string) => Promise<boolean>;
  newDocument: () => Promise<void>;
  openFolder: () => Promise<void>;
  exportBytes: () => Promise<Uint8Array | null>;
  saveCurrent: () => Promise<void>;
  saveAsCurrent: () => Promise<void>;
}

export function useSaveFlow(opts: UseSaveFlowOptions): SaveFlowHandle {
  const {
    activeTab,
    activeViewerRef,
    openTab,
    replaceTabPath,
    setFolderRoot,
    showNotice,
    exportOverride,
  } = opts;

  const openFromDialog = useCallback(async () => {
    const result = await window.api.file.open();
    if (result) openTab(result.path);
  }, [openTab]);

  const openByPath = useCallback(
    async (path: string): Promise<boolean> => {
      // 0.6.0 — editable (.hwp/.hwpx) 만 탭으로 mount. PDF / DOCX / Excel /
      // 등 readable-but-non-editable 은 OS 기본 앱으로 위임 (사용자가 트리
      // 에서 클릭했을 때 자연스러운 동작 — read-only viewer 미제공).
      //
      // 0.6.2 — boolean 반환. true = editable 탭이 열림 (또는 이미 열려있음
      // — file:open-by-path 가 중복 호출에도 동일 path 를 돌려주므로 동등).
      // false = readable-only OS 위임 / unknown / open 실패.
      if (isEditable(path)) {
        const result = await window.api.file.openByPath(path);
        if (!result) return false;
        openTab(result.path);
        return true;
      }
      if (isReadable(path)) {
        // shell.openPath — 성공 시 빈 문자열, fail 시 에러 메시지. 사용자
        // 에게 보일 만한 문구가 있으면 notice 로 노출.
        const err = await window.api.file.openExternal(path);
        if (err) showNotice(`외부 앱에서 열기 실패: ${err}`, 'warn');
        return false; // 탭이 mount 된 게 아니므로 false
      }
      // Unknown / non-readable — silently no-op (binary / unknown 확장자).
      return false;
    },
    [openTab, showNotice],
  );

  const newDocument = useCallback(async () => {
    const result = await window.api.file.new();
    openTab(result.path);
  }, [openTab]);

  const openFolder = useCallback(async () => {
    const picked = await window.api.folder.pick();
    if (picked) setFolderRoot(picked);
  }, [setFolderRoot]);

  const exportBytes = useCallback(async (): Promise<Uint8Array | null> => {
    // Phase E2c — override 가 non-null 반환하면 viewer 경유 X.
    if (exportOverride) {
      const t0 = performance.now();
      const bytes = await exportOverride();
      if (bytes) {
        console.info(
          `[ahwp] export(rhwp) ${(bytes.byteLength / 1024 / 1024).toFixed(2)}MB in ${(performance.now() - t0).toFixed(0)}ms`,
        );
        return bytes;
      }
      // override 가 null 반환 — viewer fallback.
    }
    const handle = activeViewerRef();
    if (!handle) return null;
    const t0 = performance.now();
    const bytes = await handle.exportBytes();
    console.info(
      `[ahwp] export ${(bytes.byteLength / 1024 / 1024).toFixed(2)}MB in ${(performance.now() - t0).toFixed(0)}ms`,
    );
    return bytes;
  }, [activeViewerRef, exportOverride]);

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
      void window.api.file.createVersion({ path: result.path, bytes });
      if (result.routedFrom) {
        showNotice(
          `'.hwpx' 저장은 라이브러리 한계로 일시 비활성화되어 있어 ${result.path.split(/[\\/]/).pop()} 로 저장했습니다.`,
          'warn',
        );
      }
    }
  }, [activeTab, exportBytes, replaceTabPath, openTab, showNotice]);

  const saveCurrent = useCallback(async () => {
    const tab = activeTab;
    if (!tab) return;
    // chunk 78 — `file:new` writes the scratch buffer to `userData/temp/
    // new-<timestamp>.hwp`. Saving that path silently keeps the doc
    // hidden in temp where the user can't find it later. Detect the
    // temp scratch path and route to Save As so the user picks a real
    // location. Same probe AppShell's autosave uses.
    const isScratch =
      tab.path.includes('/temp/new-') || tab.path.includes('\\temp\\new-');
    if (isScratch) {
      await saveAsCurrent();
      return;
    }
    const bytes = await exportBytes();
    if (!bytes) return;
    const result = await window.api.file.save({ path: tab.path, bytes });
    if (result.path !== tab.path) replaceTabPath(tab.path, result.path);
    // chunk 52 — explicit save invalidates the auto-save draft.
    void window.api.file.clearDraft(tab.path);
    if (result.path !== tab.path) {
      void window.api.file.clearDraft(result.path);
    }
    // chunk 62 — every explicit save spawns a version snapshot under
    // userData/versions/<hash>/<ISO>.hwp. FIFO trim at 50.
    void window.api.file.createVersion({ path: result.path, bytes });
    if (result.routedFrom) {
      // The user requested .hwpx but @rhwp/core's HWPX round-trip drops
      // images (KNOWN_ISSUES L-001), so file:save auto-routes to .hwp.
      // Tell them so they don't go looking for a missing .hwpx.
      showNotice(
        `'.hwpx' 저장은 라이브러리 한계로 일시 비활성화되어 있어 ${result.path.split(/[\\/]/).pop()} 로 저장했습니다.`,
        'warn',
      );
    }
  }, [activeTab, exportBytes, replaceTabPath, saveAsCurrent, showNotice]);

  return {
    openFromDialog,
    openByPath,
    newDocument,
    openFolder,
    exportBytes,
    saveCurrent,
    saveAsCurrent,
  };
}
