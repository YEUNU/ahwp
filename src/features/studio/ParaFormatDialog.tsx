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
import type { ParagraphAlignment, ViewerHandle } from './types';

/**
 * 문단 모양 다이얼로그 (Alt+T) — 한글 reflex 호환.
 *
 * v1.1: 정렬 + 줄 간격 (% of single line) + 들여쓰기 (mm).
 * 라이브러리 `applyParaFormat` props 전체 (lineSpacingType / spacing*
 * before/after / marginRight 등)는 후속에서 추가 — 가장 흔한 항목 우선.
 */
const ALIGNMENT_OPTIONS: Array<{ value: ParagraphAlignment; label: string }> = [
  { value: 'left', label: '왼쪽' },
  { value: 'center', label: '가운데' },
  { value: 'right', label: '오른쪽' },
  { value: 'justify', label: '양쪽' },
];

const HWPUNIT_PER_MM = 567 / 2;

export function ParaFormatDialog({
  open,
  onOpenChange,
  viewerRef,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  viewerRef: () => ViewerHandle | null;
}) {
  const [alignment, setAlignment] = useState<ParagraphAlignment>('left');
  const [lineSpacing, setLineSpacing] = useState<string>('100');
  const [indentMm, setIndentMm] = useState<string>('0');

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const v = viewerRef();
    if (v) {
      const props: Record<string, unknown> = { alignment };
      const ls = Number(lineSpacing);
      if (Number.isFinite(ls) && ls > 0 && ls <= 1000) {
        props.lineSpacing = ls;
        props.lineSpacingType = 'Percent';
      }
      const indent = Number(indentMm);
      if (Number.isFinite(indent)) {
        props.indent = Math.round(indent * HWPUNIT_PER_MM);
      }
      v.applyParaProps(props);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>문단 모양</DialogTitle>
          <DialogDescription>
            현재 선택 또는 caret 단락의 정렬·간격·들여쓰기를 설정합니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm text-muted-foreground">정렬</legend>
            <div className="flex gap-3">
              {ALIGNMENT_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="alignment"
                    value={opt.value}
                    checked={alignment === opt.value}
                    onChange={() => setAlignment(opt.value)}
                    data-testid={`parafmt-align-${opt.value}`}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">줄 간격 (%)</span>
              <Input
                type="number"
                min={50}
                max={500}
                step={5}
                value={lineSpacing}
                onChange={(e) => setLineSpacing(e.target.value)}
                data-testid="parafmt-line-spacing"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">첫 줄 들여쓰기 (mm)</span>
              <Input
                type="number"
                step={1}
                value={indentMm}
                onChange={(e) => setIndentMm(e.target.value)}
                data-testid="parafmt-indent"
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" data-testid="parafmt-apply">
              적용
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
