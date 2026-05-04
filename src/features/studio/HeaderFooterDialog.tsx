import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Header / footer editor — chunk 11 + chunk 35 (multi-line + per-page
 * templates). The user picks header vs footer, picks the page-template
 * scope (양쪽 / 홀수만 / 짝수만), enters multi-line text in a textarea,
 * and applies. Each page-template scope persists independently in the IR
 * — switching between 양쪽/홀수/짝수 pulls each slot's saved value.
 */

type HfKind = 'header' | 'footer';

const APPLY_TO_BOTH = 0;
const APPLY_TO_ODD = 1;
const APPLY_TO_EVEN = 2;
type ApplyTo =
  | typeof APPLY_TO_BOTH
  | typeof APPLY_TO_ODD
  | typeof APPLY_TO_EVEN;

const APPLY_LABELS: Record<ApplyTo, string> = {
  [APPLY_TO_BOTH]: '양쪽',
  [APPLY_TO_ODD]: '홀수 페이지',
  [APPLY_TO_EVEN]: '짝수 페이지',
};

export interface HeaderFooterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read the current slot for `(sectionIdx, isHeader, applyTo)`. */
  getCurrent: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
  ) => Record<string, unknown> | null;
  /** Replace the slot's text (empty string = remove). */
  onApply: (
    sectionIdx: number,
    isHeader: boolean,
    applyTo: number,
    text: string,
  ) => void;
}

export function HeaderFooterDialog({
  open,
  onOpenChange,
  getCurrent,
  onApply,
}: HeaderFooterDialogProps): JSX.Element {
  const [kind, setKind] = useState<HfKind>('header');
  const [applyTo, setApplyTo] = useState<ApplyTo>(APPLY_TO_BOTH);
  const [text, setText] = useState('');

  // Reload the current slot's text whenever the dialog opens or the user
  // toggles the kind / applyTo. Each combination is its own IR slot, so
  // switching pulls a different saved value.
  useEffect(() => {
    if (!open) return;
    const slot = getCurrent(0, kind === 'header', applyTo);
    if (!slot) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setText('');
      return;
    }
    const exists = (slot as { exists?: boolean }).exists === true;
    const value =
      exists && typeof (slot as { text?: unknown }).text === 'string'
        ? (slot as { text: string }).text
        : '';

    setText(value);
  }, [open, kind, applyTo, getCurrent]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    onApply(0, kind === 'header', applyTo, text);
    onOpenChange(false);
  };

  const onRemove = (): void => {
    onApply(0, kind === 'header', applyTo, '');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="header-footer-dialog"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>머리말 / 꼬리말</DialogTitle>
          <DialogDescription>
            여러 줄 텍스트와 홀수 / 짝수 페이지 템플릿을 지원합니다.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          className="space-y-4"
          data-testid="header-footer-form"
        >
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label="머리말 또는 꼬리말 선택"
          >
            <Button
              type="button"
              variant={kind === 'header' ? 'secondary' : 'outline'}
              onClick={() => setKind('header')}
              aria-pressed={kind === 'header'}
              data-testid="hf-kind-header"
            >
              머리말
            </Button>
            <Button
              type="button"
              variant={kind === 'footer' ? 'secondary' : 'outline'}
              onClick={() => setKind('footer')}
              aria-pressed={kind === 'footer'}
              data-testid="hf-kind-footer"
            >
              꼬리말
            </Button>
          </div>

          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="페이지 템플릿 선택"
          >
            {([APPLY_TO_BOTH, APPLY_TO_ODD, APPLY_TO_EVEN] as const).map(
              (v) => (
                <Button
                  key={v}
                  type="button"
                  size="sm"
                  variant={applyTo === v ? 'secondary' : 'outline'}
                  onClick={() => setApplyTo(v)}
                  aria-pressed={applyTo === v}
                  data-testid={`hf-applyto-${v}`}
                >
                  {APPLY_LABELS[v]}
                </Button>
              ),
            )}
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">
              텍스트 (Enter로 줄바꿈)
            </span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="비워두면 제거됩니다"
              rows={4}
              data-testid="hf-text-input"
              autoFocus
              className="rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-hidden focus:ring-2 focus:ring-ring"
            />
          </label>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onRemove}
              data-testid="hf-remove"
            >
              제거
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="hf-cancel"
            >
              취소
            </Button>
            <Button type="submit" data-testid="hf-apply">
              적용
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
