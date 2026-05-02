import { X } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

/**
 * Tab strip rendered above the editor pane. One tab per open file.
 * Active tab is highlighted; dirty tabs show a leading dot. Each tab has
 * a close (×) button — closing a dirty tab is gated by a confirm dialog
 * in AppShell.
 *
 * Drag-and-drop reorder + right-click context menu added in Phase 1
 * leftover. Drag uses HTML5 native drag, payload is the source index
 * encoded as a string in `text/x-ahwp-tab`. Context menu offers the
 * common close-many actions plus reveal-in-finder / copy-path.
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
  /** Move tab from `from` to `to`. AppShell rebuilds the array. */
  onReorder?: (from: number, to: number) => void;
  /** Close every tab except the one at `keepIndex`. */
  onCloseOthers?: (keepIndex: number) => void;
  /** Close every tab whose index is greater than `index`. */
  onCloseRight?: (index: number) => void;
  /** Reveal the tab's path in the OS file manager. */
  onReveal?: (index: number) => void;
  /** Copy the tab's absolute path to the clipboard. */
  onCopyPath?: (index: number) => void;
}

function basenameOf(p: string): string {
  // Cross-platform basename without pulling in Node's path module.
  const sep = p.includes('\\') ? '\\' : '/';
  const i = p.lastIndexOf(sep);
  return i >= 0 ? p.slice(i + 1) : p;
}

const TAB_DRAG_MIME = 'text/x-ahwp-tab';

export function TabBar({
  tabs,
  activeIndex,
  onActivate,
  onClose,
  onReorder,
  onCloseOthers,
  onCloseRight,
  onReveal,
  onCopyPath,
}: TabBarProps): React.ReactElement {
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [menuFor, setMenuFor] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  // Close the context menu on outside click / Escape.
  useEffect(() => {
    if (menuFor === null) return;
    const onDocDown = (e: MouseEvent): void => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        !menuRef.current.contains(e.target)
      ) {
        setMenuFor(null);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuFor(null);
    };
    document.addEventListener('mousedown', onDocDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

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
        const handleDragStart = (e: ReactDragEvent<HTMLDivElement>): void => {
          if (!onReorder) return;
          e.dataTransfer.setData(TAB_DRAG_MIME, String(idx));
          e.dataTransfer.setData('text/plain', tab.path);
          e.dataTransfer.effectAllowed = 'move';
        };
        const handleDragOver = (e: ReactDragEvent<HTMLDivElement>): void => {
          if (!onReorder) return;
          if (!e.dataTransfer.types.includes(TAB_DRAG_MIME)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setDragOverIdx(idx);
        };
        const handleDragLeave = (): void => {
          setDragOverIdx((cur) => (cur === idx ? null : cur));
        };
        const handleDrop = (e: ReactDragEvent<HTMLDivElement>): void => {
          if (!onReorder) return;
          const raw = e.dataTransfer.getData(TAB_DRAG_MIME);
          if (!raw) return;
          e.preventDefault();
          const from = Number.parseInt(raw, 10);
          if (Number.isNaN(from) || from === idx) return;
          onReorder(from, idx);
          setDragOverIdx(null);
        };
        const handleContextMenu = (
          e: ReactMouseEvent<HTMLDivElement>,
        ): void => {
          e.preventDefault();
          setMenuFor({ index: idx, x: e.clientX, y: e.clientY });
        };
        return (
          <div
            key={`${idx}:${tab.path}`}
            draggable={onReorder ? true : undefined}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onContextMenu={handleContextMenu}
            className={
              'flex min-w-0 max-w-[16rem] shrink-0 items-center gap-1.5 border-r border-border px-3 text-xs ' +
              (isActive
                ? 'bg-background text-foreground'
                : 'text-muted-foreground hover:bg-muted') +
              (dragOverIdx === idx ? ' ring-2 ring-inset ring-primary/40' : '')
            }
            data-testid="studio-tab"
            data-path={tab.path}
            data-active={isActive ? 'true' : 'false'}
            data-dirty={tab.dirty ? 'true' : 'false'}
            data-drag-over={dragOverIdx === idx ? 'true' : 'false'}
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
      {menuFor !== null ? (
        <ul
          ref={menuRef}
          role="menu"
          data-testid="studio-tab-context-menu"
          className="fixed z-50 min-w-[12rem] rounded-md border border-border bg-popover py-1 text-xs text-popover-foreground shadow-md"
          style={{ top: menuFor.y, left: menuFor.x }}
        >
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                onClose(menuFor.index);
                setMenuFor(null);
              }}
              className="block w-full px-3 py-1.5 text-left hover:bg-muted"
              data-testid="studio-tab-menu-close"
            >
              닫기
            </button>
          </li>
          {onCloseOthers && tabs.length > 1 ? (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseOthers(menuFor.index);
                  setMenuFor(null);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                data-testid="studio-tab-menu-close-others"
              >
                다른 탭 모두 닫기
              </button>
            </li>
          ) : null}
          {onCloseRight && menuFor.index < tabs.length - 1 ? (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCloseRight(menuFor.index);
                  setMenuFor(null);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                data-testid="studio-tab-menu-close-right"
              >
                오른쪽 탭 모두 닫기
              </button>
            </li>
          ) : null}
          {onCopyPath ? (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onCopyPath(menuFor.index);
                  setMenuFor(null);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                data-testid="studio-tab-menu-copy-path"
              >
                경로 복사
              </button>
            </li>
          ) : null}
          {onReveal ? (
            <li>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onReveal(menuFor.index);
                  setMenuFor(null);
                }}
                className="block w-full px-3 py-1.5 text-left hover:bg-muted"
                data-testid="studio-tab-menu-reveal"
              >
                파일 관리자에서 보기
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
