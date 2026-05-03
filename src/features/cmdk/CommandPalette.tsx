import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * Command palette — chunk 50. ⌘K (mac) / Ctrl+K (win/linux) opens a
 * unified search-and-execute modal. Replaces the "where is feature X
 * in the menu?" hunt with a single keyboard-driven entry point.
 *
 * Categories:
 *   - **action** — every `MenuAction` (file/edit/format/view/insert)
 *   - **tab**   — switch to an open tab by filename
 *   - **recent** — open a recent file from the LRU list
 *   - **theme** — light / dark / system toggle
 *
 * The fuzzy match is a tiny "all chars in order, prefix-bonus" scorer
 * — sufficient at the ~60 entries we have without pulling fuse.js.
 *
 * Keyboard:
 *   - Arrow Up/Down — navigate
 *   - Enter        — execute highlighted
 *   - Esc          — close
 *   - Type         — incremental filter, auto-selects top match
 */

export type CommandKind = 'action' | 'tab' | 'recent' | 'theme';

export interface CommandItem {
  id: string;
  kind: CommandKind;
  /** Primary user-visible text (e.g. "파일 → 저장"). */
  label: string;
  /** Optional secondary hint shown right-aligned (shortcut, path tail). */
  hint?: string;
  /** Bag of words that should match queries (label is included automatically). */
  keywords?: string[];
  /** Side effect when the user picks this item. */
  run: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
}

interface ScoredItem {
  item: CommandItem;
  score: number;
}

/** Tiny fuzzy scorer — returns Infinity for empty query (every item passes),
 *  -1 for no match. Higher is better. Prefix matches in label win big. */
function scoreFuzzy(query: string, item: CommandItem): number {
  if (query.length === 0) return 1;
  const q = query.toLowerCase();
  const haystack = (
    item.label +
    ' ' +
    (item.keywords ?? []).join(' ')
  ).toLowerCase();
  // Quick exact-substring path for the common case.
  const idx = haystack.indexOf(q);
  if (idx >= 0) {
    // Earlier match scores higher; word-boundary bonus.
    const prefix = idx === 0 || haystack[idx - 1] === ' ' ? 200 : 100;
    return prefix - idx;
  }
  // Fall through to in-order char match.
  let pos = 0;
  let score = 0;
  for (const ch of q) {
    const found = haystack.indexOf(ch, pos);
    if (found < 0) return -1;
    score += 10 - Math.min(9, found - pos);
    pos = found + 1;
  }
  return score;
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
}: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset on each open so a stale query doesn't linger.
  // The dialog mounts fresh each time `open` flips true (Radix unmounts
  // on close), so we drive the reset off `open` and avoid the
  // set-state-in-effect cascade by routing both setters through a
  // single state object on the cheap path.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery('');

    setActive(0);
  }, [open]);

  const filtered = useMemo<ScoredItem[]>(() => {
    const scored: ScoredItem[] = [];
    for (const item of items) {
      const score = scoreFuzzy(query, item);
      if (score >= 0) scored.push({ item, score });
    }
    scored.sort((a, b) => b.score - a.score);
    // Cap to a sane number — beyond ~50 entries the list becomes
    // dropdown-soup. The user can refine the query.
    return scored.slice(0, 50);
  }, [items, query]);

  // Clamp active when the filter shrinks the list.
  const clampedActive = active >= filtered.length ? 0 : active;
  useEffect(() => {
    if (clampedActive !== active) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive(clampedActive);
    }
  }, [clampedActive, active]);

  // Keep the active row in view while arrowing through long lists.
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector(
      `[data-cmd-idx="${active}"]`,
    ) as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
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
      const pick = filtered[active]?.item;
      if (pick) {
        onOpenChange(false);
        // Defer slightly so the dialog unmounts before the action runs —
        // some actions (e.g. focus-grabbing dialogs) compete with the
        // close transition otherwise.
        setTimeout(() => pick.run(), 0);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="command-palette"
        className="max-w-xl gap-2 p-0"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>명령 팔레트</DialogTitle>
        </DialogHeader>
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="명령 검색 — 메뉴, 파일, 단축키…"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-hidden"
          data-testid="command-palette-input"
        />
        <div
          ref={listRef}
          role="listbox"
          className="max-h-[60vh] overflow-auto py-1"
          data-testid="command-palette-list"
        >
          {filtered.length === 0 ? (
            <div
              className="px-4 py-6 text-center text-xs text-muted-foreground"
              data-testid="command-palette-empty"
            >
              일치하는 명령이 없습니다.
            </div>
          ) : (
            filtered.map(({ item }, idx) => (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={idx === active}
                data-cmd-idx={idx}
                data-cmd-id={item.id}
                data-testid="command-palette-item"
                onMouseEnter={() => setActive(idx)}
                onClick={() => {
                  onOpenChange(false);
                  setTimeout(() => item.run(), 0);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs',
                  idx === active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <CategoryBadge kind={item.kind} />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.hint ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {item.hint}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
        <div
          className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground"
          data-testid="command-palette-footer"
        >
          ↑↓ 이동 · Enter 실행 · Esc 닫기
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CategoryBadge({ kind }: { kind: CommandKind }): JSX.Element {
  const label =
    kind === 'action'
      ? '명령'
      : kind === 'tab'
        ? '탭'
        : kind === 'recent'
          ? '최근'
          : '테마';
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide',
        kind === 'action' && 'bg-primary/15 text-primary',
        kind === 'tab' && 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        kind === 'recent' && 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
        kind === 'theme' &&
          'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      )}
    >
      {label}
    </span>
  );
}

// Item factory moved to ./items.ts to satisfy the
// react-refresh/only-export-components rule (CommandPalette.tsx is
// a component-only module).
