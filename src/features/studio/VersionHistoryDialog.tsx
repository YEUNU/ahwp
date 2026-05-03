import { History, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Version history dialog — chunk 62. Lists snapshots written under
 * `userData/versions/<hash>/<ISO>.hwp` whenever the user explicitly
 * saves the active document. Click "복원" → AppShell pipes the chosen
 * version back through `file.save()` so .bak / atomic write / watcher
 * suppression all apply, and the active viewer remounts off the
 * restored bytes.
 *
 * Up to 50 versions are kept per file (FIFO trim in main).
 */

export interface VersionHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Active doc absolute path. Null = empty state. */
  activePath: string | null;
  /** Restore the version with `filename` for the given path. AppShell
   *  reads the bytes, calls `file.save`, and remounts the viewer. */
  onRestore: (path: string, filename: string) => Promise<void>;
}

interface VersionRow {
  filename: string;
  size: number;
  createdAt: number;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  activePath,
  onRestore,
}: VersionHistoryDialogProps): JSX.Element {
  const [rows, setRows] = useState<VersionRow[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !activePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRows([]);
      return;
    }
    let cancelled = false;
    void window.api.file.listVersions(activePath).then((r) => {
      if (cancelled) return;
      setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [open, activePath]);

  const handleRestore = async (filename: string): Promise<void> => {
    if (!activePath || busy) return;
    if (
      !window.confirm(
        '현재 문서를 이 버전으로 되돌립니다. 현재 내용은 .bak 사이드카에 백업됩니다. 계속하시겠습니까?',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await onRestore(activePath, filename);
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="version-history-dialog"
        className="max-w-xl gap-4"
      >
        <DialogHeader>
          <DialogTitle>
            <History className="mr-1 inline-block size-4 align-middle" />
            버전 히스토리
          </DialogTitle>
          <DialogDescription>
            저장할 때마다 생성된 스냅샷에서 복원할 수 있습니다 (최근 50개).
          </DialogDescription>
        </DialogHeader>
        {!activePath ? (
          <div
            className="rounded-md border border-border bg-muted px-3 py-3 text-xs text-muted-foreground"
            data-testid="version-history-no-path"
          >
            먼저 파일을 열어주세요.
          </div>
        ) : rows.length === 0 ? (
          <div
            className="rounded-md border border-border bg-muted px-3 py-3 text-xs text-muted-foreground"
            data-testid="version-history-empty"
          >
            저장된 버전이 아직 없습니다. 다음번 저장(⌘S)부터 자동으로
            기록됩니다.
          </div>
        ) : (
          <ul
            className="max-h-[50vh] divide-y divide-border overflow-auto rounded-md border border-border"
            data-testid="version-history-list"
          >
            {rows.map((r) => (
              <li
                key={r.filename}
                className="flex items-center justify-between gap-2 px-3 py-2"
                data-testid="version-history-row"
                data-filename={r.filename}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs">{formatTimestamp(r.createdAt)}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {formatSize(r.size)}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void handleRestore(r.filename)}
                  disabled={busy}
                  data-testid="version-history-restore"
                  className="text-xs"
                >
                  <RotateCcw className="mr-1 size-3" />
                  복원
                </Button>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="version-history-close"
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
