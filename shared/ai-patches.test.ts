/**
 * 0.4.20 — patches schema 의 cell location + charShape 확장 검증.
 * Body 단락 backward compat + cell 추가 + lib props 매핑 모두.
 */
import { describe, expect, it } from 'vitest';
import {
  dedupeCellTargets,
  parsePatchBlock,
  patchFormatToLibProps,
  repairLlmJson,
} from './ai-patches';
import type { AhwpPatch } from './ai-patches';

function ok(raw: string): ReturnType<typeof parsePatchBlock> {
  const result = parsePatchBlock(raw);
  if (!result.ok) throw new Error(`parse failed: ${result.reason}`);
  return result;
}

describe('parsePatchBlock — cell location', () => {
  it('parses cell coords when present', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'fill cell',
          location: {
            sectionIndex: 0,
            paragraphIndex: 5,
            startOffset: 0,
            endOffset: 0,
            cell: {
              controlIndex: 0,
              cellIndex: 3,
              cellParagraphIndex: 0,
            },
          },
          deletion: '',
          addition: 'TechFlow',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.location.cell).toEqual({
      controlIndex: 0,
      cellIndex: 3,
      cellParagraphIndex: 0,
    });
  });

  it('rejects malformed cell shape', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'bad cell',
          location: {
            sectionIndex: 0,
            paragraphIndex: 0,
            cell: { controlIndex: 0, cellIndex: -1, cellParagraphIndex: 0 },
          },
          deletion: '',
          addition: 'x',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(false);
    if (item.ok) return;
    expect(item.reason).toMatch(/cell\.cellIndex-invalid/);
  });

  it('omits cell when not provided (backward compat)', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'body edit',
          location: { sectionIndex: 0, paragraphIndex: 1 },
          deletion: 'old',
          addition: 'new',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.location.cell).toBeUndefined();
  });
});

describe('parsePatchBlock — deletion/addition coercion (0.4.22)', () => {
  it('coerces missing deletion to empty string', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'fill empty',
          location: { sectionIndex: 0, paragraphIndex: 0 },
          addition: 'value',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.deletion).toBe('');
    expect(item.patch.addition).toBe('value');
  });

  it('coerces null deletion to empty string', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'null del',
          location: { sectionIndex: 0, paragraphIndex: 0 },
          deletion: null,
          addition: 'x',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.deletion).toBe('');
  });

  it('rejects array / object deletion', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'bad del',
          location: { sectionIndex: 0, paragraphIndex: 0 },
          deletion: ['a'],
          addition: 'x',
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(false);
    if (item.ok) return;
    expect(item.reason).toMatch(/deletion-not-string/);
  });
});

describe('parsePatchBlock — additionFormat', () => {
  it('parses fontName + lib raw passthrough', () => {
    const raw = JSON.stringify({
      ops: [
        {
          title: 'styled',
          location: { sectionIndex: 0, paragraphIndex: 0 },
          deletion: '',
          addition: 'hello',
          additionFormat: {
            fontName: '함초롬바탕',
            fontSize: 1000,
            lib: { name: '함초롬바탕', size_hu: 1000, bold: false },
          },
        },
      ],
    });
    const r = ok(raw);
    if (!r.ok) throw new Error('unreachable');
    const item = r.items[0];
    expect(item.ok).toBe(true);
    if (!item.ok) return;
    expect(item.patch.additionFormat?.fontName).toBe('함초롬바탕');
    expect(item.patch.additionFormat?.lib).toEqual({
      name: '함초롬바탕',
      size_hu: 1000,
      bold: false,
    });
  });
});

describe('patchFormatToLibProps', () => {
  it('maps typed fields to lib keys', () => {
    const props = patchFormatToLibProps({
      bold: true,
      italic: false,
      fontName: '함초롬바탕',
      fontSize: 1200,
      textColor: '#ff0000',
    });
    expect(props).toEqual({
      bold: true,
      italic: false,
      name: '함초롬바탕',
      size_hu: 1200,
      color: 0xff0000,
    });
  });

  it('lib base + typed override', () => {
    const props = patchFormatToLibProps({
      lib: { name: 'old', size_hu: 800, bold: true },
      fontName: 'new',
    });
    expect(props.name).toBe('new');
    expect(props.size_hu).toBe(800);
    expect(props.bold).toBe(true);
  });

  it('skips invalid hex color', () => {
    const props = patchFormatToLibProps({ textColor: 'not-a-hex' });
    expect(props.color).toBeUndefined();
  });
});

// 0.6.14 — JSON repair fallback for model-emitted patches blocks. gpt-5.x
// and gemini emitting dense `additionFormat.lib` copies sometimes leak
// trailing commas, smart quotes, or U+2028 line separators that break
// strict JSON.parse. repairLlmJson + parsePatchBlock retry pass should
// recover those silently.
describe('repairLlmJson', () => {
  it('strips trailing commas before } and ]', () => {
    expect(repairLlmJson('{"a":1,}')).toBe('{"a":1}');
    expect(repairLlmJson('[1,2,3,]')).toBe('[1,2,3]');
    expect(repairLlmJson('[1,2,3,\n  ]')).toBe('[1,2,3\n  ]');
    expect(repairLlmJson('{"x":[1,2,]}')).toBe('{"x":[1,2]}');
  });
  it('converts smart quotes to straight quotes', () => {
    expect(repairLlmJson('{“a”:“b”}')).toBe('{"a":"b"}');
  });
  it('replaces U+2028 / U+2029 line separators with space', () => {
    const ls = '{"a":\u20281,\u20292}';
    const out = repairLlmJson(ls);
    expect(out).not.toContain('\u2028');
    expect(out).not.toContain('\u2029');
  });
  it('strips // line and /* block */ comments', () => {
    expect(repairLlmJson('{"a":1 // note\n,"b":2}')).toBe('{"a":1 \n,"b":2}');
    expect(repairLlmJson('{"a":/* drop */1}')).toBe('{"a":1}');
  });
  it('preserves URL-shaped // inside string values (no false rewrite)', () => {
    // Conservative: our regex requires a non-: char before //, so
    // `"http://foo"` keeps both slashes (colon precedes).
    const v = '{"url":"http://foo.example"}';
    expect(repairLlmJson(v)).toBe(v);
  });
  it('is idempotent on valid JSON', () => {
    const valid = '{"ops":[{"a":1,"b":[1,2,3]}]}';
    expect(repairLlmJson(valid)).toBe(valid);
  });
});

describe('parsePatchBlock — repair fallback', () => {
  it('recovers from trailing comma after last op', () => {
    const malformed = `{
      "ops":[
        {
          "title":"x",
          "location":{"sectionIndex":0,"paragraphIndex":1},
          "deletion":"",
          "addition":"hi"
        },
      ]
    }`;
    const r = parsePatchBlock(malformed);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items).toHaveLength(1);
    expect(r.items[0].ok).toBe(true);
  });

  it('recovers from trailing comma deep in fontFamilies array', () => {
    // Mirrors the real failure shape — large additionFormat.lib with a
    // stray trailing comma inside one of the embedded arrays.
    const malformed = `{
      "ops":[
        {
          "title":"x",
          "location":{
            "sectionIndex":0,"paragraphIndex":1,
            "cell":{"controlIndex":0,"cellIndex":2,"cellParagraphIndex":0}
          },
          "deletion":"",
          "addition":"코렌스",
          "additionFormat":{"lib":{
            "fontFamily":"맑은 고딕",
            "fontFamilies":["맑은 고딕","맑은 고딕",],
            "ratios":[100,100,]
          }}
        }
      ]
    }`;
    const r = parsePatchBlock(malformed);
    expect(r.ok).toBe(true);
  });

  it('returns parse:* reason when repair also fails', () => {
    const r = parsePatchBlock('{"ops":[ this is not json ]}');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/^parse:/);
  });
});

// 0.6.14 — duplicate cell-target guard. Pre-AppShell-rewrite the
// applyPatches loop silently overwrote the first patch when the
// model emitted two patches targeting the same cell. dedupeCellTargets
// flags duplicates so the dispatcher can reject the second one.
describe('dedupeCellTargets', () => {
  function cellPatch(
    sec: number,
    para: number,
    ctrl: number,
    cellIdx: number,
    cellParaIdx = 0,
    title = 'p',
  ): AhwpPatch {
    return {
      title,
      location: {
        sectionIndex: sec,
        paragraphIndex: para,
        cell: {
          controlIndex: ctrl,
          cellIndex: cellIdx,
          cellParagraphIndex: cellParaIdx,
        },
      },
      deletion: '',
      addition: 'x',
    };
  }
  function bodyPatch(sec: number, para: number, title = 'b'): AhwpPatch {
    return {
      title,
      location: { sectionIndex: sec, paragraphIndex: para },
      deletion: '',
      addition: 'y',
    };
  }

  it('passes through unique cell targets', () => {
    const r = dedupeCellTargets([
      cellPatch(0, 1, 0, 2),
      cellPatch(0, 1, 0, 4),
      cellPatch(0, 10, 0, 5),
    ]);
    expect(r).toEqual([true, true, true]);
  });

  it('rejects second occurrence of same cell coordinate', () => {
    const r = dedupeCellTargets([
      cellPatch(0, 10, 0, 5, 0, '1.1 목표'),
      cellPatch(0, 10, 0, 5, 0, '1.3 추진'), // ← same cell
    ]);
    expect(r).toEqual([true, false]);
  });

  it('keeps first occurrence + rejects all subsequent dupes', () => {
    const r = dedupeCellTargets([
      cellPatch(0, 10, 0, 5),
      cellPatch(0, 10, 0, 5),
      cellPatch(0, 10, 0, 5),
    ]);
    expect(r).toEqual([true, false, false]);
  });

  it('treats body-level patches (no cell) as always unique', () => {
    const r = dedupeCellTargets([
      bodyPatch(0, 1),
      bodyPatch(0, 1),
      bodyPatch(0, 1),
    ]);
    expect(r).toEqual([true, true, true]);
  });

  it('distinguishes different sec / para / ctrl / cellIdx / cellParaIdx', () => {
    const r = dedupeCellTargets([
      cellPatch(0, 10, 0, 5),
      cellPatch(1, 10, 0, 5), // sec differs
      cellPatch(0, 11, 0, 5), // para differs
      cellPatch(0, 10, 1, 5), // ctrl differs
      cellPatch(0, 10, 0, 6), // cellIdx differs
      cellPatch(0, 10, 0, 5, 1), // cellParaIdx differs
    ]);
    expect(r).toEqual([true, true, true, true, true, true]);
  });

  it('mixes body + cell + duplicate cell correctly', () => {
    const r = dedupeCellTargets([
      bodyPatch(0, 0),
      cellPatch(0, 10, 0, 5),
      bodyPatch(0, 0), // body always passes
      cellPatch(0, 10, 0, 5), // duplicate of #1 → reject
      cellPatch(0, 10, 0, 6), // unique → pass
    ]);
    expect(r).toEqual([true, true, true, false, true]);
  });
});
