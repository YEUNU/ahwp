import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderSearchResult } from '@shared/api';
import { cn } from '@/lib/utils';

/**
 * Cross-folder text search panel — chunk 60. Replaces the folder tree
 * view when the user presses ⌘⇧F. Sends the query to the main process,
 * which walks the active root and grep's IR text per `.hwp` / `.hwpx`.
 *
 * Click on a snippet → AppShell opens the file (existing tab if open)
 * and scrolls to the matched paragraph.
 *
 * Caps (in main):
 *   - 200 files (depth 5, file-count 200)
 *   - 5MB per file (skip larger ones to keep responsiveness)
 *   - 50 hits total · 5 snippets per file
 */

export interface SearchPanelProps {
  rootPath: string | null;
  /** Open a file at a specific paragraph. AppShell handles tab focus
   *  + scroll routing. */
  onOpenAtParagraph: (path: string, paragraphIndex: number) => void;
  /** Close the panel — returns the user to the folder tree. */
  onClose: () => void;
}

export function SearchPanel({
  rootPath,
  onOpenAtParagraph,
  onClose,
}: SearchPanelProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FolderSearchResult | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const reqIdRef = useRef(0);

  // Auto-focus on mount.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search — wait 300ms after the last keystroke before
  // hitting the IPC. Empty query clears the result without a round-trip.
  useEffect(() => {
    if (!rootPath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResult(null);
      return;
    }
    if (query.trim().length === 0) {
      setResult(null);
      return;
    }
    const myId = ++reqIdRef.current;

    setPending(true);
    const t = window.setTimeout(() => {
      void window.api.folder.searchText({ rootPath, query }).then((r) => {
        if (reqIdRef.current !== myId) return; // a newer query superseded
        setResult(r);
        setPending(false);
      });
    }, 300);
    return () => window.clearTimeout(t);
  }, [rootPath, query]);

  const summary = useMemo(() => {
    if (!result) return '';
    const fileCount = result.hits.length;
    const matchCount = result.hits.reduce((a, h) => a + h.matchCount, 0);
    const status = result.status === 'limit-reached' ? ' (상한 도달)' : '';
    return `${fileCount}개 파일에서 ${matchCount}건${status} · ${result.scanned}개 스캔, ${result.skipped}개 건너뜀`;
  }, [result]);

  return (
    <div className="flex h-full flex-col" data-testid="folder-search-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
          placeholder={rootPath ? '폴더 내 검색…' : '먼저 폴더를 열어주세요'}
          disabled={!rootPath}
          className="min-w-0 flex-1 bg-transparent text-xs outline-hidden placeholder:text-muted-foreground/60"
          data-testid="folder-search-input"
        />
        {pending ? (
          <Loader2 className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : null}
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
          aria-label="검색 닫기"
          title="검색 닫기 (Esc)"
          data-testid="folder-search-close"
        >
          ✕
        </button>
      </div>
      {summary ? (
        <div
          className="border-b border-border px-3 py-1 text-[10px] text-muted-foreground"
          data-testid="folder-search-summary"
        >
          {summary}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        {result?.hits.length === 0 && query.trim() && !pending ? (
          <div
            className="px-3 py-4 text-center text-xs text-muted-foreground"
            data-testid="folder-search-empty"
          >
            결과 없음
          </div>
        ) : null}
        {result?.hits.map((hit) => (
          <div
            key={hit.path}
            className="border-b border-border last:border-b-0"
            data-testid="folder-search-hit"
            data-path={hit.path}
          >
            <div
              className="bg-muted/40 px-3 py-1 text-[11px] font-medium"
              title={hit.path}
            >
              <span className="truncate">{hit.filename}</span>
              <span className="ml-2 text-[10px] text-muted-foreground">
                {hit.matchCount}건
              </span>
            </div>
            <ul>
              {hit.snippets.map((s, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenAtParagraph(hit.path, s.paragraphIndex)
                    }
                    className="block w-full px-3 py-1.5 text-left text-[11px] text-muted-foreground hover:bg-muted"
                    data-testid="folder-search-snippet"
                    title={`para ${s.paragraphIndex}`}
                  >
                    <SnippetText
                      preview={s.preview}
                      offset={s.matchOffset}
                      length={s.matchLength}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function SnippetText({
  preview,
  offset,
  length,
}: {
  preview: string;
  offset: number;
  length: number;
}): JSX.Element {
  const before = preview.slice(0, offset);
  const match = preview.slice(offset, offset + length);
  const after = preview.slice(offset + length);
  return (
    <span className={cn('font-mono')}>
      <span className="opacity-70">{before}</span>
      <span className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-900/60 dark:text-amber-100">
        {match}
      </span>
      <span className="opacity-70">{after}</span>
    </span>
  );
}
