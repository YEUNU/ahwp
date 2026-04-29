import { createEditor } from '@rhwp/editor';
import type { RhwpEditor } from '@rhwp/editor';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';

interface RhwpViewerProps {
  path: string;
}

export interface RhwpViewerHandle {
  /** Returns the current document as bytes via editor.exportHwp(). */
  exportBytes: () => Promise<Uint8Array>;
}

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * @rhwp/editor v0.7.8 quirks we work around:
 *  1. d.ts claims `export class RhwpEditor` but the actual ESM only exports
 *     `createEditor`. We patch the prototype via the first instance instead.
 *  2. `_request` hardcodes a 10-second timeout (line 105 of index.js). For
 *     multi-MB HWP files the WASM parser inside the iframe needs longer.
 *     Replaced with REQUEST_TIMEOUT_MS using a separate id space (>=1_000_000)
 *     so it never collides with the library's module-scoped requestId counter.
 */
const PATCHED = Symbol.for('ahwp.rhwp.patched');
let nextPatchedId = 1_000_000;

function patchPrototype(editor: RhwpEditor): void {
  const proto = Object.getPrototypeOf(editor) as Record<PropertyKey, unknown>;
  if (proto[PATCHED]) return;
  proto[PATCHED] = true;
  proto._request = function patchedRequest(
    this: {
      _iframe: HTMLIFrameElement;
      _pending: Map<
        number,
        { resolve: (v: unknown) => void; reject: (e: Error) => void }
      >;
    },
    method: string,
    params: unknown = {},
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++nextPatchedId;
      this._pending.set(id, { resolve, reject });
      this._iframe.contentWindow?.postMessage(
        { type: 'rhwp-request', id, method, params },
        '*',
      );
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          reject(
            new Error(
              `Request timeout (${REQUEST_TIMEOUT_MS / 1000}s): ${method}`,
            ),
          );
        }
      }, REQUEST_TIMEOUT_MS);
    });
  };
}

/**
 * Mounts @rhwp/editor (iframe → https://edwardkim.github.io/rhwp/) and loads
 * the file at `path` via file:read IPC. Parent triggers save by calling
 * `viewerRef.current.exportBytes()`.
 */
export const RhwpViewer = forwardRef<RhwpViewerHandle, RhwpViewerProps>(
  function RhwpViewer({ path }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<RhwpEditor | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [phase, setPhase] = useState<
      'reading' | 'mounting' | 'parsing' | 'ready'
    >('reading');

    useImperativeHandle(
      ref,
      () => ({
        exportBytes: async () => {
          if (!editorRef.current) {
            throw new Error('Editor not ready');
          }
          return editorRef.current.exportHwp();
        },
      }),
      [],
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let cancelled = false;

      (async () => {
        try {
          setError(null);

          setPhase('reading');
          const t0 = performance.now();
          const buffer = await window.api.file.read(path);
          if (cancelled) return;
          console.info(
            `[rhwp] read ${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB in ${(performance.now() - t0).toFixed(0)} ms`,
          );

          setPhase('mounting');
          const t1 = performance.now();
          const created = await createEditor(container);
          if (cancelled) {
            created.destroy();
            return;
          }
          patchPrototype(created);
          editorRef.current = created;
          console.info(
            `[rhwp] iframe ready in ${(performance.now() - t1).toFixed(0)} ms`,
          );

          setPhase('parsing');
          const t2 = performance.now();
          const fileName = path.split(/[/\\]/).pop() ?? 'document';
          await created.loadFile(buffer, fileName);
          if (cancelled) {
            created.destroy();
            editorRef.current = null;
            return;
          }
          console.info(
            `[rhwp] loadFile resolved in ${(performance.now() - t2).toFixed(0)} ms`,
          );

          setPhase('ready');
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
          editorRef.current?.destroy();
          editorRef.current = null;
        }
      })();

      return () => {
        cancelled = true;
        editorRef.current?.destroy();
        editorRef.current = null;
        while (container.firstChild)
          container.removeChild(container.firstChild);
      };
    }, [path]);

    return (
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />
        {phase !== 'ready' && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {phase === 'reading'
                ? '파일 읽는 중…'
                : phase === 'mounting'
                  ? '에디터 초기화 중…'
                  : '문서 파싱 중… (대용량 파일은 시간이 걸릴 수 있습니다)'}
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
  },
);
