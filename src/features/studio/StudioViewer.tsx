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
} from 'react';
import { Button } from '@/components/ui/button';
import type { RhwpViewerHandle } from '@/features/editor/RhwpViewer';
import { ensureRhwpCore, HwpDocument, HwpViewer } from '@/lib/rhwp-core';

interface StudioViewerProps {
  path: string;
}

type Phase = 'mounting' | 'reading' | 'rendering' | 'ready';

type RhwpDoc = InstanceType<typeof HwpDocument>;
type RhwpView = InstanceType<typeof HwpViewer>;

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
    const viewerRef = useRef<RhwpView | null>(null);
    const pageRefsRef = useRef<(HTMLDivElement | null)[]>([]);
    const cacheRef = useRef<Map<number, string>>(new Map());

    const [phase, setPhase] = useState<Phase>('mounting');
    const [error, setError] = useState<string | null>(null);
    const [pageCount, setPageCount] = useState(0);
    const [pageDims, setPageDims] = useState<PageDims | null>(null);
    const [zoom, setZoom] = useState(1);
    const [currentPage, setCurrentPage] = useState(0);

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

    // Effect 1: load doc, render page 0 to learn dimensions, prime cache.
    useEffect(() => {
      let cancelled = false;
      let localDoc: RhwpDoc | null = null;
      let localViewer: RhwpView | null = null;

      // Capture refs for cleanup — react-hooks/exhaustive-deps wants explicit
      // capture even though these are non-DOM refs (Map / array).
      const cache = cacheRef.current;
      const pageRefs = pageRefsRef;

      // Reset everything for a fresh path.
      cache.clear();
      pageRefs.current = [];

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
          const svg0 = localViewer.renderPageSvg(0);
          const dims = parsePageDimensions(svg0);
          if (!dims) throw new Error('Could not parse page-0 dimensions');
          console.info(
            `[studio] parse ${total} pages, page-0 ${dims.w}×${dims.h} in ${(performance.now() - tParse).toFixed(0)} ms`,
          );

          if (cancelled) {
            localViewer.free();
            localDoc.free();
            return;
          }

          docRef.current = localDoc;
          viewerRef.current = localViewer;
          cacheRef.current.set(0, svg0);
          setPageCount(total);
          setPageDims(dims);
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
        viewerRef.current?.free();
        docRef.current?.free();
        viewerRef.current = null;
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
        const viewer = viewerRef.current;
        if (!viewer) return;
        try {
          svg = viewer.renderPageSvg(idx);
          cacheRef.current.set(idx, svg);
        } catch (err) {
          console.error(`[studio] render page ${idx} failed:`, err);
          return;
        }
      }
      el.innerHTML = svg;
      const svgEl = el.querySelector('svg');
      if (svgEl) {
        // Strip fixed dims so CSS controls size; preserve aspect via viewBox.
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svgEl.style.width = '100%';
        svgEl.style.height = '100%';
        svgEl.style.display = 'block';
      }
    }, []);

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
            <span
              className="ml-auto text-muted-foreground"
              data-testid="studio-page-indicator"
            >
              {currentPage + 1} / {pageCount}
            </span>
          </div>
        )}

        <div
          ref={scrollRef}
          className="flex-1 overflow-auto bg-muted/30"
          data-testid="studio-scroll"
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
                  className="bg-background shadow-md"
                  style={{
                    width: pageDims.w * zoom,
                    height: pageDims.h * zoom,
                  }}
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
