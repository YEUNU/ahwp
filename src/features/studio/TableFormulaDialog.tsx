import { useEffect, useState } from 'react';
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
 * Table-cell formula evaluator — chunk 34. Right-clicking a cell and
 * picking "수식 다시 계산…" opens this dialog with the cell's
 * coordinates pre-filled. The user types a formula (`=SUM(A1:A5)`,
 * `=A1+B2*3`, ...), can preview the result (write_result=false) and
 * then commit (write_result=true) which writes the value into the
 * target cell as text and marks the doc dirty.
 *
 * The library has no `getCellFormula` getter — formulas aren't stored
 * on the IR; this dialog is the one-shot "compute X based on the
 * surrounding cells" tool. For per-cell live-recalc we'd need a richer
 * cell IR which is beyond Phase 2's scope.
 */

export interface FormulaCellContext {
  sectionIndex: number;
  parentParaIdx: number;
  controlIdx: number;
  /** Row of the cell that received the right-click (0-based). */
  targetRow: number;
  /** Column of the cell that received the right-click (0-based). */
  targetCol: number;
}

export interface TableFormulaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ctx: FormulaCellContext | null;
  /** Evaluate the formula. Returns the parsed `{ok, value, ...}` IR
   * response or null on lib-side failure. */
  onEvaluate: (
    ctx: FormulaCellContext,
    formula: string,
    writeResult: boolean,
  ) => Record<string, unknown> | null;
}

export function TableFormulaDialog({
  open,
  onOpenChange,
  ctx,
  onEvaluate,
}: TableFormulaDialogProps): JSX.Element {
  const [formula, setFormula] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset form on each open — we don't carry state between right-clicks.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFormula('');

    setPreview(null);

    setError(null);
  }, [open, ctx]);

  const runEval = (writeResult: boolean): void => {
    setError(null);
    setPreview(null);
    if (!ctx) {
      setError('대상 셀이 지정되지 않았습니다.');
      return;
    }
    const trimmed = formula.trim();
    if (trimmed.length === 0) {
      setError('수식을 입력하세요. 예: =SUM(A1:A5)');
      return;
    }
    const r = onEvaluate(ctx, trimmed, writeResult);
    if (!r) {
      setError('수식 계산에 실패했습니다.');
      return;
    }
    if (r['ok'] !== true) {
      const reason =
        typeof r['error'] === 'string' ? r['error'] : '알 수 없는 오류';
      setError(`수식 오류: ${reason}`);
      return;
    }
    const value =
      typeof r['value'] === 'number' || typeof r['value'] === 'string'
        ? String(r['value'])
        : JSON.stringify(r['value']);
    setPreview(value);
    if (writeResult) {
      // Close after a short delay so the user sees the confirmed value.
      setTimeout(() => onOpenChange(false), 800);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="table-formula-dialog"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>표 수식 계산</DialogTitle>
          <DialogDescription>
            대상 셀:{' '}
            <code className="rounded bg-muted px-1">
              row {ctx?.targetRow ?? '?'} / col {ctx?.targetCol ?? '?'}
            </code>{' '}
            · 결과를 미리 보거나 셀에 적용할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">수식</span>
          <Input
            value={formula}
            onChange={(e) => setFormula(e.target.value)}
            placeholder="=SUM(A1:A5)"
            data-testid="table-formula-input"
            autoFocus
          />
        </label>

        {preview !== null ? (
          <div
            className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
            data-testid="table-formula-preview"
          >
            결과: <code className="font-mono">{preview}</code>
          </div>
        ) : null}

        {error ? (
          <div
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            data-testid="table-formula-error"
          >
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="table-formula-cancel"
          >
            취소
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => runEval(false)}
            data-testid="table-formula-preview-btn"
          >
            미리 보기
          </Button>
          <Button
            type="button"
            onClick={() => runEval(true)}
            data-testid="table-formula-apply"
          >
            셀에 적용
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
