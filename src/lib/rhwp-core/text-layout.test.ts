/**
 * Unit tests for `parsePageTextLayout` (Phase 6 follow-up — L-004
 * Canvas-mode tooltip).
 */
import { describe, expect, it } from 'vitest';
import { parsePageTextLayout } from './text-layout';

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
