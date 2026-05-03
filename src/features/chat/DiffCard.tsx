/**
 * Diff Viewer cards — chunk Q5 (UI/UX align).
 *
 * `MultiPatchStack` 가 외부 컨테이너 (헤더 + Accept All 버튼 + 패치
 * 리스트). 각 패치는 `StackedPatch` (compact diff card with Accept /
 * Reject). 하나의 패치만 있으면 `SinglePatchCard` (큰 카드, full
 * detail + reason expander) 로 fallback.
 *
 * Render-only — 적용 / 거절은 caller 의 onAccept / onReject 콜백.
 */
import { Check, ChevronDown, ChevronRight, Eye, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { AhwpPatch, AhwpPatchPreflightItem } from '@shared/ai-patches';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type PatchStatus = 'pending' | 'accepted' | 'rejected';

export interface MultiPatchStackProps {
  /** Pre-flight items — failed parse entries shown disabled in red. */
  items: AhwpPatchPreflightItem[];
  /** Per-patch status (parallel-indexed with items). */
  statuses: PatchStatus[];
  onAccept: (idx: number) => void;
  onReject: (idx: number) => void;
  onAcceptAll: () => void;
  /** Optional preview-jump callback (scrolls editor to patch location). */
  onPreview?: (patch: AhwpPatch) => void;
}

export function MultiPatchStack({
  items,
  statuses,
  onAccept,
  onReject,
  onAcceptAll,
  onPreview,
}: MultiPatchStackProps): JSX.Element {
  const okCount = items.filter((i) => i.ok).length;
  const acceptedCount = statuses.filter((s) => s === 'accepted').length;
  const total = items.length;
  const allDecided = statuses.every((s) => s !== 'pending');

  // Single-patch case → larger detail card.
  if (total === 1 && items[0].ok) {
    const p = items[0].patch;
    return (
      <SinglePatchCard
        patch={p}
        status={statuses[0]}
        onAccept={() => onAccept(0)}
        onReject={() => onReject(0)}
        onPreview={onPreview ? () => onPreview(p) : undefined}
      />
    );
  }

  return (
    <div
      className="rounded-lg border border-border bg-muted/40 p-3"
      data-testid="diff-multi-stack"
    >
      <div className="mb-2 flex items-center gap-2 px-1.5">
        <Sparkles className="size-3.5 text-primary" />
        <span className="text-[12.5px] font-semibold tracking-tight">
          {total}개 변경사항을 제안합니다
        </span>
        <span className="text-[11px] text-muted-foreground">
          · {acceptedCount} 적용 / {total} 총
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          size="sm"
          onClick={onAcceptAll}
          disabled={allDecided || okCount === 0}
          data-testid="diff-accept-all"
        >
          <Check className="mr-1 size-3" />
          모두 Accept
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {items.map((item, i) => (
          <StackedPatch
            key={i}
            idx={i + 1}
            item={item}
            status={statuses[i]}
            onAccept={() => onAccept(i)}
            onReject={() => onReject(i)}
            onPreview={
              onPreview && item.ok ? () => onPreview(item.patch) : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}

interface StackedPatchProps {
  idx: number;
  item: AhwpPatchPreflightItem;
  status: PatchStatus;
  onAccept: () => void;
  onReject: () => void;
  onPreview?: () => void;
}

function StackedPatch({
  idx,
  item,
  status,
  onAccept,
  onReject,
  onPreview,
}: StackedPatchProps): JSX.Element {
  const dim = status !== 'pending';
  if (!item.ok) {
    return (
      <div
        className="rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-xs text-destructive"
        data-testid={`diff-patch-invalid-${idx}`}
      >
        패치 #{idx} 파싱 실패: {item.reason}
      </div>
    );
  }
  const p = item.patch;
  const locLabel =
    p.location.label ??
    `섹션 ${p.location.sectionIndex} · 단락 ${p.location.paragraphIndex}`;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border bg-card transition',
        status === 'accepted'
          ? 'border-emerald-500/50'
          : status === 'rejected'
            ? 'border-border opacity-55'
            : 'border-border',
      )}
      data-testid={`diff-patch-${idx}`}
    >
      <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-primary/15 text-[10.5px] font-bold text-primary">
          {idx}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{p.title}</div>
          <div className="font-mono text-[10.5px] text-muted-foreground">
            {locLabel}
          </div>
        </div>
        {status === 'accepted' ? (
          <Check className="size-3.5 text-emerald-600" />
        ) : null}
      </div>
      <div className="py-1.5 font-mono text-[11px] leading-relaxed">
        <DiffLine kind="del" text={p.deletion} />
        <DiffLine kind="add" text={p.addition} />
      </div>
      <div className="flex items-center gap-1.5 border-t border-border bg-muted/40 px-2.5 py-1.5">
        <Button
          type="button"
          size="sm"
          onClick={onAccept}
          disabled={dim}
          data-testid={`diff-accept-${idx}`}
        >
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onReject}
          disabled={dim}
          data-testid={`diff-reject-${idx}`}
        >
          Reject
        </Button>
        <div className="flex-1" />
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            className="text-[11px] text-muted-foreground hover:text-foreground"
            data-testid={`diff-preview-${idx}`}
          >
            보기 →
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface SinglePatchCardProps {
  patch: AhwpPatch;
  status: PatchStatus;
  onAccept: () => void;
  onReject: () => void;
  onPreview?: () => void;
}

function SinglePatchCard({
  patch,
  status,
  onAccept,
  onReject,
  onPreview,
}: SinglePatchCardProps): JSX.Element {
  const dim = status !== 'pending';
  const [reasonOpen, setReasonOpen] = useState(false);
  const locLabel =
    patch.location.label ??
    `섹션 ${patch.location.sectionIndex} · 단락 ${patch.location.paragraphIndex}`;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card transition',
        status === 'accepted'
          ? 'border-emerald-500/50 shadow-[0_0_0_1px_rgba(16,185,129,.2)]'
          : status === 'rejected'
            ? 'border-border opacity-65'
            : 'border-border',
      )}
      data-testid="diff-single-card"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <Sparkles className="size-3.5 text-primary" />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-semibold">{patch.title}</div>
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {locLabel}
          </div>
        </div>
        {status === 'accepted' ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-600">
            <Check className="size-2.5" /> 적용됨
          </span>
        ) : null}
        {status === 'rejected' ? (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] font-semibold text-destructive">
            거절됨
          </span>
        ) : null}
      </div>
      <div className="py-2 font-mono text-[12px] leading-relaxed">
        <DiffLine kind="del" text={patch.deletion} />
        <DiffLine kind="add" text={patch.addition} />
      </div>
      {patch.reason ? (
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setReasonOpen((v) => !v)}
            className="flex items-center gap-1 py-1 text-[11.5px] text-muted-foreground transition hover:text-foreground"
            data-testid="diff-reason-toggle"
          >
            {reasonOpen ? (
              <ChevronDown className="size-3" />
            ) : (
              <ChevronRight className="size-3" />
            )}
            변경 이유
          </button>
          {reasonOpen ? (
            <div className="mt-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11.5px] leading-relaxed text-muted-foreground">
              {patch.reason}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center gap-1.5 border-t border-border bg-muted/40 px-3 py-2">
        <Button
          type="button"
          size="sm"
          onClick={onAccept}
          disabled={dim}
          data-testid="diff-accept-1"
        >
          <Check className="mr-1 size-3" />
          Accept
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onReject}
          disabled={dim}
          data-testid="diff-reject-1"
        >
          Reject
        </Button>
        <div className="flex-1" />
        {onPreview ? (
          <button
            type="button"
            onClick={onPreview}
            className="flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            data-testid="diff-preview-1"
          >
            <Eye className="size-3" />
            에디터에서 보기
          </button>
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
          ? 'bg-emerald-500/8 dark:bg-emerald-500/10'
          : 'bg-destructive/8 dark:bg-destructive/10',
      )}
      data-testid={`diff-line-${kind}`}
    >
      <span
        className={cn(
          'shrink-0 select-none font-bold',
          kind === 'add' ? 'text-emerald-600' : 'text-destructive',
        )}
      >
        {sigil}
      </span>
      <span className="whitespace-pre-wrap break-words">{text}</span>
    </div>
  );
}
