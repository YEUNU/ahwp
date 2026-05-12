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

/**
 * Equation preview — chunk 16. Lets the user type a 한컴 수식 script
 * and see a live SVG preview rendered by `renderEquationPreview`.
 *
 * Inserting a new equation control into the body is deferred — the
 * library doesn't expose a one-call "insert equation" hook, so the
 * follow-up will need to wire createShapeControl + setEquationProperties
 * together. For now this dialog is preview-only (still useful for
 * authoring + sanity-checking syntax against the IR).
 */

const SAMPLE_SCRIPT = String.raw`a^2 + b^2 = c^2`;

export interface EquationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Render the script via `renderEquationPreview`. Returns SVG string or ''. */
  renderEquation: (
    script: string,
    fontSizeHwpunit?: number,
    color?: number,
  ) => string;
  /** 0.4.25 — lib 0.7.11 의 insertEquation 으로 본문에 수식 control
   *  삽입. caret 위치 (sec, para, charOff) 는 호출 측에서 결정. 성공
   *  시 true, lib panic / docless 시 false. */
  insertEquation?: (
    script: string,
    fontSizeHwpunit: number,
    color: number,
  ) => boolean;
}

export function EquationDialog({
  open,
  onOpenChange,
  renderEquation,
  insertEquation,
}: EquationDialogProps): JSX.Element {
  const [script, setScript] = useState<string>(SAMPLE_SCRIPT);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  // 0.4.26 — 폰트 크기 (pt) + 색상 옵션. lib insertEquation 은 fontSize
  // 를 HWPUNIT (pt × 100) 으로 받음. 색상은 RGB int (0xRRGGBB).
  const [fontSizePt, setFontSizePt] = useState<number>(10);
  const [color, setColor] = useState<string>('#000000');

  // Re-render preview on every script change. Driven by an effect so the
  // dialog re-renders both when the user types and when the dialog first
  // opens (with the seed script). The lint rule prefers we derive svg
  // with useMemo, but renderEquation has IR-side cost we want to gate
  // on `open`, so the effect form is correct here.
  useEffect(() => {
    if (!open) return;
    if (script.trim().length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSvg('');
      return;
    }
    const fontHwpunit = Math.max(100, Math.round(fontSizePt * 100));
    const colorInt = parseInt(color.replace('#', ''), 16) || 0;
    const out = renderEquation(script, fontHwpunit, colorInt);
    if (out.length === 0) {
      setError('수식 렌더링에 실패했습니다. 문법을 확인하세요.');
      setSvg('');
    } else {
      setError(null);
      setSvg(out);
    }
  }, [open, script, fontSizePt, color, renderEquation]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="equation-dialog" className="max-w-2xl gap-4">
        <DialogHeader>
          <DialogTitle>수식</DialogTitle>
          <DialogDescription>
            한컴 수식 문법으로 입력하면 SVG 미리보기를 보여줍니다. 본문에 삽입
            버튼으로 현재 캐럿 위치에 수식 컨트롤을 추가합니다.
          </DialogDescription>
        </DialogHeader>

        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">수식 script</span>
          <textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={4}
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-ring"
            data-testid="equation-script"
            spellCheck={false}
          />
        </label>

        <div className="flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">크기 (pt)</span>
            <select
              value={fontSizePt}
              onChange={(e) => setFontSizePt(Number(e.target.value))}
              data-testid="equation-font-size"
              className="rounded-md border border-input bg-background px-2 py-1"
            >
              {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}pt
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">색상</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              data-testid="equation-color"
              className="h-7 w-12 cursor-pointer rounded border border-input bg-background"
              aria-label="수식 색상"
            />
          </label>
        </div>

        <section
          className="flex min-h-32 items-center justify-center rounded-md border border-border bg-card/50 p-4"
          data-testid="equation-preview"
          aria-label="수식 미리보기"
        >
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : svg ? (
            // The IR returns a self-contained SVG string; injecting via
            // dangerouslySetInnerHTML is acceptable here because the
            // payload is generated by our own WASM, not user-controlled
            // network data.
            <div
              className="[&_svg]:max-h-32 [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              수식을 입력하면 미리보기가 표시됩니다.
            </p>
          )}
        </section>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="equation-close"
          >
            닫기
          </Button>
          {insertEquation ? (
            <Button
              type="button"
              variant="default"
              disabled={script.trim().length === 0 || svg.length === 0}
              onClick={() => {
                const fontHwpunit = Math.max(100, Math.round(fontSizePt * 100));
                const colorInt = parseInt(color.replace('#', ''), 16) || 0;
                const ok = insertEquation(script, fontHwpunit, colorInt);
                if (ok) onOpenChange(false);
                else setError('수식 삽입에 실패했습니다.');
              }}
              data-testid="equation-insert"
            >
              본문에 삽입
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
