/// <reference lib="dom" />
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { FolderEntry } from '@shared/api';

/**
 * VS Code-style folder tree.
 *
 * - Single root opened via `folder:pick` (parent supplies `rootPath`).
 * - Children fetched lazily on first expand (`folder:list`).
 * - chokidar events refresh the affected parent's child list only.
 * - Show every entry (folders + files), no extension filtering.
 * - Click a file → `onOpenPath` (parent decides what to do; for non-hwp
 *   files this no-ops).
 */

interface FolderTreeProps {
  rootPath: string;
  activePath: string | null;
  onOpenPath: (path: string) => void | Promise<void>;
}

interface NodeProps {
  entry: FolderEntry;
  depth: number;
  expanded: Set<string>;
  childrenByPath: Map<string, FolderEntry[]>;
  loadingPaths: Set<string>;
  activePath: string | null;
  onToggle: (path: string) => void | Promise<void>;
  onOpenPath: (path: string) => void | Promise<void>;
}

const INDENT_PX = 12;

const TreeNode = memo(function TreeNode({
  entry,
  depth,
  expanded,
  childrenByPath,
  loadingPaths,
  activePath,
  onToggle,
  onOpenPath,
}: NodeProps) {
  const isExpanded = expanded.has(entry.path);
  const isActive = activePath === entry.path;
  const isLoading = loadingPaths.has(entry.path);
  const children = childrenByPath.get(entry.path);

  const handleClick = (): void => {
    if (entry.isDirectory) {
      void onToggle(entry.path);
    } else {
      void onOpenPath(entry.path);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={
          'flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs hover:bg-muted ' +
          (isActive ? 'bg-muted font-medium' : '')
        }
        style={{ paddingLeft: 8 + depth * INDENT_PX }}
        title={entry.path}
        data-testid={
          entry.isDirectory ? 'folder-tree-folder' : 'folder-tree-file'
        }
        data-path={entry.path}
      >
        {entry.isDirectory ? (
          <>
            {isExpanded ? (
              <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            )}
            {isExpanded ? (
              <FolderOpen className="size-4 shrink-0 text-amber-500" />
            ) : (
              <Folder className="size-4 shrink-0 text-amber-500" />
            )}
          </>
        ) : (
          <>
            {/* spacer where the chevron would be, keeps file names aligned */}
            <span className="size-3 shrink-0" aria-hidden="true" />
            <File className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {entry.isDirectory && isExpanded && (
        <div>
          {isLoading && !children ? (
            <div
              className="px-2 py-0.5 text-xs text-muted-foreground"
              style={{ paddingLeft: 8 + (depth + 1) * INDENT_PX }}
            >
              로딩 중…
            </div>
          ) : children && children.length === 0 ? (
            <div
              className="px-2 py-0.5 text-xs text-muted-foreground"
              style={{ paddingLeft: 8 + (depth + 1) * INDENT_PX }}
            >
              (비어 있음)
            </div>
          ) : (
            children?.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                depth={depth + 1}
                expanded={expanded}
                childrenByPath={childrenByPath}
                loadingPaths={loadingPaths}
                activePath={activePath}
                onToggle={onToggle}
                onOpenPath={onOpenPath}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});

export function FolderTree({
  rootPath,
  activePath,
  onOpenPath,
}: FolderTreeProps): React.ReactElement {
  const [rootChildren, setRootChildren] = useState<FolderEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<
    Map<string, FolderEntry[]>
  >(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const expandedRef = useRef<Set<string>>(new Set());
  // Mirror `expanded` into a ref via effect — avoids "ref read during
  // render" lint and lets the watcher's onChange callback see the latest
  // expansion set without re-subscribing on every render.
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  // Fetch a folder's immediate children. Skips when a fetch is already
  // in flight for the same path.
  const loadChildren = useCallback(
    async (folderPath: string): Promise<FolderEntry[]> => {
      setLoadingPaths((prev) => {
        const next = new Set(prev);
        next.add(folderPath);
        return next;
      });
      try {
        const items = await window.api.folder.list(folderPath);
        setChildrenByPath((prev) => {
          const next = new Map(prev);
          next.set(folderPath, items);
          return next;
        });
        return items;
      } finally {
        setLoadingPaths((prev) => {
          const next = new Set(prev);
          next.delete(folderPath);
          return next;
        });
      }
    },
    [],
  );

  // Initial root load + watcher attach. Re-runs when rootPath changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Reset state asynchronously so we don't hit
      // react-hooks/set-state-in-effect on the synchronous fall-through.
      setRootChildren([]);
      setChildrenByPath(new Map());
      setExpanded(new Set());
      setLoadingPaths(new Set());
      const items = await window.api.folder.list(rootPath);
      if (cancelled) return;
      setRootChildren(items);
      setChildrenByPath((prev) => {
        const next = new Map(prev);
        next.set(rootPath, items);
        return next;
      });
      await window.api.folder.watch(rootPath);
    })();

    const unsubscribe = window.api.folder.onChange((event) => {
      // Refetch the parent dir's children. We only refresh dirs that are
      // either the root or currently expanded — collapsed dirs will
      // re-fetch when next opened.
      const parent = event.parent;
      if (parent === rootPath) {
        void window.api.folder.list(rootPath).then((items) => {
          if (cancelled) return;
          setRootChildren(items);
          setChildrenByPath((prev) => {
            const next = new Map(prev);
            next.set(rootPath, items);
            return next;
          });
        });
        return;
      }
      if (expandedRef.current.has(parent)) {
        void window.api.folder.list(parent).then((items) => {
          if (cancelled) return;
          setChildrenByPath((prev) => {
            const next = new Map(prev);
            next.set(parent, items);
            return next;
          });
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
      void window.api.folder.unwatch();
    };
  }, [rootPath]);

  const handleToggle = useCallback(
    async (folderPath: string): Promise<void> => {
      const willExpand = !expanded.has(folderPath);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(folderPath)) {
          next.delete(folderPath);
        } else {
          next.add(folderPath);
        }
        return next;
      });
      if (willExpand && !childrenByPath.has(folderPath)) {
        await loadChildren(folderPath);
      }
    },
    [expanded, childrenByPath, loadChildren],
  );

  return (
    <div
      className="flex h-full flex-col overflow-auto"
      data-testid="folder-tree"
    >
      {rootChildren.length === 0 ? (
        <div className="px-3 py-4 text-xs text-muted-foreground">(빈 폴더)</div>
      ) : (
        rootChildren.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            expanded={expanded}
            childrenByPath={childrenByPath}
            loadingPaths={loadingPaths}
            activePath={activePath}
            onToggle={handleToggle}
            onOpenPath={onOpenPath}
          />
        ))
      )}
    </div>
  );
}
