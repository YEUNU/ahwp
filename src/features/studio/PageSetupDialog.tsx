import { useEffect, useState, type FormEvent } from 'react';
import type { RhwpPageDef } from '@shared/rhwp-types';
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
 * Page setup — chunk 10. Reads the active StudioViewer's PageDef on open
 * (via the imperative `getPageDef` handle), lets the user tweak paper size /
 * orientation / margins in mm, and writes back via `applyPageDef`.
 *
 * HWPUNIT ↔ mm: 1mm = 567/2 = 283.5 HWPUNIT (verified against the IR's A4
 * default 59528 × 84186 → 210 × 297 mm).
 */
const HWPUNIT_PER_MM = 567 / 2;

interface PaperPreset {
  id: string;
  label: string;
  /** Width × height in mm at portrait orientation. */
  widthMm: number;
  heightMm: number;
}

const PAPER_PRESETS: readonly PaperPreset[] = [
  { id: 'A4', label: 'A4 (210 × 297 mm)', widthMm: 210, heightMm: 297 },
  { id: 'A5', label: 'A5 (148 × 210 mm)', widthMm: 148, heightMm: 210 },
  { id: 'B5', label: 'B5 (176 × 250 mm)', widthMm: 176, heightMm: 250 },
  {
    id: 'Letter',
    label: 'Letter (8.5 × 11 in)',
    widthMm: 215.9,
    heightMm: 279.4,
  },
  {
    id: 'Legal',
    label: 'Legal (8.5 × 14 in)',
    widthMm: 215.9,
    heightMm: 355.6,
  },
];

const mmToHu = (mm: number): number => Math.round(mm * HWPUNIT_PER_MM);
const huToMm = (hu: number): number =>
  Math.round((hu / HWPUNIT_PER_MM) * 10) / 10;

function detectPreset(widthMm: number, heightMm: number): string {
  // Match either orientation (landscape swaps width/height).
  for (const p of PAPER_PRESETS) {
    const matchPortrait =
      Math.abs(p.widthMm - widthMm) < 1 && Math.abs(p.heightMm - heightMm) < 1;
    const matchLandscape =
      Math.abs(p.heightMm - widthMm) < 1 && Math.abs(p.widthMm - heightMm) < 1;
    if (matchPortrait || matchLandscape) return p.id;
  }
  return 'custom';
}

interface PageSetupForm {
  preset: string;
  widthMm: number;
  heightMm: number;
  landscape: boolean;
  marginLeftMm: number;
  marginRightMm: number;
  marginTopMm: number;
  marginBottomMm: number;
}

const DEFAULT_FORM: PageSetupForm = {
  preset: 'A4',
  widthMm: 210,
  heightMm: 297,
  landscape: false,
  marginLeftMm: 30,
  marginRightMm: 30,
  marginTopMm: 20,
  marginBottomMm: 15,
};

export interface PageSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read the active viewer's PageDef. Returns null if no doc is loaded. */
  getCurrentPageDef: () => RhwpPageDef | null;
  /** Apply a HWPUNIT-keyed PageDef to the active viewer's section 0. */
  onApply: (props: RhwpPageDef) => void;
}

export function PageSetupDialog({
  open,
  onOpenChange,
  getCurrentPageDef,
  onApply,
}: PageSetupDialogProps): JSX.Element {
  const [form, setForm] = useState<PageSetupForm>(DEFAULT_FORM);

  // Seed from the current PageDef each time the dialog opens. The lint rule
  // would prefer we derive form state with useMemo, but the form is owned
  // (user can edit fields after the seed) — that's what "uncontrolled-after-
  // first-render" requires a one-shot setState on open. Acceptable use case.
  useEffect(() => {
    if (!open) return;
    const def = getCurrentPageDef();
    if (!def) return;
    const widthHu = def.width ?? 0;
    const heightHu = def.height ?? 0;
    const landscape = def.landscape ?? false;
    const widthMm = huToMm(widthHu);
    const heightMm = huToMm(heightHu);
    const presetId = detectPreset(widthMm, heightMm);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      preset: presetId,
      widthMm,
      heightMm,
      landscape,
      marginLeftMm: huToMm(def.marginLeft ?? 0),
      marginRightMm: huToMm(def.marginRight ?? 0),
      marginTopMm: huToMm(def.marginTop ?? 0),
      marginBottomMm: huToMm(def.marginBottom ?? 0),
    });
  }, [open, getCurrentPageDef]);

  const setPreset = (id: string): void => {
    if (id === 'custom') {
      setForm((f) => ({ ...f, preset: 'custom' }));
      return;
    }
    const p = PAPER_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setForm((f) => ({
      ...f,
      preset: id,
      widthMm: p.widthMm,
      heightMm: p.heightMm,
    }));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    // PageDef expects width/height at the *physical* orientation; we
    // store mm values at portrait and let the IR's `landscape` flag
    // handle the swap.
    const props: RhwpPageDef = {
      width: mmToHu(form.widthMm),
      height: mmToHu(form.heightMm),
      landscape: form.landscape,
      marginLeft: mmToHu(form.marginLeftMm),
      marginRight: mmToHu(form.marginRightMm),
      marginTop: mmToHu(form.marginTopMm),
      marginBottom: mmToHu(form.marginBottomMm),
    };
    onApply(props);
    onOpenChange(false);
  };

  const num = (
    field: keyof PageSetupForm,
    label: string,
    testid: string,
  ): JSX.Element => (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        step={0.1}
        value={String(form[field] as number)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) {
            setForm((f) => ({ ...f, [field]: v, preset: 'custom' }));
          }
        }}
        data-testid={testid}
      />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="page-setup-dialog" className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>페이지 설정</DialogTitle>
          <DialogDescription>
            용지 크기·방향·여백을 변경합니다. 단위: mm
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          className="space-y-4"
          data-testid="page-setup-form"
        >
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">용지 크기</span>
            <select
              value={form.preset}
              onChange={(e) => setPreset(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              data-testid="page-setup-preset"
            >
              {PAPER_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
              <option value="custom">사용자 정의</option>
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            {num('widthMm', '너비', 'page-setup-width')}
            {num('heightMm', '높이', 'page-setup-height')}
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={form.landscape}
              onChange={(e) =>
                setForm((f) => ({ ...f, landscape: e.target.checked }))
              }
              data-testid="page-setup-landscape"
            />
            <span>가로 방향 (landscape)</span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            {num('marginTopMm', '위 여백', 'page-setup-margin-top')}
            {num('marginBottomMm', '아래 여백', 'page-setup-margin-bottom')}
            {num('marginLeftMm', '왼쪽 여백', 'page-setup-margin-left')}
            {num('marginRightMm', '오른쪽 여백', 'page-setup-margin-right')}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              data-testid="page-setup-cancel"
            >
              취소
            </Button>
            <Button type="submit" data-testid="page-setup-apply">
              적용
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
