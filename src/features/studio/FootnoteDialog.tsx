import { useState, type FormEvent } from 'react';
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
 * Footnote inserter — chunk 13. Inserts a footnote at the active caret
 * position with optional body text. Empty body creates a numbered shell
 * the user can fill in later via direct caret editing inside the
 * footnote area (separate caret model — out of scope for this MVP).
 *
 * Known limitation: blank documents created via `createBlankDocument`
 * have no footnote area defined, so the IR panics. The dialog catches
 * the failure and surfaces a banner. Real .hwp/.hwpx docs work fine.
 */

export interface FootnoteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Insert a footnote at the active viewer's caret. Throws on IR error. */
  onInsert: (text: string) => void;
}

export function FootnoteDialog({
  open,
  onOpenChange,
  onInsert,
}: FootnoteDialogProps): JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError(null);
    try {
      onInsert(text);
      setText('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="footnote-dialog" className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>각주 삽입</DialogTitle>
          <DialogDescription>
            현재 커서 위치에 각주를 삽입합니다. 본문은 비워두면 빈 각주만
            추가됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          className="space-y-3"
          data-testid="footnote-form"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">각주 본문</span>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="각주에 표시할 텍스트"
              data-testid="footnote-text-input"
              autoFocus
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid="footnote-error"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="footnote-cancel"
            >
              취소
            </Button>
            <Button type="submit" data-testid="footnote-insert">
              삽입
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
