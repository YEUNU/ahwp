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

const DEFAULT_PROVIDER: ProviderId = 'openai';
const DEFAULT_MODEL = 'gpt-4o-mini';

interface UiMessage extends ChatMessage {
  id: string;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function ChatPanel(): JSX.Element {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const handleRef = useRef<AiChatHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const assistantIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.secrets.has(DEFAULT_PROVIDER).then((v) => {
      if (!cancelled) setHasKey(v);
    });
    return () => {
      cancelled = true;
    };
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
      setMessages((prev) => {
        const id = assistantIdRef.current;
        if (!id) return prev;
        return prev.map((m) =>
          m.id === id ? { ...m, content: m.content + evt.text } : m,
        );
      });
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
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
      messages: history.map(({ role, content }) => ({ role, content })),
    };
    handleRef.current = window.api.ai.chat(request, { onEvent });
  }, [input, messages, onEvent, streaming]);

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

  const placeholder = useMemo(() => {
    if (hasKey === false)
      return 'OpenAI API 키가 설정되지 않았습니다. 설정에서 추가하세요.';
    return 'Cmd/Ctrl+Enter는 줄바꿈, Enter는 전송';
  }, [hasKey]);

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollerRef}
        className="flex-1 space-y-4 overflow-auto px-4 py-4"
        data-testid="chat-scroller"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
            <p>현재 문서에 대해 질문하거나 도움을 요청하세요.</p>
            <p className="text-[10px] text-muted-foreground/60">
              모델: {DEFAULT_MODEL}
            </p>
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
