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
import { Input } from '@/components/ui/input';

/**
 * Header / footer editor — chunk 11. Single-line MVP that lets the user
 * pick header vs footer (the "kind" toggle), enter the text, and apply.
 * Multi-line / multi-paragraph editing + per-page templates (홀수만 / 짝수만)
 * are deferred — for now applyTo=0 ("양 쪽" = all pages) covers the most
 * common case.
 */

type HfKind = 'header' | 'footer';

const APPLY_TO_BOTH = 0;

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
  const [text, setText] = useState('');

  // Reload the current slot's text whenever the dialog opens or the user
  // toggles the kind. This keeps the form in sync with the IR — flipping
  // header ↔ footer pulls each slot's saved value.
  useEffect(() => {
    if (!open) return;
    const slot = getCurrent(0, kind === 'header', APPLY_TO_BOTH);
    if (!slot) return;
    const exists = (slot as { exists?: boolean }).exists === true;
    const value =
      exists && typeof (slot as { text?: unknown }).text === 'string'
        ? (slot as { text: string }).text
        : '';
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(value);
  }, [open, kind, getCurrent]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    onApply(0, kind === 'header', APPLY_TO_BOTH, text);
    onOpenChange(false);
  };

  const onRemove = (): void => {
    onApply(0, kind === 'header', APPLY_TO_BOTH, '');
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
            모든 페이지에 같은 텍스트를 표시합니다.
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

          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">텍스트</span>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="비워두면 제거됩니다"
              data-testid="hf-text-input"
              autoFocus
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
