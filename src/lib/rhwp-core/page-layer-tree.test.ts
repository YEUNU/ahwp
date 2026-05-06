/**
 * Unit tests for `parsePageLayerTree` (chunk 104, Phase 6.4).
 *
 * Smoke-level — verifies that the JSON-walker correctly partitions
 * floating images into behind/front buckets and ignores body-layer
 * images. Real visual fidelity is verified by Canvas-mode e2e against
 * fixtures with watermarks.
 */
import { describe, expect, it } from 'vitest';
import { parsePageLayerTree } from './page-layer-tree';

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
