import { Trash2 } from 'lucide-react';
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
 * Bookmark manager — chunk 12. Add a named bookmark at the current caret
 * position, and view / delete the existing list. Jumping to a bookmark's
 * location is deferred (caret + scroll mechanics live deeper in
 * StudioViewer than this dialog can reach today).
 *
 * IR shape (verified by probe):
 *   [{ name, sec, para, ctrlIdx, charPos }, ...]
 */

interface Bookmark {
  name: string;
  sec: number;
  para: number;
  ctrlIdx: number;
  charPos: number;
}

export interface BookmarkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Snapshot of all bookmarks. Returns null if no doc is loaded. */
  getBookmarks: () => Record<string, unknown>[] | null;
  /** Add a bookmark at the active viewer's caret. */
  onAdd: (name: string) => void;
  /** Delete a bookmark by IR coordinates. */
  onDelete: (sec: number, para: number, ctrlIdx: number) => void;
}

function asBookmarks(raw: Record<string, unknown>[] | null): Bookmark[] {
  if (!raw) return [];
  const result: Bookmark[] = [];
  for (const b of raw) {
    if (
      typeof b.name === 'string' &&
      typeof b.sec === 'number' &&
      typeof b.para === 'number' &&
      typeof b.ctrlIdx === 'number' &&
      typeof b.charPos === 'number'
    ) {
      result.push({
        name: b.name,
        sec: b.sec,
        para: b.para,
        ctrlIdx: b.ctrlIdx,
        charPos: b.charPos,
      });
    }
  }
  return result;
}

export function BookmarkDialog({
  open,
  onOpenChange,
  getBookmarks,
  onAdd,
  onDelete,
}: BookmarkDialogProps): JSX.Element {
  const [name, setName] = useState('');
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  // Refresh the list whenever the dialog opens or after each add/delete.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBookmarks(asBookmarks(getBookmarks()));
  }, [open, getBookmarks]);

  const refresh = (): void => {
    setBookmarks(asBookmarks(getBookmarks()));
  };

  const onSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onAdd(trimmed);
    setName('');
    refresh();
  };

  const onRemove = (b: Bookmark): void => {
    onDelete(b.sec, b.para, b.ctrlIdx);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="bookmark-dialog" className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>책갈피</DialogTitle>
          <DialogDescription>
            현재 커서 위치에 이름을 붙여 책갈피로 저장합니다.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onSubmit}
          className="flex gap-2"
          data-testid="bookmark-add-form"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="책갈피 이름"
            data-testid="bookmark-name-input"
            autoFocus
          />
          <Button
            type="submit"
            disabled={name.trim().length === 0}
            data-testid="bookmark-add"
          >
            추가
          </Button>
        </form>

        <section
          className="space-y-1 text-xs"
          data-testid="bookmark-list"
          aria-label="책갈피 목록"
        >
          {bookmarks.length === 0 ? (
            <p className="text-muted-foreground" data-testid="bookmark-empty">
              저장된 책갈피가 없습니다.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {bookmarks.map((b) => (
                <li
                  key={`${b.sec}-${b.para}-${b.ctrlIdx}`}
                  className="flex items-center justify-between px-3 py-2"
                  data-testid="bookmark-row"
                  data-bookmark-name={b.name}
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-[10px] text-muted-foreground/70">
                      §{b.sec} · ¶{b.para} · @{b.charPos}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`${b.name} 삭제`}
                    onClick={() => onRemove(b)}
                    data-testid="bookmark-delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="bookmark-close"
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
