/**
 * Unit tests for `runTools` dispatcher guards (0.4.12).
 *
 * Focus: hard-block insertText at (0,0,0) with multi-paragraph text —
 * common LLM mistake on form / template documents.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ViewerHandle } from '@/features/studio/types';
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
