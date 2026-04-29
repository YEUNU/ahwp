import { useCallback, useEffect, useRef, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { MenuAction, PingResponse } from '@shared/api';
import { correctExtension } from '@shared/format';
import { FileList } from '@/features/files/FileList';
import { StudioViewer } from '@/features/studio/StudioViewer';
import type { ViewerHandle } from '@/features/studio/types';
import { ThemeToggle } from './theme-toggle';

export default function AppShell() {
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
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

  // Workspace restoration: on first mount, auto-open the last active file.
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    void (async () => {
      const session = await window.api.session.get();
      if (!session.lastActivePath) return;
      const result = await window.api.file.openByPath(session.lastActivePath);
      if (result) {
        setActivePath(result.path);
        setRefreshTick((n) => n + 1);
      } else {
        // Stale path (file moved/deleted). Clear so next launch starts blank.
        await window.api.session.set({ lastActivePath: null });
      }
    })();
  }, []);

  // Persist activePath whenever it changes (after restoration ran once).
  useEffect(() => {
    if (!sessionRestoredRef.current) return;
    void window.api.session.set({ lastActivePath: activePath });
  }, [activePath]);

  const openFromDialog = useCallback(async () => {
    const result = await window.api.file.open();
    if (result) {
      setActivePath(result.path);
      setRefreshTick((n) => n + 1);
    }
  }, []);

  const openByPath = useCallback(async (path: string) => {
    const result = await window.api.file.openByPath(path);
    if (result) {
      setActivePath(result.path);
      setRefreshTick((n) => n + 1);
    }
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
        setRefreshTick((n) => n + 1);
      }
    } else {
      const result = await window.api.file.saveAs({ bytes });
      if (result) {
        setActivePath(result.path);
        setRefreshTick((n) => n + 1);
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
      setRefreshTick((n) => n + 1);
    }
  }, [activePath, exportBytes]);

  useEffect(() => {
    return window.api.onMenuAction((action: MenuAction) => {
      if (action === 'file:open') {
        void openFromDialog();
      } else if (action === 'file:save') {
        void saveCurrent();
      } else if (action === 'file:save-as') {
        void saveAsCurrent();
      }
      // file:new / view:settings handled in later phases.
    });
  }, [openFromDialog, saveCurrent, saveAsCurrent]);

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
          <div className="flex h-12 items-center justify-between border-b border-border px-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              파일
            </h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <FileList
              key={refreshTick}
              activePath={activePath}
              onOpenPath={openByPath}
            />
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
                  메뉴 → 파일 → 열기 또는 좌측 패널에 파일을 끌어 놓으세요.
                </p>
                <div className="mt-6 w-full max-w-lg rounded-lg border border-border bg-card p-4 text-xs">
                  <div className="mb-2 font-mono text-muted-foreground">
                    ipc:ping
                  </div>
                  {pingError ? (
                    <pre className="text-destructive">{pingError}</pre>
                  ) : pingResult ? (
                    <pre className="text-emerald-500 dark:text-emerald-400">
                      {JSON.stringify(pingResult, null, 2)}
                    </pre>
                  ) : (
                    <span className="text-muted-foreground">호출 중…</span>
                  )}
                </div>
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
