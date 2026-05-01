import { Loader2, Send, Square } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import type {
  ChatMessage,
  ChatRequest,
  ChatStreamEvent,
  ProviderId,
} from '@shared/ai';
import type { AiChatHandle } from '@shared/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type ChatProviderId = Extract<ProviderId, 'openai' | 'nvidia'>;

const PROVIDER_OPTIONS: { id: ChatProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'nvidia', label: 'NVIDIA NIM' },
];

const DEFAULT_MODELS: Record<ChatProviderId, string> = {
  openai: 'gpt-4o-mini',
  nvidia: 'meta/llama-3.1-70b-instruct',
};

const STORAGE_PROVIDER = 'ahwp:chat:provider';
const STORAGE_MODELS = 'ahwp:chat:models';

interface UiMessage extends ChatMessage {
  id: string;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadProvider(): ChatProviderId {
  try {
    const raw = localStorage.getItem(STORAGE_PROVIDER);
    if (raw === 'openai' || raw === 'nvidia') return raw;
  } catch {
    /* no-op */
  }
  return 'openai';
}

function loadModels(): Record<ChatProviderId, string> {
  try {
    const raw = localStorage.getItem(STORAGE_MODELS);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<ChatProviderId, string>>;
      return {
        openai:
          typeof parsed.openai === 'string' && parsed.openai.length > 0
            ? parsed.openai
            : DEFAULT_MODELS.openai,
        nvidia:
          typeof parsed.nvidia === 'string' && parsed.nvidia.length > 0
            ? parsed.nvidia
            : DEFAULT_MODELS.nvidia,
      };
    }
  } catch {
    /* no-op */
  }
  return { ...DEFAULT_MODELS };
}

export function ChatPanel(): JSX.Element {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<ChatProviderId>(() =>
    loadProvider(),
  );
  const [models, setModels] = useState<Record<ChatProviderId, string>>(() =>
    loadModels(),
  );
  const handleRef = useRef<AiChatHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const assistantIdRef = useRef<string | null>(null);

  const model = models[provider];

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PROVIDER, provider);
    } catch {
      /* no-op */
    }
  }, [provider]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MODELS, JSON.stringify(models));
    } catch {
      /* no-op */
    }
  }, [models]);

  useEffect(() => {
    let cancelled = false;
    void window.api.secrets.has(provider).then((v) => {
      if (!cancelled) setHasKey(v);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  const onProviderChange = useCallback((next: ChatProviderId) => {
    // Reset the indicator to the loading state immediately so the user sees
    // feedback while the new has() call is in flight. Doing this in the
    // change handler (not an effect) avoids react-hooks/set-state-in-effect.
    setHasKey(null);
    setProvider(next);
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      handleRef.current?.abort();
    };
  }, []);

  const onEvent = useCallback((evt: ChatStreamEvent) => {
    if (evt.type === 'text-delta') {
      // Capture the id eagerly: the setMessages updater may run later in a
      // React batch, by which point a terminal event might have cleared
      // assistantIdRef. Reading it inside the updater drops late deltas.
      const id = assistantIdRef.current;
      if (!id) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, content: m.content + evt.text } : m,
        ),
      );
      return;
    }
    if (evt.type === 'error') {
      setError(evt.message);
    }
    setStreaming(false);
    handleRef.current = null;
    assistantIdRef.current = null;
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (text.length === 0 || streaming) return;
    setError(null);

    const userMsg: UiMessage = { id: newId(), role: 'user', content: text };
    const assistantMsg: UiMessage = {
      id: newId(),
      role: 'assistant',
      content: '',
    };
    assistantIdRef.current = assistantMsg.id;

    const history = [...messages, userMsg];
    setMessages([...history, assistantMsg]);
    setInput('');
    setStreaming(true);

    const request: ChatRequest = {
      provider,
      model,
      messages: history.map(({ role, content }) => ({ role, content })),
    };
    handleRef.current = window.api.ai.chat(request, { onEvent });
  }, [input, messages, model, onEvent, provider, streaming]);

  const onSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      send();
    },
    [send],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        send();
      }
    },
    [send],
  );

  const stop = useCallback(() => {
    handleRef.current?.abort();
    handleRef.current = null;
    setStreaming(false);
    assistantIdRef.current = null;
  }, []);

  const providerLabel = useMemo(
    () => PROVIDER_OPTIONS.find((p) => p.id === provider)?.label ?? provider,
    [provider],
  );

  const placeholder = useMemo(() => {
    if (hasKey === false)
      return `${providerLabel} API 키가 설정되지 않았습니다. DevTools에서 secrets.set('${provider}', '...')`;
    return 'Enter 전송 / Shift+Enter 줄바꿈';
  }, [hasKey, provider, providerLabel]);

  const onModelChange = useCallback(
    (next: string) => {
      setModels((prev) => ({ ...prev, [provider]: next }));
    },
    [provider],
  );

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-2 border-b border-border bg-card px-3 py-2"
        data-testid="chat-provider-bar"
      >
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value as ChatProviderId)}
          className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="chat-provider-select"
          aria-label="Provider"
          disabled={streaming}
        >
          {PROVIDER_OPTIONS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          value={model}
          onChange={(e) => onModelChange(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          data-testid="chat-model-input"
          aria-label="Model"
          disabled={streaming}
          spellCheck={false}
        />
        <span
          className={cn(
            'text-[10px]',
            hasKey === true
              ? 'text-emerald-600 dark:text-emerald-400'
              : hasKey === false
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60',
          )}
          data-testid="chat-key-indicator"
          aria-label={hasKey ? 'API 키 있음' : 'API 키 없음'}
        >
          {hasKey === true ? '키 ●' : hasKey === false ? '키 ○' : '…'}
        </span>
      </div>
      <div
        ref={scrollerRef}
        className="flex-1 space-y-4 overflow-auto px-4 py-4"
        data-testid="chat-scroller"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <p>현재 문서에 대해 질문하거나 도움을 요청하세요.</p>
          </div>
        ) : (
          messages.map((m) => (
            <Message key={m.id} message={m} streaming={streaming} />
          ))
        )}
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {error}
          </div>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-border bg-card p-3"
        data-testid="chat-input-form"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            rows={2}
            className={cn(
              'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring',
              'disabled:opacity-50',
            )}
            disabled={hasKey === false}
            data-testid="chat-input"
          />
          {streaming ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={stop}
              aria-label="전송 중단"
              data-testid="chat-stop"
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={input.trim().length === 0 || hasKey === false}
              aria-label="전송"
              data-testid="chat-send"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function Message({
  message,
  streaming,
}: {
  message: UiMessage;
  streaming: boolean;
}): JSX.Element {
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    !isUser && streaming && message.content.length === 0;
  return (
    <div
      className={cn(
        'flex flex-col gap-1',
        isUser ? 'items-end' : 'items-start',
      )}
      data-testid="chat-message"
      data-role={message.role}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {isUser ? 'You' : 'Assistant'}
      </span>
      <div
        className={cn(
          'max-w-[90%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
        data-testid="chat-message-content"
      >
        {isAssistantStreaming ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          message.content
        )}
      </div>
    </div>
  );
}
