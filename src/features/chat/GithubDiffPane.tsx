/**
 * GitHub-style line diff pane — replacement for the metadata-heavy
 * MultiPatchStack cards. Renders patches as a clean stack of `--- old`
 * / `+++ new` blocks, one file-like header per patch. No card chrome,
 * no inline Accept/Reject (auto-accept handles those; user undoes via
 * the chat toast).
 *
 * Lives in a dedicated side panel right of rhwp-editor (NOT inside the
 * editor canvas). The editor pane shrinks horizontally when this is
 * visible — no overlap.
 */
import { Check, Eye, RotateCcw, X } from 'lucide-react';
import type { AhwpPatch, AhwpPatchPreflightItem } from '@shared/ai-patches';
import { cn } from '@/lib/utils';
import type { PatchStatus } from './DiffCard';

export interface GithubDiffPaneProps {
  items: AhwpPatchPreflightItem[];
  statuses: PatchStatus[];
  /** Undo *all* applied patches in the turn (single-undo grouping). */
  onUndoAll?: () => void;
  /** Per-patch scroll-to-location. */
  onPreview?: (patch: AhwpPatch) => void;
  /** Reject a single patch (only meaningful while pending). */
  onReject?: (idx: number) => void;
  /** Re-accept a previously-rejected patch. */
  onAccept?: (idx: number) => void;
  /** Dismiss the entire pane (hide). Patches stay applied; user just
   *  doesn't want to see the diff anymore. */
  onDismiss?: () => void;
}

export function GithubDiffPane({
  items,
  statuses,
  onUndoAll,
  onPreview,
  onAccept,
  onReject,
  onDismiss,
}: GithubDiffPaneProps): JSX.Element {
  const total = items.length;
  const okItems = items.filter((i) => i.ok).length;
  const acceptedCount = statuses.filter((s) => s === 'accepted').length;

  return (
    <div
      className="flex h-full flex-col overflow-hidden border-l border-border bg-background"
      data-testid="github-diff-pane"
    >
      {/* Header — total / applied / undo / close */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <span className="text-[12.5px] font-semibold">변경사항</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {acceptedCount}/{total} 적용됨
        </span>
        <div className="flex-1" />
        {onUndoAll && acceptedCount > 0 ? (
          <button
            type="button"
            onClick={onUndoAll}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="github-diff-undo-all"
            title="전체 되돌리기 (Cmd+Z)"
          >
            <RotateCcw className="size-3" /> 되돌리기
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid="github-diff-dismiss"
            title="닫기 (적용된 변경은 유지)"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {/* Diff stack */}
      <div className="flex-1 overflow-y-auto">
        {items.map((item, i) => (
          <DiffBlock
            key={i}
            idx={i + 1}
            item={item}
            status={statuses[i]}
            onAccept={onAccept ? () => onAccept(i) : undefined}
            onReject={onReject ? () => onReject(i) : undefined}
            onPreview={
              onPreview && item.ok ? () => onPreview(item.patch) : undefined
            }
          />
        ))}
        {okItems === 0 ? (
          <div className="px-3 py-4 text-[11.5px] text-muted-foreground">
            적용 가능한 변경이 없습니다.
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface DiffBlockProps {
  idx: number;
  item: AhwpPatchPreflightItem;
  status: PatchStatus;
  onAccept?: () => void;
  onReject?: () => void;
  onPreview?: () => void;
}

function DiffBlock({
  idx,
  item,
  status,
  onAccept,
  onReject,
  onPreview,
}: DiffBlockProps): JSX.Element {
  if (!item.ok) {
    return (
      <div
        className="border-b border-border px-3 py-2 text-[11px] text-destructive"
        data-testid={`github-diff-invalid-${idx}`}
      >
        패치 #{idx} 파싱 실패: {item.reason}
      </div>
    );
  }
  const p = item.patch;
  const locLabel =
    p.location.label ??
    `섹션 ${p.location.sectionIndex} · 단락 ${p.location.paragraphIndex}${
      p.location.cell ? ` · 셀 ${p.location.cell.cellIndex}` : ''
    }`;

  return (
    <div
      className="border-b border-border"
      data-testid={`github-diff-block-${idx}`}
    >
      {/* File-style header */}
      <div
        className={cn(
          'flex items-center gap-2 bg-muted/50 px-3 py-1.5 font-mono text-[11px]',
          status === 'rejected' && 'opacity-50',
        )}
      >
        <span className="font-sans text-[11.5px] font-semibold">{p.title}</span>
        <span className="truncate text-[10.5px] text-muted-foreground">
          {locLabel}
        </span>
        <div className="flex-1" />
        {status === 'accepted' ? (
          <span className="flex items-center gap-0.5 text-emerald-600">
            <Check className="size-3" /> 적용됨
          </span>
        ) : status === 'rejected' ? (
          <span className="text-destructive/70">거절됨</span>
        ) : null}
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            data-testid={`github-diff-preview-${idx}`}
            title="에디터에서 보기"
          >
            <Eye className="size-3" />
          </button>
        ) : null}
        {status === 'pending' && onReject ? (
          <button
            type="button"
            onClick={onReject}
            className="rounded px-1.5 text-[10.5px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            data-testid={`github-diff-reject-${idx}`}
          >
            거절
          </button>
        ) : null}
        {status === 'rejected' && onAccept ? (
          <button
            type="button"
            onClick={onAccept}
            className="rounded px-1.5 text-[10.5px] text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"
            data-testid={`github-diff-reaccept-${idx}`}
          >
            다시 적용
          </button>
        ) : null}
      </div>

      {/* Line diff body */}
      <div
        className={cn(
          'font-mono text-[11.5px] leading-relaxed',
          status === 'rejected' && 'opacity-50',
        )}
      >
        {p.deletion.length > 0
          ? p.deletion
              .split('\n')
              .map((line, i) => (
                <DiffLine key={`d${i}`} kind="del" text={line} />
              ))
          : null}
        {p.addition.length > 0
          ? p.addition
              .split('\n')
              .map((line, i) => (
                <DiffLine key={`a${i}`} kind="add" text={line} />
              ))
          : null}
        {p.deletion.length === 0 && p.addition.length === 0 ? (
          <div className="px-3 py-1.5 text-[10.5px] text-muted-foreground">
            (변경 없음)
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DiffLine({
  kind,
  text,
}: {
  kind: 'add' | 'del';
  text: string;
}): JSX.Element {
  const sigil = kind === 'add' ? '+' : '−';
  return (
    <div
      className={cn(
        'flex gap-2 px-3',
        kind === 'add'
          ? 'bg-emerald-500/10 dark:bg-emerald-500/15'
          : 'bg-destructive/10 dark:bg-destructive/15',
      )}
      data-testid={`github-diff-line-${kind}`}
    >
      <span
        className={cn(
          'w-3 shrink-0 select-none text-center font-bold',
          kind === 'add' ? 'text-emerald-600' : 'text-destructive',
        )}
      >
        {sigil}
      </span>
      <span className="whitespace-pre-wrap wrap-break-word">{text || ' '}</span>
    </div>
  );
}
