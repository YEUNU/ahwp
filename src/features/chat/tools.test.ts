/**
 * Unit tests for `runTools` dispatcher guards (0.4.12).
 *
 * Focus: hard-block insertText at (0,0,0) with multi-paragraph text —
 * common LLM mistake on form / template documents.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ViewerHandle } from './viewer-handle-types';
import { runTools } from './tools';
import type { AhwpPreflightItem } from '@shared/ai-tools';

function mockViewer(overrides: Partial<ViewerHandle> = {}): ViewerHandle {
  return {
    beginUndoGroup: vi.fn(),
    endUndoGroup: vi.fn(),
    irInsertText: vi.fn(() => true),
    irDeleteRange: vi.fn(() => true),
    irGetTextRange: vi.fn(() => ''),
    irGetTextInCell: vi.fn(() => ''),
    irInsertTextInCell: vi.fn(() => true),
    // 0.4.26 — 0.7.11 신규 API + 0.4.21 form-fields 의 mock defaults.
    irInsertEquation: vi.fn(() => true),
    irDeleteFootnote: vi.fn(() => true),
    irDeleteEquationControl: vi.fn(() => true),
    irGetColumnDef: vi.fn(() => ({})),
    irGetFootnoteAtCursor: vi.fn(() => ({})),
    getEmptyFormFields: vi.fn(() => ({ cellFields: [], truncated: false })),
    applyHtmlAtCaret: vi.fn(),
    snapshotParagraphs: () => new Map(),
    markChangedParagraphsSince: vi.fn(),
    ...overrides,
  } as unknown as ViewerHandle;
}

describe('runTools — insertText guards', () => {
  it('rejects insertText at (0,0,0) with multi-paragraph text — protects form layout', async () => {
    const viewer = mockViewer();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 0,
            charOffset: 0,
            text: 'Title\n\nBody paragraph 1\nBody paragraph 2',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(false);
    expect(results[0].ok ? null : results[0].reason).toMatch(
      /insertText-at-doc-start-with-multiline-rejected/,
    );
    // viewer.irInsertText must NOT have been called — the guard short-circuits.
    expect(viewer.irInsertText).not.toHaveBeenCalled();
  });

  it('allows insertText at (0,0,0) with single-line text', async () => {
    const viewer = mockViewer();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 0,
            charOffset: 0,
            text: '한 줄짜리 텍스트',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(viewer.irInsertText).toHaveBeenCalledWith(
      0,
      0,
      0,
      '한 줄짜리 텍스트',
    );
  });

  it('allows insertText at non-(0,0,0) anchor even with multi-paragraph text', async () => {
    const viewer = mockViewer();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 5,
            charOffset: 0,
            text: 'paragraph A\nparagraph B',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(viewer.irInsertText).toHaveBeenCalledWith(
      0,
      5,
      0,
      'paragraph A\nparagraph B',
    );
  });

  it('allows insertText at (0,0,N>0) — caret already inside the first paragraph', async () => {
    const viewer = mockViewer();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 0,
            charOffset: 5,
            text: 'append\nmore',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
  });

  it('rejects applyHtml when caret=(0,0,0) on non-empty doc — parallel guard (0.6.7)', async () => {
    // helper 모드 한정 가드. caret=(0,0,0) + paragraphCount > 1 면 reject.
    const viewer = mockViewer();
    const helper = {
      async getCaretPosition() {
        return { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
      },
      async getParagraphCount() {
        return 8; // non-trivial 문서 (양식 / 보고서)
      },
      async getParagraphLength() {
        return 0;
      },
      async applyHtmlAtCaret() {
        return true;
      },
    } as unknown as import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'applyHtml',
          args: { html: '<h1>제목</h1><p>본문</p>' },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(false);
    expect(results[0].ok ? null : results[0].reason).toMatch(
      /applyHtml-at-doc-start-rejected/,
    );
  });

  it('allows applyHtml when caret=(0,0,0) on fresh-blank doc', async () => {
    const viewer = mockViewer();
    const applyMock = vi.fn(async () => true);
    const helper = {
      async getCaretPosition() {
        return { sectionIndex: 0, paragraphIndex: 0, charOffset: 0 };
      },
      async getParagraphCount() {
        return 1;
      },
      async getParagraphLength() {
        return 0;
      },
      applyHtmlAtCaret: applyMock,
    } as unknown as import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'applyHtml',
          args: { html: '<p>첫 문장</p>' },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(true);
    expect(applyMock).toHaveBeenCalledWith('<p>첫 문장</p>');
  });

  it('allows applyHtml when caret is NOT (0,0,0) — anchor moved first', async () => {
    const viewer = mockViewer();
    const applyMock = vi.fn(async () => true);
    const helper = {
      async getCaretPosition() {
        return { sectionIndex: 0, paragraphIndex: 5, charOffset: 0 };
      },
      async getParagraphCount() {
        return 12;
      },
      async getParagraphLength() {
        return 30;
      },
      applyHtmlAtCaret: applyMock,
    } as unknown as import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'applyHtml',
          args: { html: '<h2>1.1 목표</h2><p>본문</p>' },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(true);
    expect(applyMock).toHaveBeenCalled();
  });

  it('begins + ends undo group exactly once even when guard rejects', async () => {
    const begin = vi.fn();
    const end = vi.fn();
    const viewer = mockViewer({
      beginUndoGroup: begin,
      endUndoGroup: end,
    });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 0,
            charOffset: 0,
            text: 'a\nb',
          },
        },
      },
    ];
    await runTools(viewer, items);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });
});

// 0.4.26 — 0.4.24 신규 5 종 + 0.4.21 getEmptyFormFields dispatch 검증.
describe('runTools — 0.7.11 신규 API dispatch', () => {
  it('insertEquation: passes args through with default size/color', async () => {
    const ins = vi.fn(() => true);
    const viewer = mockViewer({ irInsertEquation: ins });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertEquation',
          args: {
            sectionIdx: 0,
            paragraphIdx: 2,
            charOffset: 3,
            script: 'x^2 + y^2 = z^2',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(ins).toHaveBeenCalledWith(
      0,
      2,
      3,
      'x^2 + y^2 = z^2',
      undefined,
      undefined,
    );
  });

  it('deleteFootnote: routes (sec, para, ctrl)', async () => {
    const del = vi.fn(() => true);
    const viewer = mockViewer({ irDeleteFootnote: del });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'deleteFootnote',
          args: { sectionIdx: 0, paragraphIdx: 5, controlIdx: 1 },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(del).toHaveBeenCalledWith(0, 5, 1);
  });

  it('deleteEquationControl: routes (sec, parentPara, ctrl)', async () => {
    const del = vi.fn(() => true);
    const viewer = mockViewer({ irDeleteEquationControl: del });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'deleteEquationControl',
          args: { sectionIdx: 0, parentParaIdx: 4, controlIdx: 2 },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(del).toHaveBeenCalledWith(0, 4, 2);
  });

  it('getColumnDef: returns data on success', async () => {
    const data = {
      columnCount: 2,
      columnType: 0,
      sameWidth: 1,
      spacingHu: 567,
    };
    const get = vi.fn(() => data);
    const viewer = mockViewer({ irGetColumnDef: get });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: { tool: 'getColumnDef', args: { sectionIdx: 0 } },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].data).toEqual(data);
    }
  });

  it('getFootnoteAtCursor: passes direction through', async () => {
    const get = vi.fn(() => ({ controlIdx: 1, paragraphIdx: 3 }));
    const viewer = mockViewer({ irGetFootnoteAtCursor: get });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'getFootnoteAtCursor',
          args: {
            sectionIdx: 0,
            paragraphIdx: 3,
            charOffset: 10,
            direction: 'backward',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(get).toHaveBeenCalledWith(0, 3, 10, 'backward');
  });

  it('getEmptyFormFields: returns null → failed', async () => {
    const get = vi.fn(() => null);
    const viewer = mockViewer({ getEmptyFormFields: get });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: { tool: 'getEmptyFormFields', args: {} },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].reason).toBe('getEmptyFormFields-failed');
    }
  });
});

// Phase D2b — helper (BridgeIrHelper) 경로 회귀. tools.ts 의 insertText /
// insertTextInCell case 가 helper 가용 시 viewer.irX 대신 helper.X 를
// 부르고, 결과 (특히 diff before/after) 가 helper 로부터 계산되는지
// 확인. helper 는 minimal stub — 실제 RhwpBridge round-trip 은 별도 e2e.
describe('runTools — Phase D2b helper routing', () => {
  // BridgeIrHelper 의 method 시그너처를 만족하는 최소 stub. 시그너처
  // 자체는 `as unknown as BridgeIrHelper` 로 우회 — args 는 rest 로 받고
  // 필요한 인덱스만 사용.
  function makeHelperStub(): {
    helper: import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;
    calls: string[];
  } {
    const calls: string[] = [];
    const helper = {
      async getTextRange(...args: unknown[]): Promise<string> {
        const sp = args[1] as number;
        calls.push(`getTextRange#${sp}`);
        return `text-${sp}`;
      },
      async getTextInCell(...args: unknown[]): Promise<string> {
        void args;
        calls.push('getTextInCell');
        return 'cell-text';
      },
      async insertText(...args: unknown[]): Promise<boolean> {
        const text = args[3] as string;
        calls.push(`insertText:${text}`);
        return true;
      },
      async insertTextInCell(...args: unknown[]): Promise<boolean> {
        const text = args[6] as string;
        calls.push(`insertTextInCell:${text}`);
        return true;
      },
    } as unknown as import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;
    return { helper, calls };
  }

  it('insertText routes to helper when provided — viewer.irX not called', async () => {
    const irInsertText = vi.fn(() => true);
    const irGetTextRange = vi.fn(() => 'v');
    const viewer = mockViewer({ irInsertText, irGetTextRange });
    const { helper, calls } = makeHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 3,
            charOffset: 0,
            text: 'hello',
          },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(true);
    // viewer.irX 가 호출 안 됨.
    expect(irInsertText).not.toHaveBeenCalled();
    expect(irGetTextRange).not.toHaveBeenCalled();
    // helper 가 before/insert/after 순서로 호출.
    expect(calls).toEqual([
      'getTextRange#3',
      'insertText:hello',
      'getTextRange#3',
    ]);
    // diff 가 helper 응답으로 계산 (단락 #3 → 'text-3').
    if (results[0].ok && results[0].diff) {
      expect(results[0].diff.before).toBe('text-3');
      expect(results[0].diff.after).toBe('text-3');
    }
  });

  it('insertText without helper falls back to viewer.irX', async () => {
    const irInsertText = vi.fn(() => true);
    const irGetTextRange = vi.fn(() => 'old');
    const viewer = mockViewer({ irInsertText, irGetTextRange });
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 2,
            charOffset: 0,
            text: 'x',
          },
        },
      },
    ];
    const results = await runTools(viewer, items);
    expect(results[0].ok).toBe(true);
    expect(irInsertText).toHaveBeenCalledTimes(1);
    // diff 의 before/after 둘 다 viewer 응답으로 채워짐 → 2 회 호출.
    expect(irGetTextRange).toHaveBeenCalledTimes(2);
  });

  it('insertTextInCell routes to helper when provided', async () => {
    const irInsertTextInCell = vi.fn(() => true);
    const irGetTextInCell = vi.fn(() => 'old-cell');
    const viewer = mockViewer({ irInsertTextInCell, irGetTextInCell });
    const { helper, calls } = makeHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertTextInCell',
          args: {
            sectionIdx: 0,
            parentParaIdx: 5,
            controlIdx: 0,
            cellIdx: 1,
            cellParaIdx: 0,
            charOffset: 0,
            text: 'X',
          },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(true);
    expect(irInsertTextInCell).not.toHaveBeenCalled();
    expect(irGetTextInCell).not.toHaveBeenCalled();
    expect(calls).toEqual([
      'getTextInCell',
      'insertTextInCell:X',
      'getTextInCell',
    ]);
  });

  it('insertText hard-guard still fires before helper — guard runs unconditionally', async () => {
    const viewer = mockViewer();
    const { helper, calls } = makeHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'insertText',
          args: {
            sectionIdx: 0,
            paragraphIdx: 0,
            charOffset: 0,
            text: 'Title\n\nBody',
          },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(false);
    // guard 가 helper 호출 전에 reject.
    expect(calls).toHaveLength(0);
  });
});

// Phase 7 E2-finalize — 24 restored AI tool cases. runTools dispatcher
// 가 각 case 에서 helper 의 올바른 메서드를 호출하는지 mock 으로 검증.
// helper 가 호출되는 동안 viewer.X 가 호출 안 되어야 (NULL_VIEWER_STUB
// throw 안 일어남). 또 args 가 정확히 전달되는지 (= 이중변환 X) 확인.
describe('runTools — Phase E2-finalize 24 restored composites', () => {
  type CallLog = { fn: string; args: unknown[] };

  function makeFullHelperStub(
    overrides: Partial<
      Record<string, (...args: unknown[]) => Promise<unknown>>
    > = {},
  ): {
    helper: import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;
    log: CallLog[];
  } {
    const log: CallLog[] = [];
    const track =
      <T>(fn: string, ret: T) =>
      async (...args: unknown[]): Promise<T> => {
        log.push({ fn, args });
        return ret;
      };
    const stub = {
      // composite reads
      getCaretPosition: track('getCaretPosition', {
        sectionIndex: 0,
        paragraphIndex: 2,
        charOffset: 5,
      }),
      getParagraphLength: track('getParagraphLength', 10),
      getCharPropertiesAt: track('getCharPropertiesAt', {
        bold: false,
        italic: false,
      }),
      getParaPropertiesAt: track('getParaPropertiesAt', { alignment: 'left' }),
      getDocumentOutline: track('getDocumentOutline', []),
      getDocumentSummary: track('getDocumentSummary', 'summary text'),
      getStyleList: track('getStyleList', []),
      getEmptyFormFields: track('getEmptyFormFields', {
        cellFields: [],
        truncated: false,
      }),
      evaluateTableFormula: track('evaluateTableFormula', { value: 42 }),
      // write op composites
      applyParaProps: track('applyParaProps', true),
      applyAlignmentAtCaret: track('applyAlignmentAtCaret', true),
      applyFontSizePtAtCaret: track('applyFontSizePtAtCaret', true),
      applyTextColorAtCaret: track('applyTextColorAtCaret', true),
      toggleCharFormatAtCaret: track('toggleCharFormatAtCaret', true),
      insertFootnoteAtCaret: track('insertFootnoteAtCaret', true),
      addBookmarkAtCaret: track('addBookmarkAtCaret', true),
      deleteBookmarkAt: track('deleteBookmarkAt', true),
      setHeaderFooterText: track('setHeaderFooterText', true),
      setPageDef: track('setPageDef', true),
      setTableProperties: track('setTableProperties', true),
      setCellProperties: track('setCellProperties', true),
      setPictureProperties: track('setPictureProperties', true),
      deletePictureControl: track('deletePictureControl', true),
      applyCellStyle: track('applyCellStyle', true),
      createNamedStyle: track('createNamedStyle', 7), // returned id > 0
      createRectShapeAtCaret: track('createRectShapeAtCaret', {
        ok: true,
        paraIdx: 1,
        controlIdx: 0,
      }),
      insertPictureAtCaret: track('insertPictureAtCaret', true),
      applyHtmlAtCaret: track('applyHtmlAtCaret', true),
      ...overrides,
    };
    return {
      helper:
        stub as unknown as import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper,
      log,
    };
  }

  // 일관성 검증: ahwp 측 args 에 객체로 들어간 props 가 helper 의 args
  // 에 그대로 객체로 보존되는지 확인 (이중변환 fix 회귀).
  it('setTableProperties — props 객체 그대로 helper 로 전달 (no JSON.stringify)', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const props = { tableWidth: 5000, vertAlign: 'center' };
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'setTableProperties',
          args: {
            sectionIdx: 0,
            parentParaIdx: 3,
            controlIdx: 0,
            props,
          },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(true);
    expect(log).toHaveLength(1);
    expect(log[0].fn).toBe('setTableProperties');
    // 4번째 args 가 객체 그대로 — JSON string 이 아님.
    expect(log[0].args[3]).toEqual(props);
    expect(typeof log[0].args[3]).toBe('object');
  });

  it('setCellProperties / setPictureProperties — props 객체 보존', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'setCellProperties',
          args: {
            sectionIdx: 0,
            parentParaIdx: 1,
            controlIdx: 0,
            cellIdx: 3,
            props: { bgColor: '#ff0000' },
          },
        },
      },
      {
        ok: true,
        call: {
          tool: 'setPictureProperties',
          args: {
            sectionIdx: 0,
            parentParaIdx: 5,
            controlIdx: 0,
            props: { widthHwpunit: 10000 },
          },
        },
      },
    ];
    await runTools(viewer, items, helper);
    expect(log.map((c) => c.fn)).toEqual([
      'setCellProperties',
      'setPictureProperties',
    ]);
    expect(log[0].args[4]).toEqual({ bgColor: '#ff0000' });
    expect(log[1].args[3]).toEqual({ widthHwpunit: 10000 });
  });

  it('applyAlignment / applyFontSize / applyTextColor — caret-bound composite', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      { ok: true, call: { tool: 'applyAlignment', args: { align: 'center' } } },
      { ok: true, call: { tool: 'applyFontSize', args: { pt: 14 } } },
      { ok: true, call: { tool: 'applyTextColor', args: { hex: '#0000ff' } } },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(log.map((c) => c.fn)).toEqual([
      'applyAlignmentAtCaret',
      'applyFontSizePtAtCaret',
      'applyTextColorAtCaret',
    ]);
    expect(log[0].args[0]).toBe('center');
    expect(log[1].args[0]).toBe(14);
    expect(log[2].args[0]).toBe('#0000ff');
  });

  it('toggleCharFormat / insertFootnote / addBookmark / deleteBookmark', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      { ok: true, call: { tool: 'toggleCharFormat', args: { key: 'bold' } } },
      {
        ok: true,
        call: { tool: 'insertFootnote', args: { text: 'note text' } },
      },
      { ok: true, call: { tool: 'addBookmark', args: { name: 'BM1' } } },
      {
        ok: true,
        call: {
          tool: 'deleteBookmark',
          args: { sectionIdx: 0, paragraphIdx: 3, controlIdx: 1 },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(log.map((c) => c.fn)).toEqual([
      'toggleCharFormatAtCaret',
      'insertFootnoteAtCaret',
      'addBookmarkAtCaret',
      'deleteBookmarkAt',
    ]);
  });

  it('applyPageDef / setHeaderFooterText / applyHtml', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'applyPageDef',
          args: { sectionIdx: 0, props: { marginLeft: 1000 } },
        },
      },
      {
        ok: true,
        call: {
          tool: 'setHeaderFooterText',
          args: { sectionIdx: 0, isHeader: true, applyTo: 0, text: '머리말' },
        },
      },
      {
        ok: true,
        call: { tool: 'applyHtml', args: { html: '<h1>Hi</h1>' } },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results.every((r) => r.ok)).toBe(true);
    // 0.6.7 — applyHtml 의 pre-check 가 getCaretPosition 한 번 호출 (caret
    // != (0,0,0) 이면 guard 통과, applyHtmlAtCaret 진행).
    expect(log.map((c) => c.fn)).toEqual([
      'setPageDef',
      'setHeaderFooterText',
      'getCaretPosition',
      'applyHtmlAtCaret',
    ]);
    expect(log[0].args[0]).toBe(0);
    expect(log[0].args[1]).toEqual({ marginLeft: 1000 }); // 객체 그대로
    expect(log[1].args).toEqual([0, true, 0, '머리말']);
    // log[2] = getCaretPosition (guard pre-check)
    expect(log[3].args[0]).toBe('<h1>Hi</h1>');
  });

  it('createNamedStyle / createRectShape / applyCellStyle / evaluateTableFormula / insertPicture', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'createNamedStyle',
          args: { name: '본문', englishName: 'Body' },
        },
      },
      {
        ok: true,
        call: {
          tool: 'createRectShape',
          args: { widthHwpunit: 3000, heightHwpunit: 2000, opts: {} },
        },
      },
      {
        ok: true,
        call: {
          tool: 'applyCellStyle',
          args: {
            sectionIdx: 0,
            parentParaIdx: 1,
            controlIdx: 0,
            cellIdx: 4,
            cellParaIdx: 0,
            styleId: 3,
          },
        },
      },
      {
        ok: true,
        call: {
          tool: 'evaluateTableFormula',
          args: {
            sectionIdx: 0,
            parentParaIdx: 2,
            controlIdx: 0,
            targetRow: 3,
            targetCol: 1,
            formula: 'SUM(A1:A3)',
            writeResult: true,
          },
        },
      },
      {
        ok: true,
        call: {
          tool: 'insertPicture',
          args: {
            sectionIdx: 0,
            paragraphIdx: 5,
            charOffset: 0,
            base64Data: 'AAAA',
            widthHwpunit: 5000,
            heightHwpunit: 5000,
            naturalWidthPx: 100,
            naturalHeightPx: 100,
            extension: 'png',
            description: 'img',
          },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(log.map((c) => c.fn)).toEqual([
      'createNamedStyle',
      'createRectShapeAtCaret',
      'applyCellStyle',
      'evaluateTableFormula',
      'insertPictureAtCaret',
    ]);
  });

  it('applyParaProps — composite (getCaretPosition + applyParaProps)', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'applyParaProps',
          args: { props: { indentLeft: 500 } },
        },
      },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(true);
    // composite: 먼저 getCaretPosition, 그 다음 applyParaProps.
    expect(log.map((c) => c.fn)).toEqual([
      'getCaretPosition',
      'applyParaProps',
    ]);
    expect(log[1].args[2]).toEqual({ indentLeft: 500 }); // 객체 보존
  });

  it('getDocumentOutline / getDocumentSummary / getStyleListJson / getEmptyFormFields', async () => {
    const viewer = mockViewer();
    const { helper, log } = makeFullHelperStub();
    const items: AhwpPreflightItem[] = [
      { ok: true, call: { tool: 'getDocumentOutline', args: {} } },
      { ok: true, call: { tool: 'getDocumentSummary', args: {} } },
      { ok: true, call: { tool: 'getStyleListJson', args: {} } },
      { ok: true, call: { tool: 'getEmptyFormFields', args: {} } },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(log.map((c) => c.fn)).toEqual([
      'getDocumentOutline',
      'getDocumentSummary',
      'getStyleList',
      'getEmptyFormFields',
    ]);
    // 응답 데이터가 그대로 result.data 에 들어감.
    if (results[1].ok && 'data' in results[1]) {
      expect(results[1].data).toBe('summary text');
    }
  });

  it('helper.foo 가 false 반환 → tool result.ok=false + 명확한 reason', async () => {
    const viewer = mockViewer();
    const { helper } = makeFullHelperStub({
      applyAlignmentAtCaret: async () => false,
    });
    const items: AhwpPreflightItem[] = [
      { ok: true, call: { tool: 'applyAlignment', args: { align: 'center' } } },
    ];
    const results = await runTools(viewer, items, helper);
    expect(results[0].ok).toBe(false);
    if (!results[0].ok) {
      expect(results[0].reason).toBe('applyAlignment-failed');
    }
  });
});
