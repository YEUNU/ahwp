import { Pencil, Trash2 } from 'lucide-react';
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
 * Style manager — chunk 14. Lists all styles, lets the user add a new
 * named style, rename in place, or delete (paragraphs that used the
 * style fall back to id 0 / 바탕글).
 *
 * IR shape (rhwp.d.ts):
 *   getStyleList → [{id, name, englishName, type, paraShapeId, charShapeId}]
 *   createStyle({name, englishName, type, nextStyleId}) → number
 *   updateStyle(id, {name, englishName, nextStyleId}) → boolean
 *   deleteStyle(id) → boolean
 *
 * Char/para shape mods on a style are deferred — this MVP just manages
 * the name list. Existing toolbar's "스타일" dropdown stays the apply
 * surface; this dialog is the catalog editor.
 */

interface StyleEntry {
  id: number;
  name: string;
  englishName?: string;
}

export interface StyleManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getStyleList: () => Record<string, unknown>[] | null;
  onCreate: (name: string, englishName?: string) => number | null;
  onRename: (id: number, name: string, englishName?: string) => boolean;
  onDelete: (id: number) => boolean;
}

function asStyles(raw: Record<string, unknown>[] | null): StyleEntry[] {
  if (!raw) return [];
  const out: StyleEntry[] = [];
  for (const s of raw) {
    if (typeof s.id === 'number' && typeof s.name === 'string') {
      out.push({
        id: s.id,
        name: s.name,
        englishName:
          typeof s.englishName === 'string' ? s.englishName : undefined,
      });
    }
  }
  return out;
}

export function StyleManagerDialog({
  open,
  onOpenChange,
  getStyleList,
  onCreate,
  onRename,
  onDelete,
}: StyleManagerDialogProps): JSX.Element {
  const [styles, setStyles] = useState<StyleEntry[]>([]);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const refresh = (): void => {
    setStyles(asStyles(getStyleList()));
  };

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStyles(asStyles(getStyleList()));
    setEditingId(null);
  }, [open, getStyleList]);

  const onAdd = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (trimmed.length === 0) return;
    onCreate(trimmed);
    setNewName('');
    refresh();
  };

  const startEdit = (s: StyleEntry): void => {
    setEditingId(s.id);
    setEditName(s.name);
  };

  const commitEdit = (id: number): void => {
    const trimmed = editName.trim();
    if (trimmed.length === 0) {
      setEditingId(null);
      return;
    }
    onRename(id, trimmed);
    setEditingId(null);
    refresh();
  };

  const onRemove = (id: number): void => {
    onDelete(id);
    refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="style-manager-dialog"
        className="max-w-xl gap-4"
      >
        <DialogHeader>
          <DialogTitle>스타일 관리</DialogTitle>
          <DialogDescription>
            문단 스타일 목록을 편집합니다. 새 스타일은 빈 셸로 생성되며 서식은
            툴바에서 적용한 뒤 다음 청크의 "스타일에 저장"으로 매핑됩니다.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={onAdd}
          className="flex gap-2"
          data-testid="style-add-form"
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 스타일 이름"
            data-testid="style-new-name"
          />
          <Button
            type="submit"
            disabled={newName.trim().length === 0}
            data-testid="style-add"
          >
            추가
          </Button>
        </form>

        <section data-testid="style-list" aria-label="스타일 목록">
          <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
            {styles.length === 0 ? (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                스타일이 없습니다.
              </li>
            ) : (
              styles.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                  data-testid="style-row"
                  data-style-id={s.id}
                  data-style-name={s.name}
                >
                  {editingId === s.id ? (
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit(s.id);
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      onBlur={() => commitEdit(s.id)}
                      className="h-7 flex-1"
                      autoFocus
                      data-testid="style-edit-input"
                    />
                  ) : (
                    <div className="flex flex-1 flex-col">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground/70">
                        id {s.id}
                        {s.englishName && s.englishName !== s.name
                          ? ` · ${s.englishName}`
                          : ''}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${s.name} 이름 변경`}
                      onClick={() => startEdit(s)}
                      data-testid="style-rename"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={`${s.name} 삭제`}
                      onClick={() => onRemove(s.id)}
                      // The default body-paragraph style (id 0) is the
                      // fallback target on delete; deleting it would
                      // dangle every paragraph using it.
                      disabled={s.id === 0}
                      data-testid="style-delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="style-close"
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
