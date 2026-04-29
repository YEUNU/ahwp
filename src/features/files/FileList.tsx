import { FileText, Upload } from 'lucide-react';
import { useCallback, useState, type DragEvent as ReactDragEvent } from 'react';
import { cn } from '@/lib/utils';
import type { RecentFile } from '@shared/api';
import { useRecentFiles } from './use-recent-files';

const ALLOWED_EXT = /\.(hwp|hwpx)$/i;

interface FileListProps {
  activePath: string | null;
  onOpenPath: (path: string) => void | Promise<void>;
}

function basename(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return slash >= 0 ? p.slice(slash + 1) : p;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (diff < min) return '방금 전';
  if (diff < hour) return `${Math.floor(diff / min)}분 전`;
  if (diff < day) return `${Math.floor(diff / hour)}시간 전`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}일 전`;
  return new Date(ts).toLocaleDateString();
}

export function FileList({ activePath, onOpenPath }: FileListProps) {
  const { recent, loading, refresh } = useRecentFiles();
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: ReactDragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const files = Array.from(e.dataTransfer.files);
      const target = files.find((f) => ALLOWED_EXT.test(f.name));
      if (!target) return;
      const path = window.api.file.getPathForFile(target);
      if (!path) return;
      const result = await window.api.file.openByPath(path);
      if (result) {
        await onOpenPath(result.path);
        await refresh();
      }
    },
    [onOpenPath, refresh],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        'relative flex h-full flex-col',
        dragOver && 'ring-2 ring-inset ring-ring',
      )}
    >
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-sm">
          <Upload className="size-8 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">
            여기에 .hwp / .hwpx 파일을 놓으세요
          </span>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <p className="px-4 py-3 text-xs text-muted-foreground">
            불러오는 중…
          </p>
        ) : recent.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            <p className="mb-1">최근 항목이 없습니다.</p>
            <p>
              <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px]">
                ⌘O
              </kbd>{' '}
              또는 파일을 끌어 놓아 시작하세요.
            </p>
          </div>
        ) : (
          <ul className="py-1">
            {recent.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                active={file.path === activePath}
                onClick={() => void onOpenPath(file.path)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FileRow({
  file,
  active,
  onClick,
}: {
  file: RecentFile;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={file.path}
        className={cn(
          'flex w-full items-center gap-2 px-4 py-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
          active && 'bg-accent text-accent-foreground',
        )}
      >
        <FileText className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{basename(file.path)}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {relativeTime(file.lastOpenedAt)}
          </div>
        </div>
      </button>
    </li>
  );
}
