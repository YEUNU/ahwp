import { useEffect, useState } from 'react';
import type { PingResponse } from '@shared/api';

export default function App() {
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
    <div className="grid h-screen grid-cols-[260px_1fr_360px]">
      <aside className="border-r border-zinc-800 bg-zinc-950 p-4 text-zinc-200">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          파일
        </h2>
        <p className="text-xs text-zinc-500">아직 열린 파일이 없습니다.</p>
      </aside>

      <main className="flex flex-col bg-zinc-900 text-zinc-100">
        <div className="border-b border-zinc-800 px-6 py-3 text-sm text-zinc-400">
          ahwp · Phase 0 부트스트랩
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
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

      <aside className="border-l border-zinc-800 bg-zinc-950 p-4 text-zinc-200">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-400">
          챗봇
        </h2>
        <p className="text-xs text-zinc-500">Phase 2에서 활성화됩니다.</p>
      </aside>
    </div>
  );
}
