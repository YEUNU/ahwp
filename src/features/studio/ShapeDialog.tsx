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
 * Rectangle shape inserter — chunk 15. The IR's `createShapeControl`
 * accepts a JSON payload with width/height + caret coords + treatAsChar
 * + textWrap. This dialog collects width/height in mm and an inline
 * placement toggle, then delegates to the active viewer.
 *
 * Lines / arrows / curves / shape grouping are deferred — those need
 * additional shape-type fields the lib doesn't surface in the
 * `createShapeControl` JSON yet.
 */

const HWPUNIT_PER_MM = 567 / 2;
const mmToHu = (mm: number): number => Math.round(mm * HWPUNIT_PER_MM);

export interface ShapeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (
    widthHwpunit: number,
    heightHwpunit: number,
    opts: { treatAsChar: boolean },
  ) => { paraIdx: number; controlIdx: number } | null;
}

export function ShapeDialog({
  open,
  onOpenChange,
  onInsert,
}: ShapeDialogProps): JSX.Element {
  const [widthMm, setWidthMm] = useState(50);
  const [heightMm, setHeightMm] = useState(30);
  const [treatAsChar, setTreatAsChar] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError(null);
    if (widthMm <= 0 || heightMm <= 0) {
      setError('너비와 높이는 0보다 커야 합니다.');
      return;
    }
    const result = onInsert(mmToHu(widthMm), mmToHu(heightMm), {
      treatAsChar,
    });
    if (!result) {
      setError('도형 삽입에 실패했습니다.');
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="shape-dialog" className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>사각형 도형</DialogTitle>
          <DialogDescription>
            현재 커서 위치에 사각형 도형을 삽입합니다. 단위: mm
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          className="space-y-3"
          data-testid="shape-form"
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">너비</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(widthMm)}
                onChange={(e) => setWidthMm(Number(e.target.value) || 0)}
                data-testid="shape-width"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">높이</span>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(heightMm)}
                onChange={(e) => setHeightMm(Number(e.target.value) || 0)}
                data-testid="shape-height"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={treatAsChar}
              onChange={(e) => setTreatAsChar(e.target.checked)}
              data-testid="shape-treat-as-char"
            />
            <span>글자처럼 취급 (인라인 배치)</span>
          </label>

          {error ? (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
              data-testid="shape-error"
            >
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="shape-cancel"
            >
              취소
            </Button>
            <Button type="submit" data-testid="shape-insert">
              삽입
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
