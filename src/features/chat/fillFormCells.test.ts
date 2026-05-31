/**
 * fillFormCells (0.7.13) dispatch — runTools 가 cells[] 를 helper 의
 * insertTextInCell / replaceTextInCell 로 mode 별 라우팅하고 filled/failed
 * 를 집계하는지 검증. 전부 실패면 ok:false, 부분/전체 성공이면 ok:true +
 * data.failures.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ViewerHandle } from './viewer-handle-types';
import { runTools } from './tools';
import type { AhwpPreflightItem } from '@shared/ai-tools';

type CellHelper =
  import('@/features/rhwp-studio/bridge-ir-helper').BridgeIrHelper;

function mockViewer(overrides: Partial<ViewerHandle> = {}): ViewerHandle {
  return {
    beginUndoGroup: vi.fn(),
    endUndoGroup: vi.fn(),
    irInsertText: vi.fn(() => true),
    irDeleteRange: vi.fn(() => true),
    irGetTextRange: vi.fn(() => ''),
    irGetTextInCell: vi.fn(() => ''),
    irInsertTextInCell: vi.fn(() => true),
    getEmptyFormFields: vi.fn(() => ({ cellFields: [], truncated: false })),
    applyHtmlAtCaret: vi.fn(),
    snapshotParagraphs: () => new Map(),
    markChangedParagraphsSince: vi.fn(),
    ...overrides,
  } as unknown as ViewerHandle;
}

describe('runTools — fillFormCells bulk dispatch', () => {
  it('insert + replace 라우팅 + filled/failed 집계 (부분 실패 → ok:true)', async () => {
    const calls: string[] = [];
    const helper = {
      async getTextInCell(): Promise<string> {
        return '';
      },
      async insertTextInCell(...args: unknown[]): Promise<boolean> {
        const cell = args[3] as number;
        calls.push(`insert#${cell}`);
        return cell !== 99; // cell 99 만 실패 시뮬
      },
      async replaceTextInCell(...args: unknown[]): Promise<boolean> {
        const cell = args[3] as number;
        calls.push(`replace#${cell}`);
        return true;
      },
    } as unknown as CellHelper;
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'fillFormCells',
          args: {
            cells: [
              {
                sectionIdx: 0,
                parentParaIdx: 42,
                controlIdx: 0,
                cellIdx: 2,
                cellParaIdx: 0,
                text: 'a',
              },
              {
                sectionIdx: 0,
                parentParaIdx: 42,
                controlIdx: 0,
                cellIdx: 4,
                cellParaIdx: 0,
                text: 'b',
                mode: 'replace',
              },
              {
                sectionIdx: 0,
                parentParaIdx: 42,
                controlIdx: 0,
                cellIdx: 99,
                cellParaIdx: 0,
                text: 'c',
              },
            ],
          },
        },
      },
    ];
    const results = await runTools(mockViewer(), items, helper);
    expect(results[0].ok).toBe(true);
    if (results[0].ok) {
      expect(results[0].data).toEqual({
        filled: 2,
        failed: 1,
        failures: [{ cellIdx: 99, reason: 'insert-failed' }],
      });
    }
    // 좌표 → helper 메서드 라우팅 순서/모드.
    expect(calls).toEqual(['insert#2', 'replace#4', 'insert#99']);
  });

  it('전부 실패 → ok:false', async () => {
    const helper = {
      async getTextInCell(): Promise<string> {
        return '';
      },
      async insertTextInCell(): Promise<boolean> {
        return false;
      },
    } as unknown as CellHelper;
    const items: AhwpPreflightItem[] = [
      {
        ok: true,
        call: {
          tool: 'fillFormCells',
          args: {
            cells: [
              {
                sectionIdx: 0,
                parentParaIdx: 1,
                controlIdx: 0,
                cellIdx: 2,
                cellParaIdx: 0,
                text: 'a',
              },
            ],
          },
        },
      },
    ];
    const results = await runTools(mockViewer(), items, helper);
    expect(results[0].ok).toBe(false);
  });
});
