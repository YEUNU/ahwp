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
 * Table / cell properties dialogs — chunk 38 (UI for chunk 17 IR).
 *
 * The IR shape from `getTableProperties` / `getCellProperties` uses
 * HWPUNIT for spacing / padding (1mm = 283.5 HWPUNIT). We collect
 * mm in the form and convert at submit. Booleans (`repeatHeader`,
 * `isHeader`) are direct.
 *
 * Both dialogs share the same caret-resolution model: AppShell looks
 * up the active table's (sec, parentPara, ctrlIdx) and the active cell
 * (cellIdx) when the user opens a "표 속성..." / "셀 속성..." menu
 * item. Failing that lookup → onResolveContext returns null and the
 * dialog stays closed. Conversion is local; we don't mutate the IR
 * if the user clicks Cancel.
 */

const HWPUNIT_PER_MM = 567 / 2;
const huToMm = (hu: number): number =>
  Math.round((hu / HWPUNIT_PER_MM) * 100) / 100;
const mmToHu = (mm: number): number => Math.round(mm * HWPUNIT_PER_MM);

export interface TablePropsContext {
  sectionIdx: number;
  parentParaIdx: number;
  controlIdx: number;
}

export interface TablePropsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read the current table props for the active caret. `null` when
   * caret isn't inside a table or a viewer isn't loaded. */
  getCurrent: () => {
    ctx: TablePropsContext;
    props: Record<string, unknown>;
  } | null;
  onApply: (ctx: TablePropsContext, props: Record<string, unknown>) => void;
}

interface TableForm {
  paddingLeftMm: number;
  paddingRightMm: number;
  paddingTopMm: number;
  paddingBottomMm: number;
  cellSpacingMm: number;
  repeatHeader: boolean;
}

const EMPTY_TABLE_FORM: TableForm = {
  paddingLeftMm: 0,
  paddingRightMm: 0,
  paddingTopMm: 0,
  paddingBottomMm: 0,
  cellSpacingMm: 0,
  repeatHeader: false,
};

export function TablePropsDialog({
  open,
  onOpenChange,
  getCurrent,
  onApply,
}: TablePropsDialogProps): JSX.Element {
  const [ctx, setCtx] = useState<TablePropsContext | null>(null);
  const [form, setForm] = useState<TableForm>(EMPTY_TABLE_FORM);
  const [error, setError] = useState<string | null>(null);

  // Seed values when the dialog opens (or when reopened with a different
  // active table). One setState call per branch keeps the linter happy.
  useEffect(() => {
    if (!open) return;
    const r = getCurrent();
    if (!r) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('현재 커서가 표 안에 있지 않습니다.');
      setCtx(null);
      setForm(EMPTY_TABLE_FORM);
      return;
    }
    const p = r.props;
    setError(null);
    setCtx(r.ctx);
    setForm({
      paddingLeftMm: huToMm(
        typeof p.paddingLeft === 'number' ? p.paddingLeft : 0,
      ),
      paddingRightMm: huToMm(
        typeof p.paddingRight === 'number' ? p.paddingRight : 0,
      ),
      paddingTopMm: huToMm(typeof p.paddingTop === 'number' ? p.paddingTop : 0),
      paddingBottomMm: huToMm(
        typeof p.paddingBottom === 'number' ? p.paddingBottom : 0,
      ),
      cellSpacingMm: huToMm(
        typeof p.cellSpacing === 'number' ? p.cellSpacing : 0,
      ),
      repeatHeader:
        typeof p.repeatHeader === 'boolean' ? p.repeatHeader : false,
    });
  }, [open, getCurrent]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!ctx) return;
    onApply(ctx, {
      paddingLeft: mmToHu(form.paddingLeftMm),
      paddingRight: mmToHu(form.paddingRightMm),
      paddingTop: mmToHu(form.paddingTopMm),
      paddingBottom: mmToHu(form.paddingBottomMm),
      cellSpacing: mmToHu(form.cellSpacingMm),
      repeatHeader: form.repeatHeader,
    });
    onOpenChange(false);
  };
  const updateForm = (patch: Partial<TableForm>): void =>
    setForm((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="table-props-dialog"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>표 속성</DialogTitle>
          <DialogDescription>
            현재 커서가 위치한 표의 셀 padding / spacing / 머리행 반복 설정.
            단위: mm
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="좌 padding">
                <NumInput
                  value={form.paddingLeftMm}
                  onChange={(v) => updateForm({ paddingLeftMm: v })}
                  testid="table-props-pad-left"
                />
              </Field>
              <Field label="우 padding">
                <NumInput
                  value={form.paddingRightMm}
                  onChange={(v) => updateForm({ paddingRightMm: v })}
                  testid="table-props-pad-right"
                />
              </Field>
              <Field label="상 padding">
                <NumInput
                  value={form.paddingTopMm}
                  onChange={(v) => updateForm({ paddingTopMm: v })}
                  testid="table-props-pad-top"
                />
              </Field>
              <Field label="하 padding">
                <NumInput
                  value={form.paddingBottomMm}
                  onChange={(v) => updateForm({ paddingBottomMm: v })}
                  testid="table-props-pad-bottom"
                />
              </Field>
            </div>
            <Field label="셀 간격">
              <NumInput
                value={form.cellSpacingMm}
                onChange={(v) => updateForm({ cellSpacingMm: v })}
                testid="table-props-cell-spacing"
              />
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={form.repeatHeader}
                onChange={(e) => updateForm({ repeatHeader: e.target.checked })}
                data-testid="table-props-repeat-header"
              />
              <span>매 페이지 머리행 반복</span>
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" data-testid="table-props-apply">
                적용
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export interface CellPropsContext extends TablePropsContext {
  cellIdx: number;
}

export interface CellPropsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getCurrent: () => {
    ctx: CellPropsContext;
    props: Record<string, unknown>;
  } | null;
  onApply: (ctx: CellPropsContext, props: Record<string, unknown>) => void;
}

const VERTICAL_ALIGNS = ['Top', 'Middle', 'Bottom'] as const;

interface CellForm {
  paddingLeftMm: number;
  paddingRightMm: number;
  paddingTopMm: number;
  paddingBottomMm: number;
  verticalAlign: (typeof VERTICAL_ALIGNS)[number];
  isHeader: boolean;
}

const EMPTY_CELL_FORM: CellForm = {
  paddingLeftMm: 0,
  paddingRightMm: 0,
  paddingTopMm: 0,
  paddingBottomMm: 0,
  verticalAlign: 'Top',
  isHeader: false,
};

export function CellPropsDialog({
  open,
  onOpenChange,
  getCurrent,
  onApply,
}: CellPropsDialogProps): JSX.Element {
  const [ctx, setCtx] = useState<CellPropsContext | null>(null);
  const [form, setForm] = useState<CellForm>(EMPTY_CELL_FORM);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const r = getCurrent();
    if (!r) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('현재 커서가 셀 안에 있지 않습니다.');
      setCtx(null);
      setForm(EMPTY_CELL_FORM);
      return;
    }
    const p = r.props;
    const va = p.verticalAlign;
    setError(null);
    setCtx(r.ctx);
    setForm({
      paddingLeftMm: huToMm(
        typeof p.paddingLeft === 'number' ? p.paddingLeft : 0,
      ),
      paddingRightMm: huToMm(
        typeof p.paddingRight === 'number' ? p.paddingRight : 0,
      ),
      paddingTopMm: huToMm(typeof p.paddingTop === 'number' ? p.paddingTop : 0),
      paddingBottomMm: huToMm(
        typeof p.paddingBottom === 'number' ? p.paddingBottom : 0,
      ),
      verticalAlign:
        typeof va === 'string' &&
        (VERTICAL_ALIGNS as readonly string[]).includes(va)
          ? (va as (typeof VERTICAL_ALIGNS)[number])
          : 'Top',
      isHeader: typeof p.isHeader === 'boolean' ? p.isHeader : false,
    });
  }, [open, getCurrent]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!ctx) return;
    onApply(ctx, {
      paddingLeft: mmToHu(form.paddingLeftMm),
      paddingRight: mmToHu(form.paddingRightMm),
      paddingTop: mmToHu(form.paddingTopMm),
      paddingBottom: mmToHu(form.paddingBottomMm),
      verticalAlign: form.verticalAlign,
      isHeader: form.isHeader,
    });
    onOpenChange(false);
  };
  const updateForm = (patch: Partial<CellForm>): void =>
    setForm((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="cell-props-dialog" className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>셀 속성</DialogTitle>
          <DialogDescription>
            현재 셀의 padding / 세로 정렬 / 머리 셀 여부. 단위: mm
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="좌 padding">
                <NumInput
                  value={form.paddingLeftMm}
                  onChange={(v) => updateForm({ paddingLeftMm: v })}
                  testid="cell-props-pad-left"
                />
              </Field>
              <Field label="우 padding">
                <NumInput
                  value={form.paddingRightMm}
                  onChange={(v) => updateForm({ paddingRightMm: v })}
                  testid="cell-props-pad-right"
                />
              </Field>
              <Field label="상 padding">
                <NumInput
                  value={form.paddingTopMm}
                  onChange={(v) => updateForm({ paddingTopMm: v })}
                  testid="cell-props-pad-top"
                />
              </Field>
              <Field label="하 padding">
                <NumInput
                  value={form.paddingBottomMm}
                  onChange={(v) => updateForm({ paddingBottomMm: v })}
                  testid="cell-props-pad-bottom"
                />
              </Field>
            </div>
            <Field label="세로 정렬">
              <select
                value={form.verticalAlign}
                onChange={(e) =>
                  updateForm({
                    verticalAlign: e.target
                      .value as (typeof VERTICAL_ALIGNS)[number],
                  })
                }
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                data-testid="cell-props-vertical-align"
              >
                {VERTICAL_ALIGNS.map((va) => (
                  <option key={va} value={va}>
                    {va === 'Top' ? '위' : va === 'Middle' ? '가운데' : '아래'}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={form.isHeader}
                onChange={(e) => updateForm({ isHeader: e.target.checked })}
                data-testid="cell-props-is-header"
              />
              <span>머리 셀로 지정</span>
            </label>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                취소
              </Button>
              <Button type="submit" data-testid="cell-props-apply">
                적용
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="block">
      <span className="mb-1 block text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function NumInput({
  value,
  onChange,
  testid,
}: {
  value: number;
  onChange: (v: number) => void;
  testid: string;
}): JSX.Element {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => {
        const n = Number.parseFloat(e.target.value);
        onChange(Number.isFinite(n) ? n : 0);
      }}
      step="0.1"
      min="0"
      data-testid={testid}
      className="h-9 text-xs"
    />
  );
}
