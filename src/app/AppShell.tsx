import { useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { PingResponse } from '@shared/api';

export default function AppShell() {
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [pingError, setPingError] = useState<string | null>(null);

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

  return (
    <PanelGroup
      direction="horizontal"
      autoSaveId="ahwp:shell"
      className="h-screen"
    >
      <Panel
        id="files"
        order={1}
        defaultSize={18}
        minSize={12}
        maxSize={40}
        className="bg-zinc-950 text-zinc-200"
      >
        <aside className="h-full overflow-auto p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            파일
          </h2>
          <p className="text-xs text-zinc-500">아직 열린 파일이 없습니다.</p>
        </aside>
      </Panel>

      <PanelResizeHandle className="w-px bg-zinc-800 transition-colors hover:bg-zinc-700 data-[resize-handle-state=drag]:bg-zinc-600" />

      <Panel id="editor" order={2} defaultSize={56} minSize={30}>
        <main className="flex h-full flex-col bg-zinc-900 text-zinc-100">
          <div className="border-b border-zinc-800 px-6 py-3 text-sm text-zinc-400">
            ahwp · Phase 1-A 레이아웃
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-auto p-8">
            <h1 className="text-2xl font-semibold">Hello, ahwp</h1>
            <p className="text-sm text-zinc-400">
              Electron + Vite + React + TypeScript 부트스트랩이 동작합니다.
            </p>

            <div className="mt-6 w-full max-w-lg rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs">
              <div className="mb-2 font-mono text-zinc-500">ipc:ping</div>
              {pingError ? (
                <pre className="text-red-400">{pingError}</pre>
              ) : pingResult ? (
                <pre className="text-emerald-400">
                  {JSON.stringify(pingResult, null, 2)}
                </pre>
              ) : (
                <span className="text-zinc-600">호출 중…</span>
              )}
            </div>
          </div>
        </main>
      </Panel>

      <PanelResizeHandle className="w-px bg-zinc-800 transition-colors hover:bg-zinc-700 data-[resize-handle-state=drag]:bg-zinc-600" />

      <Panel
        id="chat"
        order={3}
        defaultSize={26}
        minSize={18}
        maxSize={50}
        className="bg-zinc-950 text-zinc-200"
      >
        <aside className="h-full overflow-auto p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
            챗봇
          </h2>
          <p className="text-xs text-zinc-500">Phase 2에서 활성화됩니다.</p>
        </aside>
      </Panel>
    </PanelGroup>
  );
}
