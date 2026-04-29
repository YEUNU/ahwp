import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { MenuAction, PingResponse } from '@shared/api';
import { ThemeToggle } from './theme-toggle';

export default function AppShell() {
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);
  const [lastMenuAction, setLastMenuAction] = useState<MenuAction | null>(null);

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

  useEffect(() => {
    return window.api.onMenuAction((action) => {
      setLastMenuAction(action);
    });
  }, []);

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
          <div className="flex h-12 items-center border-b border-border px-4">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              파일
            </h2>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <p className="text-xs text-muted-foreground">
              아직 열린 파일이 없습니다.
            </p>
          </div>
        </aside>
      </Panel>

      <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-ring data-[resize-handle-state=drag]:bg-ring" />

      <Panel id="editor" order={2} defaultSize={56} minSize={30}>
        <main className="flex h-full flex-col">
          <div className="flex h-12 items-center justify-between border-b border-border px-6">
            <span className="text-sm text-muted-foreground">
              ahwp · Phase 1-A 레이아웃
            </span>
            <ThemeToggle />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-8">
            <h1 className="text-2xl font-semibold">Hello, ahwp</h1>
            <p className="text-sm text-muted-foreground">
              Electron + Vite + React + TypeScript 부트스트랩이 동작합니다.
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

            <div className="w-full max-w-lg rounded-lg border border-border bg-card p-4 text-xs">
              <div className="mb-2 font-mono text-muted-foreground">
                menu:action
              </div>
              <span className="text-muted-foreground">
                {lastMenuAction ?? '아직 메뉴 액션을 받지 않았습니다.'}
              </span>
            </div>
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
