import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Notion-style `/` slash menu — chunk 64. Opens when the user types `/`
 * at the start of an empty paragraph; the StudioViewer suppresses the
 * literal `/` and pops this menu at the caret. Selection wraps via
 * arrow keys + Enter; Esc closes without firing.
 *
 * Items map to existing ViewerHandle methods so we don't grow the
 * IR surface — every command corresponds to a button the user could
 * already invoke from the toolbar / menu.
 */

export type SlashCommandId =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'list-bullet'
  | 'list-number'
  | 'page-break';

interface SlashCommand {
  id: SlashCommandId;
  label: string;
  hint: string;
  /** Match tokens for the inline filter — Korean + English. */
  keywords: string[];
}

const COMMANDS: SlashCommand[] = [
  {
    id: 'heading-1',
    label: '제목 1',
    hint: '큰 제목',
    keywords: ['heading', 'h1', 'title', '제목', '큰', '대제목'],
  },
  {
    id: 'heading-2',
    label: '제목 2',
    hint: '중간 제목',
    keywords: ['heading', 'h2', 'subtitle', '제목', '중간'],
  },
  {
    id: 'heading-3',
    label: '제목 3',
    hint: '작은 제목',
    keywords: ['heading', 'h3', '제목', '작은'],
  },
  {
    id: 'list-bullet',
    label: '글머리 기호',
    hint: '점 리스트',
    keywords: ['list', 'bullet', 'ul', '글머리', '리스트', '점'],
  },
  {
    id: 'list-number',
    label: '번호 매기기',
    hint: '숫자 리스트',
    keywords: ['list', 'number', 'ol', '번호', '리스트'],
  },
  {
    id: 'page-break',
    label: '페이지 나누기',
    hint: '새 페이지',
    keywords: ['page', 'break', '페이지', '나누기'],
  },
];

export interface SlashMenuProps {
  /** Anchor position in client coordinates (caret rect). */
  x: number;
  y: number;
  onPick: (id: SlashCommandId) => void;
  onClose: () => void;
}

export function SlashMenu({
  x,
  y,
  onPick,
  onClose,
}: SlashMenuProps): JSX.Element {
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on outside click. Listener is attached on a microtask delay
  // so the same `/` keystroke that opened us doesn't immediately close
  // us via a synthetic click cascade.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (
        rootRef.current &&
        e.target instanceof Node &&
        rootRef.current.contains(e.target)
      )
        return;
      onClose();
    };
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  const filtered = COMMANDS.filter((c) => {
    if (filter.length === 0) return true;
    const f = filter.toLowerCase();
    return (
      c.label.toLowerCase().includes(f) ||
      c.keywords.some((k) => k.toLowerCase().includes(f))
    );
  });

  // Clamp `active` when the list shrinks.
  const clampedActive = active >= filtered.length ? 0 : active;

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % Math.max(1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(
        (i) =>
          (i - 1 + Math.max(1, filtered.length)) % Math.max(1, filtered.length),
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[clampedActive];
      if (pick) onPick(pick.id);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={rootRef}
      role="menu"
      data-testid="studio-slash-menu"
      className="fixed z-50 w-56 rounded-md border border-border bg-popover py-1 shadow-md"
      style={{ left: x, top: y }}
    >
      <input
        ref={inputRef}
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={onKey}
        placeholder="명령 검색…"
        className="w-full border-b border-border bg-transparent px-2 py-1 text-xs outline-none"
        data-testid="studio-slash-input"
      />
      <ul className="max-h-60 overflow-auto">
        {filtered.map((cmd, idx) => (
          <li key={cmd.id}>
            <button
              type="button"
              onClick={() => onPick(cmd.id)}
              onMouseEnter={() => setActive(idx)}
              data-testid={`studio-slash-${cmd.id}`}
              className={cn(
                'flex w-full items-center justify-between gap-2 px-2 py-1 text-left text-xs',
                idx === clampedActive ? 'bg-muted' : 'hover:bg-muted/60',
              )}
            >
              <span>{cmd.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {cmd.hint}
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="px-2 py-2 text-center text-[10px] text-muted-foreground">
            결과 없음
          </li>
        ) : null}
      </ul>
    </div>
  );
}
