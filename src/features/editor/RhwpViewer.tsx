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
 * Mounts @rhwp/editor (iframe → https://edwardkim.github.io/rhwp/) once and
 * reuses it across path changes — only `loadFile` is re-run when `path`
 * changes. This avoids the iframe + WASM cold-start cost on every file open.
 *
 * Two effects:
 *   1. Editor lifecycle (deps []): create iframe + WASM once on mount, destroy
 *      on unmount. StrictMode dev double-invoke is safe via local `editor`
 *      closure — the orphaned async chain self-destroys when its `cancelled`
 *      flag flips.
 *   2. File loading (deps [path, editorReady]): wait for editor, read bytes,
 *      call loadFile.
 */
export const RhwpViewer = forwardRef<RhwpViewerHandle, RhwpViewerProps>(
  function RhwpViewer({ path }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<RhwpEditor | null>(null);
    const [editorReady, setEditorReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [phase, setPhase] = useState<'mounting' | 'reading' | 'ready'>(
      'mounting',
    );

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

    // Effect 1: editor lifecycle. Mount once, destroy on unmount.
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      let cancelled = false;
      let local: RhwpEditor | null = null;

      (async () => {
        try {
          const t0 = performance.now();
          const created = await createEditor(container);
          if (cancelled) {
            created.destroy();
            return;
          }
          patchPrototype(created);
          local = created;
          editorRef.current = created;
          setEditorReady(true);
          console.info(
            `[rhwp] iframe ready in ${(performance.now() - t0).toFixed(0)} ms`,
          );
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })();

      return () => {
        cancelled = true;
        local?.destroy();
        if (editorRef.current === local) editorRef.current = null;
        setEditorReady(false);
        while (container.firstChild)
          container.removeChild(container.firstChild);
      };
    }, []);

    // Effect 2: load file when path changes (waits for editor to be ready).
    useEffect(() => {
      if (!editorReady) return;
      const editor = editorRef.current;
      if (!editor) return;

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

          // v0.7.8 quirk: editor.loadFile()'s postMessage response often does
          // NOT arrive back to our promise even though the iframe completes
          // initDoc fully (we see [WasmBridge]/[CanvasView]/[initDoc 8. 완료]
          // logs but no resolve). The iframe shows its own toolbar/canvas UI
          // as soon as it's ready, so we hand off the bytes and immediately
          // drop our overlay; iframe handles visual progress from here.
          // We still track the promise in the background to surface errors.
          const fileName = path.split(/[/\\]/).pop() ?? 'document';
          const t1 = performance.now();
          editor.loadFile(buffer, fileName).then(
            () =>
              console.info(
                `[rhwp] loadFile resolved in ${(performance.now() - t1).toFixed(0)} ms`,
              ),
            (err) => {
              console.warn('[rhwp] loadFile rejected:', err);
              if (!cancelled) {
                setError(err instanceof Error ? err.message : String(err));
              }
            },
          );
          setPhase('ready');
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [path, editorReady]);

    return (
      <div className="relative h-full w-full">
        <div ref={containerRef} className="h-full w-full" />
        {phase !== 'ready' && !error && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/60 backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {phase === 'mounting' ? '에디터 초기화 중…' : '파일 읽는 중…'}
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
