import { ImageIcon } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Picture properties dialog — chunk 39 (UI for chunk 24 IR).
 *
 * Sidebar-detail layout (chunk 57, Q8 align): left pane lists every
 * picture in the doc, right pane edits width/height/treatAsChar of the
 * selected one. Picture enumeration is provided by AppShell which
 * walks `getControlTextPositions` per paragraph in section 0.
 *
 * Empty doc → sidebar shows "그림이 없습니다" message and right pane
 * stays disabled. The dialog is always opened by user action (menu /
 * cmd palette), so we don't auto-close on empty.
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

  // Re-enumerate every time the dialog opens — image list can change
  // between sessions / after Save As.
  useEffect(() => {
    if (!open) return;
    const list = enumeratePictures();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPictures(list);
    if (list.length === 0) {
      setForm(EMPTY_FORM);
      return;
    }
    setActiveIdx(0);
    setForm(propsToForm(getProps(list[0])));
  }, [open, enumeratePictures, getProps]);

  // When the user picks a different picture in the sidebar, reseed the
  // form. Separate effect so the open-side initial seed and the picker
  // change reseed are clean.
  useEffect(() => {
    if (!open || pictures.length === 0) return;
    if (activeIdx < 0 || activeIdx >= pictures.length) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm(propsToForm(getProps(pictures[activeIdx])));
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

  const hasPictures = pictures.length > 0;
  const activePic = hasPictures ? pictures[activeIdx] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="picture-props-dialog"
        className="grid h-[min(520px,82vh)] max-w-[min(760px,92vw)] grid-cols-[220px_1fr] gap-0 overflow-hidden p-0"
      >
        {/* Sidebar — picture list */}
        <div className="flex flex-col border-r border-border bg-muted/40">
          <div className="flex items-center gap-2 px-4 pb-2.5 pt-3.5">
            <ImageIcon className="size-4 text-muted-foreground" />
            <span className="text-[13px] font-bold tracking-tight">
              그림 속성
            </span>
          </div>
          <div className="flex-1 overflow-auto px-2 pb-3">
            {hasPictures ? (
              <ul
                className="flex flex-col gap-px"
                data-testid="picture-props-list"
              >
                {pictures.map((p, i) => (
                  <li key={`${p.parentParaIdx}-${p.controlIdx}`}>
                    <button
                      type="button"
                      onClick={() => setActiveIdx(i)}
                      data-testid="picture-props-item"
                      data-active={i === activeIdx ? 'true' : 'false'}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12px] transition',
                        i === activeIdx
                          ? 'bg-card font-semibold text-foreground shadow-sm'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                        {i + 1}
                      </span>
                      <span className="truncate">{p.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div
                className="px-2 py-3 text-[11.5px] text-muted-foreground"
                data-testid="picture-props-empty"
              >
                이 문서에 그림이 없습니다.
              </div>
            )}
          </div>
          <div className="border-t border-border px-4 py-2.5 text-[10.5px] text-muted-foreground/70">
            {hasPictures ? `${pictures.length}개` : 'ahwp'}
          </div>
        </div>

        {/* Detail */}
        <div className="flex min-w-0 flex-col">
          {activePic ? (
            <form
              onSubmit={onSubmit}
              className="flex h-full min-h-0 flex-col"
              data-testid="picture-props-form"
            >
              <div className="border-b border-border px-7 pb-3.5 pt-4">
                <h2 className="text-[17px] font-bold tracking-tight">
                  {activePic.label}
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  너비·높이 / 글자처럼 취급 설정 (단위: mm)
                </p>
              </div>
              <div className="flex-1 space-y-4 overflow-auto px-7 py-5">
                <div className="grid grid-cols-2 gap-4">
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
                    onChange={(e) =>
                      updateForm({ treatAsChar: e.target.checked })
                    }
                    data-testid="picture-props-treat-as-char"
                  />
                  <span>글자처럼 취급 (문단 흐름 안에 배치)</span>
                </label>
              </div>
              <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-7 py-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onDeleteClick}
                  className="text-destructive hover:text-destructive"
                  data-testid="picture-props-delete"
                >
                  삭제
                </Button>
                <div className="flex-1" />
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
            </form>
          ) : (
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-7 pb-3.5 pt-4">
                <h2 className="text-[17px] font-bold tracking-tight">
                  그림 속성
                </h2>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  편집할 그림이 없습니다.
                </p>
              </div>
              <div className="flex flex-1 items-center justify-center px-7 text-xs text-muted-foreground">
                그림을 삽입한 뒤 다시 시도하세요.
              </div>
              <div className="flex items-center gap-2 border-t border-border bg-muted/40 px-7 py-3">
                <div className="flex-1" />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  닫기
                </Button>
              </div>
            </div>
          )}
        </div>
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
      <span className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
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
