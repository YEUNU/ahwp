/**
 * Settings dialog — 4-tab sidebar redesign (UI/UX align to style_example).
 *
 * Left sidebar: 일반 / AI 공급자 / 단축키 / 정보. Right pane has a
 * header with title + description, scrollable content, and a footer.
 *
 * About + Shortcuts content merged from the previous standalone dialogs
 * (`AboutDialog` / `ShortcutsDialog`). Menu actions `view:about` and
 * `view:shortcuts` open Settings on the right tab via `initialTab`.
 */
import {
  Check,
  Info,
  Keyboard,
  Loader2,
  Settings as SettingsIcon,
  Sparkles,
  X as XIcon,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import type { AppVersions } from '@shared/api';
import { PROVIDERS, type ProviderId, type ProviderMeta } from '@shared/ai';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useTheme } from '@/app/use-theme';

const SHOWN_IDS = new Set<ProviderId>(['openai', 'nvidia', 'google', 'custom']);
const SHOWN_PROVIDERS = PROVIDERS.filter((p) => SHOWN_IDS.has(p.id));

const REPO_URL = 'https://github.com/YEUNU/ahwp';
const ISSUES_URL = `${REPO_URL}/issues`;
const RELEASES_URL = `${REPO_URL}/releases`;

export type SettingsTab = 'general' | 'ai' | 'shortcuts' | 'about';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Tab to focus when opening. Falls back to `ai` (the most-used tab). */
  initialTab?: SettingsTab;
}

const TABS: {
  id: SettingsTab;
  label: string;
  icon: JSX.Element;
}[] = [
  {
    id: 'general',
    label: '일반',
    icon: <SettingsIcon className="size-3.5" />,
  },
  { id: 'ai', label: 'AI 공급자', icon: <Sparkles className="size-3.5" /> },
  {
    id: 'shortcuts',
    label: '단축키',
    icon: <Keyboard className="size-3.5" />,
  },
  { id: 'about', label: '정보', icon: <Info className="size-3.5" /> },
];

export function SettingsDialog({
  open,
  onOpenChange,
  initialTab = 'ai',
}: SettingsDialogProps): JSX.Element {
  // `key` on the inner forces a fresh component instance per initialTab
  // — caller flipping initialTab mid-open re-mounts so the local `active`
  // re-initializes from the new prop without setState-in-effect.
  return (
    <SettingsDialogInner
      key={`${open}-${initialTab}`}
      open={open}
      onOpenChange={onOpenChange}
      initialTab={initialTab}
    />
  );
}

function SettingsDialogInner({
  open,
  onOpenChange,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab: SettingsTab;
}): JSX.Element {
  const [active, setActive] = useState<SettingsTab>(initialTab);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-testid="settings-dialog"
        className="grid h-[min(620px,88vh)] max-w-[min(900px,92vw)] grid-cols-[200px_1fr] gap-0 overflow-hidden p-0"
      >
        {/* Left tabs */}
        <div className="flex flex-col border-r border-border bg-muted/40 p-3">
          <div className="flex items-center gap-2 px-2 pb-3 pt-1">
            {/* chunk 77 — packaged Electron 에서 `<img src="/icon.svg">`
                는 file:/// resolve 로 404. inline SVG 로 교체. */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 64 64"
              width={16}
              height={16}
              aria-hidden="true"
              className="rounded-[4px]"
            >
              <defs>
                <clipPath id="settings-logo-squircle">
                  <path d="M 14.3168 0 L 49.6832 0 Q 64 0 64 14.3168 L 64 49.6832 Q 64 64 49.6832 64 L 14.3168 64 Q 0 64 0 49.6832 L 0 14.3168 Q 0 0 14.3168 0 Z" />
                </clipPath>
              </defs>
              <g clipPath="url(#settings-logo-squircle)">
                <rect width="64" height="64" fill="#2b6a6b" />
                <rect
                  x="26.88"
                  y="10.24"
                  width="6.4"
                  height="43.52"
                  rx="0.768"
                  fill="#f6f4ef"
                />
                <rect
                  x="33.28"
                  y="29.44"
                  width="20.48"
                  height="6.4"
                  rx="0.768"
                  fill="#f6f4ef"
                />
              </g>
            </svg>
            <span className="text-[13px] font-bold tracking-tight">설정</span>
          </div>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active === tab.id}
              onClick={() => setActive(tab.id)}
              data-testid={`settings-tab-${tab.id}`}
              className={cn(
                'mb-px flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition',
                active === tab.id
                  ? 'bg-card font-semibold text-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <span className="flex w-3.5 justify-center">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
          <div className="flex-1" />
          <div className="px-2 pt-2 text-[10.5px] text-muted-foreground/70">
            ahwp
          </div>
        </div>

        {/* Right content */}
        {/* chunk 72 — `min-h-0` is the unlock for nested flex/grid
            scroll. Without it, the grid track height is given to this
            div but the inner flex column collapses to its content
            height (browser default `min-height: auto`), so PaneBody's
            `flex-1 overflow-auto` never had bounded height to scroll
            against. With `min-h-0` the grid track height drives the
            flex column, PaneBody fills the residual, overflow kicks in. */}
        <div className="flex min-h-0 min-w-0 flex-col">
          {active === 'general' && <GeneralPane />}
          {active === 'ai' && <AiProvidersPane />}
          {active === 'shortcuts' && <ShortcutsPane />}
          {active === 'about' && <AboutPane />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Panes ───────────────────────────────────────────────

function PaneHeader({
  title,
  description,
}: {
  title: string;
  description: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-end justify-between border-b border-border px-7 pb-3.5 pt-4">
      <div>
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

function PaneBody({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      // `min-h-0` paired with `flex-1` lets this body shrink below its
      // intrinsic height so the parent grid track caps it; combined
      // with overflow-y-auto the content scrolls within the bounds.
      className="min-h-0 flex-1 overflow-y-auto px-7 py-5"
      data-testid="settings-pane-body"
    >
      {children}
    </div>
  );
}

function PaneFooter({
  children,
  hint,
}: {
  children?: ReactNode;
  hint?: ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2.5 border-t border-border bg-muted/40 px-7 py-3">
      {hint ? (
        <span className="flex-1 text-[11.5px] text-muted-foreground">
          {hint}
        </span>
      ) : (
        <div className="flex-1" />
      )}
      {children}
    </div>
  );
}

function GeneralPane(): JSX.Element {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <>
      <PaneHeader title="일반" description="외형과 기본 동작을 설정합니다." />
      <PaneBody>
        <section className="space-y-3" data-testid="settings-general">
          <Field label="테마" help="시스템: OS의 라이트/다크 모드 자동 추적">
            <div className="flex gap-1.5">
              {(['system', 'light', 'dark'] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setTheme(opt)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs transition',
                    theme === opt
                      ? 'border-primary bg-primary/10 font-semibold text-foreground'
                      : 'border-border text-muted-foreground hover:bg-muted',
                  )}
                  data-testid={`settings-theme-${opt}`}
                >
                  {opt === 'system'
                    ? '시스템'
                    : opt === 'light'
                      ? '라이트'
                      : '다크'}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-muted-foreground/70">
              현재 적용: {resolvedTheme === 'dark' ? '다크' : '라이트'}
            </p>
          </Field>
        </section>
      </PaneBody>
    </>
  );
}

function AiProvidersPane(): JSX.Element {
  return (
    <>
      <PaneHeader
        title="AI 공급자"
        description="채팅에 사용할 AI 공급자를 설정합니다. 키는 OS 키체인에 암호화되어 저장됩니다."
      />
      <PaneBody>
        <div className="space-y-2.5" data-testid="settings-provider-list">
          {SHOWN_PROVIDERS.map((meta) => (
            <ProviderCard key={meta.id} meta={meta} />
          ))}
        </div>
      </PaneBody>
      <PaneFooter hint="변경사항은 저장 버튼으로 반영됩니다. 키를 변경하려면 새 값을 입력하세요." />
    </>
  );
}

function ShortcutsPane(): JSX.Element {
  return (
    <>
      <PaneHeader
        title="단축키"
        description={
          <>⌘K로 모든 명령을 검색해 키보드만으로 실행할 수 있습니다.</>
        }
      />
      <PaneBody>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          {SHORTCUT_SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {s.title}
              </h3>
              <ul className="space-y-1.5">
                {s.rows.map((r) => (
                  <li
                    key={r.keys}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-foreground">{r.label}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {r.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </PaneBody>
    </>
  );
}

function AboutPane(): JSX.Element {
  const [versions, setVersions] = useState<AppVersions | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.getVersions().then((v) => {
      if (!cancelled) setVersions(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const openExternal = useCallback((url: string): void => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }, []);

  return (
    <>
      <PaneHeader
        title="ahwp"
        description="AI-powered HWP/HWPX desktop editor"
      />
      <PaneBody>
        <section className="space-y-4 text-sm" data-testid="settings-about">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <span className="text-muted-foreground">버전</span>
            <span
              className="font-mono font-semibold"
              data-testid="about-app-version"
            >
              {versions ? `v${versions.app}` : '…'}
            </span>
          </div>

          <div className="space-y-2 font-mono text-xs">
            <Row label="Electron" value={versions?.electron} />
            <Row label="Chromium" value={versions?.chrome} />
            <Row label="Node.js" value={versions?.node} />
            <Row
              label="@rhwp/core"
              value={versions?.rhwpCore}
              testid="about-rhwp-core"
            />
            <Row
              label="OS"
              value={
                versions ? `${versions.platform} ${versions.arch}` : undefined
              }
            />
          </div>

          <div className="border-t border-border pt-3 text-xs text-muted-foreground">
            라이선스: Apache License 2.0
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openExternal(REPO_URL)}
              data-testid="about-github"
            >
              GitHub
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openExternal(RELEASES_URL)}
              data-testid="about-releases"
            >
              Releases
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openExternal(ISSUES_URL)}
              data-testid="about-issues"
            >
              Issues
            </Button>
          </div>
        </section>
      </PaneBody>
    </>
  );
}

// ─── Provider card (AI tab) ─────────────────────────────

type PingState =
  | { kind: 'idle' }
  | { kind: 'pinging' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

function ProviderCard({ meta }: { meta: ProviderMeta }): JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [pingState, setPingState] = useState<PingState>({ kind: 'idle' });
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [supportsTools, setSupportsTools] = useState(false);

  useEffect(() => {
    if (!meta.requiresBaseUrl) return;
    let cancelled = false;
    void window.api.ai.getProviderConfig(meta.id).then((cfg) => {
      if (cancelled) return;
      setBaseUrl(cfg.baseUrl ?? '');
      setSupportsTools(cfg.supportsTools ?? false);
    });
    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.requiresBaseUrl]);

  const refresh = useCallback(async () => {
    const v = await window.api.secrets.has(meta.id);
    setHasKey(v);
  }, [meta.id]);

  useEffect(() => {
    let cancelled = false;
    void window.api.secrets.has(meta.id).then((v) => {
      if (!cancelled) setHasKey(v);
    });
    return () => {
      cancelled = true;
    };
  }, [meta.id]);

  const onSave = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const trimmed = input.trim();
      const baseUrlTrimmed = baseUrl.trim();
      const hasKeyInput = trimmed.length > 0;
      const hasConfigChange = meta.requiresBaseUrl;
      if (!hasKeyInput && !hasConfigChange) return;
      setBusy('save');
      setPingState({ kind: 'idle' });
      try {
        if (hasKeyInput) {
          await window.api.secrets.set(meta.id, trimmed);
          setInput('');
        }
        if (meta.requiresBaseUrl) {
          await window.api.ai.setProviderConfig({
            providerId: meta.id,
            baseUrl: baseUrlTrimmed,
            supportsTools,
          });
        }
        await refresh();
      } catch (err) {
        setPingState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setBusy(null);
      }
    },
    [baseUrl, input, meta.id, meta.requiresBaseUrl, refresh, supportsTools],
  );

  const onTest = useCallback(async () => {
    setPingState({ kind: 'pinging' });
    const trimmed = input.trim();
    try {
      await window.api.ai.ping(
        meta.id,
        trimmed.length > 0 ? { apiKey: trimmed } : undefined,
      );
      setPingState({ kind: 'ok' });
    } catch (err) {
      setPingState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [input, meta.id]);

  const onDelete = useCallback(async () => {
    setBusy('delete');
    try {
      await window.api.secrets.delete(meta.id);
      setPingState({ kind: 'idle' });
      await refresh();
    } finally {
      setBusy(null);
    }
  }, [meta.id, refresh]);

  const canSave = input.trim().length > 0 && busy === null;
  const canTest =
    busy === null &&
    pingState.kind !== 'pinging' &&
    (input.trim().length > 0 || hasKey === true);

  return (
    <form
      onSubmit={onSave}
      className="overflow-hidden rounded-lg border border-border bg-card transition"
      data-testid={`settings-row-${meta.id}`}
    >
      {/* Card header */}
      <div className="flex items-center gap-3 px-3.5 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[13px] font-bold tracking-tight text-primary">
          {meta.label[0]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold tracking-tight">
            {meta.label}
          </div>
        </div>
        {/* Status pill */}
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-semibold',
            hasKey === true
              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
              : 'bg-muted text-muted-foreground',
          )}
          data-testid={`settings-indicator-${meta.id}`}
        >
          <span
            className={cn(
              'size-1 rounded-full',
              hasKey === true ? 'bg-emerald-500' : 'bg-muted-foreground/50',
            )}
          />
          {hasKey === null ? '확인 중…' : hasKey ? '연결됨' : '미연결'}
        </div>
      </div>

      {/* Form */}
      <div className="space-y-2.5 px-3.5 pb-3">
        <Field label="API 키">
          <Input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              hasKey
                ? '저장된 키 사용 중. 새 값을 입력하면 덮어씁니다.'
                : `${meta.label} API key`
            }
            data-testid={`settings-input-${meta.id}`}
            disabled={busy !== null}
          />
        </Field>

        {meta.requiresBaseUrl ? (
          <>
            <Field label="Base URL">
              <Input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:11434/v1 (Ollama 예시)"
                data-testid={`settings-baseurl-${meta.id}`}
                disabled={busy !== null}
              />
            </Field>
            <label
              className="flex items-center gap-2 text-xs text-muted-foreground"
              data-testid={`settings-supports-tools-${meta.id}`}
            >
              <input
                type="checkbox"
                checked={supportsTools}
                onChange={(e) => setSupportsTools(e.target.checked)}
                disabled={busy !== null}
                className="accent-primary"
              />
              이 모델은 tool calling 지원 (Agent 모드 활성)
            </label>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="submit"
            size="sm"
            disabled={!canSave}
            data-testid={`settings-save-${meta.id}`}
          >
            {busy === 'save' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            저장
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void onTest()}
            disabled={!canTest}
            data-testid={`settings-test-${meta.id}`}
          >
            {pingState.kind === 'pinging' ? (
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
            ) : null}
            연결 테스트
          </Button>
          {hasKey ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onDelete()}
              disabled={busy !== null}
              data-testid={`settings-delete-${meta.id}`}
            >
              {busy === 'delete' ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : null}
              삭제
            </Button>
          ) : null}
          <div className="flex-1" />
          {pingState.kind === 'ok' ? (
            <span
              className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
              data-testid={`settings-ping-ok-${meta.id}`}
            >
              <Check className="h-3 w-3" /> 연결 정상
            </span>
          ) : null}
        </div>

        {pingState.kind === 'error' ? (
          <p
            className="flex items-start gap-1 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive"
            data-testid={`settings-ping-error-${meta.id}`}
          >
            <XIcon className="mt-[2px] h-3 w-3 shrink-0" />
            <span>{pingState.message}</span>
          </p>
        ) : null}
      </div>
    </form>
  );
}

// ─── Helpers ────────────────────────────────────────────

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div>
      <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
      {help ? (
        <p className="mt-1.5 text-[10.5px] text-muted-foreground/70">{help}</p>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  testid,
}: {
  label: string;
  value: string | undefined;
  testid?: string;
}): JSX.Element {
  return (
    <div className="flex justify-between" data-testid={testid}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value ?? '…'}</span>
    </div>
  );
}

// ─── Shortcuts data ─────────────────────────────────────

interface ShortcutRow {
  keys: string;
  label: string;
}

interface ShortcutSection {
  title: string;
  rows: ShortcutRow[];
}

const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    title: '파일',
    rows: [
      { keys: '⌘N', label: '새 문서' },
      { keys: '⌘O', label: '파일 열기' },
      { keys: '⌘S', label: '저장' },
      { keys: '⌘⇧S', label: '다른 이름으로 저장' },
      { keys: '⌘W', label: '현재 탭 닫기' },
    ],
  },
  {
    title: '편집',
    rows: [
      { keys: '⌘Z', label: '실행 취소' },
      { keys: '⌘⇧Z / ⌘Y', label: '다시 실행' },
      { keys: '⌘C / ⌘X / ⌘V', label: '복사 / 잘라내기 / 붙여넣기' },
      { keys: '⌘⇧C / ⌘⇧V', label: '컨트롤 복사 / 붙여넣기' },
      { keys: '⌘A', label: '전체 선택' },
      { keys: '⌘F', label: '찾기' },
      { keys: '⌘H', label: '찾아 바꾸기' },
    ],
  },
  {
    title: '서식',
    rows: [
      { keys: '⌘B', label: '진하게' },
      { keys: '⌘I', label: '기울임' },
      { keys: '⌘U', label: '밑줄' },
    ],
  },
  {
    title: '캐럿 / 선택',
    rows: [
      { keys: '← / →', label: '글자 단위 이동' },
      { keys: '↑ / ↓', label: '시각 라인 단위 이동' },
      { keys: '⌘← / ⌘→', label: '단어 단위 이동' },
      { keys: 'Home / End', label: '단락 시작 / 끝' },
      { keys: '⌘Home / ⌘End', label: '문서 시작 / 끝' },
      { keys: 'Shift + 위 화살표 / 클릭', label: '선택 확장' },
      { keys: 'Esc (드래그 중)', label: '드래그 선택 취소' },
    ],
  },
  {
    title: '네비게이션',
    rows: [
      { keys: '⌘K', label: '명령 팔레트' },
      { keys: '⌘/', label: '단축키 (이 탭)' },
      { keys: 'PageUp / PageDown', label: '페이지 단위 스크롤' },
    ],
  },
  {
    title: '표 / 셀',
    rows: [
      { keys: 'Tab / Shift+Tab', label: '셀 사이 이동 (셀 안에서)' },
      { keys: '우클릭', label: '셀 컨텍스트 메뉴' },
    ],
  },
];
