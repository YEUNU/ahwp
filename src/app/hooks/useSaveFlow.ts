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
import type { ViewerHandle } from '@/features/studio/types';
import type { TabState } from './useTabManagement';

export interface UseSaveFlowOptions {
  activeTab: TabState | null;
  activeViewerRef: () => ViewerHandle | null;
  openTab: (path: string) => void;
  replaceTabPath: (oldPath: string, newPath: string) => void;
  setFolderRoot: Dispatch<SetStateAction<string | null>>;
  showNotice: (text: string, kind?: 'info' | 'warn') => void;
}

export interface SaveFlowHandle {
  openFromDialog: () => Promise<void>;
  openByPath: (path: string) => Promise<void>;
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
  } = opts;

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
  }, [setFolderRoot]);

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
