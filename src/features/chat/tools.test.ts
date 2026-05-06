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
