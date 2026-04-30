import { X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/**
 * Tab strip rendered above the editor pane. One tab per open file.
 * Active tab is highlighted; dirty tabs show a leading dot. Each tab has
 * a close (×) button — closing a dirty tab is gated by a confirm dialog
 * in AppShell.
 */

export interface TabDescriptor {
  path: string;
  /** Renderer-side dirty state, kept in AppShell. */
  dirty: boolean;
}

interface TabBarProps {
  tabs: TabDescriptor[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onClose: (index: number) => void;
}

function basenameOf(p: string): string {
  // Cross-platform basename without pulling in Node's path module.
  const sep = p.includes('\\') ? '\\' : '/';
  const i = p.lastIndexOf(sep);
  return i >= 0 ? p.slice(i + 1) : p;
}

export function TabBar({
  tabs,
  activeIndex,
  onActivate,
  onClose,
}: TabBarProps): React.ReactElement {
  return (
    <div
      className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b border-border bg-card"
      data-testid="studio-tabbar"
    >
      {tabs.map((tab, idx) => {
        const isActive = idx === activeIndex;
        const handleMouseDown = (
          e: ReactMouseEvent<HTMLButtonElement>,
        ): void => {
          // Middle click closes the tab (browser convention).
          if (e.button === 1) {
            e.preventDefault();
            onClose(idx);
          }
        };
        return (
          <div
            key={`${idx}:${tab.path}`}
            className={
              'flex min-w-0 max-w-[16rem] shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs ' +
              (isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-muted')
            }
            data-testid="studio-tab"
            data-path={tab.path}
            data-active={isActive ? 'true' : 'false'}
            data-dirty={tab.dirty ? 'true' : 'false'}
          >
            <button
              type="button"
              onClick={() => onActivate(idx)}
              onMouseDown={handleMouseDown}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-2 text-left"
              title={tab.path}
            >
              {tab.dirty && (
                <span
                  className="inline-block size-1.5 shrink-0 rounded-full bg-amber-500"
                  aria-hidden="true"
                  data-testid="studio-tab-dirty-dot"
                />
              )}
              <span className="truncate">{basenameOf(tab.path)}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClose(idx);
              }}
              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="탭 닫기"
              title="탭 닫기"
              data-testid="studio-tab-close"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
