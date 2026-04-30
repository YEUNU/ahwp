import { FolderInput } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { MenuAction, PingResponse } from '@shared/api';
import { correctExtension } from '@shared/format';
import { FolderTree } from '@/features/files/FolderTree';
import { StudioViewer } from '@/features/studio/StudioViewer';
import type { ViewerHandle } from '@/features/studio/types';
import { ThemeToggle } from './theme-toggle';

export default function AppShell() {
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [folderRoot, setFolderRoot] = useState<string | null>(null);
  const viewerRef = useRef<ViewerHandle | null>(null);
  const sessionRestoredRef = useRef(false);

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

  // Workspace restoration: on first mount, auto-open the last active file
  // and (separately) the last folder root.
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    void (async () => {
      const session = await window.api.session.get();
      if (session.lastFolderPath) {
        // Verify the folder still exists by listing it; fs throws on
        // missing dirs but folder.list returns [] on error. We also pick
        // up the case where the user's last folder was on an unmounted
        // drive — set the root anyway and let FolderTree show "비어 있음".
        setFolderRoot(session.lastFolderPath);
      }
      if (session.lastActivePath) {
        const result = await window.api.file.openByPath(session.lastActivePath);
        if (result) {
          setActivePath(result.path);
        } else {
          await window.api.session.set({ lastActivePath: null });
        }
      }
    })();
  }, []);

  // Persist active path + folder root whenever either changes (after
  // restoration ran once).
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    void window.api.session.set({
      lastActivePath: activePath,
      lastFolderPath: folderRoot,
    });
  }, [activePath, folderRoot]);

  const openFromDialog = useCallback(async () => {
    const result = await window.api.file.open();
    if (result) {
      setActivePath(result.path);
    }
  }, []);

  const openByPath = useCallback(async (path: string) => {
    const result = await window.api.file.openByPath(path);
    if (result) {
      setActivePath(result.path);
    }
  }, []);

  const newDocument = useCallback(async () => {
    const result = await window.api.file.new();
    setActivePath(result.path);
  }, []);

  const openFolder = useCallback(async () => {
    const picked = await window.api.folder.pick();
    if (picked) setFolderRoot(picked);
  }, []);

  const exportBytes = useCallback(async (): Promise<Uint8Array | null> => {
    if (!viewerRef.current) return null;
    const t0 = performance.now();
    const bytes = await viewerRef.current.exportBytes();
    console.info(
      `[ahwp] export ${(bytes.byteLength / 1024 / 1024).toFixed(2)}MB in ${(performance.now() - t0).toFixed(0)}ms`,
    );
    return bytes;
  }, []);

  // Save flow trusts the main process to normalize via @rhwp/core and route
  // the on-disk extension to .hwpx. Renderer just hands over bytes and
  // updates activePath if the server changed it (e.g., .hwp → .hwpx).
  const saveCurrent = useCallback(async () => {
    const bytes = await exportBytes();
    if (!bytes) return;
    if (activePath) {
      const result = await window.api.file.save({ path: activePath, bytes });
      if (result.path !== activePath) {
        setActivePath(result.path);
      }
    } else {
      const result = await window.api.file.saveAs({ bytes });
      if (result) {
        setActivePath(result.path);
      }
    }
  }, [activePath, exportBytes]);

  const saveAsCurrent = useCallback(async () => {
    const bytes = await exportBytes();
    if (!bytes) return;
    // Suggest a sensible default path (.hwpx) for the dialog. Server will
    // also enforce .hwpx on the result.
    const defaultPath = activePath
      ? correctExtension(activePath, 'hwpx')
      : undefined;
    const result = await window.api.file.saveAs({ bytes, defaultPath });
    if (result) {
      setActivePath(result.path);
    }
  }, [activePath, exportBytes]);

  useEffect(() => {
    return window.api.onMenuAction((action: MenuAction) => {
      if (action === 'file:new') {
        void newDocument();
      } else if (action === 'file:open') {
        void openFromDialog();
      } else if (action === 'file:save') {
        void saveCurrent();
      } else if (action === 'file:save-as') {
        void saveAsCurrent();
      } else if (action === 'edit:undo') {
        viewerRef.current?.undo();
      } else if (action === 'edit:redo') {
        viewerRef.current?.redo();
      } else if (action === 'edit:copy') {
        void viewerRef.current?.copy();
      } else if (action === 'edit:cut') {
        void viewerRef.current?.cut();
      } else if (action === 'edit:paste') {
        void viewerRef.current?.paste();
      } else if (action === 'edit:find') {
        viewerRef.current?.openFind();
      } else if (
        action === 'format:bold' ||
        action === 'format:italic' ||
        action === 'format:underline'
      ) {
        const key = action.split(':')[1] as 'bold' | 'italic' | 'underline';
        viewerRef.current?.toggleCharFormat(key);
      }
      // view:settings handled in later phases.
    });
  }, [newDocument, openFromDialog, saveCurrent, saveAsCurrent]);

  return (
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
                activePath={activePath}
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
              {activePath ?? 'ahwp · Phase 1-C'}
            </span>
            <ThemeToggle />
          </div>
          <div className="flex-1 overflow-hidden">
            {activePath ? (
              <StudioViewer path={activePath} ref={viewerRef} />
            ) : (
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
          <div className="flex-1 overflow-auto p-4">
            <p className="text-xs text-muted-foreground">
              Phase 2에서 활성화됩니다.
            </p>
          </div>
        </aside>
      </Panel>
    </PanelGroup>
  );
}
