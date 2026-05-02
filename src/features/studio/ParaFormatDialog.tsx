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
import type { ParagraphAlignment, ViewerHandle } from './types';

/**
 * 문단 모양 다이얼로그 (Alt+T) — 한글 reflex 호환.
 *
 * v1: 정렬만 지원. 줄 간격 / 들여쓰기 / 단락 간격은 ViewerHandle이
 * 직접 publish하지 않아 후속 (라이브러리 `applyParaFormat`로 props_json
 * 전달하면 가능 — handle 메서드 신설 필요).
 */
const ALIGNMENT_OPTIONS: Array<{ value: ParagraphAlignment; label: string }> = [
  { value: 'left', label: '왼쪽' },
  { value: 'center', label: '가운데' },
  { value: 'right', label: '오른쪽' },
  { value: 'justify', label: '양쪽' },
];

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

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const v = viewerRef();
    if (v) {
      v.applyAlignment(alignment);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>문단 모양</DialogTitle>
          <DialogDescription>
            현재 선택 또는 caret 단락의 정렬을 설정합니다.
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
