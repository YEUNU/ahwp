import { createEditor, type RhwpEditor } from '@rhwp/editor';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface RhwpViewerProps {
  path: string;
}

/**
 * Mounts @rhwp/editor (iframe → https://edwardkim.github.io/rhwp/) and loads
 * the file at `path` via file:read IPC. Each path change destroys + remounts
 * the editor; that's wasteful but avoids stale state in the iframe protocol
 * until @rhwp/editor exposes a "clear" method.
 */
export function RhwpViewer({ path }: RhwpViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'reading' | 'mounting' | 'ready'>(
    'reading',
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let editor: RhwpEditor | null = null;

    (async () => {
      try {
        setError(null);
        setPhase('reading');
        const buffer = await window.api.file.read(path);
        if (cancelled) return;

        setPhase('mounting');
        editor = await createEditor(container);
        if (cancelled) {
          editor.destroy();
          return;
        }

        const fileName = path.split(/[/\\]/).pop() ?? 'document';
        await editor.loadFile(buffer, fileName);
        if (cancelled) {
          editor.destroy();
          return;
        }
        setPhase('ready');
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
        editor?.destroy();
      }
    })();

    return () => {
      cancelled = true;
      editor?.destroy();
      // Clear the iframe slot so the next mount starts fresh.
      while (container.firstChild) container.removeChild(container.firstChild);
    };
  }, [path]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {phase !== 'ready' && !error && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-sm">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            {phase === 'reading' ? '파일 읽는 중…' : '에디터 초기화 중…'}
          </span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 px-6 text-center">
          <AlertTriangle className="size-8 text-destructive" />
          <div className="text-sm font-medium">파일을 열지 못했습니다</div>
          <pre className="max-w-md whitespace-pre-wrap text-xs text-muted-foreground">
            {error}
          </pre>
        </div>
      )}
    </div>
  );
}
