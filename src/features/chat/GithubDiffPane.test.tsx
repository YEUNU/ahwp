/**
 * 0.6.14 — GithubDiffPane unit tests. The pane replaces the
 * card-heavy MultiPatchStack with a GitHub-style line diff. We verify:
 *   - rendering both add-only and delete+add diffs
 *   - status badges (적용됨 / 거절됨)
 *   - per-patch callbacks (preview / reject / re-accept)
 *   - global callbacks (undoAll / dismiss)
 *   - invalid-patch error display
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AhwpPatchPreflightItem } from '@shared/ai-patches';
import { GithubDiffPane } from './GithubDiffPane';
import type { PatchStatus } from './DiffCard';

function okItem(
  overrides: Partial<{
    title: string;
    sectionIndex: number;
    paragraphIndex: number;
    cellIndex?: number;
    deletion: string;
    addition: string;
  }> = {},
): AhwpPatchPreflightItem {
  return {
    ok: true,
    patch: {
      title: overrides.title ?? '도입기업명',
      location: {
        sectionIndex: overrides.sectionIndex ?? 0,
        paragraphIndex: overrides.paragraphIndex ?? 1,
        ...(overrides.cellIndex !== undefined
          ? {
              cell: {
                controlIndex: 0,
                cellIndex: overrides.cellIndex,
                cellParagraphIndex: 0,
              },
            }
          : {}),
      },
      deletion: overrides.deletion ?? '',
      addition: overrides.addition ?? '코렌스',
    },
  };
}

describe('GithubDiffPane', () => {
  it('renders header with applied count + total', () => {
    const items = [
      okItem({ title: 'A' }),
      okItem({ title: 'B' }),
      okItem({ title: 'C' }),
    ];
    const statuses: PatchStatus[] = ['accepted', 'accepted', 'pending'];
    render(<GithubDiffPane items={items} statuses={statuses} />);
    expect(screen.getByText('변경사항')).toBeInTheDocument();
    expect(screen.getByText('2/3 적용됨')).toBeInTheDocument();
  });

  it('renders add-only diff (form fill — deletion empty)', () => {
    const items = [okItem({ deletion: '', addition: '코렌스' })];
    render(<GithubDiffPane items={items} statuses={['accepted']} />);
    // + line present, no − line.
    expect(screen.getByTestId('github-diff-line-add')).toHaveTextContent(
      '코렌스',
    );
    expect(screen.queryByTestId('github-diff-line-del')).toBeNull();
  });

  it('renders delete+add diff with both lines', () => {
    const items = [
      okItem({ title: 'replace', deletion: '기존', addition: '신규' }),
    ];
    render(<GithubDiffPane items={items} statuses={['pending']} />);
    expect(screen.getByTestId('github-diff-line-del')).toHaveTextContent(
      '기존',
    );
    expect(screen.getByTestId('github-diff-line-add')).toHaveTextContent(
      '신규',
    );
  });

  it('shows location label including cell index when present', () => {
    const items = [okItem({ paragraphIndex: 23, cellIndex: 5 })];
    render(<GithubDiffPane items={items} statuses={['accepted']} />);
    expect(screen.getByText(/섹션 0 · 단락 23 · 셀 5/)).toBeInTheDocument();
  });

  it('shows 적용됨 badge for accepted patches', () => {
    const items = [okItem()];
    render(<GithubDiffPane items={items} statuses={['accepted']} />);
    expect(screen.getByText('적용됨')).toBeInTheDocument();
  });

  it('shows 거절됨 badge + 다시 적용 button for rejected patches', () => {
    const onAccept = vi.fn();
    const items = [okItem()];
    render(
      <GithubDiffPane
        items={items}
        statuses={['rejected']}
        onAccept={onAccept}
      />,
    );
    expect(screen.getByText('거절됨')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('github-diff-reaccept-1'));
    expect(onAccept).toHaveBeenCalledWith(0);
  });

  it('fires onReject for pending patches', () => {
    const onReject = vi.fn();
    const items = [okItem()];
    render(
      <GithubDiffPane
        items={items}
        statuses={['pending']}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByTestId('github-diff-reject-1'));
    expect(onReject).toHaveBeenCalledWith(0);
  });

  it('fires onPreview when preview button clicked', () => {
    const onPreview = vi.fn();
    const items = [okItem()];
    render(
      <GithubDiffPane
        items={items}
        statuses={['accepted']}
        onPreview={onPreview}
      />,
    );
    fireEvent.click(screen.getByTestId('github-diff-preview-1'));
    expect(onPreview).toHaveBeenCalledWith(items[0].ok ? items[0].patch : null);
  });

  it('fires onUndoAll only when at least one patch accepted', () => {
    const onUndoAll = vi.fn();
    const items = [okItem(), okItem()];
    const { rerender } = render(
      <GithubDiffPane
        items={items}
        statuses={['pending', 'pending']}
        onUndoAll={onUndoAll}
      />,
    );
    // No undo button when nothing accepted yet.
    expect(screen.queryByTestId('github-diff-undo-all')).toBeNull();
    rerender(
      <GithubDiffPane
        items={items}
        statuses={['accepted', 'pending']}
        onUndoAll={onUndoAll}
      />,
    );
    fireEvent.click(screen.getByTestId('github-diff-undo-all'));
    expect(onUndoAll).toHaveBeenCalled();
  });

  it('fires onDismiss when × button clicked', () => {
    const onDismiss = vi.fn();
    const items = [okItem()];
    render(
      <GithubDiffPane
        items={items}
        statuses={['accepted']}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByTestId('github-diff-dismiss'));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders invalid patches with parse-failure message', () => {
    const items: AhwpPatchPreflightItem[] = [
      { ok: false, reason: 'cell.cellIndex-invalid' },
    ];
    render(<GithubDiffPane items={items} statuses={['pending']} />);
    expect(screen.getByTestId('github-diff-invalid-1')).toHaveTextContent(
      /cell\.cellIndex-invalid/,
    );
  });

  it('renders multi-line additions as separate + lines', () => {
    const items = [okItem({ addition: '첫줄\n둘째줄\n셋째줄' })];
    render(<GithubDiffPane items={items} statuses={['accepted']} />);
    const addLines = screen.getAllByTestId('github-diff-line-add');
    expect(addLines).toHaveLength(3);
    expect(addLines[0]).toHaveTextContent('첫줄');
    expect(addLines[1]).toHaveTextContent('둘째줄');
    expect(addLines[2]).toHaveTextContent('셋째줄');
  });
});
