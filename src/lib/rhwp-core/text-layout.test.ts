/**
 * Unit tests for `parsePageTextLayout` + `applyTextTooltipOverlay`
 * (Phase 6 follow-up — L-004 Canvas-mode tooltip).
 */
import { describe, expect, it } from 'vitest';
import { applyTextTooltipOverlay, parsePageTextLayout } from './text-layout';

describe('parsePageTextLayout', () => {
  it('returns empty list for malformed JSON', () => {
    expect(parsePageTextLayout('').runs).toEqual([]);
    expect(parsePageTextLayout('not json').runs).toEqual([]);
  });

  it('returns empty list when runs array is missing', () => {
    expect(parsePageTextLayout(JSON.stringify({})).runs).toEqual([]);
  });

  it('parses real-shape runs from the lib', () => {
    const json = JSON.stringify({
      runs: [
        {
          text: '제조',
          x: 137.7,
          y: 113.6,
          w: 46.1,
          h: 24.0,
          charX: [0.0, 23.0, 46.1],
          fontFamily: '맑은 고딕',
          fontSize: 24.0,
          bold: true,
        },
        {
          text: 'AI',
          x: 183.8,
          y: 113.6,
          w: 22.4,
          h: 24.0,
        },
      ],
    });
    const result = parsePageTextLayout(json);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]).toEqual({
      text: '제조',
      x: 137.7,
      y: 113.6,
      w: 46.1,
      h: 24.0,
    });
    expect(result.runs[1].text).toBe('AI');
  });

  it('skips empty / whitespace-only text runs (paragraph end markers)', () => {
    const json = JSON.stringify({
      runs: [
        { text: '', x: 100, y: 200, w: 500, h: 13.3 },
        { text: '   ', x: 100, y: 220, w: 500, h: 13.3 },
        { text: 'real', x: 100, y: 240, w: 50, h: 13.3 },
      ],
    });
    const result = parsePageTextLayout(json);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].text).toBe('real');
  });

  it('rejects runs with non-finite or non-positive bbox', () => {
    const json = JSON.stringify({
      runs: [
        { text: 'a', x: 0, y: 0, w: 0, h: 10 }, // zero width
        { text: 'b', x: 0, y: 0, w: 10, h: -5 }, // negative height
        { text: 'c', x: 'oops', y: 0, w: 10, h: 10 }, // non-numeric
        { text: 'd', x: 0, y: 0 }, // missing w/h
        { text: 'e', x: 5, y: 5, w: 10, h: 10 }, // valid
      ],
    });
    const result = parsePageTextLayout(json);
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0].text).toBe('e');
  });

  it('strips font / style metadata to keep the parsed shape minimal', () => {
    // The L-004 tooltip only needs bbox + text. We don't propagate
    // fontFamily / fontSize / bold / etc. from the parser — they're
    // not used by `applyTextTooltipOverlay`.
    const json = JSON.stringify({
      runs: [
        {
          text: 'hello',
          x: 10,
          y: 20,
          w: 30,
          h: 14,
          fontFamily: 'Sans',
          fontSize: 14,
          bold: true,
          italic: false,
          textColor: '#000',
        },
      ],
    });
    const result = parsePageTextLayout(json);
    expect(Object.keys(result.runs[0]).sort()).toEqual([
      'h',
      'text',
      'w',
      'x',
      'y',
    ]);
  });
});

describe('applyTextTooltipOverlay (DOM applicator)', () => {
  function setupParent(): { parent: HTMLElement; canvas: HTMLCanvasElement } {
    const parent = document.createElement('div');
    parent.style.position = 'relative';
    const canvas = document.createElement('canvas');
    parent.appendChild(canvas);
    return { parent, canvas };
  }

  it('does nothing when there are no runs', () => {
    const { parent, canvas } = setupParent();
    applyTextTooltipOverlay(parent, 0, { runs: [] }, 1);
    expect(parent.children.length).toBe(1);
    expect(parent.firstElementChild).toBe(canvas);
  });

  it('does nothing when the parent has no canvas', () => {
    const parent = document.createElement('div');
    applyTextTooltipOverlay(
      parent,
      0,
      { runs: [{ text: 'hi', x: 0, y: 0, w: 10, h: 10 }] },
      1,
    );
    expect(parent.children.length).toBe(0);
  });

  it('appends one tooltip layer with z-index 1 + per-run divs', () => {
    const { parent, canvas } = setupParent();
    applyTextTooltipOverlay(
      parent,
      4,
      {
        runs: [
          { text: 'hello', x: 10, y: 20, w: 50, h: 14 },
          { text: 'world', x: 70, y: 20, w: 50, h: 14 },
        ],
      },
      1,
    );
    expect(parent.children.length).toBe(2);
    expect(parent.children[0]).toBe(canvas);
    const layer = parent.children[1] as HTMLElement;
    expect(layer.dataset.rhwpTextTooltip).toBe('4');
    expect(layer.style.zIndex).toBe('1');
    expect(layer.children.length).toBe(2);
  });

  it('sets title + bbox × zoom + pointer-events: auto on each run div', () => {
    const { parent } = setupParent();
    applyTextTooltipOverlay(
      parent,
      0,
      { runs: [{ text: '잘린 텍스트', x: 100, y: 200, w: 50, h: 13 }] },
      2,
    );
    const div = parent.querySelector(
      '[data-rhwp-text-tooltip] > div',
    ) as HTMLElement;
    expect(div).not.toBeNull();
    expect(div.title).toBe('잘린 텍스트');
    expect(div.style.left).toBe('200px');
    expect(div.style.top).toBe('400px');
    expect(div.style.width).toBe('100px');
    expect(div.style.height).toBe('26px');
    expect(div.style.pointerEvents).toBe('auto');
    expect(div.style.background).toBe('transparent');
  });

  it('layer itself is pointer-events: none so gaps pass mouse through', () => {
    const { parent } = setupParent();
    applyTextTooltipOverlay(
      parent,
      0,
      { runs: [{ text: 'a', x: 0, y: 0, w: 10, h: 10 }] },
      1,
    );
    const layer = parent.querySelector(
      '[data-rhwp-text-tooltip]',
    ) as HTMLElement;
    expect(layer.style.pointerEvents).toBe('none');
  });

  it('is idempotent — re-applying replaces previous overlay', () => {
    const { parent } = setupParent();
    const layout = {
      runs: [{ text: 'a', x: 0, y: 0, w: 10, h: 10 }],
    };
    applyTextTooltipOverlay(parent, 7, layout, 1);
    applyTextTooltipOverlay(parent, 7, layout, 1);
    // Only 1 tooltip layer + 1 canvas.
    expect(parent.children.length).toBe(2);
    expect(
      parent.querySelectorAll('[data-rhwp-text-tooltip="7"]'),
    ).toHaveLength(1);
  });

  it('different page indices live as separate layers', () => {
    const { parent } = setupParent();
    applyTextTooltipOverlay(
      parent,
      0,
      { runs: [{ text: 'p0', x: 0, y: 0, w: 10, h: 10 }] },
      1,
    );
    applyTextTooltipOverlay(
      parent,
      1,
      { runs: [{ text: 'p1', x: 0, y: 0, w: 10, h: 10 }] },
      1,
    );
    expect(parent.querySelectorAll('[data-rhwp-text-tooltip]')).toHaveLength(2);
  });
});
