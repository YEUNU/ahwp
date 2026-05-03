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
 * Picture properties dialog — chunk 39 (UI for chunk 24 IR).
 *
 * IR has no first-class image picker because pictures live as Control
 * objects scattered across paragraphs. We enumerate via
 * `enumeratePictures()` (provided by AppShell, which walks
 * `getControlTextPositions` per paragraph in section 0). When the doc
 * has 0 pictures the dialog shows an empty state; with 1 we auto-pick;
 * with 2+ a select lists them by paragraph + index. The form edits
 * width/height (mm) + treatAsChar.
 */

const HWPUNIT_PER_MM = 567 / 2;
const huToMm = (hu: number): number =>
  Math.round((hu / HWPUNIT_PER_MM) * 100) / 100;
const mmToHu = (mm: number): number => Math.round(mm * HWPUNIT_PER_MM);

export interface PictureRef {
  sectionIdx: number;
  parentParaIdx: number;
  controlIdx: number;
  /** Display label for the picker — e.g. "1페이지 · 단락 4". */
  label: string;
}

export interface PicturePropsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Walk the doc and return every picture control. AppShell provides
   * the enumeration since it's a multi-paragraph IR walk. */
  enumeratePictures: () => PictureRef[];
  getProps: (ref: PictureRef) => Record<string, unknown> | null;
  onApply: (ref: PictureRef, props: Record<string, unknown>) => void;
  onDelete: (ref: PictureRef) => void;
}

interface PicForm {
  widthMm: number;
  heightMm: number;
  treatAsChar: boolean;
}

const EMPTY_FORM: PicForm = {
  widthMm: 0,
  heightMm: 0,
  treatAsChar: false,
};

export function PicturePropsDialog({
  open,
  onOpenChange,
  enumeratePictures,
  getProps,
  onApply,
  onDelete,
}: PicturePropsDialogProps): JSX.Element {
  const [pictures, setPictures] = useState<PictureRef[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [form, setForm] = useState<PicForm>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  // Re-enumerate every time the dialog opens — image list can change
  // between sessions / after Save As.
  useEffect(() => {
    if (!open) return;
    const list = enumeratePictures();
    if (list.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError('이 문서에 그림이 없습니다.');
      setPictures([]);
      setForm(EMPTY_FORM);
      return;
    }
    setError(null);
    setPictures(list);
    setActiveIdx(0);
    const props = getProps(list[0]);
    setForm(propsToForm(props));
  }, [open, enumeratePictures, getProps]);

  // When the user picks a different picture in the dropdown, reseed
  // the form. This is intentionally a separate effect so the open-side
  // initial seed and the picker-change reseed are clean.
  useEffect(() => {
    if (!open || pictures.length === 0) return;
    if (activeIdx < 0 || activeIdx >= pictures.length) return;
    const props = getProps(pictures[activeIdx]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(propsToForm(props));
  }, [open, activeIdx, pictures, getProps]);

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (pictures.length === 0) return;
    onApply(pictures[activeIdx], {
      width: mmToHu(form.widthMm),
      height: mmToHu(form.heightMm),
      treatAsChar: form.treatAsChar,
    });
    onOpenChange(false);
  };

  const onDeleteClick = (): void => {
    if (pictures.length === 0) return;
    const ok = window.confirm('이 그림을 삭제하시겠습니까?');
    if (!ok) return;
    onDelete(pictures[activeIdx]);
    onOpenChange(false);
  };

  const updateForm = (patch: Partial<PicForm>): void =>
    setForm((prev) => ({ ...prev, ...patch }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="picture-props-dialog"
        className="max-w-md gap-4"
      >
        <DialogHeader>
          <DialogTitle>그림 속성</DialogTitle>
          <DialogDescription>
            문서의 그림 컨트롤을 선택해 너비·높이 / 글자처럼 취급 설정 변경.
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
            {pictures.length > 1 ? (
              <Field label="그림 선택">
                <select
                  value={activeIdx}
                  onChange={(e) =>
                    setActiveIdx(Number.parseInt(e.target.value, 10))
                  }
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                  data-testid="picture-props-picker"
                >
                  {pictures.map((p, i) => (
                    <option
                      key={`${p.parentParaIdx}-${p.controlIdx}`}
                      value={i}
                    >
                      {p.label}
                    </option>
                  ))}
                </select>
              </Field>
            ) : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="너비">
                <NumInput
                  value={form.widthMm}
                  onChange={(v) => updateForm({ widthMm: v })}
                  testid="picture-props-width"
                />
              </Field>
              <Field label="높이">
                <NumInput
                  value={form.heightMm}
                  onChange={(v) => updateForm({ heightMm: v })}
                  testid="picture-props-height"
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={form.treatAsChar}
                onChange={(e) => updateForm({ treatAsChar: e.target.checked })}
                data-testid="picture-props-treat-as-char"
              />
              <span>글자처럼 취급 (문단 흐름 안에 배치)</span>
            </label>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                onClick={onDeleteClick}
                className="text-destructive hover:text-destructive"
                data-testid="picture-props-delete"
              >
                삭제
              </Button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                >
                  취소
                </Button>
                <Button type="submit" data-testid="picture-props-apply">
                  적용
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function propsToForm(props: Record<string, unknown> | null): PicForm {
  if (!props) return EMPTY_FORM;
  return {
    widthMm: huToMm(typeof props.width === 'number' ? props.width : 0),
    heightMm: huToMm(typeof props.height === 'number' ? props.height : 0),
    treatAsChar:
      typeof props.treatAsChar === 'boolean' ? props.treatAsChar : false,
  };
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
