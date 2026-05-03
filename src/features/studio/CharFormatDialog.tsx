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
import type { CharFormatKey, ViewerHandle } from './types';

/**
 * 글자 모양 다이얼로그 (Alt+L) — 한글 reflex 호환.
 *
 * IR이 publish하는 `applyCharFormat`/`applyFontSizePt`/`applyTextColor`
 * 만 사용한 v1. 폰트 family 직접 변경은 아직 미노출이라 후속.
 *
 * 동작:
 *  - Bold/Italic/Underline 체크박스 → toggleCharFormat (현재 상태와 다르면 적용)
 *  - Font size pt → applyFontSizePt
 *  - Text color hex → applyTextColor
 *  - "적용" 버튼 클릭 시에만 IR 호출 (취소 안전)
 *
 * AppShell이 dialog open 시점에 caret의 현재 active format을 읽어
 * `initial` prop으로 전달. 컴포넌트는 매 open마다 `key={openInstanceId}`
 * 로 remount되어 useState lazy init이 fresh로 실행됨.
 */
export function CharFormatDialog({
  open,
  onOpenChange,
  viewerRef,
  initial,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  viewerRef: () => ViewerHandle | null;
  initial: { bold: boolean; italic: boolean; underline: boolean };
}) {
  const [bold, setBold] = useState(initial.bold);
  const [italic, setItalic] = useState(initial.italic);
  const [underline, setUnderline] = useState(initial.underline);
  const [fontSize, setFontSize] = useState<string>('10');
  const [color, setColor] = useState('#000000');

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    const v = viewerRef();
    if (!v) {
      onOpenChange(false);
      return;
    }
    const toggles: CharFormatKey[] = [];
    if (bold !== initial.bold) toggles.push('bold');
    if (italic !== initial.italic) toggles.push('italic');
    if (underline !== initial.underline) toggles.push('underline');
    for (const k of toggles) v.toggleCharFormat(k);
    const sizePt = Number(fontSize);
    if (Number.isFinite(sizePt) && sizePt > 0 && sizePt <= 1000) {
      v.applyFontSizePt(sizePt);
    }
    if (/^#[0-9a-fA-F]{6}$/.test(color)) {
      v.applyTextColor(color);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>글자 모양</DialogTitle>
          <DialogDescription>
            현재 선택 또는 caret 단락의 글자 속성을 변경합니다.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bold}
                onChange={(e) => setBold(e.target.checked)}
                data-testid="charfmt-bold"
              />
              진하게 (B)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={italic}
                onChange={(e) => setItalic(e.target.checked)}
                data-testid="charfmt-italic"
              />
              기울임 (I)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={underline}
                onChange={(e) => setUnderline(e.target.checked)}
                data-testid="charfmt-underline"
              />
              밑줄 (U)
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">크기 (pt)</span>
              <Input
                type="number"
                min={1}
                max={1000}
                step={0.5}
                value={fontSize}
                onChange={(e) => setFontSize(e.target.value)}
                data-testid="charfmt-size"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">색상 (#RRGGBB)</span>
              <Input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                data-testid="charfmt-color"
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
            <Button type="submit" data-testid="charfmt-apply">
              적용
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
