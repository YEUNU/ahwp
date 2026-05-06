/**
 * Unit tests for `parsePageLayerTree` + `applyOverlayLayers`
 * (chunk 104, Phase 6.4).
 *
 * Smoke-level — verifies that the JSON-walker correctly partitions
 * floating images into behind/front buckets and that the DOM
 * applicator produces the expected layer structure (z-index ordering,
 * bbox × zoom positioning, effect filters, watermark blend).
 */
import { describe, expect, it } from 'vitest';
import { applyOverlayLayers, parsePageLayerTree } from './page-layer-tree';

describe('parsePageLayerTree', () => {
  it('returns empty lists for malformed JSON', () => {
    const result = parsePageLayerTree('not json');
    expect(result.behind).toEqual([]);
    expect(result.front).toEqual([]);
  });

  it('returns empty lists for an empty root', () => {
    const result = parsePageLayerTree(JSON.stringify({ root: { ops: [] } }));
    expect(result.behind).toEqual([]);
    expect(result.front).toEqual([]);
  });

  it('partitions behind / front / drops body-layer images', () => {
    const json = JSON.stringify({
      root: {
        ops: [
          {
            type: 'image',
            wrap: 'behindText',
            bbox: { x: 100, y: 200, width: 400, height: 100 },
            mime: 'image/png',
            base64: 'AAA=',
          },
          {
            type: 'image',
            wrap: 'inFrontOfText',
            bbox: { x: 50, y: 60, width: 200, height: 80 },
            mime: 'image/jpeg',
            base64: 'BBB=',
          },
          {
            type: 'image',
            wrap: 'square', // body layer — must be dropped
            bbox: { x: 0, y: 0, width: 100, height: 100 },
            base64: 'CCC=',
          },
          {
            type: 'text', // not an image — must be skipped
            content: 'hello',
          },
        ],
      },
    });
    const result = parsePageLayerTree(json);
    expect(result.behind).toHaveLength(1);
    expect(result.front).toHaveLength(1);
    expect(result.behind[0].mime).toBe('image/png');
    expect(result.front[0].mime).toBe('image/jpeg');
    expect(result.behind[0].bbox).toEqual({
      x: 100,
      y: 200,
      width: 400,
      height: 100,
    });
  });

  it('walks nested children + child trees', () => {
    const json = JSON.stringify({
      root: {
        children: [
          {
            child: {
              ops: [
                {
                  type: 'image',
                  wrap: 'behindText',
                  bbox: { x: 0, y: 0, width: 10, height: 10 },
                  base64: 'X=',
                },
              ],
            },
          },
        ],
      },
    });
    const result = parsePageLayerTree(json);
    expect(result.behind).toHaveLength(1);
  });

  it('preserves effect / brightness / contrast / watermark metadata', () => {
    const json = JSON.stringify({
      root: {
        ops: [
          {
            type: 'image',
            wrap: 'behindText',
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            base64: 'X=',
            effect: 'grayScale',
            brightness: -20,
            contrast: 30,
            watermark: { preset: 'hancom-watermark' },
          },
        ],
      },
    });
    const result = parsePageLayerTree(json);
    expect(result.behind[0].effect).toBe('grayScale');
    expect(result.behind[0].brightness).toBe(-20);
    expect(result.behind[0].contrast).toBe(30);
    expect(result.behind[0].watermark?.preset).toBe('hancom-watermark');
  });

  it('applies sensible defaults for missing fields', () => {
    const json = JSON.stringify({
      root: {
        ops: [
          {
            type: 'image',
            wrap: 'behindText',
            bbox: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      },
    });
    const result = parsePageLayerTree(json);
    expect(result.behind[0].mime).toBe('application/octet-stream');
    expect(result.behind[0].base64).toBe('');
    expect(result.behind[0].effect).toBe('realPic');
    expect(result.behind[0].brightness).toBe(0);
    expect(result.behind[0].contrast).toBe(0);
    expect(result.behind[0].watermark).toBeUndefined();
  });
});

describe('applyOverlayLayers (DOM applicator)', () => {
  function setupParent(): { parent: HTMLElement; canvas: HTMLCanvasElement } {
    const parent = document.createElement('div');
    parent.style.position = 'relative';
    const canvas = document.createElement('canvas');
    parent.appendChild(canvas);
    return { parent, canvas };
  }

  it('does nothing when there are no overlays', () => {
    const { parent, canvas } = setupParent();
    applyOverlayLayers(parent, 0, { behind: [], front: [] }, 1);
    // No new children — only the canvas itself.
    expect(parent.children.length).toBe(1);
    expect(parent.firstElementChild).toBe(canvas);
  });

  it('does nothing when the parent has no canvas (defensive guard)', () => {
    const parent = document.createElement('div');
    applyOverlayLayers(
      parent,
      0,
      {
        behind: [
          {
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            mime: 'image/png',
            base64: 'x',
            effect: 'realPic',
            brightness: 0,
            contrast: 0,
            wrap: 'behindText',
          },
        ],
        front: [],
      },
      1,
    );
    expect(parent.children.length).toBe(0);
  });

  it('inserts behind layer BEFORE canvas (z-index 0 + insertBefore)', () => {
    const { parent, canvas } = setupParent();
    applyOverlayLayers(
      parent,
      3,
      {
        behind: [
          {
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            mime: 'image/png',
            base64: 'x',
            effect: 'realPic',
            brightness: 0,
            contrast: 0,
            wrap: 'behindText',
          },
        ],
        front: [],
      },
      1,
    );
    expect(parent.children.length).toBe(2);
    const behind = parent.firstElementChild as HTMLElement;
    expect(behind.dataset.rhwpOverlay).toBe('behind-3');
    expect(behind.style.zIndex).toBe('0');
    expect(parent.children[1]).toBe(canvas);
  });

  it('appends front layer AFTER canvas (z-index 2)', () => {
    const { parent, canvas } = setupParent();
    applyOverlayLayers(
      parent,
      5,
      {
        behind: [],
        front: [
          {
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            mime: 'image/png',
            base64: 'x',
            effect: 'realPic',
            brightness: 0,
            contrast: 0,
            wrap: 'inFrontOfText',
          },
        ],
      },
      1,
    );
    expect(parent.children.length).toBe(2);
    expect(parent.children[0]).toBe(canvas);
    const front = parent.children[1] as HTMLElement;
    expect(front.dataset.rhwpOverlay).toBe('front-5');
    expect(front.style.zIndex).toBe('2');
  });

  it('positions <img> at bbox × zoom (CSS px)', () => {
    const { parent } = setupParent();
    applyOverlayLayers(
      parent,
      0,
      {
        behind: [
          {
            bbox: { x: 100, y: 200, width: 300, height: 400 },
            mime: 'image/png',
            base64: 'AAA=',
            effect: 'realPic',
            brightness: 0,
            contrast: 0,
            wrap: 'behindText',
          },
        ],
        front: [],
      },
      1.5,
    );
    const img = parent.querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.style.left).toBe('150px');
    expect(img.style.top).toBe('300px');
    expect(img.style.width).toBe('450px');
    expect(img.style.height).toBe('600px');
    expect(img.src).toBe('data:image/png;base64,AAA=');
    expect(img.style.pointerEvents).toBe('none');
  });

  it('maps grayScale / blackWhite / brightness / contrast to CSS filter', () => {
    const { parent } = setupParent();
    applyOverlayLayers(
      parent,
      0,
      {
        behind: [
          {
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            mime: 'image/png',
            base64: 'x',
            effect: 'grayScale',
            brightness: 50,
            contrast: -20,
            wrap: 'behindText',
          },
        ],
        front: [],
      },
      1,
    );
    const img = parent.querySelector('img') as HTMLImageElement;
    expect(img.style.filter).toContain('grayscale(100%)');
    expect(img.style.filter).toContain('brightness(1.5)');
    expect(img.style.filter).toContain('contrast(0.8)');
  });

  it('applies mix-blend-mode: multiply for watermarks', () => {
    const { parent } = setupParent();
    applyOverlayLayers(
      parent,
      0,
      {
        behind: [
          {
            bbox: { x: 0, y: 0, width: 10, height: 10 },
            mime: 'image/png',
            base64: 'x',
            effect: 'realPic',
            brightness: 0,
            contrast: 0,
            watermark: { preset: 'hancom-watermark' },
            wrap: 'behindText',
          },
        ],
        front: [],
      },
      1,
    );
    const img = parent.querySelector('img') as HTMLImageElement;
    expect(img.style.mixBlendMode).toBe('multiply');
  });

  it('is idempotent — re-applying replaces previous layers', () => {
    const { parent } = setupParent();
    const overlays = {
      behind: [
        {
          bbox: { x: 0, y: 0, width: 10, height: 10 },
          mime: 'image/png',
          base64: 'first',
          effect: 'realPic',
          brightness: 0,
          contrast: 0,
          wrap: 'behindText' as const,
        },
      ],
      front: [],
    };
    applyOverlayLayers(parent, 0, overlays, 1);
    applyOverlayLayers(parent, 0, overlays, 1);
    // Still only 2 children (one behind div + canvas) — duplicate
    // calls should not stack.
    expect(parent.children.length).toBe(2);
    expect(
      parent.querySelectorAll('[data-rhwp-overlay="behind-0"]'),
    ).toHaveLength(1);
  });
});
