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
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChatMessage, ProviderId } from '@shared/ai';
import {
  parseToolBlock,
  type AhwpPreflightItem,
  type AhwpToolResult,
} from '@shared/ai-tools';
import { parsePatchBlock, type AhwpPatch } from '@shared/ai-patches';
import { MultiPatchStack, type PatchStatus } from './DiffCard';
import {
  EXCERPT_SOFT_CHAR_LIMIT,
  type ExcerptAttachment,
  type ExcerptStatus,
  type TextRange,
} from '@shared/ai-excerpt';
import type { AiChatHandle } from '@shared/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MessageContent } from './MessageContent';
import { useChatHistory } from './hooks/useChatHistory';
import { useChatStreaming } from './hooks/useChatStreaming';
import { useExcerptAttachments } from './hooks/useExcerptAttachments';
import { previewArgs } from './tools';

type ChatProviderId = Extract<
  ProviderId,
  'openai' | 'nvidia' | 'google' | 'custom'
>;

const PROVIDER_OPTIONS: { id: ChatProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'nvidia', label: 'NVIDIA NIM' },
  { id: 'google', label: 'Google (Gemini)' },
  { id: 'custom', label: 'Custom (OpenAI-호환)' },
];

const DEFAULT_MODELS: Record<ChatProviderId, string> = {
  openai: 'gpt-4o-mini',
  nvidia: 'meta/llama-3.1-70b-instruct',
  google: 'gemini-2.0-flash',
  custom: '',
};

const STORAGE_PROVIDER = 'ahwp:chat:provider';
const STORAGE_MODELS = 'ahwp:chat:models';
const STORAGE_CHAT_MODE = 'ahwp:chat:mode';

export type ChatMode = 'manual' | 'agent';

interface UiMessage extends ChatMessage {
  id: string;
  /** Phase 3 — tool 호출/결과 inline 표시 (assistant 메시지 안). */
  toolEntries?: UiToolEntry[];
}

interface UiToolEntry {
  id: string;
  name: string;
  argsPreview: string;
  status: 'running' | 'ok' | 'failed';
  reason?: string;
}

function loadProvider(): ChatProviderId {
  try {
    const raw = localStorage.getItem(STORAGE_PROVIDER);
    if (
      raw === 'openai' ||
      raw === 'nvidia' ||
      raw === 'google' ||
      raw === 'custom'
    )
      return raw;
  } catch {
    /* no-op */
  }
  return 'openai';
}

function loadChatMode(): ChatMode {
  try {
    const raw = localStorage.getItem(STORAGE_CHAT_MODE);
    if (raw === 'agent') return 'agent';
  } catch {
    /* no-op */
  }
  return 'manual';
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
        google:
          typeof parsed.google === 'string' && parsed.google.length > 0
            ? parsed.google
            : DEFAULT_MODELS.google,
        custom:
          typeof parsed.custom === 'string'
            ? parsed.custom
            : DEFAULT_MODELS.custom,
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
  /**
   * Active document HTML context — chunk 18. When attached, the
   * panel includes a system message with the first N paragraphs as
   * HTML so the AI can understand structure (paragraphs, alignment,
   * font styles, tables). Returns null when no doc is loaded.
   */
  getDocHtml?: () => string;
  /**
   * Apply an AI-authored HTML fragment to the active doc — chunk 18.
   * Wraps StudioViewer's applyHtmlAtCaret. Surfaced as a "문서에 적용"
   * button on assistant messages that contain ```html``` code blocks.
   */
  applyHtml?: (html: string) => void;
  /**
   * Run a pre-flighted ahwp-tools op list against a target doc — chunk 19,
   * extended in chunk 59 to be docId-aware. `targetPath` is the absolute
   * path of the doc the turn was started on; AppShell looks up the matching
   * mounted viewer and dispatches the ops there. Passing `null` falls back
   * to the active viewer (legacy / "도구 실행" button on Manual responses).
   * Wraps `runTools` from src/features/chat/tools.ts.
   */
  runTools?: (
    items: AhwpPreflightItem[],
    targetPath?: string | null,
  ) => AhwpToolResult[];
  /**
   * Capture the active StudioViewer selection as a portable excerpt — chunk 20.
   * `null` when no selection is active or the selection spans paragraphs.
   * The chip lives in chat state until the user removes it or sends.
   */
  captureExcerpt?: () => {
    sectionIndex: number;
    startParagraphIndex: number;
    startOffset: number;
    endParagraphIndex: number;
    endOffset: number;
    text: string;
  } | null;
  /**
   * Active document path — chunk 20. Used to label excerpt chips with
   * the source filename and to differentiate chips by origin doc.
   */
  activeDocPath?: () => string | null;
  /**
   * Re-read the IR at a stored anchor — chunk 20. Returns whether the
   * captured text is still where we left it, and a relocated anchor
   * when the IR moved it. Called per-chip right before `fireChat` so
   * we don't send stale anchors.
   */
  verifyExcerpt?: (
    anchor: TextRange,
    expected: string,
  ) => {
    status: ExcerptStatus;
    newAnchor?: TextRange;
  } | null;
  /**
   * Currently open document tabs — chunk 21. Used by the multi-doc
   * chip row to show target (active tab, locked) + reference candidates
   * (other tabs, user opt-in). Returns an empty array when no tabs are
   * open.
   */
  getOpenDocs?: () => {
    path: string;
    label: string;
    isActive: boolean;
  }[];
  /**
   * Read a non-active document's outline for the system prompt — chunk
   * 21. Each reference contributes a short outline (the first ~20
   * paragraphs as HTML by default) so the model can quote / analyze it
   * without the full body landing in every turn. The IR fetch goes
   * through the inactive tab's mounted viewer, so this works without
   * activating that tab.
   */
  getDocOutline?: (path: string) => string;
  /**
   * Roll back the most recent AI-applied change — chunk 29. Wraps the
   * active viewer's `undo()`, which on AI-driven mutations covers an
   * entire turn (chunk 27 grouped undo). Returns true when a change was
   * actually undone. Surfaced as a "되돌리기" button next to the
   * "✓ 적용됨" / "도구 실행" affordances for ~15 seconds after apply.
   */
  undoLastApply?: () => boolean;
  /**
   * Diff Viewer apply (Q5 UI/UX align). Apply a batch of patches as a
   * single grouped-undo turn. Returns per-patch success/failure (parallel
   * to the input array). Caller (AppShell) wraps in
   * `beginUndoGroup` / `endUndoGroup` so a single ⌘Z rolls back the
   * whole batch.
   */
  applyPatches?: (patches: AhwpPatch[]) => boolean[];
  /**
   * Diff Viewer "에디터에서 보기" (Q5 확장). Scroll the active viewer
   * to the patch's paragraph + place caret at the start offset.
   * No-op when no viewer is active.
   */
  previewPatch?: (patch: AhwpPatch) => void;
}

/**
 * Imperative handle for cross-pane triggers — chunk 56. The studio
 * viewer's selection context menu calls `prefillAndSend` to fire an
 * AI command (e.g. "다듬어주세요") with the selected text inline, so
 * the user gets a one-click path from selection → AI request without
 * dictating into the chat input by hand.
 */
export interface ChatPanelHandle {
  /**
   * Compose and send a chat turn with `text` as the user message body.
   * No-op while a stream is in flight (we won't queue).
   */
  prefillAndSend: (text: string) => void;
}

const HTML_BLOCK_RE = /```html\n?([\s\S]*?)```/i;
const TOOLS_BLOCK_RE = /```ahwp-tools\n?([\s\S]*?)```/i;
const PATCHES_BLOCK_RE = /```ahwp-patches\n?([\s\S]*?)```/i;

export const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(
  function ChatPanel(
    {
      onOpenSettings,
      getDocHtml,
      applyHtml,
      runTools,
      captureExcerpt,
      activeDocPath,
      verifyExcerpt,
      getOpenDocs,
      getDocOutline,
      undoLastApply,
      applyPatches,
      previewPatch,
    },
    ref,
  ) {
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [hasKey, setHasKey] = useState<boolean | null>(null);
    const [provider, setProvider] = useState<ChatProviderId>(() =>
      loadProvider(),
    );
    // Phase 3 — Manual / Agent 모드. Manual 은 기존 chunk 18+19 (HTML/
    // ahwp-tools 텍스트 dispatcher) — 사용자가 "도구 실행" 버튼을 눌러야
    // 변경 적용. Agent 는 provider native tool-use API 로 자동 루프 +
    // 묶음 undo. 기본 manual.
    const [chatMode, setChatMode] = useState<ChatMode>(() => loadChatMode());
    useEffect(() => {
      try {
        localStorage.setItem(STORAGE_CHAT_MODE, chatMode);
      } catch {
        /* no-op */
      }
    }, [chatMode]);
    const chatModeRef = useRef(chatMode);
    useEffect(() => {
      chatModeRef.current = chatMode;
    }, [chatMode]);
    const [models, setModels] = useState<Record<ChatProviderId, string>>(() =>
      loadModels(),
    );
    // chunk 48 — model list per provider. The renderer asks main for the
    // catalog (cached 24h), then keeps the result in memory so the
    // dropdown is responsive. `idle` before first fetch; `loading` while
    // a fetch is in flight; `ok` / `stale` / `error` after. The free-text
    // input is always available — the dropdown just *suggests* values
    // (datalist), so a missing list (`error`) doesn't block chat.
    type ModelListState =
      | { kind: 'idle' }
      | { kind: 'loading' }
      | { kind: 'ok'; models: string[]; fetchedAt: number }
      | { kind: 'stale'; models: string[]; fetchedAt: number; reason: string }
      | { kind: 'error'; reason: string };
    const [modelList, setModelList] = useState<
      Record<ChatProviderId, ModelListState>
    >({
      openai: { kind: 'idle' },
      nvidia: { kind: 'idle' },
      google: { kind: 'idle' },
      custom: { kind: 'idle' },
    });
    const [attachDoc, setAttachDoc] = useState(false);
    // chunk 20 — excerpt chips. When non-empty, the system message
    // injects a structured `[발췌]:` block instead of the whole-doc
    // HTML (the toggle still appears but the docHtml path is suppressed).
    const [excerpts, setExcerpts] = useState<ExcerptAttachment[]>([]);
    // Toast for send-side blocking events (e.g. all chips went stale).
    const [excerptError, setExcerptError] = useState<string | null>(null);
    // chunk 26 — chat history persistence. Conversation id is null until
    // the user sends the first message of a fresh chat; from then on
    // every send/assistant turn is appended via IPC. Switching to a
    // saved conversation loads its messages and sets this id.
    const [conversationId, setConversationId] = useState<number | null>(null);
    const conversationIdRef = useRef<number | null>(null);
    useEffect(() => {
      conversationIdRef.current = conversationId;
    }, [conversationId]);
    // chunk 31 — 자동 제목 요약. assistant turn 종료 시 messages.length가
    // 4 이상이면 1회 한정 background AI 호출로 짧은 한국어 제목 생성 →
    // chatHistory.rename. 이미 처리된 conversationId는 set에 등록해
    // 같은 대화 내 중복 호출 방지. 실패는 silent — 첫 user 메시지 60자
    // truncated title이 그대로 유지됨.
    const autoTitledConvIdsRef = useRef<Set<number>>(new Set());
    // chunk 26 — history list for the popover. State + callbacks live
    // in `useChatHistory` (R2.1).
    // chunk 21 — paths the user opted in as references. Active tab is
    // implicit target (always included) and never appears in this set.
    // Stored as an array (not Set) so React equality is straightforward.
    const [referencePaths, setReferencePaths] = useState<string[]>([]);
    const handleRef = useRef<AiChatHandle | null>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const assistantIdRef = useRef<string | null>(null);
    // chunk 67 — auto-grow textarea. Height tracks content up to a
    // ceiling, then overflow-y kicks in. Without this the user typing
    // a long prompt either gets a 2-row letterbox (rows={2}) with
    // hidden content or — worse — a fixed huge area cropping the
    // chat scroller above.
    const inputRef = useRef<HTMLTextAreaElement | null>(null);

    const model = models[provider];

    // chunk 67 — auto-grow textarea on input change. Height = max
    // (scrollHeight, baseline). Tailwind's max-h-48 is the upper
    // bound; once content exceeds it the browser shows a scrollbar
    // because of overflow-y-auto.
    useLayoutEffect(() => {
      const ta = inputRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      ta.style.height = `${ta.scrollHeight}px`;
    }, [input]);

    // chunk 31 — provider/model을 onEvent에서 stale-closure 없이 읽기 위해
    // ref로 mirror. setProvider/setModels가 트리거되는 useEffect에서 동기화.
    const providerRef = useRef(provider);
    const modelRef = useRef(model);
    useEffect(() => {
      providerRef.current = provider;
    }, [provider]);
    useEffect(() => {
      modelRef.current = model;
    }, [model]);

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

    // chunk 48 — model list fetcher. Sets `loading` first, then commits
    // the IPC result. Re-runs on provider change and key transitions
    // (false → true). `force=true` bypasses the 24h cache for a manual
    // 새로고침 click.
    const fetchModels = useCallback(
      async (target: ChatProviderId, force = false): Promise<void> => {
        setModelList((prev) => ({ ...prev, [target]: { kind: 'loading' } }));
        try {
          const res = await window.api.ai.listModels(target, { force });
          if (res.status === 'ok') {
            setModelList((prev) => ({
              ...prev,
              [target]: {
                kind: 'ok',
                models: res.models,
                fetchedAt: res.fetchedAt,
              },
            }));
            return;
          }
          if (res.status === 'stale-cache') {
            setModelList((prev) => ({
              ...prev,
              [target]: {
                kind: 'stale',
                models: res.models,
                fetchedAt: res.fetchedAt,
                reason: res.reason,
              },
            }));
            return;
          }
          setModelList((prev) => ({
            ...prev,
            [target]: { kind: 'error', reason: res.reason },
          }));
        } catch (err) {
          setModelList((prev) => ({
            ...prev,
            [target]: {
              kind: 'error',
              reason: err instanceof Error ? err.message : String(err),
            },
          }));
        }
      },
      [],
    );

    // Auto-fetch on provider change + key transition. The cache layer in
    // main makes the cost trivial — most calls return synchronously from
    // disk. Refetch only fires when key first becomes available; we don't
    // want to spam the API on transient flips.
    useEffect(() => {
      if (hasKey !== true) return;
      void fetchModels(provider);
    }, [provider, hasKey, fetchModels]);

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

    // Mirror slot for `refreshHistory` so streaming send-completion can
    // read the latest binding without stale closure.
    const refreshHistoryRef = useRef<(() => Promise<void>) | null>(null);

    // R2.2 — chunk 20 (excerpt 첨부) + chunk 22 (drag/drop) →
    // useExcerptAttachments hook.
    const {
      onCaptureExcerpt,
      onDropExcerpt,
      onDragOverExcerpt,
      removeExcerpt,
    } = useExcerptAttachments({
      activeDocPath,
      captureExcerpt,
      setExcerpts,
      setExcerptError,
    });

    // R2.1 — chunk 26 (history list) + chunk 30 (inline rename) →
    // useChatHistory hook.
    const {
      historyList,
      historyOpen,
      setHistoryOpen,
      renamingId,
      renameDraft,
      setRenameDraft,
      refreshHistory,
      newConversation,
      loadConversation,
      deleteHistoryItem,
      beginRename,
      cancelRename,
      commitRename,
    } = useChatHistory({
      activeDocPath,
      conversationIdRef,
      streaming,
      setMessages,
      setConversationId,
      setError,
      setExcerpts,
      setExcerptError,
      refreshHistoryRef,
    });

    // R2.3 — streaming + agent loop → useChatStreaming hook.
    const {
      sendDirect,
      regenerate,
      deleteMessage,
      copyMessage,
      onSubmit,
      onKeyDown,
      stop,
    } = useChatStreaming({
      conversationIdRef,
      autoTitledConvIdsRef,
      providerRef,
      modelRef,
      chatModeRef,
      handleRef,
      scrollerRef,
      assistantIdRef,
      refreshHistoryRef,
      messages,
      setMessages,
      input,
      setInput,
      streaming,
      setStreaming,
      setError,
      hasKey,
      provider,
      model,
      chatMode,
      modelList,
      attachDoc,
      excerpts,
      excerptError,
      setExcerptError,
      setExcerpts,
      conversationId,
      setConversationId,
      referencePaths,
      onOpenSettings,
      getDocHtml,
      applyHtml,
      runTools,
      captureExcerpt,
      activeDocPath,
      verifyExcerpt,
      getOpenDocs,
      getDocOutline,
      undoLastApply,
    });

    // The ChatPanelHandle imperative — chunk 56. Provides prefillAndSend
    // for cross-pane triggers (Studio AI command menu).
    useImperativeHandle(
      ref,
      () => ({
        prefillAndSend: (text: string) => {
          void sendDirect(text);
        },
      }),
      [sendDirect],
    );

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
          {/* chunk 65 — model selector. 기존 free-text input + datalist
            는 사용자 자유 입력을 허용했지만, provider 가 노출하지 않는
            모델 id 를 직접 입력하는 경우는 드물고 오타 위험만 컸다.
            이제 fetched 목록의 dropdown 만 사용. 현재 model 이 목록에
            없으면 "(저장됨)" 마커와 함께 sticky 옵션으로 보존 — provider
            전환 / fetch 실패 시에도 마지막 선택을 잃지 않는다. */}
          {(() => {
            const state = modelList[provider];
            const fetched =
              state.kind === 'ok' || state.kind === 'stale' ? state.models : [];
            const inFetched = fetched.includes(model);
            const empty = fetched.length === 0 && !model;
            return (
              <select
                value={model}
                onChange={(e) => onModelChange(e.target.value)}
                className="flex-1 truncate rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                data-testid="chat-model-input"
                aria-label="Model"
                disabled={streaming || state.kind === 'loading' || empty}
              >
                {empty ? (
                  <option value="">
                    {state.kind === 'loading'
                      ? '모델 목록 가져오는 중…'
                      : state.kind === 'error'
                        ? '모델 목록 확인 불가 — 새로고침'
                        : '모델 없음'}
                  </option>
                ) : null}
                {!inFetched && model ? (
                  <option value={model}>{model} (저장됨)</option>
                ) : null}
                {fetched.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            );
          })()}
          {/* chunk 48 — refresh button + status badge. Click forces a
            cache-bypassing refetch. The badge tells the user whether
            we're using a fresh list, a stale-cache fallback, or a
            "확인 불가" state where the dropdown is empty and they have
            to type the model id by hand. */}
          <button
            type="button"
            onClick={() => void fetchModels(provider, true)}
            disabled={streaming || modelList[provider].kind === 'loading'}
            className="rounded-md border border-input bg-background px-1.5 py-1 text-[10px] hover:bg-muted disabled:opacity-50"
            data-testid="chat-model-refresh"
            title={
              modelList[provider].kind === 'error'
                ? `모델 목록 확인 불가: ${(modelList[provider] as { reason: string }).reason}`
                : modelList[provider].kind === 'stale'
                  ? `오래된 캐시: ${(modelList[provider] as { reason: string }).reason}`
                  : '모델 목록 새로고침'
            }
            aria-label="모델 목록 새로고침"
          >
            {modelList[provider].kind === 'loading'
              ? '⟳'
              : modelList[provider].kind === 'error'
                ? '⚠'
                : modelList[provider].kind === 'stale'
                  ? '⚠'
                  : '↻'}
          </button>
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
          <button
            type="button"
            onClick={() => {
              const next = !historyOpen;
              setHistoryOpen(next);
              if (next) void refreshHistory();
            }}
            disabled={streaming}
            className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            data-testid="chat-history-toggle"
            aria-label="대화 목록"
            title="대화 목록"
          >
            📚
          </button>
          <button
            type="button"
            onClick={newConversation}
            disabled={streaming}
            className="rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
            data-testid="chat-history-new"
            aria-label="새 대화"
            title="새 대화"
          >
            +
          </button>
        </div>
        {/* Phase 3 — Manual / Agent 모드 pill 토글 (style_example). Manual:
          AI 응답의 도구 블록을 사용자가 직접 적용. Agent: provider native
          tool-use API + 자동 루프 + 묶음 undo. */}
        <div className="px-3 pb-2 pt-3" data-testid="chat-mode-bar">
          <div
            className="flex gap-0.5 rounded-md bg-muted p-0.5"
            role="tablist"
          >
            <ModePill
              active={chatMode === 'manual'}
              disabled={streaming}
              onClick={() => setChatMode('manual')}
              testId="chat-mode-manual"
              title="Manual: AI 응답에 도구 블록이 있으면 사용자가 버튼 눌러 적용"
              icon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" />
                  <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2" />
                  <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8" />
                  <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                </svg>
              }
              label="Manual"
              sub="제안 → 승인"
            />
            <ModePill
              active={chatMode === 'agent'}
              disabled={streaming}
              onClick={() => setChatMode('agent')}
              testId="chat-mode-agent"
              title="Agent (실험적): AI가 도구를 직접 호출해 자동으로 적용. 한 turn 내 묶음 undo."
              icon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <circle cx="12" cy="5" r="2" />
                  <path d="M12 7v4" />
                  <line x1="8" y1="16" x2="8" y2="16" />
                  <line x1="16" y1="16" x2="16" y2="16" />
                </svg>
              }
              label="Agent"
              sub="자동 실행"
            />
          </div>
        </div>
        {historyOpen ? (
          <div
            className="border-b border-border bg-card px-3 py-2"
            data-testid="chat-history-popover"
          >
            {historyList.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                저장된 대화가 없습니다.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-auto">
                {historyList.map((c) => {
                  const isRenaming = renamingId === c.id;
                  return (
                    <li
                      key={c.id}
                      className={cn(
                        'group flex items-center gap-1 rounded px-1 text-[11px] hover:bg-muted',
                        c.id === conversationId && 'bg-muted',
                      )}
                      aria-current={
                        c.id === conversationId ? 'page' : undefined
                      }
                      data-testid="chat-history-item"
                      data-id={c.id}
                      data-active={c.id === conversationId ? 'true' : 'false'}
                      data-renaming={isRenaming ? 'true' : 'false'}
                    >
                      {isRenaming ? (
                        <input
                          type="text"
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void commitRename(c.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          onBlur={() => void commitRename(c.id)}
                          autoFocus
                          className="flex-1 rounded border border-input bg-background px-1 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
                          data-testid="chat-history-item-rename-input"
                          aria-label="대화 제목 수정"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => void loadConversation(c.id)}
                          onDoubleClick={() => beginRename(c.id, c.title)}
                          className="flex-1 truncate text-left"
                          data-testid="chat-history-item-load"
                          title="더블클릭하면 제목을 수정합니다"
                        >
                          {c.title || '(제목 없음)'}
                        </button>
                      )}
                      {!isRenaming ? (
                        <button
                          type="button"
                          onClick={() => beginRename(c.id, c.title)}
                          aria-label="대화 제목 수정"
                          data-testid="chat-history-item-rename"
                          className="opacity-0 hover:text-foreground group-hover:opacity-100"
                          title="제목 수정"
                        >
                          ✎
                        </button>
                      ) : null}
                      {!isRenaming ? (
                        <button
                          type="button"
                          onClick={() => void deleteHistoryItem(c.id)}
                          aria-label="대화 삭제"
                          data-testid="chat-history-item-delete"
                          className="opacity-0 hover:text-destructive group-hover:opacity-100"
                        >
                          ×
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}
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
            messages
              .filter((m) => m.role !== 'tool')
              .map((m) => (
                <Message
                  key={m.id}
                  message={m}
                  streaming={streaming}
                  onCopy={copyMessage}
                  onRegenerate={regenerate}
                  onDelete={deleteMessage}
                  onApplyHtml={applyHtml}
                  onRunTools={runTools}
                  onUndoApply={undoLastApply}
                  onApplyPatches={applyPatches}
                  onPreviewPatch={previewPatch}
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
          onDragOver={onDragOverExcerpt}
          onDrop={onDropExcerpt}
          className="border-t border-border bg-card p-3"
          data-testid="chat-input-form"
        >
          {getOpenDocs ? (
            <MultiDocChips
              getOpenDocs={getOpenDocs}
              referencePaths={referencePaths}
              onToggleReference={(path) =>
                setReferencePaths((prev) =>
                  prev.includes(path)
                    ? prev.filter((p) => p !== path)
                    : [...prev, path],
                )
              }
              disabled={streaming}
            />
          ) : null}
          {getDocHtml ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-2',
                  excerpts.length > 0 && 'opacity-50',
                )}
                data-testid="chat-attach-toggle"
                title={
                  excerpts.length > 0
                    ? '발췌 첨부가 있을 때는 통째 첨부 대신 발췌가 사용됩니다.'
                    : undefined
                }
              >
                <input
                  type="checkbox"
                  checked={attachDoc}
                  onChange={(e) => setAttachDoc(e.target.checked)}
                  data-testid="chat-attach-checkbox"
                  disabled={streaming || excerpts.length > 0}
                />
                <span>📎 현재 문서를 컨텍스트로 첨부</span>
              </label>
              {captureExcerpt ? (
                <button
                  type="button"
                  onClick={onCaptureExcerpt}
                  disabled={streaming}
                  data-testid="chat-capture-excerpt"
                  className="rounded-md border border-input px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                >
                  📌 발췌 첨부
                </button>
              ) : null}
            </div>
          ) : null}
          {excerpts.length > 0 ? (
            <ul
              className="mb-2 flex flex-wrap gap-1.5"
              data-testid="chat-excerpt-list"
            >
              {excerpts.map((ex) => {
                const tooLong = ex.text.length > EXCERPT_SOFT_CHAR_LIMIT;
                return (
                  <li
                    key={ex.id}
                    data-testid="chat-excerpt-chip"
                    data-status={ex.status}
                    data-role={ex.role}
                    className={cn(
                      'flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                      ex.status === 'fresh' &&
                        'border-input bg-muted text-foreground',
                      ex.status === 'stale-relocated' &&
                        'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
                      ex.status === 'stale-missing' &&
                        'border-destructive/40 bg-destructive/10 text-destructive',
                    )}
                    title={ex.text}
                  >
                    <span className="text-muted-foreground">
                      {ex.docLabel}:¶{ex.anchor.startParagraphIndex}
                      {ex.anchor.endParagraphIndex !==
                      ex.anchor.startParagraphIndex
                        ? `..${ex.anchor.endParagraphIndex}`
                        : ''}
                    </span>
                    <span className="max-w-[14rem] truncate">
                      {ex.text.replace(/\s+/g, ' ').trim()}
                    </span>
                    {tooLong ? (
                      <span
                        className="text-amber-600"
                        title={`긴 발췌 (${ex.text.length}자) — 토큰 사용량 주의`}
                      >
                        ⚠️
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => removeExcerpt(ex.id)}
                      disabled={streaming}
                      aria-label="발췌 제거"
                      data-testid="chat-excerpt-remove"
                      className="rounded-full px-1 text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-50"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {excerptError ? (
            <div
              role="alert"
              data-testid="chat-excerpt-error"
              className="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive"
            >
              {excerptError}
            </div>
          ) : null}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              rows={2}
              className={cn(
                'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
                // chunk 67 — max-h ≈ 8 rows worth of text-sm leading.
                // overflow-y-auto so the scrollbar shows once the
                // auto-grow useLayoutEffect hits the ceiling.
                'max-h-48 overflow-y-auto',
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
  },
);

interface MessageProps {
  message: UiMessage;
  streaming: boolean;
  onCopy: (id: string) => Promise<boolean>;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Apply an HTML fragment to the active document (chunk 18). */
  onApplyHtml?: (html: string) => void;
  /** Run an `ahwp-tools` op list against the active document (chunk 19). */
  onRunTools?: (items: AhwpPreflightItem[]) => AhwpToolResult[];
  /**
   * Roll back the last AI-applied change — chunk 29. Routes through the
   * active viewer's undo stack which is grouped per AI turn (chunk 27),
   * so a single click reverses all ops the model just ran. Returns true
   * when something was actually undone.
   */
  onUndoApply?: () => boolean;
  /** Apply a batch of patches as a grouped-undo turn (Q5 diff viewer). */
  onApplyPatches?: (patches: AhwpPatch[]) => boolean[];
  /** Scroll the editor to a patch's location (Q5 확장). */
  onPreviewPatch?: (patch: AhwpPatch) => void;
}

/** Manual / Agent mode pill (style_example). Two-state segmented toggle
 * with icon + label + sub-label, 5px radius pill containing a 6px-radius
 * inner pill for the active button. */
function ModePill({
  active,
  disabled,
  onClick,
  testId,
  title,
  icon,
  label,
  sub,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
  title: string;
  icon: JSX.Element;
  label: string;
  sub: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      disabled={disabled}
      onClick={onClick}
      title={title}
      data-testid={testId}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-[11.5px] transition disabled:opacity-50',
        active
          ? 'bg-card font-semibold text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span className="flex size-3.5 items-center justify-center opacity-90">
        {icon}
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className="tracking-tight">{label}</span>
        <span
          className={cn(
            'text-[9.5px] font-normal',
            active ? 'text-muted-foreground' : 'text-muted-foreground/70',
          )}
        >
          {sub}
        </span>
      </span>
    </button>
  );
}

/** Multi-doc chip strip — chunk 21. Reads `getOpenDocs` each render so
 * we always reflect the latest tab list (close/open events mutate the
 * source of truth in AppShell, not here). The active tab is shown as
 * a locked target chip; everything else is a reference checkbox. */
function MultiDocChips({
  getOpenDocs,
  referencePaths,
  onToggleReference,
  disabled,
}: {
  getOpenDocs: () => { path: string; label: string; isActive: boolean }[];
  referencePaths: string[];
  onToggleReference: (path: string) => void;
  disabled: boolean;
}): JSX.Element | null {
  const docs = getOpenDocs();
  if (docs.length === 0) return null;
  return (
    <div
      className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]"
      data-testid="chat-multidoc-chips"
    >
      <span className="text-muted-foreground">컨텍스트:</span>
      {docs.map((d) => {
        const isReference = referencePaths.includes(d.path);
        return (
          <span
            key={d.path}
            data-testid="chat-multidoc-chip"
            data-role={
              d.isActive ? 'target' : isReference ? 'reference' : 'unused'
            }
            className={cn(
              'flex items-center gap-1 rounded-full border px-2 py-0.5',
              d.isActive && 'border-primary/40 bg-primary/10 text-foreground',
              !d.isActive &&
                isReference &&
                'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400',
              !d.isActive &&
                !isReference &&
                'border-input bg-background text-muted-foreground',
            )}
            title={d.path}
          >
            {d.isActive ? (
              <span className="font-medium">🎯 {d.label}</span>
            ) : (
              <label
                className={cn(
                  'flex cursor-pointer items-center gap-1',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
                data-testid="chat-multidoc-toggle"
              >
                <input
                  type="checkbox"
                  checked={isReference}
                  onChange={() => onToggleReference(d.path)}
                  disabled={disabled}
                  data-testid="chat-multidoc-checkbox"
                />
                <span>📚 {d.label}</span>
              </label>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Message({
  message,
  streaming,
  onCopy,
  onRegenerate,
  onDelete,
  onApplyHtml,
  onRunTools,
  onUndoApply,
  onApplyPatches,
  onPreviewPatch,
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

  // Apply-HTML affordance — only on completed assistant messages that
  // contain a ```html``` fenced block AND when a viewer handle is
  // available (onApplyHtml prop). Extract the first block; the
  // SYSTEM_PROMPT_DOC_CONTEXT instructs the model to emit at most one.
  const htmlMatch =
    !isUser && !streaming && onApplyHtml
      ? HTML_BLOCK_RE.exec(message.content)
      : null;
  const htmlPayload = htmlMatch ? htmlMatch[1].trim() : null;
  // chunk 29 — applied/toolsRun feedback persists ~15s instead of ~2s
  // so the user has time to click "되돌리기" before the affordance hides.
  // The badge collapses back to its original state once `undone` flips
  // true (we keep the affordance idempotent — second undo click is a
  // no-op).
  const APPLIED_TOAST_MS = 15000;
  const [applied, setApplied] = useState(false);
  const [undone, setUndone] = useState(false);
  const appliedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    };
  }, []);
  const handleApply = () => {
    if (!htmlPayload || !onApplyHtml) return;
    onApplyHtml(htmlPayload);
    setApplied(true);
    setUndone(false);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    appliedTimerRef.current = setTimeout(
      () => setApplied(false),
      APPLIED_TOAST_MS,
    );
  };
  const handleUndoApply = () => {
    if (!onUndoApply || undone) return;
    const ok = onUndoApply();
    if (ok) {
      setUndone(true);
      // Keep the badge visible for a beat so the user sees the rollback
      // confirmation, then collapse.
      if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
      appliedTimerRef.current = setTimeout(() => {
        setApplied(false);
        setUndone(false);
      }, 2000);
    }
  };

  // Diff Viewer affordance — Q5 (UI/UX align). The model emits a
  // ```ahwp-patches``` block when it has discrete, location-anchored
  // changes that benefit from per-patch Accept/Reject. We pre-flight
  // here so the preview can show invalid patches in red.
  const patchesMatch =
    !isUser && !streaming && onApplyPatches
      ? PATCHES_BLOCK_RE.exec(message.content)
      : null;
  const patchesParsed = useMemo(() => {
    if (!patchesMatch) return null;
    return parsePatchBlock(patchesMatch[1].trim());
  }, [patchesMatch]);
  // Per-patch status. The patches block becomes visible only after
  // streaming completes (patchesMatch gates on !streaming), so on first
  // mount patchCount may be 0 → patchStatuses=[]. Once streaming flips,
  // patchCount becomes N. We compute *displayed* statuses by aligning
  // length with patchCount each render — falling back to 'pending'
  // for missing slots — so the UI is always coherent without a
  // setState-in-effect cascade.
  const patchCount =
    patchesParsed && patchesParsed.ok ? patchesParsed.items.length : 0;
  const [patchStatusOverrides, setPatchStatusOverrides] = useState<
    Record<number, PatchStatus>
  >({});
  const patchStatuses: PatchStatus[] = Array.from(
    { length: patchCount },
    (_, i) => patchStatusOverrides[i] ?? 'pending',
  );
  const setPatchStatusAt = (idx: number, status: PatchStatus): void => {
    setPatchStatusOverrides((prev) => ({ ...prev, [idx]: status }));
  };

  // Q5 확장 — Accept 후 ~12s 토스트 ("N개 적용됨 · 되돌리기").
  const [patchToast, setPatchToast] = useState<{
    appliedCount: number;
  } | null>(null);
  const patchToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (patchToastTimerRef.current) clearTimeout(patchToastTimerRef.current);
    };
  }, []);
  const showPatchToast = (count: number): void => {
    if (count <= 0) return;
    setPatchToast({ appliedCount: count });
    if (patchToastTimerRef.current) clearTimeout(patchToastTimerRef.current);
    patchToastTimerRef.current = setTimeout(() => setPatchToast(null), 12000);
  };
  const handlePatchUndo = (): void => {
    if (!onUndoApply) return;
    if (onUndoApply()) {
      // After undo, all accepted statuses revert visually to pending —
      // we don't track which ones were just accepted vs. earlier, so
      // wipe overrides entirely. (For multi-step accept flows the user
      // can re-apply.)
      setPatchStatusOverrides({});
      if (patchToastTimerRef.current) clearTimeout(patchToastTimerRef.current);
      setPatchToast(null);
    }
  };

  const handlePatchAcceptIdx = (idx: number): void => {
    if (!patchesParsed?.ok || !onApplyPatches) return;
    const item = patchesParsed.items[idx];
    if (!item.ok) return;
    const results = onApplyPatches([item.patch]);
    if (results[0]) {
      setPatchStatusAt(idx, 'accepted');
      showPatchToast(1);
    }
  };
  const handlePatchRejectIdx = (idx: number): void => {
    setPatchStatusAt(idx, 'rejected');
  };
  const handlePatchAcceptAll = (): void => {
    if (!patchesParsed?.ok || !onApplyPatches) return;
    const pendingItems: { idx: number; patch: AhwpPatch }[] = [];
    patchesParsed.items.forEach((it, i) => {
      if (it.ok && patchStatuses[i] === 'pending') {
        pendingItems.push({ idx: i, patch: it.patch });
      }
    });
    if (pendingItems.length === 0) return;
    const results = onApplyPatches(pendingItems.map((x) => x.patch));
    let okCount = 0;
    setPatchStatusOverrides((prev) => {
      const next = { ...prev };
      pendingItems.forEach((it, k) => {
        if (results[k]) okCount += 1;
        next[it.idx] = results[k] ? 'accepted' : 'rejected';
      });
      return next;
    });
    showPatchToast(okCount);
  };

  // Tool-call dispatcher affordance — chunk 19. The model emits a
  // ```ahwp-tools``` JSON block when it needs to mutate controls (footnote,
  // header/footer, bookmark, page def, style, shape) that the HTML path
  // can't express. We pre-flight here so the preview can show invalid ops
  // in red even before the user clicks.
  const toolsMatch =
    !isUser && !streaming && onRunTools
      ? TOOLS_BLOCK_RE.exec(message.content)
      : null;
  const toolsParsed = useMemo(() => {
    if (!toolsMatch) return null;
    return parseToolBlock(toolsMatch[1].trim());
  }, [toolsMatch]);
  const [toolsRun, setToolsRun] = useState<{
    ok: number;
    total: number;
  } | null>(null);
  const [toolsUndone, setToolsUndone] = useState(false);
  const toolsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
    };
  }, []);
  const handleRunTools = () => {
    if (!toolsParsed || !toolsParsed.ok || !onRunTools) return;
    const results = onRunTools(toolsParsed.items);
    let ok = 0;
    for (const r of results) if (r.ok) ok += 1;
    setToolsRun({ ok, total: results.length });
    setToolsUndone(false);
    if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
    // chunk 29 — keep the affordance visible for ~15s so the user has
    // time to click 되돌리기. The runTools dispatcher already groups all
    // ops into a single undo entry (chunk 27).
    toolsTimerRef.current = setTimeout(
      () => setToolsRun(null),
      APPLIED_TOAST_MS,
    );
  };
  const handleUndoTools = () => {
    if (!onUndoApply || toolsUndone) return;
    const ok = onUndoApply();
    if (ok) {
      setToolsUndone(true);
      if (toolsTimerRef.current) clearTimeout(toolsTimerRef.current);
      toolsTimerRef.current = setTimeout(() => {
        setToolsRun(null);
        setToolsUndone(false);
      }, 2000);
    }
  };

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
        {/* Phase 3 — Agent 모드 tool 호출 inline 표시. running=spinner,
          ok=✓, failed=✗ + reason 툴팁. */}
        {!isUser && message.toolEntries && message.toolEntries.length > 0 ? (
          <div
            className="mt-2 flex flex-col gap-1 border-t border-border/50 pt-2 text-xs"
            data-testid="chat-tool-entries"
          >
            {message.toolEntries.map((te) => (
              <div
                key={te.id}
                className="flex items-center gap-2 font-mono"
                data-testid="chat-tool-entry"
                data-tool-name={te.name}
                data-tool-status={te.status}
                title={te.reason ?? ''}
              >
                <span className="text-muted-foreground">
                  {te.status === 'running'
                    ? '⏳'
                    : te.status === 'ok'
                      ? '✓'
                      : '✗'}
                </span>
                <span className="font-semibold">🔧 {te.name}</span>
                <span className="truncate text-muted-foreground">
                  {te.argsPreview}
                </span>
                {te.status === 'failed' && te.reason ? (
                  <span className="text-destructive">{te.reason}</span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {htmlPayload ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <Button
              type="button"
              size="sm"
              variant={applied ? 'secondary' : 'default'}
              onClick={handleApply}
              data-testid="chat-action-apply-html"
              className="text-xs"
            >
              {applied ? (undone ? '✓ 되돌림' : '✓ 적용됨') : '문서에 적용'}
            </Button>
            {applied && !undone && onUndoApply ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleUndoApply}
                data-testid="chat-action-undo-apply"
                className="text-xs"
                title="방금 적용한 변경을 한 번에 되돌립니다 (⌘Z 묶음 undo)"
              >
                되돌리기
              </Button>
            ) : null}
          </div>
        ) : null}
        {/* Q5 Diff Viewer — render patches block as Accept/Reject cards. */}
        {patchesParsed && patchesParsed.ok && patchCount > 0 ? (
          <div
            className="mt-2 border-t border-border pt-2"
            data-testid="chat-patches-block"
          >
            <MultiPatchStack
              items={patchesParsed.items}
              statuses={patchStatuses}
              onAccept={handlePatchAcceptIdx}
              onReject={handlePatchRejectIdx}
              onAcceptAll={handlePatchAcceptAll}
              onPreview={onPreviewPatch}
            />
            {patchToast ? (
              <div
                className="mt-2 flex items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs"
                data-testid="diff-applied-toast"
              >
                <Check className="size-3.5 text-emerald-600" />
                <span className="flex-1 font-medium text-foreground">
                  {patchToast.appliedCount}개 적용됨
                </span>
                {onUndoApply ? (
                  <button
                    type="button"
                    onClick={handlePatchUndo}
                    className="text-[11px] font-medium text-emerald-700 hover:underline dark:text-emerald-300"
                    data-testid="diff-applied-undo"
                  >
                    되돌리기
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        {patchesParsed && !patchesParsed.ok ? (
          <div
            className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive"
            data-testid="chat-patches-error"
          >
            패치 블록 파싱 실패: {patchesParsed.reason}
          </div>
        ) : null}
        {toolsParsed ? (
          <div
            className="mt-2 border-t border-border pt-2"
            data-testid="chat-tools-block"
          >
            {toolsParsed.ok ? (
              <>
                <ul
                  className="mb-2 space-y-0.5 text-[11px]"
                  data-testid="chat-tools-preview"
                >
                  {toolsParsed.items.map((item, idx) => (
                    <li
                      key={idx}
                      className={cn(
                        'flex gap-2',
                        item.ok ? 'text-muted-foreground' : 'text-destructive',
                      )}
                      data-testid="chat-tools-op"
                      data-op-ok={item.ok ? 'true' : 'false'}
                    >
                      <span className="font-mono">
                        {item.ok ? item.call.tool : item.tool}
                      </span>
                      <span className="truncate">
                        {item.ok ? previewArgs(item.call) : `✗ ${item.reason}`}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={toolsRun ? 'secondary' : 'default'}
                    onClick={handleRunTools}
                    disabled={
                      toolsParsed.items.every((it) => !it.ok) // all-failed: nothing to dispatch
                    }
                    data-testid="chat-action-run-tools"
                    className="text-xs"
                  >
                    {toolsRun
                      ? toolsUndone
                        ? `✓ 되돌림 (${toolsRun.ok}/${toolsRun.total})`
                        : `✓ 적용됨 (${toolsRun.ok}/${toolsRun.total})`
                      : '도구 실행'}
                  </Button>
                  {toolsRun && !toolsUndone && onUndoApply ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleUndoTools}
                      data-testid="chat-action-undo-tools"
                      className="text-xs"
                      title="방금 실행한 모든 도구 호출을 한 번에 되돌립니다"
                    >
                      되돌리기
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div
                className="text-[11px] text-destructive"
                data-testid="chat-tools-error"
              >
                도구 블록 파싱 실패: {toolsParsed.reason}
              </div>
            )}
          </div>
        ) : null}
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
