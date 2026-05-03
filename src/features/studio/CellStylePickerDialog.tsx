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
 * Cell-style picker — chunk 42 (UI for chunk 23 IR `applyCellStyle`).
 *
 * @rhwp/core 0.7.9 has no direct cell-color setter (KNOWN_ISSUES
 * L-006). The only way to color a cell is to apply a pre-existing
 * named style. This dialog lists the doc's styles and lets the user
 * pick one to apply to the active cell.
 *
 * The cell context resolution mirrors `TableCellPropsDialog.tsx`:
 * the cell context comes from the right-clicked cell stored on the
 * caret. AppShell wires `getCurrentCell()` + `getStyles()` +
 * `onApply()`.
 */

export interface CellStylePickerCtx {
  sectionIdx: number;
  parentParaIdx: number;
  controlIdx: number;
  cellIdx: number;
}

export interface StyleOption {
  id: number;
  name: string;
  englishName?: string;
}

export interface CellStylePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getCurrentCell: () => CellStylePickerCtx | null;
  getStyles: () => StyleOption[];
  onApply: (ctx: CellStylePickerCtx, styleId: number) => void;
}

export function CellStylePickerDialog({
  open,
  onOpenChange,
  getCurrentCell,
  getStyles,
  onApply,
}: CellStylePickerDialogProps): JSX.Element {
  const [ctx, setCtx] = useState<CellStylePickerCtx | null>(null);
  const [styles, setStyles] = useState<StyleOption[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const cell = getCurrentCell();
    if (!cell) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('현재 커서가 셀 안에 있지 않습니다.');
      setCtx(null);
      setStyles([]);
      return;
    }
    const list = getStyles();
    setError(null);
    setCtx(cell);
    setStyles(list);
    setSelectedId(list[0]?.id ?? 0);
  }, [open, getCurrentCell, getStyles]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!ctx) return;
    onApply(ctx, selectedId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="cell-style-picker-dialog"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>셀에 스타일 적용</DialogTitle>
          <DialogDescription>
            현재 셀에 적용할 명명된 스타일을 선택합니다. 라이브러리 한계로 셀
            배경색·테두리는 미리 정의된 스타일을 통해서만 적용 가능합니다
            (KNOWN_ISSUES L-006).
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : styles.length === 0 ? (
          <div className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            이 문서에 명명된 스타일이 없습니다. "보기 → 스타일 관리…"에서 먼저
            스타일을 만드세요.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <ul
              className="max-h-64 space-y-1 overflow-auto rounded-md border border-border p-1"
              data-testid="cell-style-picker-list"
            >
              {styles.map((s) => (
                <li key={s.id}>
                  <label
                    className={
                      'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs ' +
                      (selectedId === s.id
                        ? 'bg-accent text-accent-foreground'
                        : 'hover:bg-muted')
                    }
                  >
                    <input
                      type="radio"
                      name="cell-style"
                      checked={selectedId === s.id}
                      onChange={() => setSelectedId(s.id)}
                      data-testid="cell-style-picker-option"
                      data-style-id={s.id}
                    />
                    <span className="flex-1 font-medium">{s.name}</span>
                    {s.englishName ? (
                      <span className="text-muted-foreground">
                        {s.englishName}
                      </span>
                    ) : null}
                    <span className="font-mono text-muted-foreground/70">
                      #{s.id}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" data-testid="cell-style-picker-apply">
                적용
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
