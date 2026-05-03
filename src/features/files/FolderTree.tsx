/// <reference lib="dom" />
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
} from 'lucide-react';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { FolderEntry } from '@shared/api';

/**
 * VS Code-style folder tree.
 *
 * - Single root opened via `folder:pick` (parent supplies `rootPath`).
 * - Children fetched lazily on first expand (`folder:list`).
 * - chokidar events refresh the affected parent's child list only.
 * - Selection state is tracked locally; `activePath` (the file shown in
 *   the editor) is highlighted distinctly.
 * - Right-click → context menu with create/rename/trash/reveal.
 * - Inline rename + new file/folder inputs.
 * - Drag-to-move via HTML5 DnD (chunk 65 — wired here, fs.rename in main).
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
  selectedPath: string | null;
  renamingPath: string | null;
  pendingNew: PendingNew | null;
  draggingPath: string | null;
  dropTargetPath: string | null;
  onToggle: (path: string) => void | Promise<void>;
  onOpenPath: (path: string) => void | Promise<void>;
  onSelect: (path: string) => void;
  onContextMenu: (e: ReactMouseEvent, entry: FolderEntry) => void;
  onCommitRename: (path: string, newName: string) => void | Promise<void>;
  onCancelRename: () => void;
  onCommitNew: (
    parentPath: string,
    kind: 'file' | 'folder',
    name: string,
  ) => void | Promise<void>;
  onCancelNew: () => void;
  onDragStart: (e: ReactDragEvent, entry: FolderEntry) => void;
  onDragOver: (e: ReactDragEvent, entry: FolderEntry) => void;
  onDragLeave: () => void;
  onDrop: (e: ReactDragEvent, entry: FolderEntry) => void;
}

const INDENT_PX = 12;

interface ContextMenuState {
  x: number;
  y: number;
  entry: FolderEntry;
}

interface PendingNew {
  parentPath: string;
  kind: 'file' | 'folder';
}

const TreeNode = memo(function TreeNode({
  entry,
  depth,
  expanded,
  childrenByPath,
  loadingPaths,
  activePath,
  selectedPath,
  renamingPath,
  pendingNew,
  draggingPath,
  dropTargetPath,
  onToggle,
  onOpenPath,
  onSelect,
  onContextMenu,
  onCommitRename,
  onCancelRename,
  onCommitNew,
  onCancelNew,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: NodeProps) {
  const isExpanded = expanded.has(entry.path);
  const isActive = activePath === entry.path;
  const isSelected = selectedPath === entry.path;
  const isLoading = loadingPaths.has(entry.path);
  const children = childrenByPath.get(entry.path);
  const isRenaming = renamingPath === entry.path;
  const isDropTarget = dropTargetPath === entry.path;
  const isBeingDragged = draggingPath === entry.path;
  const showInlineNew =
    entry.isDirectory && pendingNew?.parentPath === entry.path;

  const handleClick = (): void => {
    onSelect(entry.path);
    if (entry.isDirectory) {
      void onToggle(entry.path);
    } else {
      void onOpenPath(entry.path);
    }
  };

  const className =
    'flex w-full items-center gap-1 px-2 py-0.5 text-left text-xs hover:bg-muted ' +
    (isActive ? 'bg-muted font-medium ' : isSelected ? 'bg-muted ' : '') +
    (isDropTarget
      ? 'outline outline-2 outline-offset-[-2px] outline-ring '
      : '') +
    (isBeingDragged ? 'opacity-50 ' : '');

  return (
    <div>
      {isRenaming ? (
        <InlineNameInput
          initial={entry.name}
          depth={depth}
          icon={
            entry.isDirectory ? (
              <Folder className="size-4 shrink-0 text-amber-500" />
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground" />
            )
          }
          onCommit={(name) => onCommitRename(entry.path, name)}
          onCancel={onCancelRename}
          dataTestid="folder-tree-rename-input"
        />
      ) : (
        <button
          type="button"
          onClick={handleClick}
          onContextMenu={(e) => onContextMenu(e, entry)}
          draggable
          onDragStart={(e) => onDragStart(e, entry)}
          onDragOver={(e) => onDragOver(e, entry)}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, entry)}
          className={className}
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
              <span className="size-3 shrink-0" aria-hidden="true" />
              <File className="size-4 shrink-0 text-muted-foreground" />
            </>
          )}
          <span className="truncate">{entry.name}</span>
        </button>
      )}
      {entry.isDirectory && isExpanded && (
        <div>
          {showInlineNew && pendingNew && (
            <InlineNameInput
              initial=""
              depth={depth + 1}
              icon={
                pendingNew.kind === 'folder' ? (
                  <Folder className="size-4 shrink-0 text-amber-500" />
                ) : (
                  <File className="size-4 shrink-0 text-muted-foreground" />
                )
              }
              placeholder={
                pendingNew.kind === 'folder' ? '폴더 이름' : '파일 이름'
              }
              onCommit={(name) =>
                onCommitNew(pendingNew.parentPath, pendingNew.kind, name)
              }
              onCancel={onCancelNew}
              dataTestid={
                pendingNew.kind === 'folder'
                  ? 'folder-tree-new-folder-input'
                  : 'folder-tree-new-file-input'
              }
            />
          )}
          {isLoading && !children ? (
            <div
              className="px-2 py-0.5 text-xs text-muted-foreground"
              style={{ paddingLeft: 8 + (depth + 1) * INDENT_PX }}
            >
              로딩 중…
            </div>
          ) : children && children.length === 0 && !showInlineNew ? (
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
                selectedPath={selectedPath}
                renamingPath={renamingPath}
                pendingNew={pendingNew}
                draggingPath={draggingPath}
                dropTargetPath={dropTargetPath}
                onToggle={onToggle}
                onOpenPath={onOpenPath}
                onSelect={onSelect}
                onContextMenu={onContextMenu}
                onCommitRename={onCommitRename}
                onCancelRename={onCancelRename}
                onCommitNew={onCommitNew}
                onCancelNew={onCancelNew}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
});

interface InlineInputProps {
  initial: string;
  depth: number;
  icon: React.ReactNode;
  placeholder?: string;
  onCommit: (name: string) => void | Promise<void>;
  onCancel: () => void;
  dataTestid: string;
}

function InlineNameInput({
  initial,
  depth,
  icon,
  placeholder,
  onCommit,
  onCancel,
  dataTestid,
}: InlineInputProps): React.ReactElement {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select the basename without extension so Enter immediately overwrites
    // the name without forcing the user to clear it. For empty initial
    // (new file), this is a no-op.
    if (initial) {
      const dot = initial.lastIndexOf('.');
      const end = dot > 0 ? dot : initial.length;
      el.setSelectionRange(0, end);
    }
  }, [initial]);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const name = value.trim();
      if (name) void onCommit(name);
      else onCancel();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="flex w-full items-center gap-1 px-2 py-0.5 text-xs"
      style={{ paddingLeft: 8 + depth * INDENT_PX }}
    >
      <span className="size-3 shrink-0" aria-hidden="true" />
      {icon}
      <input
        ref={ref}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => onCancel()}
        placeholder={placeholder}
        className="h-5 min-w-0 flex-1 rounded border border-input bg-background px-1 text-xs"
        data-testid={dataTestid}
      />
    </div>
  );
}

interface ContextMenuProps {
  state: ContextMenuState;
  onClose: () => void;
  onRename: () => void;
  onTrash: () => void;
  onReveal: () => void;
  onNewFile: () => void;
  onNewFolder: () => void;
}

function TreeContextMenu({
  state,
  onClose,
  onRename,
  onTrash,
  onReveal,
  onNewFile,
  onNewFolder,
}: ContextMenuProps): React.ReactElement {
  const menuRef = useRef<HTMLDivElement>(null);
  // Close on outside mousedown (NOT click — click can fire after the
  // contextmenu event in some test runners) + Escape.
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (
        menuRef.current &&
        e.target instanceof Node &&
        menuRef.current.contains(e.target)
      ) {
        return;
      }
      onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    // Defer attaching mousedown so the contextmenu's own mousedown that
    // opened the menu doesn't immediately close it.
    const t = window.setTimeout(() => {
      document.addEventListener('mousedown', onDown);
    }, 0);
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 min-w-[10rem] rounded-md border border-border bg-popover py-1 text-xs shadow-md"
      style={{ left: state.x, top: state.y }}
      data-testid="folder-tree-context-menu"
    >
      {state.entry.isDirectory && (
        <>
          <MenuItem
            icon={<FilePlus className="size-3.5" />}
            label="새 파일"
            onClick={onNewFile}
            testid="ctx-new-file"
          />
          <MenuItem
            icon={<FolderPlus className="size-3.5" />}
            label="새 폴더"
            onClick={onNewFolder}
            testid="ctx-new-folder"
          />
          <hr className="my-1 border-border" />
        </>
      )}
      <MenuItem
        icon={<Pencil className="size-3.5" />}
        label="이름 변경"
        onClick={onRename}
        testid="ctx-rename"
      />
      <MenuItem
        icon={<Trash2 className="size-3.5" />}
        label="휴지통으로 이동"
        onClick={onTrash}
        testid="ctx-trash"
      />
      <hr className="my-1 border-border" />
      <MenuItem
        icon={<Search className="size-3.5" />}
        label="파일 관리자에서 보기"
        onClick={onReveal}
        testid="ctx-reveal"
      />
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  testid,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testid: string;
}): React.ReactElement {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted"
      data-testid={testid}
    >
      <span className="text-muted-foreground">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function dirOf(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/';
  const i = p.lastIndexOf(sep);
  return i >= 0 ? p.slice(0, i) : p;
}

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') ? '\\' : '/';
  return parent.endsWith(sep) ? parent + name : `${parent}${sep}${name}`;
}

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
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [pendingNew, setPendingNew] = useState<PendingNew | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const expandedRef = useRef<Set<string>>(new Set());
  const selectedPathRef = useRef<string | null>(null);
  // Renderer-side clipboard for file/folder copy-paste. Holds the source
  // path + intent. Cleared after a 'cut' paste; sticky on 'copy' so the
  // user can paste the same source multiple times.
  const fileClipboardRef = useRef<{
    path: string;
    mode: 'copy' | 'cut';
  } | null>(null);
  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);
  useEffect(() => {
    selectedPathRef.current = selectedPath;
  }, [selectedPath]);

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

  // Initial root load + watcher attach.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRootChildren([]);
      setChildrenByPath(new Map());
      setExpanded(new Set());
      setLoadingPaths(new Set());
      setSelectedPath(null);
      setRenamingPath(null);
      setPendingNew(null);
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

  const handleSelect = useCallback((p: string) => setSelectedPath(p), []);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, entry: FolderEntry): void => {
      e.preventDefault();
      // Stop propagation so the root-container's onContextMenu doesn't
      // overwrite our entry-specific menu state.
      e.stopPropagation();
      setSelectedPath(entry.path);
      setContextMenu({ x: e.clientX, y: e.clientY, entry });
    },
    [],
  );

  const findEntryByPath = useCallback(
    (p: string): FolderEntry | undefined => {
      // Search root + all loaded children for a matching entry.
      for (const e of rootChildren) {
        if (e.path === p) return e;
      }
      for (const list of childrenByPath.values()) {
        for (const e of list) {
          if (e.path === p) return e;
        }
      }
      return undefined;
    },
    [rootChildren, childrenByPath],
  );

  const startRename = useCallback((p: string) => {
    setContextMenu(null);
    setRenamingPath(p);
  }, []);

  const commitRename = useCallback(
    async (oldPath: string, newName: string): Promise<void> => {
      const newPath = joinPath(dirOf(oldPath), newName);
      if (newPath === oldPath) {
        setRenamingPath(null);
        return;
      }
      try {
        await window.api.folder.rename(oldPath, newPath);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`이름 변경 실패: ${msg}`);
      } finally {
        setRenamingPath(null);
      }
    },
    [],
  );

  const cancelRename = useCallback(() => setRenamingPath(null), []);

  const startNew = useCallback(
    (parentPath: string, kind: 'file' | 'folder') => {
      setContextMenu(null);
      // If creating inside a closed folder, expand it first so the input
      // is visible.
      if (parentPath !== rootPath && !expanded.has(parentPath)) {
        setExpanded((prev) => new Set(prev).add(parentPath));
        if (!childrenByPath.has(parentPath)) {
          void loadChildren(parentPath);
        }
      }
      setPendingNew({ parentPath, kind });
    },
    [rootPath, expanded, childrenByPath, loadChildren],
  );

  const commitNew = useCallback(
    async (
      parentPath: string,
      kind: 'file' | 'folder',
      name: string,
    ): Promise<void> => {
      try {
        if (kind === 'file') {
          await window.api.folder.createFile(parentPath, name);
        } else {
          await window.api.folder.createFolder(parentPath, name);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`생성 실패: ${msg}`);
      } finally {
        setPendingNew(null);
      }
    },
    [],
  );

  const cancelNew = useCallback(() => setPendingNew(null), []);

  const trashPath = useCallback(async (p: string): Promise<void> => {
    setContextMenu(null);
    const ok = window.confirm(`정말 휴지통으로 이동하시겠습니까?\n\n${p}`);
    if (!ok) return;
    try {
      await window.api.folder.trash(p);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`삭제 실패: ${msg}`);
    }
  }, []);

  const revealPath = useCallback((p: string) => {
    setContextMenu(null);
    void window.api.folder.reveal(p);
  }, []);

  // Drag and drop handlers (chunk 65). Minimal HTML5 DnD: we ferry the
  // dragged path via dataTransfer and call rename on drop.
  const handleDragStart = useCallback(
    (e: ReactDragEvent, entry: FolderEntry): void => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-ahwp-path', entry.path);
      setDraggingPath(entry.path);
    },
    [],
  );

  const handleDragOver = useCallback(
    (e: ReactDragEvent, entry: FolderEntry): void => {
      // Drop only allowed onto folders. Don't hilight the dragged item
      // itself or anything inside it (no self-move; only parent change).
      if (!entry.isDirectory) return;
      const src = e.dataTransfer.getData('application/x-ahwp-path');
      if (src && (src === entry.path || entry.path.startsWith(src + '/'))) {
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetPath(entry.path);
    },
    [],
  );

  const handleDragLeave = useCallback((): void => {
    setDropTargetPath(null);
  }, []);

  const handleDrop = useCallback(
    async (e: ReactDragEvent, entry: FolderEntry): Promise<void> => {
      e.preventDefault();
      const src = e.dataTransfer.getData('application/x-ahwp-path');
      setDraggingPath(null);
      setDropTargetPath(null);
      if (!src || !entry.isDirectory) return;
      // Disallow moving into self / a descendant of self.
      if (src === entry.path) return;
      if (entry.path.startsWith(src + '/')) return;
      const name = src.split(/[\\/]/).pop() ?? '';
      if (!name) return;
      const dest = joinPath(entry.path, name);
      if (dest === src) return;
      try {
        await window.api.folder.rename(src, dest);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`이동 실패: ${msg}`);
      }
    },
    [],
  );

  const handleRootDragOver = useCallback(
    (e: ReactDragEvent): void => {
      const src = e.dataTransfer.getData('application/x-ahwp-path');
      if (src && dirOf(src) === rootPath) return; // already in root
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    },
    [rootPath],
  );

  const handleRootDrop = useCallback(
    async (e: ReactDragEvent): Promise<void> => {
      e.preventDefault();
      const src = e.dataTransfer.getData('application/x-ahwp-path');
      setDraggingPath(null);
      setDropTargetPath(null);
      if (!src) return;
      if (dirOf(src) === rootPath) return;
      const name = src.split(/[\\/]/).pop() ?? '';
      if (!name) return;
      const dest = joinPath(rootPath, name);
      if (dest === src) return;
      try {
        await window.api.folder.rename(src, dest);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`이동 실패: ${msg}`);
      }
    },
    [rootPath],
  );

  /**
   * Walk the tree in display order producing a flat list of every visible
   * entry. "Visible" = the entry's ancestors are all expanded. Used for
   * arrow-key navigation between siblings/ancestors/descendants.
   */
  const buildVisibleEntries = useCallback((): FolderEntry[] => {
    const out: FolderEntry[] = [];
    const walk = (entries: FolderEntry[]): void => {
      for (const e of entries) {
        out.push(e);
        if (e.isDirectory && expanded.has(e.path)) {
          const kids = childrenByPath.get(e.path);
          if (kids) walk(kids);
        }
      }
    };
    walk(rootChildren);
    return out;
  }, [rootChildren, childrenByPath, expanded]);

  /** Find the parent of `path` in the loaded tree, or null at root. */
  const findParentPath = useCallback(
    (p: string): string | null => {
      // Brute search across childrenByPath: the entry whose children
      // include `p` is the parent. rootPath is the parent if `p` is in
      // rootChildren.
      if (rootChildren.some((e) => e.path === p)) return rootPath;
      for (const [parent, kids] of childrenByPath.entries()) {
        if (kids.some((k) => k.path === p)) return parent;
      }
      return null;
    },
    [rootChildren, childrenByPath, rootPath],
  );

  /**
   * Tree-level keyboard handler — OS file explorer parity:
   *   F2          rename
   *   Delete      trash
   *   Enter       open file / toggle folder
   *   ↑ / ↓       previous / next visible entry
   *   ←           collapse (or jump to parent if already collapsed/file)
   *   →           expand (or jump to first child if already expanded)
   *   Cmd/Ctrl + N        new file (in selected folder, or selected file's parent)
   *   Cmd/Ctrl + Shift + N  new folder (same target)
   */
  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      // Inputs own their own keys.
      if (renamingPath || pendingNew) return;

      const sel = selectedPathRef.current;
      const entry = sel ? findEntryByPath(sel) : null;

      // Cmd/Ctrl + N → new file under the selected folder (or sibling parent).
      // Cmd/Ctrl + Shift + N → new folder. Use rootPath if no selection.
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === 'n'
      ) {
        e.preventDefault();
        const target = !sel
          ? rootPath
          : entry?.isDirectory
            ? entry.path
            : (findParentPath(sel) ?? rootPath);
        startNew(target, e.shiftKey ? 'folder' : 'file');
        return;
      }

      // Cmd/Ctrl + C / X / V — file clipboard (copy / cut / paste). The
      // editor's text-edit shortcuts run only inside the StudioViewer
      // scroll container, so they don't conflict here.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'c' && sel) {
          e.preventDefault();
          fileClipboardRef.current = { path: sel, mode: 'copy' };
          return;
        }
        if (k === 'x' && sel) {
          e.preventDefault();
          fileClipboardRef.current = { path: sel, mode: 'cut' };
          return;
        }
        if (k === 'v') {
          const cb = fileClipboardRef.current;
          if (!cb) return;
          e.preventDefault();
          // Paste destination: the selected folder, or the selected
          // item's parent, or root.
          const destDir = !sel
            ? rootPath
            : entry?.isDirectory
              ? entry.path
              : (findParentPath(sel) ?? rootPath);
          if (!destDir) return;
          // Disallow pasting a folder into itself / a descendant.
          const sep = cb.path.includes('\\') ? '\\' : '/';
          if (destDir === cb.path || destDir.startsWith(cb.path + sep)) {
            window.alert('대상 폴더가 원본의 하위입니다.');
            return;
          }
          void (async () => {
            try {
              if (cb.mode === 'copy') {
                await window.api.folder.copy(cb.path, destDir);
              } else {
                const name = cb.path.split(/[\\/]/).pop() ?? '';
                if (!name) return;
                const newPath = joinPath(destDir, name);
                if (newPath === cb.path) return;
                await window.api.folder.rename(cb.path, newPath);
                fileClipboardRef.current = null; // cut consumed
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              window.alert(`붙여넣기 실패: ${msg}`);
            }
          })();
          return;
        }
      }

      // Arrow navigation.
      const visible = buildVisibleEntries();
      const curIdx = sel ? visible.findIndex((e2) => e2.path === sel) : -1;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx =
          curIdx < 0 ? 0 : Math.min(curIdx + 1, visible.length - 1);
        const next = visible[nextIdx];
        if (next) setSelectedPath(next.path);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const nextIdx =
          curIdx <= 0 ? Math.max(visible.length - 1, 0) : curIdx - 1;
        const next = visible[nextIdx];
        if (next) setSelectedPath(next.path);
        return;
      }
      if (e.key === 'ArrowRight') {
        if (!entry) return;
        e.preventDefault();
        if (entry.isDirectory && !expanded.has(entry.path)) {
          void handleToggle(entry.path);
        } else if (entry.isDirectory) {
          // Already expanded → jump to first child.
          const kids = childrenByPath.get(entry.path);
          if (kids && kids[0]) setSelectedPath(kids[0].path);
        }
        return;
      }
      if (e.key === 'ArrowLeft') {
        if (!entry) return;
        e.preventDefault();
        if (entry.isDirectory && expanded.has(entry.path)) {
          void handleToggle(entry.path);
        } else {
          // Collapsed dir or file → jump to parent (if any).
          const parent = findParentPath(entry.path);
          if (parent && parent !== rootPath) setSelectedPath(parent);
        }
        return;
      }

      // Existing actions need a selection.
      if (!sel || !entry) return;
      if (e.key === 'F2') {
        e.preventDefault();
        startRename(sel);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void trashPath(sel);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (entry.isDirectory) void handleToggle(entry.path);
        else void onOpenPath(entry.path);
      }
    },
    [
      renamingPath,
      pendingNew,
      findEntryByPath,
      buildVisibleEntries,
      findParentPath,
      expanded,
      childrenByPath,
      rootPath,
      startRename,
      trashPath,
      handleToggle,
      onOpenPath,
      startNew,
    ],
  );

  return (
    <div
      className="flex h-full flex-col overflow-auto outline-none"
      data-testid="folder-tree"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragOver={handleRootDragOver}
      onDrop={handleRootDrop}
      onContextMenu={(e) => {
        // Right-click on the empty area of the panel → show menu rooted at
        // the root folder so users can create top-level files/folders.
        e.preventDefault();
        setSelectedPath(null);
        setContextMenu({
          x: e.clientX,
          y: e.clientY,
          entry: { path: rootPath, name: rootPath, isDirectory: true },
        });
      }}
    >
      {/* Inline new-file/folder input at root level when pending */}
      {pendingNew && pendingNew.parentPath === rootPath && (
        <InlineNameInput
          initial=""
          depth={0}
          icon={
            pendingNew.kind === 'folder' ? (
              <Folder className="size-4 shrink-0 text-amber-500" />
            ) : (
              <File className="size-4 shrink-0 text-muted-foreground" />
            )
          }
          placeholder={pendingNew.kind === 'folder' ? '폴더 이름' : '파일 이름'}
          onCommit={(name) =>
            commitNew(pendingNew.parentPath, pendingNew.kind, name)
          }
          onCancel={cancelNew}
          dataTestid={
            pendingNew.kind === 'folder'
              ? 'folder-tree-new-folder-input'
              : 'folder-tree-new-file-input'
          }
        />
      )}
      {rootChildren.length === 0 && !pendingNew ? (
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
            selectedPath={selectedPath}
            renamingPath={renamingPath}
            pendingNew={pendingNew}
            draggingPath={draggingPath}
            dropTargetPath={dropTargetPath}
            onToggle={handleToggle}
            onOpenPath={onOpenPath}
            onSelect={handleSelect}
            onContextMenu={handleContextMenu}
            onCommitRename={commitRename}
            onCancelRename={cancelRename}
            onCommitNew={commitNew}
            onCancelNew={cancelNew}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        ))
      )}
      {contextMenu && (
        <TreeContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={() => startRename(contextMenu.entry.path)}
          onTrash={() => void trashPath(contextMenu.entry.path)}
          onReveal={() => revealPath(contextMenu.entry.path)}
          onNewFile={() =>
            startNew(
              contextMenu.entry.isDirectory
                ? contextMenu.entry.path
                : dirOf(contextMenu.entry.path),
              'file',
            )
          }
          onNewFolder={() =>
            startNew(
              contextMenu.entry.isDirectory
                ? contextMenu.entry.path
                : dirOf(contextMenu.entry.path),
              'folder',
            )
          }
        />
      )}
    </div>
  );
}
