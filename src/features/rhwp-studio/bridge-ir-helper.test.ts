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
});
