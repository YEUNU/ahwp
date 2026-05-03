/**
 * `PaperPage` + `HorizontalRuler` — Phase R1.7 refactor (REFACTORING_PLAN.md).
 *
 * StudioViewer.tsx 내부에 인라인되어 있던 페이지 한 장의 JSX (SVG
 * mount target + 5종 overlay + caret cursor) 와 가로 ruler 를
 * 분리한 render-only 컴포넌트. 외부 동작 / DOM 구조 / data-testid
 * 모두 1:1 동일.
 *
 * Render-only — props 만 받아 그림. 클릭/드래그/단축키 등 행동은
 * caller 의 콜백을 그대로 호출.
 */
import React, { type MutableRefObject } from 'react';

const SVG_PER_MM = 96 / 25.4;

export function HorizontalRuler({
  widthSvg,
  zoom,
}: {
  widthSvg: number;
  zoom: number;
}): React.ReactElement {
  const widthPx = widthSvg * zoom;
  const widthMm = widthSvg / SVG_PER_MM;
  // One tick per cm + minor 5mm tick. Cap to a reasonable number to
  // keep React render cheap (an A4 portrait at 210mm = 21 ticks).
  const tickEls: React.ReactElement[] = [];
  const cmCount = Math.floor(widthMm / 10);
  for (let cm = 0; cm <= cmCount; cm++) {
    const x = cm * 10 * SVG_PER_MM * zoom;
    tickEls.push(
      <div
        key={`cm-${cm}`}
        className="absolute bottom-0 border-l border-foreground/40"
        style={{ left: x, height: 8 }}
      />,
    );
    tickEls.push(
      <span
        key={`cm-l-${cm}`}
        className="absolute bottom-2 select-none text-[8px] leading-none text-muted-foreground"
        style={{ left: x + 2 }}
      >
        {cm}
      </span>,
    );
    // 5mm half-tick (skip past the last cm).
    if (cm < cmCount) {
      const halfX = (cm * 10 + 5) * SVG_PER_MM * zoom;
      tickEls.push(
        <div
          key={`mm5-${cm}`}
          className="absolute bottom-0 border-l border-foreground/30"
          style={{ left: halfX, height: 4 }}
        />,
      );
    }
  }
  return (
    <div
      className="relative h-4 border-b border-border bg-muted/30"
      style={{ width: widthPx }}
      data-testid="studio-ruler-h"
      aria-hidden="true"
    >
      {tickEls}
    </div>
  );
}

export interface PaperRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaperFindRect extends PaperRect {
  isActive: boolean;
}

export interface PaperChangedRect {
  x: number;
  y: number;
  height: number;
}

export interface PaperCursorRect {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

export interface PaperExcerpt {
  sectionIndex: number;
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
  text: string;
}

export interface PaperPageProps {
  pageIndex: number;
  widthSvg: number;
  heightSvg: number;
  zoom: number;
  showRuler: boolean;
  isActive: boolean;
  /** Path of the document — used as the drag payload `docPath`. */
  path: string;
  /** Mutable ref array; PaperPage assigns its mount node to slot[pageIndex]. */
  pageRefsRef: MutableRefObject<(HTMLDivElement | null)[]>;
  /** Already-filtered to this page (caller does `arr[i] ?? []`). */
  changedParaRects: PaperChangedRect[];
  selectionRects: PaperRect[];
  controlBboxes: PaperRect[];
  cellBlockHighlights: PaperRect[];
  findHighlights: PaperFindRect[];
  /** Full cursor rect (or null) — PaperPage gates rendering on
   * `cursorRect.pageIndex === pageIndex`. */
  cursorRect: PaperCursorRect | null;
  onMouseDown: (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => void;
  onContextMenu: (
    pageIndex: number,
    e: React.MouseEvent<HTMLDivElement>,
  ) => void;
  /** Captures the current selection as an excerpt, or null if none. Called
   * on dragstart of a selection rect. */
  captureExcerpt: () => PaperExcerpt | null;
}

export function PaperPage(props: PaperPageProps): React.ReactElement {
  const {
    pageIndex: i,
    widthSvg,
    heightSvg,
    zoom,
    showRuler,
    isActive,
    path,
    pageRefsRef,
    changedParaRects,
    selectionRects,
    controlBboxes,
    cellBlockHighlights,
    findHighlights,
    cursorRect,
    onMouseDown,
    onContextMenu,
    captureExcerpt,
  } = props;

  return (
    <div className="flex flex-col items-stretch" data-testid="studio-page-wrap">
      {showRuler && <HorizontalRuler widthSvg={widthSvg} zoom={zoom} />}
      <div
        // chunk 54 — page paper is always white, even in dark
        // mode. The IR's SVG renderer hard-codes black text;
        // matching `bg-background` would make text invisible
        // on a dark theme. Chrome around the page (toolbar,
        // sidebar, status bar) follows the theme normally.
        //
        // `select-none` — drag selection is fully owned by our
        // IR-level handlers (handlePageMouseDown + the
        // selectionRectsByPage overlay). Without this, the
        // browser ALSO runs native text selection over the
        // SVG `<text>` elements in parallel, producing a wide
        // blue highlight that is independent of our IR state
        // (and not clearable via ESC since ESC doesn't reset
        // native selection). User-perceived symptom: drag
        // results in "the entire page is highlighted" while
        // our debug log shows the IR selection is tiny.
        // Native copy/select-all still works because the menu
        // layer routes Cmd+A/C to our IR handlers when Studio
        // is focused.
        className="relative cursor-text select-none bg-[hsl(var(--paper))] text-[hsl(var(--paper-foreground))] shadow-md"
        style={{
          width: widthSvg * zoom,
          height: heightSvg * zoom,
        }}
        onMouseDown={(e) => onMouseDown(i, e)}
        // Mouse move / up / leave are handled at the document
        // level by listeners attached in handlePageMouseDown.
        // This keeps drag selection consistent across page gaps
        // and chrome (PDF-like behavior).
        onContextMenu={(e) => onContextMenu(i, e)}
      >
        {/* SVG mount target — kept as a separate child so the
              cursor overlay survives renderPageInto's
              el.replaceChildren(adopted) call. */}
        <div
          ref={(el) => {
            pageRefsRef.current[i] = el;
          }}
          data-testid="studio-viewer-page"
          data-page-idx={i}
          className="absolute inset-0"
        />
        {/* chunk 57 — AI-applied paragraph highlight. A
              thin amber stripe along the left edge of each
              changed paragraph, fades after 15s. Pointer
              events disabled so it doesn't intercept text
              selection. */}
        {changedParaRects.map((r, ri) => (
          <div
            key={`changed-${ri}`}
            data-testid="studio-changed-stripe"
            className="pointer-events-none absolute animate-pulse rounded-r bg-amber-400/60"
            style={{
              left: r.x * zoom,
              top: r.y * zoom,
              width: 3,
              height: r.height * zoom,
            }}
          />
        ))}
        {/* Selection highlight overlay — one rect per visible
              line in the selection range, computed via
              getSelectionRects. */}
        {selectionRects.map((r, ri) => (
          <div
            key={ri}
            data-testid="studio-selection-rect"
            // chunk 22 — selection rects are interactive so the
            // user can grab them as a drag source. Mousedown
            // here also passes through to text selection /
            // caret movement via the page surface's pointer
            // event, but HTML5 drag fires on its own threshold
            // (no mouseup needed). This matches native browser
            // text selection drag UX.
            className="absolute cursor-grab bg-primary/25 active:cursor-grabbing"
            draggable={isActive}
            onDragStart={(e) => {
              const cap = captureExcerpt();
              if (!cap) {
                e.preventDefault();
                return;
              }
              const payload = {
                docPath: path,
                sectionIndex: cap.sectionIndex,
                startParagraphIndex: cap.startParagraphIndex,
                startOffset: cap.startOffset,
                endParagraphIndex: cap.endParagraphIndex,
                endOffset: cap.endOffset,
                text: cap.text,
              };
              try {
                e.dataTransfer.setData(
                  'application/x-ahwp-excerpt',
                  JSON.stringify(payload),
                );
                e.dataTransfer.setData('text/plain', cap.text);
                e.dataTransfer.effectAllowed = 'copy';
              } catch {
                /* dataTransfer can throw under hardened CSP */
              }
            }}
            style={{
              left: r.x * zoom,
              top: r.y * zoom,
              width: r.width * zoom,
              height: r.height * zoom,
            }}
          />
        ))}
        {/* Control highlight overlay — drag selection that
              passed over a table (bbox via getTableBBox).
              Rendered with same color as text selection so the
              object reads as "selected" alongside the lines.
              pointer-events-none so it doesn't intercept the
              page's mousedown. */}
        {controlBboxes.map((r, ri) => (
          <div
            key={`ctrl-${ri}`}
            data-testid="studio-control-selection-rect"
            className="pointer-events-none absolute bg-primary/25"
            style={{
              left: r.x * zoom,
              top: r.y * zoom,
              width: r.width * zoom,
              height: r.height * zoom,
            }}
          />
        ))}
        {/* Phase A — multi-cell block highlights. Cells
              between anchor.cell and focus.cell of the same
              table when drag crossed cell boundaries. Same
              tint as selection / control highlight for visual
              consistency. */}
        {cellBlockHighlights.map((r, ri) => (
          <div
            key={`cb-${ri}`}
            data-testid="studio-cell-block-rect"
            className="pointer-events-none absolute bg-primary/25"
            style={{
              left: r.x * zoom,
              top: r.y * zoom,
              width: r.width * zoom,
              height: r.height * zoom,
            }}
          />
        ))}
        {/* Find match highlights (chunk 9). Active match rendered
              with a stronger color so it stands out from the rest. */}
        {findHighlights.map((r, ri) => (
          <div
            key={`fm-${ri}`}
            data-testid={
              r.isActive ? 'studio-find-match-active' : 'studio-find-match'
            }
            className={
              'pointer-events-none absolute ' +
              (r.isActive ? 'bg-amber-400/70' : 'bg-amber-300/35')
            }
            style={{
              left: r.x * zoom,
              top: r.y * zoom,
              width: r.width * zoom,
              height: r.height * zoom,
            }}
          />
        ))}
        {cursorRect && cursorRect.pageIndex === i && (
          <div
            data-testid="studio-cursor"
            className="animate-caret-blink pointer-events-none absolute bg-foreground"
            style={{
              left: cursorRect.x * zoom,
              top: cursorRect.y * zoom,
              width: Math.max(1, zoom),
              height: cursorRect.height * zoom,
            }}
          />
        )}
      </div>
    </div>
  );
}
