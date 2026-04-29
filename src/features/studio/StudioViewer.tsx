import { AlertTriangle, Loader2 } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { RhwpViewerHandle } from '@/features/editor/RhwpViewer';
import { ensureRhwpCore, HwpDocument, HwpViewer } from '@/lib/rhwp-core';

interface StudioViewerProps {
  path: string;
}

type Phase = 'mounting' | 'reading' | 'rendering' | 'ready';

type RhwpDoc = InstanceType<typeof HwpDocument>;
type RhwpView = InstanceType<typeof HwpViewer>;

/**
 * Studio migration chunk 2 — read-only first-page POC.
 *
 * Replaces `@rhwp/editor` (iframe) with direct `@rhwp/core` (WASM) calls.
 * Currently renders ONLY page 0 statically; multi-page + scroll + zoom land
 * in chunk 3, input/edit in chunk 4. See docs/STUDIO_MIGRATION.md.
 *
 * Toggled by `localStorage.setItem('ahwp:use-studio', '1')` in AppShell —
 * default still uses the iframe wrapper so we have a fallback during
 * migration (decision #3).
 */
export const StudioViewer = forwardRef<RhwpViewerHandle, StudioViewerProps>(
  function StudioViewer({ path }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const docRef = useRef<RhwpDoc | null>(null);
    const viewerRef = useRef<RhwpView | null>(null);
    const [phase, setPhase] = useState<Phase>('mounting');
    const [error, setError] = useState<string | null>(null);
    const [pageCount, setPageCount] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        exportBytes: async () => {
          if (!docRef.current) throw new Error('Document not loaded');
          return docRef.current.exportHwpx();
        },
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let cancelled = false;
      let localDoc: RhwpDoc | null = null;
      let localViewer: RhwpView | null = null;

      (async () => {
        try {
          setError(null);
          setPhase('mounting');
          await ensureRhwpCore();
          if (cancelled) return;

          setPhase('reading');
          const tRead = performance.now();
          const buffer = await window.api.file.read(path);
          if (cancelled) return;
          console.info(
            `[studio] read ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB in ${(performance.now() - tRead).toFixed(0)} ms`,
          );

          setPhase('rendering');
          const tParse = performance.now();
          localDoc = new HwpDocument(new Uint8Array(buffer));
          localViewer = new HwpViewer(localDoc);
          const total = localViewer.pageCount();
          const svg = localViewer.renderPageSvg(0);
          console.info(
            `[studio] parse + render page 0 in ${(performance.now() - tParse).toFixed(0)} ms (${total} pages)`,
          );

          if (cancelled) {
            localViewer.free();
            localDoc.free();
            return;
          }

          docRef.current = localDoc;
          viewerRef.current = localViewer;
          setPageCount(total);
          container.innerHTML = svg;
          setPhase('ready');
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
          localViewer?.free();
          localDoc?.free();
        }
      })();

      return () => {
        cancelled = true;
        // Free in reverse construction order. HwpViewer holds a reference to
        // HwpDocument; freeing the doc first would leave the viewer with a
        // dangling pointer.
        viewerRef.current?.free();
        docRef.current?.free();
        viewerRef.current = null;
        docRef.current = null;
        if (container) container.innerHTML = '';
      };
    }, [path]);

    return (
      <div className="relative h-full w-full overflow-auto bg-muted/30">
        <div
          ref={containerRef}
          data-testid="studio-viewer-page"
          className="mx-auto my-4 bg-background shadow-md [&>svg]:block"
        />
        {phase !== 'ready' && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {phase === 'mounting' && '@rhwp/core 초기화 중…'}
              {phase === 'reading' && '파일 읽는 중…'}
              {phase === 'rendering' && '문서 파싱 중…'}
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
        {phase === 'ready' && pageCount > 1 && (
          <div className="pointer-events-none absolute right-4 top-4 rounded bg-background/80 px-2 py-1 text-xs text-muted-foreground">
            1 / {pageCount} (chunk 2: 첫 페이지만 — 다중 페이지는 chunk 3)
          </div>
        )}
      </div>
    );
  },
);
