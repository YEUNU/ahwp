import {
  Check,
  Copy,
  Loader2,
  RotateCcw,
  Send,
  Square,
  Trash2,
} from 'lucide-react';
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
import { MessageContent } from './MessageContent';

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

export interface ChatPanelProps {
  /**
   * Open the Settings modal — used by the empty-key CTA so users don't have to
   * dig through the menu when their key isn't set yet.
   */
  onOpenSettings?: () => void;
}

export function ChatPanel({
  onOpenSettings,
}: ChatPanelProps = {}): JSX.Element {
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

  /**
   * Append a fresh assistant bubble to `history` and start streaming the
   * provider's response into it. `history` should already end in the user
   * message that the assistant is replying to.
   */
  const fireChat = useCallback(
    (history: UiMessage[]) => {
      setError(null);
      const assistantMsg: UiMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
      };
      assistantIdRef.current = assistantMsg.id;
      setMessages([...history, assistantMsg]);
      setStreaming(true);

      const request: ChatRequest = {
        provider,
        model,
        messages: history.map(({ role, content }) => ({ role, content })),
      };
      handleRef.current = window.api.ai.chat(request, { onEvent });
    },
    [model, onEvent, provider],
  );

  const send = useCallback(() => {
    const text = input.trim();
    if (text.length === 0 || streaming) return;
    const userMsg: UiMessage = { id: newId(), role: 'user', content: text };
    setInput('');
    fireChat([...messages, userMsg]);
  }, [fireChat, input, messages, streaming]);

  const regenerate = useCallback(
    (assistantId: string) => {
      if (streaming) return;
      const idx = messages.findIndex((m) => m.id === assistantId);
      if (idx === -1) return;
      const history = messages.slice(0, idx);
      // Need a preceding user turn to regenerate from.
      if (history.length === 0 || history[history.length - 1].role !== 'user')
        return;
      fireChat(history);
    },
    [fireChat, messages, streaming],
  );

  const deleteMessage = useCallback(
    (id: string) => {
      if (streaming) return;
      setMessages((prev) => prev.filter((m) => m.id !== id));
    },
    [streaming],
  );

  const copyMessage = useCallback(
    async (id: string): Promise<boolean> => {
      const m = messages.find((x) => x.id === id);
      if (!m) return false;
      try {
        await window.api.clipboard.writeText(m.content);
        return true;
      } catch {
        return false;
      }
    },
    [messages],
  );

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
    if (hasKey === false) return `${providerLabel} API 키가 필요합니다`;
    return 'Enter 전송 / Shift+Enter 줄바꿈';
  }, [hasKey, providerLabel]);

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
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-xs text-muted-foreground">
            {hasKey === false ? (
              <>
                <p>{providerLabel} API 키를 먼저 설정하세요.</p>
                {onOpenSettings ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onOpenSettings}
                    data-testid="chat-open-settings"
                  >
                    설정 열기
                  </Button>
                ) : null}
              </>
            ) : (
              <p>현재 문서에 대해 질문하거나 도움을 요청하세요.</p>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              streaming={streaming}
              onCopy={copyMessage}
              onRegenerate={regenerate}
              onDelete={deleteMessage}
            />
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

interface MessageProps {
  message: UiMessage;
  streaming: boolean;
  onCopy: (id: string) => Promise<boolean>;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
}

function Message({
  message,
  streaming,
  onCopy,
  onRegenerate,
  onDelete,
}: MessageProps): JSX.Element {
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    !isUser && streaming && message.content.length === 0;
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = async () => {
    const ok = await onCopy(message.id);
    if (!ok) return;
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  // Action visibility: hide all actions while a stream is running anywhere
  // (regenerate/delete would corrupt streaming state). Copy is fine even
  // mid-stream, but for consistency we hide everything during streaming
  // and only show it on the bubble that finished its content.
  const actionsHidden = streaming || isAssistantStreaming;

  return (
    <div
      className={cn(
        'group flex flex-col gap-1',
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
          'max-w-[90%] rounded-md px-3 py-2',
          isUser
            ? 'whitespace-pre-wrap bg-primary text-sm text-primary-foreground'
            : 'bg-muted text-foreground',
        )}
        data-testid="chat-message-content"
      >
        {isAssistantStreaming ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isUser ? (
          message.content
        ) : (
          <MessageContent content={message.content} />
        )}
      </div>
      {actionsHidden ? null : (
        <div
          className={cn(
            'flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
            isUser ? 'self-end' : 'self-start',
          )}
          data-testid="chat-message-actions"
        >
          <ActionButton
            label={copied ? '복사됨' : '복사'}
            testid={`chat-action-copy-${message.role}`}
            onClick={() => void handleCopy()}
          >
            {copied ? (
              <Check className="h-3 w-3" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </ActionButton>
          {!isUser ? (
            <>
              <ActionButton
                label="재생성"
                testid="chat-action-regenerate"
                onClick={() => onRegenerate(message.id)}
              >
                <RotateCcw className="h-3 w-3" />
              </ActionButton>
              <ActionButton
                label="삭제"
                testid="chat-action-delete"
                onClick={() => onDelete(message.id)}
              >
                <Trash2 className="h-3 w-3" />
              </ActionButton>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ActionButton({
  label,
  testid,
  onClick,
  children,
}: {
  label: string;
  testid: string;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testid}
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
