import { Check, Loader2, X as XIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PROVIDERS, type ProviderId, type ProviderMeta } from '@shared/ai';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Providers wired to actual adapters. Anthropic / Google / custom are
 * deferred to later Phase 2 chunks; we hide them from the form so we
 * don't promise functionality we haven't shipped. `custom` (chunk 49)
 * covers any OpenAI-compatible endpoint — self-hosted Ollama via /v1
 * shim, vLLM, LM Studio, on-prem LLM gateway — once the adapter ships.
 */
const SHOWN_IDS = new Set<ProviderId>(['openai', 'nvidia']);
const SHOWN_PROVIDERS = PROVIDERS.filter((p) => SHOWN_IDS.has(p.id));

type PingState =
  | { kind: 'idle' }
  | { kind: 'pinging' }
  | { kind: 'ok' }
  | { kind: 'error'; message: string };

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDialog({
  open,
  onOpenChange,
}: SettingsDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="settings-dialog" className="max-w-xl gap-6">
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
          <DialogDescription>
            BYOK API 키는 OS 키체인으로 암호화되어 로컬에만 저장됩니다.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            AI Providers
          </h3>
          <div className="space-y-3" data-testid="settings-provider-list">
            {SHOWN_PROVIDERS.map((meta) => (
              <ProviderRow key={meta.id} meta={meta} />
            ))}
          </div>
        </section>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="settings-close"
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderRow({ meta }: { meta: ProviderMeta }): JSX.Element {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [input, setInput] = useState('');
  const [pingState, setPingState] = useState<PingState>({ kind: 'idle' });
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);

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
      if (trimmed.length === 0) return;
      setBusy('save');
      setPingState({ kind: 'idle' });
      try {
        await window.api.secrets.set(meta.id, trimmed);
        setInput('');
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
    [input, meta.id, refresh],
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

  const indicator = (() => {
    if (hasKey === null) return '…';
    return hasKey ? '●' : '○';
  })();

  const canSave = input.trim().length > 0 && busy === null;
  const canTest =
    busy === null &&
    pingState.kind !== 'pinging' &&
    (input.trim().length > 0 || hasKey === true);

  return (
    <form
      onSubmit={onSave}
      className="space-y-2 rounded-md border border-border bg-card p-3"
      data-testid={`settings-row-${meta.id}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{meta.label}</span>
        <span
          className={cn(
            'text-xs',
            hasKey === true
              ? 'text-emerald-600 dark:text-emerald-400'
              : hasKey === false
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60',
          )}
          data-testid={`settings-indicator-${meta.id}`}
          aria-label={hasKey ? '키 저장됨' : '키 없음'}
        >
          {indicator}
        </span>
      </div>

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

      <div className="flex flex-wrap gap-2">
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
      </div>

      {pingState.kind === 'ok' ? (
        <p
          className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
          data-testid={`settings-ping-ok-${meta.id}`}
        >
          <Check className="h-3 w-3" /> 연결 정상
        </p>
      ) : null}
      {pingState.kind === 'error' ? (
        <p
          className="flex items-start gap-1 text-xs text-destructive"
          data-testid={`settings-ping-error-${meta.id}`}
        >
          <XIcon className="mt-[2px] h-3 w-3 flex-shrink-0" />
          <span>{pingState.message}</span>
        </p>
      ) : null}
    </form>
  );
}
