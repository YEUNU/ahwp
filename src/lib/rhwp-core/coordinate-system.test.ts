/**
 * Unit tests for `coordinate-system.ts` (chunk 101, Phase 6.1).
 *
 * These are pure functions taking primitive numbers + a DOM element.
 * jsdom suffices — no canvas, no WASM, no async. Each function is
 * exercised against zoom=1 (identity) and a non-trivial zoom (1.5)
 * to catch zoom-application bugs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clientToPage,
  clientToPageWithRect,
  pageYToClientY,
  clientToScroller,
  pageToScroller,
  pageDimsToCanvasSize,
} from './coordinate-system';

/** jsdom doesn't compute real layouts. Stub `getBoundingClientRect`
 *  on the test element to control what the coord helpers see. */
function stubRect(
  el: HTMLElement,
  rect: { left: number; top: number; right?: number; bottom?: number },
): void {
  el.getBoundingClientRect = (): DOMRect =>
    ({
      x: rect.left,
      y: rect.top,
      left: rect.left,
      top: rect.top,
      right: rect.right ?? rect.left + 100,
      bottom: rect.bottom ?? rect.top + 100,
      width: (rect.right ?? rect.left + 100) - rect.left,
      height: (rect.bottom ?? rect.top + 100) - rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
}

describe('clientToPage', () => {
  it('subtracts the page rect origin and divides by zoom (zoom=1)', () => {
    const el = document.createElement('div');
    stubRect(el, { left: 100, top: 200 });
    expect(clientToPage(150, 250, el, 1)).toEqual({ x: 50, y: 50 });
  });

  it('divides by zoom for a non-identity zoom factor', () => {
    const el = document.createElement('div');
    stubRect(el, { left: 100, top: 200 });
    // Click at client (250, 350) is 150 CSS-px right + 150 CSS-px down
    // from the page top-left. At zoom=1.5 that maps to page-coord 100×100.
    expect(clientToPage(250, 350, el, 1.5)).toEqual({ x: 100, y: 100 });
  });

  it('returns negative coords for clicks above/left of the page rect', () => {
    const el = document.createElement('div');
    stubRect(el, { left: 50, top: 50 });
    const result = clientToPage(20, 30, el, 1);
    expect(result.x).toBe(-30);
    expect(result.y).toBe(-20);
  });
});

describe('clientToPageWithRect', () => {
  it('matches clientToPage when given the same rect (caller-cached path)', () => {
    const rect = {
      x: 100,
      y: 200,
      left: 100,
      top: 200,
      right: 200,
      bottom: 300,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect;
    expect(clientToPageWithRect(150, 250, rect, 1)).toEqual({ x: 50, y: 50 });
    expect(clientToPageWithRect(250, 350, rect, 1.5)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it('does not call getBoundingClientRect (callers bypass DOM read)', () => {
    const rect = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON: () => ({}),
    } as DOMRect;
    // Caller passes a rect they computed once — verifying the helper
    // doesn't reach for a fresh rect is implicit (no DOM element passed).
    expect(clientToPageWithRect(50, 50, rect, 1)).toEqual({ x: 50, y: 50 });
  });
});

describe('pageYToClientY', () => {
  it('inverts clientToPage on the Y axis (zoom=1)', () => {
    const el = document.createElement('div');
    stubRect(el, { left: 100, top: 200 });
    // pageY=50 + zoom=1 → clientY = top + 50 = 250
    expect(pageYToClientY(50, el, 1)).toBe(250);
  });

  it('multiplies pageY by zoom before adding the rect top', () => {
    const el = document.createElement('div');
    stubRect(el, { left: 100, top: 200 });
    // pageY=50 + zoom=1.5 → clientY = 200 + 75 = 275
    expect(pageYToClientY(50, el, 1.5)).toBe(275);
  });

  it('round-trips with clientToPage', () => {
    const el = document.createElement('div');
    stubRect(el, { left: 0, top: 0 });
    const clientY = 123;
    const zoom = 1.25;
    const pageY = clientToPage(0, clientY, el, zoom).y;
    expect(pageYToClientY(pageY, el, zoom)).toBeCloseTo(clientY);
  });
});

describe('clientToScroller', () => {
  let scroller: HTMLElement;

  beforeEach(() => {
    scroller = document.createElement('div');
    stubRect(scroller, { left: 50, top: 100 });
    Object.defineProperty(scroller, 'scrollLeft', {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(scroller, 'scrollTop', {
      value: 0,
      configurable: true,
    });
  });

  it('subtracts scroller rect (no scroll offset)', () => {
    expect(clientToScroller(100, 200, scroller)).toEqual({ x: 50, y: 100 });
  });

  it('adds scrollLeft / scrollTop into the result', () => {
    Object.defineProperty(scroller, 'scrollLeft', { value: 30 });
    Object.defineProperty(scroller, 'scrollTop', { value: 70 });
    expect(clientToScroller(100, 200, scroller)).toEqual({ x: 80, y: 170 });
  });
});

describe('pageToScroller', () => {
  it('combines page-coord × zoom + page-rect-relative-to-scroller offset', () => {
    const pageEl = document.createElement('div');
    stubRect(pageEl, { left: 100, top: 200 });
    const scroller = document.createElement('div');
    stubRect(scroller, { left: 50, top: 100 });
    Object.defineProperty(scroller, 'scrollLeft', {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(scroller, 'scrollTop', {
      value: 0,
      configurable: true,
    });
    // page coord (10, 20) at zoom=1, page rect (100, 200), scroller (50, 100)
    // → scroller-local: (100-50)+10=60, (200-100)+20=120
    expect(pageToScroller(10, 20, pageEl, scroller, 1)).toEqual({
      x: 60,
      y: 120,
    });
  });

  it('applies zoom to the page-coord component', () => {
    const pageEl = document.createElement('div');
    stubRect(pageEl, { left: 0, top: 0 });
    const scroller = document.createElement('div');
    stubRect(scroller, { left: 0, top: 0 });
    Object.defineProperty(scroller, 'scrollLeft', { value: 0 });
    Object.defineProperty(scroller, 'scrollTop', { value: 0 });
    // page (10, 20) at zoom=2 → scroller (20, 40)
    expect(pageToScroller(10, 20, pageEl, scroller, 2)).toEqual({
      x: 20,
      y: 40,
    });
  });

  it('includes scroller scroll offsets', () => {
    const pageEl = document.createElement('div');
    stubRect(pageEl, { left: 0, top: 0 });
    const scroller = document.createElement('div');
    stubRect(scroller, { left: 0, top: 0 });
    Object.defineProperty(scroller, 'scrollLeft', { value: 100 });
    Object.defineProperty(scroller, 'scrollTop', { value: 200 });
    // scroll offsets add to the result
    expect(pageToScroller(0, 0, pageEl, scroller, 1)).toEqual({
      x: 100,
      y: 200,
    });
  });
});

describe('pageDimsToCanvasSize', () => {
  let dprDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  });

  afterEach(() => {
    if (dprDescriptor) {
      Object.defineProperty(window, 'devicePixelRatio', dprDescriptor);
    }
    vi.restoreAllMocks();
  });

  it('returns CSS = page × zoom and backing = CSS × DPR (DPR=1)', () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 1,
      configurable: true,
    });
    const result = pageDimsToCanvasSize(595, 842, 1);
    expect(result).toEqual({
      cssW: 595,
      cssH: 842,
      backingW: 595,
      backingH: 842,
    });
  });

  it('multiplies by both zoom and DPR for backing-store sizing', () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 2,
      configurable: true,
    });
    const result = pageDimsToCanvasSize(595, 842, 1.5);
    expect(result.cssW).toBe(595 * 1.5);
    expect(result.cssH).toBe(842 * 1.5);
    expect(result.backingW).toBe(595 * 1.5 * 2);
    expect(result.backingH).toBe(842 * 1.5 * 2);
  });

  it('accepts an explicit DPR override (test environments)', () => {
    Object.defineProperty(window, 'devicePixelRatio', {
      value: 1,
      configurable: true,
    });
    const result = pageDimsToCanvasSize(100, 100, 1, 3);
    expect(result.backingW).toBe(300);
    expect(result.backingH).toBe(300);
    // CSS sizes are NOT multiplied by DPR — only by zoom.
    expect(result.cssW).toBe(100);
    expect(result.cssH).toBe(100);
  });
});
