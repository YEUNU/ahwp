/**
 * `BridgeIrHelper` 단위 테스트 — Phase 7 Phase D2a.
 *
 * RhwpBridge 의 invokeWasm 만 mock — wire format / composite 분기 검증.
 * 실제 iframe round-trip 은 e2e (rhwp-studio-debug-mount + Phase D 의
 * 후속 spec) 에서 다룬다.
 */
import { describe, expect, it, vi } from 'vitest';
import { BridgeIrHelper } from './bridge-ir-helper';
import type { RhwpBridge } from '@/lib/rhwp-bridge';

interface RecordedCall {
  fn: string;
  args: unknown[];
}

function makeBridge(responses: Record<string, unknown>): {
  bridge: RhwpBridge;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  // We only need invokeWasm. 다른 surface 는 BridgeIrHelper 가 안 씀.
  const bridge = {
    invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
      calls.push({ fn, args });
      // 'getParagraphLength' 는 호출마다 같은 값 반환 (테스트 단순화).
      const v = responses[fn];
      if (v === undefined) throw new Error(`unmocked invokeWasm: ${fn}`);
      return v;
    }),
  } as unknown as RhwpBridge;
  return { bridge, calls };
}

describe('BridgeIrHelper — Phase D2a', () => {
  it('simple read passthrough — getSectionCount', async () => {
    const { bridge, calls } = makeBridge({ getSectionCount: 3 });
    const h = new BridgeIrHelper(bridge);
    expect(await h.getSectionCount()).toBe(3);
    expect(calls).toEqual([{ fn: 'getSectionCount', args: [] }]);
  });

  it('getParagraphLength forwards args', async () => {
    const { bridge, calls } = makeBridge({ getParagraphLength: 42 });
    const h = new BridgeIrHelper(bridge);
    expect(await h.getParagraphLength(0, 5)).toBe(42);
    expect(calls).toEqual([{ fn: 'getParagraphLength', args: [0, 5] }]);
  });

  it('single-paragraph getTextRange — one invokeWasm call', async () => {
    const { bridge, calls } = makeBridge({ getTextRange: 'hello' });
    const h = new BridgeIrHelper(bridge);
    const txt = await h.getTextRange(0, 0, 0, 0, 5);
    expect(txt).toBe('hello');
    expect(calls).toEqual([{ fn: 'getTextRange', args: [0, 0, 0, 5] }]);
  });

  it('cross-paragraph getTextRange — composite stitches with \\n', async () => {
    // sp=0 ep=2. len0=4 → first slice "ello" (start at 1).
    // p=1 → full "WORLD".
    // ep=2 → 0..3 "BYE".
    const responses: Record<string, unknown> = {
      getParagraphLength: 0, // overridden per-call via custom mock below
    };
    const calls: RecordedCall[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getParagraphLength') {
          // sec=0 para=0 → 5; para=1 → 5.
          const para = args[1] as number;
          return para === 0 ? 5 : 5;
        }
        if (fn === 'getTextRange') {
          const [, , off, count] = args as [number, number, number, number];
          if (off === 1 && count === 4) return 'ello';
          if (off === 0 && count === 5) return 'WORLD';
          if (off === 0 && count === 3) return 'BYE';
          throw new Error(
            `unexpected getTextRange args: ${JSON.stringify(args)}`,
          );
        }
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as RhwpBridge;
    void responses; // satisfy lint
    const h = new BridgeIrHelper(bridge);
    const out = await h.getTextRange(0, 0, 1, 2, 3);
    expect(out).toBe('ello\nWORLD\nBYE');
    // 4 calls: 1 paragraphLength for sp, 1 paragraphLength for middle p=1, 3 getTextRange.
    expect(calls.filter((c) => c.fn === 'getTextRange')).toHaveLength(3);
  });

  it('getTextRange respects maxBytes — trim with marker', async () => {
    const long = 'A'.repeat(5000);
    const { bridge } = makeBridge({ getTextRange: long });
    const h = new BridgeIrHelper(bridge);
    const out = await h.getTextRange(0, 0, 0, 0, 5000, 4096);
    expect(out.endsWith('…[trimmed]')).toBe(true);
    expect(out.length).toBeLessThan(long.length);
  });

  it('searchAllText forwards args + parses to SearchHit[]', async () => {
    const hits = [
      { sec: 0, para: 1, charOffset: 0, length: 2 },
      { sec: 0, para: 3, charOffset: 5, length: 2 },
    ];
    const { bridge, calls } = makeBridge({ searchAllText: hits });
    const h = new BridgeIrHelper(bridge);
    const out = await h.searchAllText('q', false, false);
    expect(out).toEqual(hits);
    expect(calls).toEqual([{ fn: 'searchAllText', args: ['q', false, false] }]);
  });

  it('insertText returns true on {ok:true} JSON response', async () => {
    const { bridge } = makeBridge({ insertText: '{"ok":true,"paraIdx":0}' });
    const h = new BridgeIrHelper(bridge);
    expect(await h.insertText(0, 0, 0, 'hi')).toBe(true);
  });

  it('insertText returns false on {ok:false} JSON response', async () => {
    const { bridge } = makeBridge({ insertText: '{"ok":false}' });
    const h = new BridgeIrHelper(bridge);
    expect(await h.insertText(0, 0, 0, 'hi')).toBe(false);
  });

  it('deleteText / insertTextInCell forward args', async () => {
    const { bridge, calls } = makeBridge({
      deleteText: '{"ok":true}',
      insertTextInCell: '{"ok":true}',
    });
    const h = new BridgeIrHelper(bridge);
    expect(await h.deleteText(0, 0, 0, 3)).toBe(true);
    expect(await h.insertTextInCell(0, 1, 2, 3, 4, 5, 'cell')).toBe(true);
    expect(calls.map((c) => [c.fn, c.args.length])).toEqual([
      ['deleteText', 4],
      ['insertTextInCell', 7],
    ]);
  });

  it('getTextInCell forwards 7 args', async () => {
    const { bridge, calls } = makeBridge({ getTextInCell: 'cell text' });
    const h = new BridgeIrHelper(bridge);
    expect(await h.getTextInCell(0, 1, 0, 0, 0, 0, 100)).toBe('cell text');
    expect(calls[0]).toEqual({
      fn: 'getTextInCell',
      args: [0, 1, 0, 0, 0, 0, 100],
    });
  });

  it('getCaretPosition forwards null gracefully', async () => {
    const { bridge } = makeBridge({ getCaretPosition: null });
    const h = new BridgeIrHelper(bridge);
    expect(await h.getCaretPosition()).toBeNull();
  });

  it('getCaretPosition returns shape when defined', async () => {
    const { bridge } = makeBridge({
      getCaretPosition: { sectionIndex: 0, paragraphIndex: 5, charOffset: 7 },
    });
    const h = new BridgeIrHelper(bridge);
    const p = await h.getCaretPosition();
    expect(p).toEqual({ sectionIndex: 0, paragraphIndex: 5, charOffset: 7 });
  });

  // ── Phase D2c-1 신규 ────────────────────────────────────────────

  it('deleteRange extracts .ok from parsed response', async () => {
    const { bridge, calls } = makeBridge({
      deleteRange: { ok: true, paraIdx: 0, charOffset: 0 },
    });
    const h = new BridgeIrHelper(bridge);
    expect(await h.deleteRange(0, 0, 0, 0, 10)).toBe(true);
    expect(calls[0]).toEqual({ fn: 'deleteRange', args: [0, 0, 0, 0, 10] });
  });

  it('deleteRange returns false on {ok:false}', async () => {
    const { bridge } = makeBridge({ deleteRange: { ok: false } });
    const h = new BridgeIrHelper(bridge);
    expect(await h.deleteRange(0, 0, 0, 0, 10)).toBe(false);
  });

  it('mergeParagraph parses JSON ok', async () => {
    const { bridge, calls } = makeBridge({
      mergeParagraph: '{"ok":true,"paraIdx":3}',
    });
    const h = new BridgeIrHelper(bridge);
    expect(await h.mergeParagraph(0, 5)).toBe(true);
    expect(calls[0]).toEqual({ fn: 'mergeParagraph', args: [0, 5] });
  });

  it('applyCharFormat stringifies props', async () => {
    const { bridge, calls } = makeBridge({
      applyCharFormat: '{"ok":true}',
    });
    const h = new BridgeIrHelper(bridge);
    const props = { bold: true, italic: false };
    expect(await h.applyCharFormat(0, 1, 0, 5, props)).toBe(true);
    expect(calls[0].fn).toBe('applyCharFormat');
    expect(calls[0].args[4]).toBe(JSON.stringify(props));
  });

  it('applyStyle extracts .ok', async () => {
    const { bridge, calls } = makeBridge({ applyStyle: { ok: true } });
    const h = new BridgeIrHelper(bridge);
    expect(await h.applyStyle(0, 1, 7)).toBe(true);
    expect(calls[0]).toEqual({ fn: 'applyStyle', args: [0, 1, 7] });
  });

  it('getCharPropertiesAt returns wasm-bridge parsed object', async () => {
    const { bridge } = makeBridge({
      getCharPropertiesAt: { bold: true, fontSize: 1200 },
    });
    const h = new BridgeIrHelper(bridge);
    const r = await h.getCharPropertiesAt(0, 0, 5);
    expect(r).toEqual({ bold: true, fontSize: 1200 });
  });

  it('getParaPropertiesAt forwards args', async () => {
    const { bridge, calls } = makeBridge({
      getParaPropertiesAt: { alignment: 'center' },
    });
    const h = new BridgeIrHelper(bridge);
    expect(await h.getParaPropertiesAt(0, 3)).toEqual({ alignment: 'center' });
    expect(calls[0]).toEqual({ fn: 'getParaPropertiesAt', args: [0, 3] });
  });

  // Regression — 이전 구현은 getCellInfo (셀-상대 위치만 반환)
  // 의 rowCount/colCount 를 읽으려 해서 모든 양식에서 0 셀을 반환했다.
  // 수정: getTableDimensions 사용 + multi-control + labelHint /
  // labelCharShape 추가.
  // 추가 fix (병합 셀): 이웃 셀 산술 (c-1, c-colCount) 대신 getCellInfo
  // 로 (row,col) 그리드 맵을 빌드 — 병합 표에서 정확한 좌상 이웃 식별.
  it('getEmptyFormFields uses getTableDimensions and surfaces empty cells with label-hint', async () => {
    // 2x2 표 (cellIdx 0~3, 병합 없음):
    //   [0 "이름"  ] [1 ""      ]  ← 1 이 빈 셀, 라벨=좌측 "이름"
    //   [2 "주소"  ] [3 "  "    ]  ← 3 이 공백-only, 라벨=좌측 "주소"
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 2;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          // paragraph 0 anchors a 2x2 table at controlIdx=0; 다른 위치는 없음.
          if (p === 0 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 2,
              colCount: 2,
              cellCount: 4,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getCellInfo') {
          const [, , , cellIdx] = args as [number, number, number, number];
          // 2x2 grid 좌상→우하 순.
          const layout = [
            { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
            { row: 0, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
          ];
          return JSON.stringify({ ok: true, ...layout[cellIdx] });
        }
        if (fn === 'getTextInCell') {
          const [, , , cellIdx] = args as [number, number, number, number];
          if (cellIdx === 0) return '이름';
          if (cellIdx === 1) return '';
          if (cellIdx === 2) return '주소';
          if (cellIdx === 3) return '   ';
          return '';
        }
        if (fn === 'getCellCharPropertiesAt') {
          const [, , , cellIdx] = args as [number, number, number, number];
          // Full WASM response — getEmptyFormFields will COMPACT this
          // down to only the typography-meaningful keys (fontFamily,
          // fontSize, bold, italic, underline, strikethrough, textColor,
          // charShapeId). Verify the compaction happens.
          return JSON.stringify({
            fontFamily: '함초롬바탕',
            fontSize: 1000,
            bold: false,
            italic: cellIdx === 0,
            textColor: '#000000',
            charShapeId: 13 + cellIdx, // distinct so we can tell labels apart
            // bloated fields that compact should drop:
            fontFamilies: ['함초롬바탕', '함초롬바탕'],
            ratios: [100, 100],
            borderFillId: 3,
            shadowOffsetX: 10,
          });
        }
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const result = await h.getEmptyFormFields();

    expect(result.truncated).toBe(false);
    expect(result.cellFields).toHaveLength(2);

    // First empty cell — cellIdx=1, label is the LEFT sibling cellIdx=0.
    // labelCharShape should be COMPACTED (no fontFamilies / ratios / borderFillId).
    expect(result.cellFields[0]).toMatchObject({
      location: {
        sectionIndex: 0,
        paragraphIndex: 0,
        controlIndex: 0,
        cellIndex: 1,
        cellParagraphIndex: 0,
      },
      labelHint: '이름',
      labelCharShape: {
        fontFamily: '함초롬바탕',
        fontSize: 1000,
        bold: false,
        italic: true, // cellIdx=0 of label probe → true
        textColor: '#000000',
        charShapeId: 13, // 13 + 0
      },
      currentText: '',
    });
    // Bloated fields MUST NOT be in the compact output.
    expect(result.cellFields[0].labelCharShape).not.toHaveProperty(
      'fontFamilies',
    );
    expect(result.cellFields[0].labelCharShape).not.toHaveProperty('ratios');
    expect(result.cellFields[0].labelCharShape).not.toHaveProperty(
      'borderFillId',
    );
    expect(result.cellFields[0].labelCharShape).not.toHaveProperty(
      'shadowOffsetX',
    );

    expect(result.cellFields[1].location.cellIndex).toBe(3);
    expect(result.cellFields[1].labelHint).toBe('주소');
    expect(result.cellFields[1].labelCharShape).toMatchObject({
      charShapeId: 15, // label is cellIdx=2 → 13 + 2 = 15
    });

    // 새 구현은 getCellInfo 로 (row,col) 그리드 맵을 빌드한다.
    const fns = calls.map((c) => c.fn);
    expect(fns).toContain('getTableDimensions');
    expect(fns).toContain('getCellInfo');
  });

  // Regression — 병합 셀이 있는 표에서 c-1 / c-colCount flat-index
  // 산술이 잘못된 셀을 라벨로 가리켜 AI 가 엉뚱한 위치에 텍스트를
  // 채우던 버그. getCellInfo 기반 (row,col) 그리드 맵으로 fix.
  it('getEmptyFormFields finds correct label neighbor in merged tables', async () => {
    // 2x3 grid (rowCount=2, colCount=3), 5 cells with one cell merged across
    // bottom row (colSpan=2):
    //
    //   row 0: [0 "이름"   ][1 ""       ][2 "전화"   ]
    //   row 1: [3 "주소"   ][4 ""                    ]  ← colSpan=2
    //
    // cellCount = 5 (not 6). totalCells == 5.
    // - 빈 셀 cellIdx=1: 라벨=좌측 cellIdx=0 "이름".
    // - 빈 셀 cellIdx=4: 라벨=좌측 cellIdx=3 "주소".
    //
    // OLD flat-index 산술이라면:
    //   cellIdx=4: c % colCount = 4 % 3 = 1 > 0 → label = c-1 = 3 "주소" ✓ (운 좋게 맞음)
    //   하지만 cellIdx=1 의 top neighbor 가 (없으니 left "이름" 으로 fallback). OK.
    // 실제 깨지는 케이스: row 0 에 colSpan=2 merge 있을 때.
    //
    //   row 0: [0 "이름"          ][1 ""    ]  ← cellIdx=0 colSpan=2, cellIdx=1 colSpan=1
    //   row 1: [2 ""     ][3 ""   ][4 ""    ]  ← 3 cells
    //
    // cellCount = 5, colCount = 3.
    // - 빈 cellIdx=1 의 grid (row=0, col=2). 좌측은 grid(0, 1) → cellIdx=0
    //   ("이름") via gridMap (병합 부분이 모두 0 으로 채워짐).
    //   OLD: c-1 = 0 → "이름". 우연히 맞음.
    // - 빈 cellIdx=2 의 grid (row=1, col=0). top 은 grid(0, 0) → cellIdx=0 "이름".
    //   OLD: c-colCount = 2-3 = -1 → no top neighbor. 라벨 비어버림.
    //   NEW: 정확히 "이름" 반환.
    // - 빈 cellIdx=4 의 grid (row=1, col=2). top 은 grid(0, 2) → cellIdx=1.
    //   cellIdx=1 도 비어있으므로 라벨 비어버림. left 는 grid(1, 1) → cellIdx=3
    //   (역시 비어있음). 결국 빈 라벨.
    //   OLD: c-colCount = 4-3 = 1, 라벨 = "" (cellIdx=1 비어있음).
    //   양쪽 모두 라벨 비지만, NEW 는 leftIdx 와 topIdx 가 정확함.
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 1;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          if (p === 0 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 2,
              colCount: 3,
              cellCount: 5,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getCellInfo') {
          const [, , , cellIdx] = args as [number, number, number, number];
          // cellIdx=0: row 0 col 0 colSpan 2 (병합)
          // cellIdx=1: row 0 col 2
          // cellIdx=2: row 1 col 0
          // cellIdx=3: row 1 col 1
          // cellIdx=4: row 1 col 2
          const layout = [
            { row: 0, col: 0, rowSpan: 1, colSpan: 2 },
            { row: 0, col: 2, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 0, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 1, rowSpan: 1, colSpan: 1 },
            { row: 1, col: 2, rowSpan: 1, colSpan: 1 },
          ];
          return JSON.stringify({ ok: true, ...layout[cellIdx] });
        }
        if (fn === 'getTextInCell') {
          const [, , , cellIdx] = args as [number, number, number, number];
          if (cellIdx === 0) return '이름';
          return '';
        }
        if (fn === 'getCellCharPropertiesAt')
          return JSON.stringify({ fontFamily: '함초롬바탕', charShapeId: 13 });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const result = await h.getEmptyFormFields();

    // 4 개의 빈 셀: cellIdx 1, 2, 3, 4.
    const byCellIdx = new Map(
      result.cellFields.map((f) => [f.location.cellIndex, f]),
    );
    expect(byCellIdx.size).toBe(4);

    // cellIdx=1 의 left = grid(0,1) → cellIdx=0 "이름" (병합 셀이 col 0~1 점유).
    expect(byCellIdx.get(1)?.labelHint).toBe('이름');

    // cellIdx=2 의 left 없음 (col=0), top = grid(0,0) → cellIdx=0 "이름".
    // OLD 구현은 c-colCount = -1 이라 라벨 비었음. NEW 는 "이름" 반환.
    expect(byCellIdx.get(2)?.labelHint).toBe('이름');

    // cellIdx=3 의 left = grid(1,0) → cellIdx=2 (빈 셀, 라벨 못 찾음).
    // top = grid(0,1) → cellIdx=0 "이름" (병합 셀).
    expect(byCellIdx.get(3)?.labelHint).toBe('이름');

    // cellIdx=4 의 left = grid(1,1) → cellIdx=3 (빈 셀). top = grid(0,2) →
    // cellIdx=1 (빈 셀). 라벨 비어있음. 그래도 cell idx 자체는 정확.
    expect(byCellIdx.get(4)?.labelHint).toBe('');
  });

  // 0.6.15 — includeFilled 옵션. 채워진 셀도 isEmpty=false 와
  // contentCharShape 와 함께 반환. AI 가 placeholder (이탤릭+비검정)
  // 감지하고 replaceTextInCell 로 교체할 수 있도록.
  it('getEmptyFormFields with includeFilled returns filled cells with isEmpty + contentCharShape', async () => {
    // 2x1 표:
    //   [0 "코렌스" — 채워진 사용자 값]
    //   [1 "예) 회사명을 입력하세요" — italic blue placeholder]
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 1;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          if (p === 0 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 2,
              colCount: 1,
              cellCount: 2,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getCellInfo') {
          const [, , , cellIdx] = args as [number, number, number, number];
          return JSON.stringify({
            ok: true,
            row: cellIdx,
            col: 0,
            rowSpan: 1,
            colSpan: 1,
          });
        }
        if (fn === 'getTextInCell') {
          const [, , , cellIdx] = args as [number, number, number, number];
          if (cellIdx === 0) return '코렌스';
          if (cellIdx === 1) return '예) 회사명을 입력하세요';
          return '';
        }
        if (fn === 'getCellCharPropertiesAt') {
          const [, , , cellIdx] = args as [number, number, number, number];
          // 검정 일반 (사용자 값) vs 이탤릭 파란 (placeholder).
          if (cellIdx === 0)
            return JSON.stringify({
              fontFamily: '함초롬바탕',
              fontSize: 1000,
              italic: false,
              textColor: '#000000',
              charShapeId: 13,
            });
          return JSON.stringify({
            fontFamily: '함초롬바탕',
            fontSize: 1000,
            italic: true,
            textColor: '#0000ff',
            charShapeId: 225,
          });
        }
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);

    // Default (includeFilled=false) — 빈 셀만, 그런데 둘 다 채워져 있으니 0개.
    const onlyEmpty = await h.getEmptyFormFields();
    expect(onlyEmpty.cellFields).toHaveLength(0);

    // includeFilled=true — 채워진 셀 둘 다 반환.
    const full = await h.getEmptyFormFields({ includeFilled: true });
    expect(full.cellFields).toHaveLength(2);

    const byCellIdx = new Map(
      full.cellFields.map((f) => [f.location.cellIndex, f]),
    );
    // cellIdx=0 — 사용자 값 "코렌스", 검정 일반.
    expect(byCellIdx.get(0)).toMatchObject({
      currentText: '코렌스',
      isEmpty: false,
      contentCharShape: {
        italic: false,
        textColor: '#000000',
      },
    });
    // cellIdx=1 — placeholder, italic blue. AI 가 이를 보고 교체 판단.
    expect(byCellIdx.get(1)).toMatchObject({
      currentText: '예) 회사명을 입력하세요',
      isEmpty: false,
      contentCharShape: {
        italic: true,
        textColor: '#0000ff',
      },
    });
  });

  // 0.6.15 — replaceTextInCell: 기존 텍스트 길이만큼 deleteTextInCell 후
  // insertTextInCell. 하나의 atomic 작업 (그룹 undo 내부).
  it('replaceTextInCell deletes existing text then inserts new', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getTextInCell') return '예시 텍스트'; // 길이 6 (한글)
        if (fn === 'deleteTextInCell') return JSON.stringify({ ok: true });
        if (fn === 'insertTextInCell') return JSON.stringify({ ok: true });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const ok = await h.replaceTextInCell(0, 1, 0, 3, 0, '새 값');
    expect(ok).toBe(true);

    const fns = calls.map((c) => c.fn);
    expect(fns).toEqual([
      'getTextInCell',
      'deleteTextInCell',
      'insertTextInCell',
    ]);
    const delCall = calls.find((c) => c.fn === 'deleteTextInCell');
    // (sec, parentPara, ctrl, cellIdx, cellParaIdx, charOffset=0, count=length)
    expect(delCall?.args).toEqual([0, 1, 0, 3, 0, 0, '예시 텍스트'.length]);
    const insCall = calls.find((c) => c.fn === 'insertTextInCell');
    expect(insCall?.args).toEqual([0, 1, 0, 3, 0, 0, '새 값']);
  });

  // 0.6.15 — empty cell 인 경우 delete 호출은 건너뛰고 insert 만.
  it('replaceTextInCell skips delete when cell is empty', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getTextInCell') return '';
        if (fn === 'insertTextInCell') return JSON.stringify({ ok: true });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const ok = await h.replaceTextInCell(0, 1, 0, 3, 0, '새 값');
    expect(ok).toBe(true);

    const fns = calls.map((c) => c.fn);
    expect(fns).toEqual(['getTextInCell', 'insertTextInCell']);
    expect(fns).not.toContain('deleteTextInCell');
  });

  // 0.6.15 — text='' 는 effectively clear: delete 만 호출, insert skip.
  it('replaceTextInCell with empty text only clears (no insert)', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getTextInCell') return '지울 텍스트';
        if (fn === 'deleteTextInCell') return JSON.stringify({ ok: true });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const ok = await h.replaceTextInCell(0, 1, 0, 3, 0, '');
    expect(ok).toBe(true);

    const fns = calls.map((c) => c.fn);
    expect(fns).toEqual(['getTextInCell', 'deleteTextInCell']);
    expect(fns).not.toContain('insertTextInCell');
  });

  // 0.6.15 — delete 가 실패하면 insert 시도 안 함, false 반환.
  it('replaceTextInCell returns false when delete fails (no insert attempted)', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getTextInCell') return '기존';
        if (fn === 'deleteTextInCell')
          return JSON.stringify({ ok: false, reason: 'oob' });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const ok = await h.replaceTextInCell(0, 1, 0, 3, 0, '새');
    expect(ok).toBe(false);

    const fns = calls.map((c) => c.fn);
    expect(fns).toEqual(['getTextInCell', 'deleteTextInCell']);
    expect(fns).not.toContain('insertTextInCell');
  });

  it('getEmptyFormFields probes multiple controlIdx per paragraph', async () => {
    // paragraph 5 has two tables: ctrl=0 (1x1, filled), ctrl=1 (1x1, empty).
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 6;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          if (p !== 5) return JSON.stringify({ ok: false });
          if (ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 1,
              cellCount: 1,
            });
          if (ctrl === 1)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 1,
              cellCount: 1,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getCellInfo') {
          return JSON.stringify({
            ok: true,
            row: 0,
            col: 0,
            rowSpan: 1,
            colSpan: 1,
          });
        }
        if (fn === 'getTextInCell') {
          const [, p, ctrl] = args as [number, number, number];
          if (p === 5 && ctrl === 0) return '채워진 셀';
          if (p === 5 && ctrl === 1) return '';
          return '';
        }
        if (fn === 'getCellCharPropertiesAt') return JSON.stringify({});
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;

    const h = new BridgeIrHelper(bridge);
    const result = await h.getEmptyFormFields();
    expect(result.cellFields).toHaveLength(1);
    expect(result.cellFields[0].location).toMatchObject({
      paragraphIndex: 5,
      controlIndex: 1,
      cellIndex: 0,
    });
  });

  // Regression — helper used to pass `text` as 4th arg, but WASM
  // insertFootnote takes 3 args (sec, para, charOffset). text was silently
  // dropped → empty footnote. Fix: insertFootnote returns {paraIdx,
  // controlIdx, footnoteNumber} which we then feed to insertTextInFootnote.
  it('insertFootnoteAtCaret calls insertFootnote(3 args) + insertTextInFootnote', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getCaretPosition')
          return { sectionIndex: 0, paragraphIndex: 5, charOffset: 3 };
        if (fn === 'insertFootnote')
          return JSON.stringify({
            ok: true,
            paraIdx: 5,
            controlIdx: 2,
            footnoteNumber: 1,
          });
        if (fn === 'insertTextInFootnote') return JSON.stringify({ ok: true });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const ok = await h.insertFootnoteAtCaret('각주 본문');
    expect(ok).toBe(true);
    const insertCall = calls.find((c) => c.fn === 'insertFootnote');
    expect(insertCall?.args).toEqual([0, 5, 3]); // exactly 3 args
    const textCall = calls.find((c) => c.fn === 'insertTextInFootnote');
    expect(textCall?.args).toEqual([0, 5, 2, 0, 0, '각주 본문']);
  });

  // Regression — setHeaderFooterText was calling a phantom WASM name.
  // Fix: composite getHeaderFooter (create if missing) → clear → insert.
  it('setHeaderFooterText composite: getHeaderFooter → delete existing → insert new', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getHeaderFooter')
          return JSON.stringify({ ok: true, exists: true, paraCount: 1 });
        if (fn === 'getHeaderFooterParaInfo')
          return JSON.stringify({ ok: true, charCount: 7 });
        if (fn === 'deleteTextInHeaderFooter')
          return JSON.stringify({ ok: true });
        if (fn === 'insertTextInHeaderFooter')
          return JSON.stringify({ ok: true, charOffset: 4 });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const ok = await h.setHeaderFooterText(0, true, 0, '새 머리말');
    expect(ok).toBe(true);
    const fns = calls.map((c) => c.fn);
    expect(fns).toContain('getHeaderFooter');
    expect(fns).toContain('deleteTextInHeaderFooter');
    expect(fns).toContain('insertTextInHeaderFooter');
    expect(fns).not.toContain('setHeaderFooterText'); // phantom — never called
    const del = calls.find((c) => c.fn === 'deleteTextInHeaderFooter');
    expect(del?.args).toEqual([0, true, 0, 0, 0, 7]); // clears existing 7 chars
    const ins = calls.find((c) => c.fn === 'insertTextInHeaderFooter');
    expect(ins?.args).toEqual([0, true, 0, 0, 0, '새 머리말']);
  });

  it('setHeaderFooterText creates HF when exists=false', async () => {
    const seen: string[] = [];
    let hfExists = false;
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        seen.push(fn);
        if (fn === 'getHeaderFooter')
          return JSON.stringify(
            hfExists
              ? { ok: true, exists: true, paraCount: 1 }
              : { ok: true, exists: false },
          );
        if (fn === 'createHeaderFooter') {
          hfExists = true;
          return JSON.stringify({ ok: true });
        }
        if (fn === 'getHeaderFooterParaInfo')
          return JSON.stringify({ ok: true, charCount: 0 });
        if (fn === 'insertTextInHeaderFooter')
          return JSON.stringify({ ok: true });
        throw new Error(`unmocked: ${fn} ${JSON.stringify(args)}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    expect(await h.setHeaderFooterText(0, false, 0, 'X')).toBe(true);
    expect(seen).toContain('createHeaderFooter');
  });

  // Regression — helper called phantom `getStyleListJson`. The real WASM
  // method is `getStyleList` and it returns a JSON string we must parse.
  it('getStyleList uses correct WASM name and parses JSON string', async () => {
    const calls: string[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string) => {
        calls.push(fn);
        if (fn === 'getStyleList')
          return JSON.stringify([
            { id: 0, name: '바탕글' },
            { id: 2, name: '개요 1' },
            { id: 3, name: '개요 2' },
          ]);
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const out = await h.getStyleList();
    expect(out).toEqual([
      { id: 0, name: '바탕글' },
      { id: 2, name: '개요 1' },
      { id: 3, name: '개요 2' },
    ]);
    expect(calls).not.toContain('getStyleListJson');
    expect(calls).toContain('getStyleList');
  });

  // Regression — outline previously read non-existent ParaProperties.styleId.
  // The real source of paragraph-level styleId is getStyleAt(s, p).
  it('getDocumentOutline uses getStyleAt for styleId resolution', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 3;
        if (fn === 'getStyleList')
          return JSON.stringify([
            { id: 0, name: '바탕글' },
            { id: 2, name: '개요 1' },
            { id: 3, name: '개요 2' },
          ]);
        if (fn === 'getStyleAt') {
          const [, p] = args as [number, number];
          if (p === 0)
            return JSON.stringify({ ok: true, id: 2, name: '개요 1' });
          if (p === 1)
            return JSON.stringify({ ok: true, id: 0, name: '바탕글' });
          if (p === 2)
            return JSON.stringify({ ok: true, id: 3, name: '개요 2' });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getParagraphLength') {
          const [, p] = args as [number, number];
          return p === 1 ? 5 : 7;
        }
        if (fn === 'getTextRange') {
          const [, p] = args as [number, number];
          if (p === 0) return '1장 개요';
          if (p === 2) return '1.1 세부';
          return 'body';
        }
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const out = await h.getDocumentOutline();
    expect(out).toEqual([
      { sectionIndex: 0, paragraphIndex: 0, level: 1, text: '1장 개요' },
      { sectionIndex: 0, paragraphIndex: 2, level: 2, text: '1.1 세부' },
    ]);
    expect(calls.some((c) => c.fn === 'getStyleAt')).toBe(true);
  });

  // Regression — applyHtmlAtCaret used to check `typeof r === 'object'`
  // even though pasteHtml returns a JSON string. Result {"ok":false,...}
  // was treated as success. isOk() handles both shapes.
  it('applyHtmlAtCaret returns false when pasteHtml reports {ok:false} as string', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string) => {
        if (fn === 'getCaretPosition')
          return { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
        if (fn === 'pasteHtml')
          return JSON.stringify({ ok: false, reason: 'malformed' });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    expect(await h.applyHtmlAtCaret('<p>x</p>')).toBe(false);
  });

  it('applyHtmlAtCaret returns true on {ok:true} string', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string) => {
        if (fn === 'getCaretPosition')
          return { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
        if (fn === 'pasteHtml') return JSON.stringify({ ok: true });
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    expect(await h.applyHtmlAtCaret('<p>x</p>')).toBe(true);
  });

  // Enhancement — getEmptyFormFields now returns tableInventory and
  // honors opts.parentParaIdx for table-specific scoping.
  it('getEmptyFormFields returns tableInventory and honors parentParaIdx scope', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 10;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          if (p === 3 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 2,
              cellCount: 2,
            });
          if (p === 7 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 2,
              cellCount: 2,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getCellInfo') {
          const [, , , cellIdx] = args as [number, number, number, number];
          // 1x2 표: cellIdx=0 (0,0), cellIdx=1 (0,1).
          return JSON.stringify({
            ok: true,
            row: 0,
            col: cellIdx,
            rowSpan: 1,
            colSpan: 1,
          });
        }
        if (fn === 'getTextInCell') {
          const [, p, , c] = args as [number, number, number, number];
          if (p === 3 && c === 0) return '회사명';
          if (p === 3 && c === 1) return '';
          if (p === 7 && c === 0) return '주소';
          if (p === 7 && c === 1) return '';
          return '';
        }
        if (fn === 'getCellCharPropertiesAt') return JSON.stringify({});
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);

    // Without scoping — sees both tables.
    const full = await h.getEmptyFormFields();
    expect(full.tableInventory).toHaveLength(2);
    expect(full.tableInventory[0]).toMatchObject({
      paragraphIndex: 3,
      emptyCells: 1,
      sampleLabel: '회사명',
    });
    expect(full.tableInventory[1]).toMatchObject({
      paragraphIndex: 7,
      sampleLabel: '주소',
    });
    expect(full.cellFields).toHaveLength(2);

    // Scoped to one table.
    const scoped = await h.getEmptyFormFields({ parentParaIdx: 7 });
    expect(scoped.tableInventory).toHaveLength(1);
    expect(scoped.tableInventory[0].paragraphIndex).toBe(7);
    expect(scoped.cellFields).toHaveLength(1);
    expect(scoped.cellFields[0].location.paragraphIndex).toBe(7);
    expect(scoped.cellFields[0].labelHint).toBe('주소');
  });

  it('getEmptyFormFields keeps counting emptyCells in tableInventory after maxResults cap', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 1;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          if (p === 0 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 5,
              cellCount: 5,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getTextInCell') {
          const [, , , c] = args as [number, number, number, number];
          return c === 0 ? '라벨' : '';
        }
        if (fn === 'getCellCharPropertiesAt') return JSON.stringify({});
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const r = await h.getEmptyFormFields({ maxResults: 2 });
    expect(r.truncated).toBe(true);
    expect(r.cellFields).toHaveLength(2);
    // All 4 empty cells (c=1..4) accounted for in inventory despite the cap.
    expect(r.tableInventory[0].emptyCells).toBe(4);
  });

  it('getStyleAt composite — 2 calls (getStyleAt + getStyleDetail)', async () => {
    const calls: { fn: string; args: unknown[] }[] = [];
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        calls.push({ fn, args });
        if (fn === 'getStyleAt') return { id: 5, name: '본문' };
        if (fn === 'getStyleDetail')
          return { fontSize: 1000, alignment: 'left' };
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const out = await h.getStyleAt(0, 2);
    expect(out).toEqual({ fontSize: 1000, alignment: 'left', styleId: 5 });
    expect(calls.map((c) => c.fn)).toEqual(['getStyleAt', 'getStyleDetail']);
    expect(calls[1].args).toEqual([5]);
  });

  // 0.6.14 — form-structure prefix in getDocumentSummary. Without this hint
  // the model treats the doc as prose and uses body-level patches that
  // duplicate headings and skip table cells. Verified failure mode in live
  // test session — see commit message for details.
  it('getDocumentSummary prefixes [form: ...] when doc contains empty cells', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 3;
        if (fn === 'getTableDimensions') {
          const [, p, ctrl] = args as [number, number, number];
          if (p === 1 && ctrl === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 2,
              cellCount: 2,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getTextInCell') {
          const [, , , c] = args as [number, number, number, number];
          return c === 0 ? '도입기업명' : '';
        }
        if (fn === 'getParagraphLength') {
          const [, p] = args as [number, number];
          return p === 0 ? 7 : 0;
        }
        if (fn === 'getTextRange') return '문서 제목';
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const summary = await h.getDocumentSummary();
    expect(summary).toMatch(/^\[form: 1 tables, 1 empty cells/);
    expect(summary).toContain('문서 제목');
  });

  it('getDocumentSummary omits prefix for prose-only docs (no tables)', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 2;
        if (fn === 'getTableDimensions') return JSON.stringify({ ok: false });
        if (fn === 'getParagraphLength') {
          const [, p] = args as [number, number];
          return p === 0 ? 9 : 0;
        }
        if (fn === 'getTextRange') return '본문 텍스트';
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const summary = await h.getDocumentSummary();
    expect(summary).not.toMatch(/\[form:/);
    expect(summary).toContain('본문 텍스트');
  });

  it('getDocumentSummary omits prefix when tables exist but all cells filled', async () => {
    const bridge = {
      invokeWasm: vi.fn(async (fn: string, args: unknown[]) => {
        if (fn === 'getSectionCount') return 1;
        if (fn === 'getParagraphCount') return 2;
        if (fn === 'getTableDimensions') {
          const [, p] = args as [number, number];
          if (p === 0)
            return JSON.stringify({
              ok: true,
              rowCount: 1,
              colCount: 1,
              cellCount: 1,
            });
          return JSON.stringify({ ok: false });
        }
        if (fn === 'getTextInCell') return '이미 채워진 값';
        if (fn === 'getParagraphLength') return 0;
        throw new Error(`unmocked: ${fn}`);
      }),
    } as unknown as import('@/lib/rhwp-bridge').RhwpBridge;
    const h = new BridgeIrHelper(bridge);
    const summary = await h.getDocumentSummary();
    // No empty cells → no form prefix; user shouldn't be steered to fill.
    expect(summary).not.toMatch(/\[form:/);
  });
});
