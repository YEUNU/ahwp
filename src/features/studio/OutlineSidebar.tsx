import { ListTree } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { ViewerHandle } from './types';

/**
 * Document outline sidebar — chunk 58. Walks the active doc's
 * paragraph styles via `viewer.getOutline()`, renders headings indented
 * by level, and routes clicks through `viewer.scrollToParagraph()`.
 *
 * The IR walk is on-demand: we refetch when `dirty` flips (the
 * StudioViewer's status bar already debounces dirty changes 200ms, so
 * this won't churn during typing — but TOC follows behind by one
 * debounce cycle, which is fine for the navigation use case).
 *
 * Empty fallback: if the doc has no styles named "제목 1" / "Heading 1"
 * the panel shows a hint nudging the user to apply heading styles.
 */

export interface OutlineSidebarProps {
  /** Lazy resolver for the active viewer handle. AppShell passes
   *  `() => activeViewerRef()`. */
  getViewer: () => ViewerHandle | null;
  /** Bumps every time the active doc's content changes — drives the
   *  refetch effect. */
  refreshKey: number;
  /** Toggle handler for the sidebar's collapse button. */
  onClose: () => void;
}

export function OutlineSidebar({
  getViewer,
  refreshKey,
  onClose,
}: OutlineSidebarProps): JSX.Element {
  const [items, setItems] = useState<
    { paragraphIndex: number; level: number; text: string }[]
  >([]);

  useEffect(() => {
    const v = getViewer();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setItems(v?.getOutline() ?? []);
  }, [getViewer, refreshKey]);

  return (
    <div
      className="flex h-full w-56 flex-col border-l border-border bg-card text-xs"
      data-testid="studio-outline-sidebar"
    >
      <div className="flex h-9 items-center justify-between gap-2 border-b border-border px-3">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <ListTree className="size-3.5" />
          목차
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="목차 닫기"
          data-testid="studio-outline-close"
        >
          ✕
        </button>
      </div>
      {items.length === 0 ? (
        <div
          className="px-3 py-4 text-[11px] leading-relaxed text-muted-foreground"
          data-testid="studio-outline-empty"
        >
          단락 스타일을 "제목 1" / "제목 2" 등으로 지정하면 여기에 자동으로
          목차가 표시됩니다.
        </div>
      ) : (
        <ul
          className="flex-1 overflow-auto py-1"
          data-testid="studio-outline-list"
        >
          {items.map((item, idx) => (
            <li key={`${item.paragraphIndex}-${idx}`}>
              <button
                type="button"
                onClick={() => {
                  const v = getViewer();
                  v?.scrollToParagraph(0, item.paragraphIndex);
                }}
                data-testid="studio-outline-item"
                data-level={item.level}
                className={cn(
                  'block w-full truncate px-3 py-1 text-left text-[11px] hover:bg-muted',
                  item.level === 1 && 'font-semibold',
                )}
                style={{ paddingLeft: `${0.75 + (item.level - 1) * 0.6}rem` }}
                title={item.text}
              >
                {item.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
