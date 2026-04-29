import {
  AlertTriangle,
  Loader2,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import type { RhwpViewerHandle } from '@/features/editor/RhwpViewer';
import { ensureRhwpCore, HwpDocument } from '@/lib/rhwp-core';

interface StudioViewerProps {
  path: string;
}

type Phase = 'mounting' | 'reading' | 'rendering' | 'ready';

type RhwpDoc = InstanceType<typeof HwpDocument>;

interface PageDims {
  w: number;
  h: number;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;
const PAGE_GAP_PX = 16;
const PAGE_PADDING_PX = 32;

/** Parse <svg width="X" height="Y"> or fall back to viewBox last two numbers. */
function parsePageDimensions(svg: string): PageDims | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;
  const w = parseFloat(root.getAttribute('width') || '');
  const h = parseFloat(root.getAttribute('height') || '');
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return { w, h };
  }
  const vb = root.getAttribute('viewBox');
  if (vb) {
    const parts = vb.split(/\s+/).map(parseFloat);
    if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
      return { w: parts[2], h: parts[3] };
    }
  }
  return null;
}

/**
 * Studio migration chunk 3 — multi-page + virtualized scroll + zoom.
 *
 * - All N pages rendered as placeholder divs sized from page-0 dimensions.
 * - IntersectionObserver lazy-renders SVG into placeholders as they scroll
 *   into view. Per-page cache (Map<idx, svg>) so we never re-parse.
 * - Zoom: CSS-driven (placeholder dimensions × zoom). The injected SVGs use
 *   `width:100%; height:100%` so they scale with the parent.
 * - Edit/input/cursor land in chunk 4.
 *
 * See docs/STUDIO_MIGRATION.md.
 */
export const StudioViewer = forwardRef<RhwpViewerHandle, StudioViewerProps>(
  function StudioViewer({ path }, ref) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const docRef = useRef<RhwpDoc | null>(null);
    const pageRefsRef = useRef<(HTMLDivElement | null)[]>([]);
    const cacheRef = useRef<Map<number, string>>(new Map());

    const [phase, setPhase] = useState<Phase>('mounting');
    const [error, setError] = useState<string | null>(null);
    const [pageCount, setPageCount] = useState(0);
    const [pageDims, setPageDims] = useState<PageDims | null>(null);
    const [zoom, setZoom] = useState(1);
    const [currentPage, setCurrentPage] = useState(0);
    const [dirty, setDirty] = useState(false);
    // Mirror dirty into a ref so callers that captured an older `__studioDebug`
    // closure (e.g. tests grabbing the reference once) read the latest value.
    const dirtyRef = useRef(false);
    // Caret state is read from doc.getCaretPosition() after every mutation;
    // we keep the last-known value here so handlers can act without re-fetching.
    // Shape: { sectionIndex, paragraphIndex, charOffset } per @rhwp/core.
    const caretRef = useRef<{
      sectionIndex: number;
      paragraphIndex: number;
      charOffset: number;
    }>({ sectionIndex: 0, paragraphIndex: 0, charOffset: 0 });

    useImperativeHandle(
      ref,
      () => ({
        // exportHwp (CFB), not exportHwpx — see electron/hwp/converter.ts:
        // @rhwp/core v0.7.8's HWPX round-trip drops image references; HWP
        // round-trip preserves them. Save flow accepts either format and
        // routes the disk extension by the bytes' magic number.
        exportBytes: async () => {
          if (!docRef.current) throw new Error('Document not loaded');
          return docRef.current.exportHwp();
        },
      }),
      [],
    );

    // Effect 1: load doc, render page 0 to learn dimensions, prime cache.
    useEffect(() => {
      let cancelled = false;
      let localDoc: RhwpDoc | null = null;

      // Capture refs for cleanup — react-hooks/exhaustive-deps wants explicit
      // capture even though these are non-DOM refs (Map / array).
      const cache = cacheRef.current;
      const pageRefs = pageRefsRef;

      // Reset everything for a fresh path.
      cache.clear();
      pageRefs.current = [];
      dirtyRef.current = false;
      setDirty(false);

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
          // We use HwpDocument's render/page-count methods directly. We don't
          // construct HwpViewer — its constructor consumes the HwpDocument
          // (`document.__destroy_into_raw()`), zeroing the doc's internal
          // pointer and breaking subsequent exportHwpx() / insertText() calls.
          // The doc itself exposes everything we need (pageCount,
          // renderPageSvg, renderPageHtml).
          localDoc = new HwpDocument(new Uint8Array(buffer));
          const total = localDoc.pageCount();
          const svg0 = localDoc.renderPageSvg(0);
          const dims = parsePageDimensions(svg0);
          if (!dims) throw new Error('Could not parse page-0 dimensions');
          console.info(
            `[studio] parse ${total} pages, page-0 ${dims.w}×${dims.h} in ${(performance.now() - tParse).toFixed(0)} ms`,
          );

          if (cancelled) {
            localDoc.free();
            return;
          }

          docRef.current = localDoc;
          cacheRef.current.set(0, svg0);
          // Sync initial caret state from the doc.
          try {
            caretRef.current = JSON.parse(
              localDoc.getCaretPosition(),
            ) as typeof caretRef.current;
          } catch {
            /* keep default 0,0,0 */
          }
          setPageCount(total);
          setPageDims(dims);
          setPhase('ready');
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : String(err));
          }
          localDoc?.free();
        }
      })();

      return () => {
        cancelled = true;
        docRef.current?.free();
        docRef.current = null;
        cache.clear();
        pageRefs.current = [];
      };
    }, [path]);

    // Mount or fetch SVG for a page (uses cache).
    const renderPageInto = useCallback((idx: number): void => {
      const el = pageRefsRef.current[idx];
      if (!el) return;
      // Already mounted? Skip.
      if (el.firstElementChild?.tagName.toLowerCase() === 'svg') return;
      let svg = cacheRef.current.get(idx);
      if (!svg) {
        const doc = docRef.current;
        if (!doc) return;
        try {
          svg = doc.renderPageSvg(idx);
          cacheRef.current.set(idx, svg);
        } catch (err) {
          console.error(`[studio] render page ${idx} failed:`, err);
          return;
        }
      }
      // Parse via DOMParser (image/svg+xml) — guarantees the SVG namespace
      // is established for `<image>` (otherwise the HTML parser may treat it
      // ambiguously) and that xlink:href / href on embedded images resolve
      // correctly. innerHTML works for many SVGs but is unreliable when the
      // payload contains <image>, <use href>, or namespace-prefixed attrs.
      const parser = new DOMParser();
      const parsed = parser.parseFromString(svg, 'image/svg+xml');
      const root = parsed.documentElement;
      // Surface parse errors (DOMParser doesn't throw — it returns a
      // <parsererror> document instead).
      if (root.tagName.toLowerCase() === 'parsererror') {
        console.error(
          `[studio] page ${idx} SVG parse error:`,
          root.textContent,
        );
        return;
      }
      const adopted = document.importNode(
        root,
        true,
      ) as unknown as SVGSVGElement;
      // Strip fixed dims so CSS controls size; preserve aspect via viewBox.
      adopted.removeAttribute('width');
      adopted.removeAttribute('height');
      adopted.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      adopted.style.width = '100%';
      adopted.style.height = '100%';
      adopted.style.display = 'block';
      el.replaceChildren(adopted);
      // Diagnostic: track image counts per page for debugging.
      const stringCount = (svg.match(/<image\b/g) ?? []).length;
      const parsedCount = parsed.querySelectorAll('image').length;
      const mountedCount = el.querySelectorAll('image').length;
      const diag = window as Window & {
        __studioPageDiag?: Record<
          number,
          { string: number; parsed: number; mounted: number }
        >;
      };
      diag.__studioPageDiag ??= {};
      diag.__studioPageDiag[idx] = {
        string: stringCount,
        parsed: parsedCount,
        mounted: mountedCount,
      };
      if (stringCount !== mountedCount) {
        console.warn(
          `[studio] page ${idx} image count mismatch: string=${stringCount} parsed=${parsedCount} mounted=${mountedCount}`,
        );
      }
    }, []);

    /**
     * After a HwpDocument mutation (insert / delete / etc.), the cached SVGs
     * are stale. Clear the cache and re-render any placeholders that were
     * already mounted; placeholders not yet mounted will lazy-render fresh
     * SVGs when the IntersectionObserver next visits them.
     *
     * Also resyncs caretRef from doc.getCaretPosition() — the doc auto-tracks
     * caret across insert/delete (verified via scripts/check-hittest.mjs).
     */
    const refreshAfterMutation = useCallback((): void => {
      cacheRef.current.clear();
      pageRefsRef.current.forEach((el, idx) => {
        if (el?.firstElementChild?.tagName.toLowerCase() === 'svg') {
          el.innerHTML = '';
          renderPageInto(idx);
        }
      });
      const doc = docRef.current;
      if (doc) {
        try {
          const parsed = JSON.parse(
            doc.getCaretPosition(),
          ) as typeof caretRef.current;
          caretRef.current = parsed;
        } catch {
          /* keep previous caret */
        }
      }
      dirtyRef.current = true;
      setDirty(true);
    }, [renderPageInto]);

    /**
     * Keyboard input — chunk 4-B PoC.
     *
     * Scope: ASCII printable + Backspace + Enter. Korean IME (composition
     * events) is L-003 in KNOWN_ISSUES — listening to keydown alone would
     * lose mid-composition state, so multi-keystroke 한글 currently fails.
     * Track L-003 and address with composition* events in a follow-up.
     */
    const handleKeyDown = useCallback(
      (e: ReactKeyboardEvent<HTMLDivElement>): void => {
        const doc = docRef.current;
        if (!doc) return;
        const c = caretRef.current;
        // Don't intercept browser shortcuts (Ctrl+S, Cmd+R, etc.) or modifier keys.
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'Backspace') {
          if (c.charOffset > 0) {
            doc.deleteText(
              c.sectionIndex,
              c.paragraphIndex,
              c.charOffset - 1,
              1,
            );
            refreshAfterMutation();
          }
          e.preventDefault();
        } else if (e.key === 'Delete') {
          // Delete forward — best-effort. If deleteText fails (end-of-doc), ignore.
          try {
            doc.deleteText(c.sectionIndex, c.paragraphIndex, c.charOffset, 1);
            refreshAfterMutation();
          } catch {
            /* ignore — past end */
          }
          e.preventDefault();
        } else if (e.key === 'Enter') {
          doc.insertText(c.sectionIndex, c.paragraphIndex, c.charOffset, '\n');
          refreshAfterMutation();
          e.preventDefault();
        } else if (e.key.length === 1) {
          // Printable ASCII (single char, no modifier). Korean composition
          // currently slips through here too — see L-003 — and produces
          // partial jamo strings that don't compose properly.
          doc.insertText(c.sectionIndex, c.paragraphIndex, c.charOffset, e.key);
          refreshAfterMutation();
          e.preventDefault();
        }
        // Arrow keys / Home / End / Tab: ignored for now (caret nav not
        // implemented).
      },
      [refreshAfterMutation],
    );

    /**
     * Mouse click on a page → hitTest → caret moves.
     * Translates screen coords to page-local SVG coords (account for zoom).
     */
    const handlePageClick = useCallback(
      (idx: number, e: ReactMouseEvent<HTMLDivElement>): void => {
        const doc = docRef.current;
        if (!doc) return;
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        // Page coords in SVG space (zoom applied to placeholder, so divide by zoom)
        const x = (e.clientX - rect.left) / zoom;
        const y = (e.clientY - rect.top) / zoom;
        try {
          const result = JSON.parse(doc.hitTest(idx, x, y)) as {
            sectionIndex: number;
            paragraphIndex: number;
            charOffset: number;
          };
          caretRef.current = {
            sectionIndex: result.sectionIndex,
            paragraphIndex: result.paragraphIndex,
            charOffset: result.charOffset,
          };
        } catch (err) {
          console.warn('[studio] hitTest failed:', err);
        }
      },
      [zoom],
    );

    /**
     * Test/dev hook on `window.__studioDebug` so e2e specs can drive
     * mutations + read state without going through real input UI (which
     * lands in chunk 4-B). Production builds also keep this — the surface
     * is small and non-destructive.
     */
    useEffect(() => {
      if (phase !== 'ready') return;
      const debug = {
        insertText: (
          sectionIdx: number,
          paraIdx: number,
          charOffset: number,
          text: string,
        ): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.insertText(sectionIdx, paraIdx, charOffset, text);
          refreshAfterMutation();
          return result;
        },
        deleteText: (
          sectionIdx: number,
          paraIdx: number,
          charOffset: number,
          count: number,
        ): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          const result = doc.deleteText(sectionIdx, paraIdx, charOffset, count);
          refreshAfterMutation();
          return result;
        },
        getCaretPosition: (): string => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          return doc.getCaretPosition();
        },
        exportBytes: (): Uint8Array => {
          const doc = docRef.current;
          if (!doc) throw new Error('Document not loaded');
          // HWP, not HWPX — see imperative handle comment.
          return doc.exportHwp();
        },
        getPageCount: (): number => pageCount,
        isDirty: (): boolean => dirtyRef.current,
        getCaret: (): {
          sectionIndex: number;
          paragraphIndex: number;
          charOffset: number;
        } => ({ ...caretRef.current }),
        focusViewer: (): void => {
          scrollRef.current?.focus();
        },
      };
      (window as Window & { __studioDebug?: typeof debug }).__studioDebug =
        debug;
      return () => {
        delete (window as Window & { __studioDebug?: typeof debug })
          .__studioDebug;
      };
    }, [phase, pageCount, refreshAfterMutation]);

    // Effect 2: IntersectionObserver — lazy render visible pages, track current.
    useEffect(() => {
      if (phase !== 'ready' || !pageDims || pageCount === 0) return;

      const scrollEl = scrollRef.current;
      const pageRefs = pageRefsRef;
      let observer: IntersectionObserver | null = null;

      // Defer one tick so refs are populated after the placeholder render.
      const raf = requestAnimationFrame(() => {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const idx = Number(
                entry.target.getAttribute('data-page-idx') ?? '-1',
              );
              if (idx < 0) continue;
              if (entry.isIntersecting) {
                renderPageInto(idx);
              }
            }
            // Update current page = the most-visible entry.
            const visible = entries
              .filter((e) => e.isIntersecting)
              .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
            if (visible.length > 0) {
              const idx = Number(
                visible[0].target.getAttribute('data-page-idx') ?? '-1',
              );
              if (idx >= 0) setCurrentPage(idx);
            }
          },
          { root: scrollEl, rootMargin: '400px', threshold: [0, 0.5] },
        );

        pageRefs.current.forEach((el) => {
          if (el && observer) observer.observe(el);
        });

        // Force-render page 0 immediately (in case observer doesn't fire yet).
        renderPageInto(0);
      });

      return () => {
        cancelAnimationFrame(raf);
        observer?.disconnect();
      };
    }, [phase, pageDims, pageCount, renderPageInto]);

    const setZoomFit = useCallback(() => {
      if (!pageDims || !scrollRef.current) return;
      const containerWidth = scrollRef.current.clientWidth - PAGE_PADDING_PX;
      const fit = containerWidth / pageDims.w;
      setZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, fit)));
    }, [pageDims]);

    const stepZoom = useCallback((dir: 'in' | 'out') => {
      setZoom((current) => {
        if (dir === 'in') {
          const next = ZOOM_LEVELS.find((z) => z > current) ?? ZOOM_MAX;
          return Math.min(ZOOM_MAX, next);
        }
        const lower = [...ZOOM_LEVELS].reverse().find((z) => z < current);
        return Math.max(ZOOM_MIN, lower ?? ZOOM_MIN);
      });
    }, []);

    const showToolbar = phase === 'ready' && pageDims !== null;

    return (
      <div
        className="relative flex h-full w-full flex-col"
        data-testid="studio-viewer"
      >
        {showToolbar && (
          <div className="flex h-10 items-center gap-1 border-b border-border px-3 text-xs">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stepZoom('out')}
              aria-label="축소"
              data-testid="studio-zoom-out"
            >
              <ZoomOut className="size-4" />
            </Button>
            <span
              className="min-w-[3.5rem] text-center font-mono text-muted-foreground"
              data-testid="studio-zoom-level"
            >
              {Math.round(zoom * 100)}%
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => stepZoom('in')}
              aria-label="확대"
              data-testid="studio-zoom-in"
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setZoom(1)}
              data-testid="studio-zoom-reset"
            >
              100%
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={setZoomFit}
              aria-label="너비 맞춤"
              data-testid="studio-zoom-fit"
            >
              <Maximize2 className="size-4" />
            </Button>
            {dirty && (
              <span
                className="ml-auto mr-2 text-amber-500"
                data-testid="studio-dirty-indicator"
                title="저장되지 않은 변경사항"
              >
                ●
              </span>
            )}
            <span
              className={
                dirty
                  ? 'text-muted-foreground'
                  : 'ml-auto text-muted-foreground'
              }
              data-testid="studio-page-indicator"
            >
              {currentPage + 1} / {pageCount}
            </span>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-muted/30 outline-none"
          data-testid="studio-scroll"
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {pageDims && pageCount > 0 && (
            <div
              className="flex flex-col items-center"
              style={{
                gap: `${PAGE_GAP_PX}px`,
                padding: `${PAGE_GAP_PX}px`,
              }}
            >
              {Array.from({ length: pageCount }, (_, i) => (
                <div
                  key={i}
                  ref={(el) => {
                    pageRefsRef.current[i] = el;
                  }}
                  data-testid="studio-viewer-page"
                  data-page-idx={i}
                  className="cursor-text bg-background shadow-md"
                  style={{
                    width: pageDims.w * zoom,
                    height: pageDims.h * zoom,
                  }}
                  onClick={(e) => handlePageClick(i, e)}
                />
              ))}
            </div>
          )}
        </div>

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
      </div>
    );
  },
);
