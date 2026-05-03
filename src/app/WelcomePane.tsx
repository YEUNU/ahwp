/**
 * Welcome / empty-state pane — UI/UX revamp.
 *
 * Shown in the editor area when no tabs are open. Layout follows
 * `style_example/components/WelcomeScreen.jsx`:
 *   - Greeting + intro paragraph
 *   - Two big cards: "빈 문서로 시작" (⌘N) + "파일 열기" (⌘O, drop target)
 *   - Recent files 3-column grid with paper-preview thumbnails
 *
 * The drop target accepts native file drag-drop. Recent files are
 * fetched via `window.api.file.listRecent()` once on mount.
 */
import { FileText, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PingResponse, RecentFile } from '@shared/api';
import { localizeShortcutPublic } from '@/lib/hancom-tooltips';

export interface WelcomePaneProps {
  onNewDoc: () => void;
  onOpen: () => void;
  onOpenPath: (path: string) => void;
  pingError: string | null;
  pingResult: PingResponse | null;
}

function basenameOf(p: string): string {
  const sep = p.includes('\\') ? '\\' : '/';
  const i = p.lastIndexOf(sep);
  return i >= 0 ? p.slice(i + 1) : p;
}

function formatDate(epoch: number): string {
  const d = new Date(epoch);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) {
    return `오늘 · ${d.getHours().toString().padStart(2, '0')}:${d
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();
  if (isYesterday) return '어제';
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

export function WelcomePane({
  onNewDoc,
  onOpen,
  onOpenPath,
  pingError,
  pingResult,
}: WelcomePaneProps): JSX.Element {
  const { t } = useTranslation();
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [drag, setDrag] = useState(false);
  const [hover, setHover] = useState<'blank' | 'open' | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.file.listRecent().then((rows) => {
      if (!cancelled) setRecents(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      className="h-full overflow-auto"
      data-testid="welcome-pane"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDrag(true);
        }
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files[0];
        if (file) {
          const path = window.api.file.getPathForFile(file);
          if (path) onOpenPath(path);
        }
      }}
    >
      <div className="mx-auto max-w-[920px] px-12 py-14">
        <div className="mb-9">
          <div className="mb-2.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/70">
            WELCOME
          </div>
          <h1 className="m-0 text-[30px] font-bold tracking-tight">
            {t('welcome.title')}
          </h1>
          <p className="mt-2 max-w-[560px] text-sm leading-relaxed text-muted-foreground">
            {t('welcome.subtitle')}
          </p>
        </div>

        {/* Two cards */}
        <div className="mb-10 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <button
            type="button"
            onClick={onNewDoc}
            onMouseEnter={() => setHover('blank')}
            onMouseLeave={() => setHover(null)}
            className={
              'relative rounded-[10px] border bg-popover p-[22px_22px_20px] text-left transition-all ' +
              (hover === 'blank'
                ? 'border-primary shadow-[0_4px_16px_rgba(43,106,107,.10)]'
                : 'border-border')
            }
            data-testid="welcome-new-doc"
          >
            <div className="mb-3.5 flex size-[38px] items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <FileText className="size-5" />
            </div>
            <div className="mb-1 text-[15px] font-semibold tracking-tight">
              {t('welcome.cta.new')}
            </div>
            <div className="text-[12.5px] leading-relaxed text-muted-foreground">
              {t('welcome.cta.new.subtitle')}
            </div>
            <div className="absolute right-3.5 top-3.5 rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground/70">
              {localizeShortcutPublic('⌘N')}
            </div>
          </button>

          <button
            type="button"
            onClick={onOpen}
            onMouseEnter={() => setHover('open')}
            onMouseLeave={() => setHover(null)}
            className={
              'relative rounded-[10px] border-dashed p-[22px_22px_20px] text-left transition-all ' +
              (drag
                ? 'border-2 border-primary bg-accent'
                : hover === 'open'
                  ? 'border bg-popover'
                  : 'border bg-popover')
            }
            style={{
              borderStyle: 'dashed',
              borderWidth: drag ? 2 : 1,
            }}
            data-testid="welcome-open"
          >
            <div className="mb-3.5 flex size-[38px] items-center justify-center rounded-lg bg-muted text-foreground">
              <Upload className="size-5" />
            </div>
            <div className="mb-1 text-[15px] font-semibold tracking-tight">
              {t('welcome.cta.open')}{' '}
              {drag ? (
                <span className="text-primary">· {t('welcome.drop_here')}</span>
              ) : null}
            </div>
            <div className="text-[12.5px] leading-relaxed text-muted-foreground">
              {t('welcome.cta.open.subtitle')}
            </div>
            <div className="absolute right-3.5 top-3.5 rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground/70">
              {localizeShortcutPublic('⌘O')}
            </div>
          </button>
        </div>

        {/* Recent files */}
        {recents.length > 0 ? (
          <>
            <div className="mb-3.5 flex items-baseline justify-between">
              <h2 className="m-0 text-sm font-semibold tracking-tight">
                최근 작업한 문서
              </h2>
              <span className="text-xs text-muted-foreground">
                총 {recents.length}개
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recents.slice(0, 6).map((f) => {
                const isLegacy = f.path.toLowerCase().endsWith('.hwp');
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => onOpenPath(f.path)}
                    className="overflow-hidden rounded-lg border border-border bg-popover text-left transition-shadow hover:shadow-md"
                    data-testid="welcome-recent-card"
                    data-path={f.path}
                    title={f.path}
                  >
                    <div className="relative h-[88px] border-b border-border bg-muted/40">
                      <div className="absolute left-3.5 top-3.5 right-3.5 h-[5px] rounded-sm bg-primary/85" />
                      <div className="absolute left-3.5 top-[25px] h-[3px] w-[52%] bg-border" />
                      <div className="absolute left-3.5 top-[33px] h-[3px] w-[78%] bg-border/70" />
                      <div className="absolute left-3.5 top-[41px] h-[3px] w-[68%] bg-border/70" />
                      <div className="absolute left-3.5 top-[54px] h-[3px] w-[40%] bg-border/70" />
                      <div className="absolute left-3.5 top-[62px] h-[3px] w-[60%] bg-border/70" />
                      {isLegacy ? (
                        <div className="absolute right-2 top-2 rounded bg-amber-600 px-1.5 py-0.5 text-[9.5px] font-semibold text-white">
                          HWP
                        </div>
                      ) : null}
                    </div>
                    <div className="px-3 py-2.5">
                      <div className="truncate text-[12.5px] font-semibold tracking-tight">
                        {basenameOf(f.path)}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground/70">
                        {formatDate(f.lastOpenedAt)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : null}

        {pingError ? (
          <pre className="mt-8 max-w-md whitespace-pre-wrap text-xs text-destructive">
            {pingError}
          </pre>
        ) : null}
        {!pingError && !pingResult ? (
          <div className="mt-6 text-xs text-muted-foreground/70">
            초기화 중…
          </div>
        ) : null}
      </div>
    </div>
  );
}
