import {
  AlertTriangle,
  Check,
  Copy,
  History,
  Key,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
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
  type ReactNode,
} from 'react';
import type { ChatMessage, ProviderId } from '@shared/ai';
import {
  parseToolBlock,
  type AhwpPreflightItem,
  type AhwpToolResult,
} from '@shared/ai-tools';
import { createPortal } from 'react-dom';
import { parsePatchBlock, type AhwpPatch } from '@shared/ai-patches';
import { MultiPatchStack, type PatchStatus } from './DiffCard';
import { markdownToHtml } from './markdownToHtml';
import { findSectionToReplace } from './sectionMatcher';
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
import {
  useChatStreaming,
  loadAgentMaxTurns,
  loadPlanModeDefault,
} from './hooks/useChatStreaming';
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
// chunk 99 follow-up — autoApprove 토글 폐기. 모든 도구 즉시 dispatch.
// 컨텍스트 자동 첨부도 폐기 (attachDoc / referencePaths) — 사용자가
// 매뉴얼 발췌 chip 으로만 컨텍스트 추가.

// chunk 77 — module-scope so helper components below (ModelRefreshButton)
// can declare prop types referencing it without crossing the React
// component closure.
type ModelListState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; models: string[]; fetchedAt: number }
  | { kind: 'stale'; models: string[]; fetchedAt: number; reason: string }
  | { kind: 'error'; reason: string };

export type ChatMode = 'manual' | 'agent';

interface UiMessage extends ChatMessage {
  id: string;
  /** Phase 3 — tool 호출/결과 inline 표시 (assistant 메시지 안). */
  toolEntries?: UiToolEntry[];
  /** chunk 99 follow-up — plan mode 에서 생성된 어시스턴트 메시지.
   *  UI 가 "이 계획대로 실행" 버튼 surface. */
  planMode?: boolean;
}

interface UiToolEntry {
  id: string;
  name: string;
  argsPreview: string;
  /** chunk 97 — pending: write tool 사용자 승인 대기. rejected: 사용자가
   *  거절 (dispatch 안 됨, tool_result 는 'user-rejected' 로 모델에 회신). */
  status: 'running' | 'ok' | 'failed' | 'pending' | 'rejected';
  reason?: string;
  /** 0.4.11 — JSON-stringified tool 결과 (확장 버튼 노출). */
  resultPreview?: string;
  /** 0.4.17 — read 는 dim 한 줄, write 는 카드. */
  kind: 'read' | 'write';
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
   * Replace an existing outline section's body with the AI-authored
   * HTML — chunk 99 follow-up. Surfaced as "기존 X.Y.Z 섹션 교체"
   * button when the AI's heading matches an outline section number.
   * Avoids the duplicate-section bug where pasteHtml-at-caret left
   * the old heading + body intact next to the new one.
   */
  applyHtmlReplaceSection?: (
    html: string,
    target: { startParaIdx: number; endParaIdxExclusive: number },
  ) => void;
  /**
   * Read the active document outline (heading paragraphs). Used by
   * the apply button to detect when the AI heading matches an existing
   * section so we can offer the replace path instead of paste-at-caret.
   */
  getOutline?: () => readonly {
    paragraphIndex: number;
    level: number;
    text: string;
  }[];
  /**
   * Active doc paragraph count cap — passed to `findSectionToReplace`
   * so the matcher can compute end-of-document for the last outline
   * entry. Optional; falls back to outline-end when missing.
   */
  getActiveParagraphCount?: () => number;
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
  ) => Promise<AhwpToolResult[]> | AhwpToolResult[];
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
  /** chunk 99 follow-up — switchTargetDoc 가 닫힌 탭 path 를 받았을 때
   *  자동으로 file:open-by-path → tab 추가 → mount. true=성공.
   *  AppShell 가 IPC + tabsState 갱신 책임. 미제공 시 닫힌 path 는
   *  reject 되고 모델은 다른 접근으로 회피 (기존 동작). */
  openDocByPath?: (path: string) => Promise<boolean>;
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
      applyHtmlReplaceSection,
      getOutline,
      runTools,
      captureExcerpt,
      activeDocPath,
      verifyExcerpt,
      getOpenDocs,
      getDocOutline,
      undoLastApply,
      openDocByPath,
      applyPatches,
      previewPatch,
    },
    ref,
  ) {
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    // chunk 99 follow-up — agent turn step counter for "Turn N/M" UI.
    // Hook bumps via setAgentTurn callback on each turn entry.
    const [agentTurn, setAgentTurn] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [hasKey, setHasKey] = useState<boolean | null>(null);
    const [provider, setProvider] = useState<ChatProviderId>(() =>
      loadProvider(),
    );
    // chunk 99 follow-up — autoApprove 토글 폐기. 모든 도구 즉시
    // dispatch (read + write 동등). 사용자가 만족 못하면 stop / undo
    // (⌘Z) 로 옵트아웃. 명시적 confirm UX 제거 (사용자 요청).
    // chunk 99 follow-up — Plan mode 표시 상태. 영속 상태는 default
    // (Settings) 만. 매 turn 마다 default 가 자동 적용되므로 ChatPanel
    // 은 default 를 미러링 + Settings 변경 이벤트 listen.
    const [planModeDefault, setPlanModeDefault] = useState<boolean>(() =>
      loadPlanModeDefault(),
    );
    useEffect(() => {
      const onChange = () => setPlanModeDefault(loadPlanModeDefault());
      window.addEventListener('ahwp:plan-mode-default-changed', onChange);
      // 다른 탭 변경도 listen (storage event 는 cross-tab).
      const onStorage = (e: StorageEvent) => {
        if (e.key === 'ahwp:chat:plan-mode-default') onChange();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        window.removeEventListener('ahwp:plan-mode-default-changed', onChange);
        window.removeEventListener('storage', onStorage);
      };
    }, []);
    // 옛 chunk 18 호환을 위한 chatModeRef stub — useChatStreaming 의 옵션
    // 시그니처 호환용. 실제 분기는 autoApproveRef 가 담당.
    const chatModeRef = useRef<'manual' | 'agent'>('agent');
    const [models, setModels] = useState<Record<ChatProviderId, string>>(() =>
      loadModels(),
    );
    // chunk 48 — model list per provider. The renderer asks main for the
    // catalog (cached 24h), then keeps the result in memory so the
    // dropdown is responsive. `idle` before first fetch; `loading` while
    // a fetch is in flight; `ok` / `stale` / `error` after. The free-text
    // input is always available — the dropdown just *suggests* values
    // (datalist), so a missing list (`error`) doesn't block chat.
    // chunk 77 — `ModelListState` 는 모듈 스코프로 hoist 해서 helper
    // component (ModelRefreshButton) 가 참조할 수 있게 했다.
    const [modelList, setModelList] = useState<
      Record<ChatProviderId, ModelListState>
    >({
      openai: { kind: 'idle' },
      nvidia: { kind: 'idle' },
      google: { kind: 'idle' },
      custom: { kind: 'idle' },
    });
    // chunk 74 — default true. The user expectation when opening
    // ChatPanel with an active doc is "AI knows what I'm looking at".
    // Toggling off is for very long docs where token cost is a concern.
    // Persisted via localStorage so the user's preference sticks.
    // chunk 99 follow-up — 컨텍스트 자동 첨부 폐기 (사용자 요청).
    // attachDoc 토글 UI 제거. 사용자가 매뉴얼로 발췌 chip 으로 첨부.
    // attachDoc state 는 false 로 고정 — getDocHtml 자동 호출 차단.
    // hook signature 호환을 위해 setter stub 유지.
    const attachDoc = false;
    const setAttachDoc = (): void => {};
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
    // chunk 99 follow-up — 멀티 문서 chip UI 폐기 (사용자 요청). 빈
    // 배열 고정 — useChatStreaming 의 reference outline 자동 주입 차단.
    const referencePaths: string[] = [];
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
      const refresh = (): void => {
        void window.api.secrets.has(provider).then((v) => {
          if (!cancelled) setHasKey(v);
        });
      };
      refresh();
      // chunk 70 broadcast — Settings 에서 키 저장/삭제 시 즉시 반영
      // (이전엔 deps=[provider] 만이라 같은 provider 키 추가 시 stale).
      const unsubscribe = window.api.secrets.onChanged(refresh);
      return () => {
        cancelled = true;
        unsubscribe();
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

    // chunk 69 — pre-fetch every provider that has a stored key so the
    // model selector is ready the moment the user switches to it (no
    // "확인 불가" → click 새로고침 → wait dance). The cache layer in
    // main keeps the cost trivial after the first run; force is false
    // so a fresh < 24h cache short-circuits immediately. We fire in
    // parallel — providers don't block each other.
    //
    // chunk 70 — also re-fire on `secrets:changed` (broadcast from
    // main when the user saves / deletes a key in Settings). The
    // mount-only effect alone missed the common path of "launch app
    // with no keys → add key in Settings → switch provider in
    // ChatPanel → wait" because the startup effect had already
    // exited.
    const prefetchAllProviders = useCallback(async (): Promise<void> => {
      const checks = await Promise.all(
        PROVIDER_OPTIONS.map(async (p) => ({
          id: p.id,
          has: await window.api.secrets.has(p.id),
        })),
      );
      for (const { id, has } of checks) {
        if (has) void fetchModels(id);
      }
    }, [fetchModels]);

    useEffect(() => {
      void prefetchAllProviders();
      const unsubscribe = window.api.secrets.onChanged(() => {
        void prefetchAllProviders();
      });
      return unsubscribe;
    }, [prefetchAllProviders]);

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
      resolveApproval,
      requestPlanSkip,
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
      setAgentTurn,
      hasKey,
      provider,
      model,
      chatMode: 'agent' as const,
      modelList,
      attachDoc,
      setAttachDoc,
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
      // chunk 99 follow-up — switchTargetDoc 의 cross-doc auto-open
      // path. AppShell 이 prop 으로 주입 (file:open-by-path IPC + tab
      // mount 책임). 미주입 시 hook 은 단순 reject (현재 동작).
      openDocByPath,
      // plan 응답 turn 종료 시 React state 동기화 (localStorage 는 이미
      // hook 안에서 갱신). 미동기화 시 사용자 다음 메시지 보낼 때까지
      // 토글 ON 으로 보임 (혼란).
      // chunk 99 follow-up — auto-disengage 폐기 (active key 폐기와 함께).
      // default 가 매 turn 자동 적용되므로 disengage 도 별도 동기화 불필요.
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

    // chunk 99 follow-up — Plan mode 응답 직후 사용자가 "이 계획대로
    // 실행" 클릭 시 호출. plan mode 토글 off + 직전 user prompt (plan
    // 응답 바로 위 user message) 를 새 turn 으로 다시 발사. 모델은
    // 이번엔 write tool 풀 catalog 로 작업.
    const executePlanFromMessage = useCallback(
      (assistantMessageId: string) => {
        // 가장 가까운 직전 user message 찾기.
        const idx = messages.findIndex((m) => m.id === assistantMessageId);
        if (idx <= 0) return;
        let userText: string | null = null;
        for (let i = idx - 1; i >= 0; i--) {
          if (messages[i].role === 'user') {
            userText = messages[i].content;
            break;
          }
        }
        if (!userText) return;
        // chunk 99 follow-up — next-send 1회만 plan 우회. default 는
        // 그대로 유지되어 *다음 새* prompt 부터 다시 dry-run 으로 시작.
        requestPlanSkip();
        void sendDirect(userText);
      },
      [messages, sendDirect, requestPlanSkip],
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
      // chunk 73 — `min-h-0` lets nested flex children honor the
      // parent's height bound. Without it the chat-scroller's
      // `flex-1 overflow-auto` collapsed when the message list grew,
      // pushing the input form out of view (same root cause as the
      // Settings PaneBody issue in chunk 72).
      <div className="flex h-full min-h-0 flex-col">
        {/* chunk 77 — provider bar 2-row layout. Row 1: provider +
            status icons + actions (always visible regardless of model
            id length). Row 2: full-width model selector + refresh.
            Earlier single-row layout collapsed history/+ buttons when
            NVIDIA / NIM model ids stretched the model select. */}
        <div
          className="flex shrink-0 flex-col gap-1.5 border-b border-border bg-card px-3 py-2"
          data-testid="chat-provider-bar"
        >
          <div className="flex items-center gap-1.5">
            <select
              value={provider}
              onChange={(e) =>
                onProviderChange(e.target.value as ChatProviderId)
              }
              className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-ring"
              data-testid="chat-provider-select"
              aria-label="Provider"
              title="AI 공급자 선택 (OpenAI / NVIDIA NIM / Google Gemini / Custom)"
              disabled={streaming}
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            <KeyStatusIcon hasKey={hasKey} providerLabel={providerLabel} />
            <IconButton
              onClick={() => {
                const next = !historyOpen;
                setHistoryOpen(next);
                if (next) void refreshHistory();
              }}
              disabled={streaming}
              testid="chat-history-toggle"
              ariaLabel="대화 목록"
              title="대화 목록 (현재 문서 기준 — 클릭해 이전 대화 불러오기)"
              active={historyOpen}
            >
              <History className="size-3.5" />
            </IconButton>
            <IconButton
              onClick={newConversation}
              disabled={streaming}
              testid="chat-history-new"
              ariaLabel="새 대화"
              title="새 대화 시작 (기존 대화는 DB 에 보존)"
            >
              <Plus className="size-3.5" />
            </IconButton>
          </div>
          <div className="flex items-center gap-1.5">
            {/* chunk 65 — model selector. fetched 목록의 dropdown 만
              사용. 현재 model 이 목록에 없으면 "(저장됨)" sticky 옵션
              으로 보존. */}
            {(() => {
              const state = modelList[provider];
              const fetched =
                state.kind === 'ok' || state.kind === 'stale'
                  ? state.models
                  : [];
              const inFetched = fetched.includes(model);
              const empty = fetched.length === 0 && !model;
              return (
                <select
                  value={model}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="min-w-0 flex-1 truncate rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-hidden focus:ring-2 focus:ring-ring"
                  data-testid="chat-model-input"
                  aria-label="Model"
                  title={
                    empty
                      ? '모델 목록 없음 — 키 등록 후 옆 새로고침 버튼'
                      : `현재 모델: ${model || '(미선택)'}\n클릭해 다른 모델 선택`
                  }
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
            <ModelRefreshButton
              state={modelList[provider]}
              streaming={streaming}
              onClick={() => void fetchModels(provider, true)}
            />
          </div>
        </div>
        {/* chunk 99 follow-up — 쓰기 도구 자동 승인 토글 폐기 (사용자
          요청). 모든 도구 즉시 dispatch. UI 는 Plan mode indicator
          하나만. */}
        <div
          className="flex shrink-0 flex-col gap-1.5 px-3 pb-2 pt-3"
          data-testid="chat-mode-bar"
        >
          {/* chunk 99 follow-up — Plan mode toggle 은 Settings 의
            "Agent 동작" 으로 이동. 매 turn 마다 토글하기엔 호흡이 길고,
            기본값 (default ON) 으로 충분히 dry-run 사이클이 잡힘. 활성
            상태일 때만 indicator 노출해 사용자에게 "이번 turn 은 dry-
            run" 임을 알림. */}
          {planModeDefault ? (
            <div
              className="flex items-center justify-between gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-1.5"
              data-testid="chat-plan-mode-indicator"
              title="Plan mode 활성 — AI 가 변경 계획만 작성합니다. 응답 후 자동 해제. 기본 동작은 Settings → AI 공급자 → 'Plan mode 기본 활성화' 에서 조절."
            >
              <span className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
                ⏸ Plan mode (다음 turn dry-run)
              </span>
              <button
                type="button"
                onClick={() => requestPlanSkip()}
                disabled={streaming}
                className="text-[10px] font-medium text-muted-foreground hover:text-foreground"
                data-testid="chat-plan-mode-skip"
                title="이번 turn 은 plan 없이 바로 실행. 다음 새 prompt 부터 다시 default 적용."
              >
                건너뛰기
              </button>
            </div>
          ) : null}
        </div>
        {historyOpen ? (
          <div
            // chunk 82 — `shrink-0` 가드. chat-scroller 가 `flex-1 +
            // min-h-0` 로 잡혀 있어서 sibling 들이 default `shrink: 1`
            // 로 0 height 까지 줄어들 수 있다 (popover 컨텐츠가 보여
            // 야 하는데 button 들이 0 size 로 hidden 처리됨).
            className="shrink-0 border-b border-border bg-card px-3 py-2"
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
                          className="flex-1 rounded border border-input bg-background px-1 py-0.5 text-[11px] outline-hidden focus:ring-1 focus:ring-ring"
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
          // chunk 73 — `min-h-0` so this region can shrink below its
          // intrinsic content height when the parent flex container
          // caps it. Pairs with `flex-1` + `overflow-y-auto` so long
          // assistant replies scroll within the bounds instead of
          // pushing the input form below the viewport.
          className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4"
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
                  onApplyHtmlReplaceSection={applyHtmlReplaceSection}
                  getOutline={getOutline}
                  onRunTools={runTools}
                  onUndoApply={undoLastApply}
                  onApplyPatches={applyPatches}
                  onPreviewPatch={previewPatch}
                  onResolveApproval={resolveApproval}
                  onExecutePlan={() => executePlanFromMessage(m.id)}
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
          className="shrink-0 border-t border-border bg-card p-3"
          data-testid="chat-input-form"
        >
          {/* chunk 99 follow-up — 멀티 문서 자동 chip 폐기 (사용자
            요청, 매뉴얼만). MultiDocChips 컴포넌트는 keep — 향후 사용자
            매뉴얼 토글 / cmd-K 같은 곳에서 재활용 가능. */}
          {/* chunk 99 follow-up — 자동 첨부 토글 폐기 (사용자 요청).
            컨텍스트는 사용자가 매뉴얼 발췌 chip 으로만 추가. captureExcerpt
            버튼은 그대로 노출. */}
          {captureExcerpt ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
              <button
                type="button"
                onClick={onCaptureExcerpt}
                disabled={streaming}
                data-testid="chat-capture-excerpt"
                className="rounded-md border border-input px-2 py-0.5 hover:bg-muted disabled:opacity-50"
                title="에디터에서 선택한 텍스트를 칩으로 첨부 (selection rect 를 채팅 입력란으로 드래그해도 동일)"
              >
                📌 발췌 첨부
              </button>
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
                    <span className="max-w-56 truncate">
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
                'placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring',
                'disabled:opacity-50',
              )}
              disabled={hasKey === false}
              data-testid="chat-input"
            />
            {streaming ? (
              <div className="flex items-center gap-1.5">
                {agentTurn > 0 ? (
                  <span
                    className="text-[10px] tabular-nums text-muted-foreground"
                    data-testid="chat-agent-turn-counter"
                    title={`Agent 작업 진행: ${agentTurn} / ${loadAgentMaxTurns()} 턴 (Settings 에서 한계 조절)`}
                  >
                    Turn {agentTurn}/{loadAgentMaxTurns()}
                  </span>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  onClick={stop}
                  aria-label="전송 중단"
                  title="전송 중단 (응답 스트리밍 + Agent 루프 취소)"
                  data-testid="chat-stop"
                >
                  <Square className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={input.trim().length === 0 || hasKey === false}
                aria-label="전송"
                title="전송 (Enter)"
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

// chunk 77 — provider-bar 작은 SVG 아이콘 버튼 helper. 일관된
// border / hover / disabled 스타일 + lucide 아이콘 size 정렬.
function IconButton({
  onClick,
  disabled,
  testid,
  ariaLabel,
  title,
  active,
  dataState,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  testid: string;
  ariaLabel: string;
  title: string;
  active?: boolean;
  dataState?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      data-state={dataState}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md border border-input transition disabled:opacity-50',
        active ? 'bg-muted text-foreground' : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  );
}

// chunk 77 — API 키 상태 아이콘. lucide Key (등록) / KeyRound 윤곽
// (미등록) / Loader2 (확인 중). 테마의 emerald / muted-foreground 토큰
// 사용. 텍스트 "키 ●" / "키 ○" 이모지 → SVG 교체.
function KeyStatusIcon({
  hasKey,
  providerLabel,
}: {
  hasKey: boolean | null;
  providerLabel: string;
}): JSX.Element {
  const title =
    hasKey === true
      ? `${providerLabel} API 키 등록됨 — 채팅 가능`
      : hasKey === false
        ? `${providerLabel} API 키 미등록 — Settings 에서 등록 필요`
        : 'API 키 상태 확인 중…';
  return (
    <span
      className={cn(
        'flex size-7 shrink-0 items-center justify-center rounded-md',
        hasKey === true
          ? 'text-emerald-600 dark:text-emerald-400'
          : hasKey === false
            ? 'text-muted-foreground'
            : 'text-muted-foreground/60',
      )}
      data-testid="chat-key-indicator"
      data-state={
        hasKey === true ? 'ok' : hasKey === false ? 'missing' : 'loading'
      }
      aria-label={hasKey ? 'API 키 있음' : 'API 키 없음'}
      title={title}
    >
      {hasKey === null ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : hasKey ? (
        <Key className="size-3.5" />
      ) : (
        <KeyRound className="size-3.5" />
      )}
    </span>
  );
}

// chunk 77 — 모델 목록 새로고침 버튼. 상태에 따라 RefreshCw (idle/ok)
// / Loader2 spin (loading) / AlertTriangle (error/stale) 아이콘 교체.
// 이전엔 ↻ / ⟳ / ⚠ 텍스트로 OS 폰트에 따라 모양이 일정치 않았다.
function ModelRefreshButton({
  state,
  streaming,
  onClick,
}: {
  state: ModelListState;
  streaming: boolean;
  onClick: () => void;
}): JSX.Element {
  const title =
    state.kind === 'error'
      ? `모델 목록 확인 불가: ${state.reason}`
      : state.kind === 'stale'
        ? `오래된 캐시: ${state.reason}`
        : '모델 목록 새로고침';
  return (
    <IconButton
      onClick={onClick}
      disabled={streaming || state.kind === 'loading'}
      testid="chat-model-refresh"
      ariaLabel="모델 목록 새로고침"
      title={title}
      dataState={state.kind}
    >
      {state.kind === 'loading' ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : state.kind === 'error' || state.kind === 'stale' ? (
        <AlertTriangle className="size-3.5 text-amber-600 dark:text-amber-400" />
      ) : (
        <RefreshCw className="size-3.5" />
      )}
    </IconButton>
  );
}

interface MessageProps {
  message: UiMessage;
  streaming: boolean;
  onCopy: (id: string) => Promise<boolean>;
  onRegenerate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Apply an HTML fragment to the active document (chunk 18). */
  onApplyHtml?: (html: string) => void;
  /** Replace an existing outline section's body with HTML (chunk 99 follow-up). */
  onApplyHtmlReplaceSection?: (
    html: string,
    target: { startParaIdx: number; endParaIdxExclusive: number },
  ) => void;
  /** Read active document outline — used to detect section-replace candidate. */
  getOutline?: () => readonly {
    paragraphIndex: number;
    level: number;
    text: string;
  }[];
  /** Run an `ahwp-tools` op list against the active document (chunk 19). */
  onRunTools?: (
    items: AhwpPreflightItem[],
  ) => Promise<AhwpToolResult[]> | AhwpToolResult[];
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
  /** chunk 97 — pending write tool 의 사용자 결정 콜백. */
  onResolveApproval?: (toolUseId: string, accept: boolean) => Promise<void>;
  /** chunk 99 follow-up — plan mode 응답 직후 사용자가 "이 계획대로
   *  실행" 클릭 시 호출. plan mode 를 끄고 같은 prompt 를 새 turn 으로
   *  발사한다. */
  onExecutePlan?: () => void;
}

/** Multi-doc chip strip — chunk 21. Reads `getOpenDocs` each render so
 * we always reflect the latest tab list (close/open events mutate the
 * source of truth in AppShell, not here). The active tab is shown as
 * a locked target chip; everything else is a reference checkbox. */
// chunk 99 follow-up — MultiDocChips (auto multi-doc 컨텍스트 chip)
// 폐기 (사용자 요청). 사용자가 매뉴얼로 발췌 chip 만 추가. 향후 재
// 활용 시 git history 에서 복구 가능 (chunk 21 이력).

function Message({
  message,
  streaming,
  onCopy,
  onRegenerate,
  onDelete,
  onApplyHtml,
  onApplyHtmlReplaceSection,
  getOutline,
  onRunTools,
  onUndoApply,
  onApplyPatches,
  onPreviewPatch,
  onResolveApproval,
  onExecutePlan,
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
  let htmlPayload = htmlMatch ? htmlMatch[1].trim() : null;
  // chunk 99 fallback — 모델이 도구 호출 / ```html``` 블록 둘 다 안 쓰고
  // 자유 markdown 으로 응답한 경우 (gpt-5.4-mini 의 한국어 conversational
  // 응답 패턴). 마크다운 → HTML 변환해서 같은 적용 버튼으로 라우팅.
  let markdownFallback = false;
  if (!htmlPayload && !isUser && !streaming && onApplyHtml) {
    const hasToolEntries =
      message.toolEntries && message.toolEntries.length > 0;
    if (!hasToolEntries) {
      const md = markdownToHtml(message.content);
      if (md) {
        htmlPayload = md.html;
        markdownFallback = true;
      }
    }
  }
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
  // chunk 99 follow-up — outline-aware section replace detection. When
  // the AI's HTML starts with a heading whose section number ("2.7.4")
  // matches an existing outline entry, we offer a replace path instead
  // of paste-at-caret. Avoids duplicate sections.
  const sectionMatch = useMemo(() => {
    if (!htmlPayload || !onApplyHtmlReplaceSection || !getOutline) return null;
    try {
      const outline = getOutline();
      if (!outline || outline.length === 0) return null;
      return findSectionToReplace(outline, htmlPayload);
    } catch (err) {
      console.warn('[chat] findSectionToReplace failed:', err);
      return null;
    }
  }, [htmlPayload, onApplyHtmlReplaceSection, getOutline]);
  const handleApply = useCallback(() => {
    if (!htmlPayload) return;
    if (sectionMatch && onApplyHtmlReplaceSection) {
      onApplyHtmlReplaceSection(htmlPayload, {
        startParaIdx: sectionMatch.startParaIdx,
        endParaIdxExclusive: sectionMatch.endParaIdxExclusive,
      });
    } else if (onApplyHtml) {
      onApplyHtml(htmlPayload);
    } else {
      return;
    }
    setApplied(true);
    setUndone(false);
    if (appliedTimerRef.current) clearTimeout(appliedTimerRef.current);
    appliedTimerRef.current = setTimeout(
      () => setApplied(false),
      APPLIED_TOAST_MS,
    );
  }, [
    htmlPayload,
    sectionMatch,
    onApplyHtmlReplaceSection,
    onApplyHtml,
    appliedTimerRef,
    APPLIED_TOAST_MS,
  ]);
  // chunk 99 follow-up — 자동 적용. plan mode 가 아닌 일반 응답에서
  // ```html``` / markdown fallback / sectionMatch 가 결정되면 한 번만
  // dispatch. 사용자가 만족 못하면 stop / undo (⌘Z).
  //
  // 0.4.6 fix: markdown fallback 은 sectionMatch (`### N.N.N ...` 같은
  // 섹션 번호 heading) 가 매칭됐을 때만 자동 적용. read-only agent loop
  // 의 informational 마무리 (옵션 나열 / 질문 / 안내 같은 conversational
  // 답변) 가 markdownToHtml 변환을 통과해도 sectionMatch 가 없으면
  // 적용되지 않음. 사용자 의도가 "조회" 였는데 doc 이 mutate 되던 회귀
  // (사업계획서 "다 채워졌는지 확인해줘" 류) fix. 명시적 ```html``` 블록
  // 은 의도적 payload 라 이전 동작 유지.
  const autoAppliedRef = useRef(false);
  useEffect(() => {
    if (autoAppliedRef.current) return;
    if (isUser || streaming) return;
    if (message.planMode) return;
    if (!htmlPayload) return;
    if (markdownFallback && !sectionMatch) return;
    autoAppliedRef.current = true;
    // microtask 양보 — setState 가 effect 본체에서 직접 발생하지 않게.
    queueMicrotask(handleApply);
  }, [
    isUser,
    streaming,
    message.planMode,
    htmlPayload,
    markdownFallback,
    sectionMatch,
    handleApply,
  ]);
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
  const handlePatchAcceptAll = useCallback((): void => {
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
  }, [patchesParsed, onApplyPatches, patchStatuses, showPatchToast]);
  // chunk 99 follow-up — patches 자동 acceptAll. plan mode 가 아닌
  // 일반 응답에서 ahwp-patches 블록이 도착하고 처음 mount 될 때 한 번
  // 만 dispatch. Diff 카드는 기록 + 되돌리기 용도로 노출 유지.
  const autoAcceptedPatchesRef = useRef(false);
  useEffect(() => {
    if (autoAcceptedPatchesRef.current) return;
    if (isUser || streaming) return;
    if (message.planMode) return;
    if (!patchesParsed?.ok || patchCount === 0) return;
    autoAcceptedPatchesRef.current = true;
    queueMicrotask(handlePatchAcceptAll);
  }, [
    isUser,
    streaming,
    message.planMode,
    patchesParsed,
    patchCount,
    handlePatchAcceptAll,
  ]);

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
  const handleRunTools = async () => {
    if (!toolsParsed || !toolsParsed.ok || !onRunTools) return;
    const results = await onRunTools(toolsParsed.items);
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
            {groupToolEntries(message.toolEntries).map((g) =>
              g.kind === 'read-group' ? (
                <ReadGroup
                  key={g.id}
                  entries={g.entries}
                  onResolveApproval={onResolveApproval ?? null}
                />
              ) : (
                <ToolEntryRow
                  key={g.entry.id}
                  entry={g.entry}
                  onResolveApproval={onResolveApproval ?? null}
                />
              ),
            )}
            {/* 모두 승인 / 거절 — pending 이 둘 이상일 때만 보임. */}
            {(() => {
              const pendingIds = (message.toolEntries ?? [])
                .filter((te) => te.status === 'pending')
                .map((te) => te.id);
              if (pendingIds.length < 2 || !onResolveApproval) return null;
              return (
                <div
                  className="mt-1 flex gap-1"
                  data-testid="chat-tool-bulk-approve-bar"
                >
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      for (const id of pendingIds)
                        void onResolveApproval(id, true);
                    }}
                    data-testid="chat-tool-approve-all"
                    className="h-6 px-2 text-[10px]"
                  >
                    모두 승인 ({pendingIds.length})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      for (const id of pendingIds)
                        void onResolveApproval(id, false);
                    }}
                    data-testid="chat-tool-reject-all"
                    className="h-6 px-2 text-[10px]"
                  >
                    모두 거절
                  </Button>
                </div>
              );
            })()}
          </div>
        ) : null}
        {/* chunk 99 follow-up — plan mode 응답에 "이 계획대로 실행"
          버튼. 클릭 시 plan mode 토글 off + 직전 user prompt 를 다시
          새 turn 으로 발사. ChatPanel 의 onExecutePlan 이 그 플로우를
          orchestrate. streaming 중엔 숨김 (plan 작성 중). */}
        {!isUser && !streaming && message.planMode && onExecutePlan ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={onExecutePlan}
              data-testid="chat-action-execute-plan"
              className="text-xs"
              title="Plan 모드를 끄고 위 계획을 실제로 적용합니다 (write tool 호출 활성)."
            >
              ▶ 이 계획대로 실행
            </Button>
            <span className="text-[10px] text-muted-foreground">
              Plan mode — write 도구 차단 상태
            </span>
          </div>
        ) : null}
        {/* chunk 99 follow-up — 자동 적용. plan mode 가 아니면 useEffect
          가 한 번 자동 dispatch (no-op button). plan mode 에선 인디케이터
          + execute button 으로 수동 흐름 유지. 자동 적용 후 ✓ 토스트만
          간략히 표시 — 사용자가 ⌘Z 로 undo 가능. */}
        {htmlPayload && !message.planMode ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
            {applied && !undone ? (
              <>
                <span data-testid="chat-action-applied-toast">
                  ✓{' '}
                  {sectionMatch
                    ? `기존 ${sectionMatch.sectionNumber} 섹션 교체 적용됨`
                    : markdownFallback
                      ? '마크다운 자동 적용됨'
                      : 'HTML 자동 적용됨'}
                </span>
                {onUndoApply ? (
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
              </>
            ) : (
              <span>적용 중…</span>
            )}
          </div>
        ) : null}
        {htmlPayload && message.planMode ? (
          /* plan mode 일 때만 명시적 버튼 — 사용자가 검토 후 적용. */
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
            <Button
              type="button"
              size="sm"
              variant={applied ? 'secondary' : 'default'}
              onClick={handleApply}
              data-testid="chat-action-apply-html"
              data-markdown-fallback={markdownFallback ? 'true' : 'false'}
              data-section-match={
                sectionMatch ? sectionMatch.sectionNumber : ''
              }
              className="text-xs"
              title={
                sectionMatch
                  ? `기존 "${sectionMatch.headingText}" 섹션 을 응답 내용으로 교체합니다.`
                  : markdownFallback
                    ? '응답의 마크다운 형식을 HTML 로 변환해서 활성 문서에 적용합니다.'
                    : '응답에 포함된 HTML 블록을 활성 문서에 적용합니다.'
              }
            >
              {applied
                ? undone
                  ? '✓ 되돌림'
                  : '✓ 적용됨'
                : sectionMatch
                  ? `기존 ${sectionMatch.sectionNumber} 섹션 교체`
                  : markdownFallback
                    ? '마크다운 적용'
                    : '문서에 적용'}
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
        {/* Q5 Diff Viewer — render patches block as Accept/Reject cards.
          chunk 99 follow-up — react-dom createPortal 로 가운데 (Studio)
          패널의 #ahwp-editor-diff-overlay 컨테이너에 떠 있도록 라우팅.
          chat 안엔 작은 hint 만 남기고 실제 카드는 에디터 위에 sticky.
          포털 target 이 mount 안 됐으면 (e2e 초기 / 미분기 환경) 기존
          chat-side 인라인 fallback 으로 렌더. */}
        {patchesParsed && patchesParsed.ok && patchCount > 0
          ? (() => {
              const cards = (
                <div
                  className="pointer-events-auto rounded-md border border-border bg-card px-3 py-2 shadow-lg"
                  data-testid="chat-patches-block"
                  data-message-id={message.id}
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
              );
              const target =
                typeof document !== 'undefined'
                  ? document.getElementById('ahwp-editor-diff-overlay')
                  : null;
              if (target) {
                return (
                  <>
                    {createPortal(cards, target)}
                    <div
                      className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-[11px] text-amber-700 dark:text-amber-300"
                      data-testid="chat-patches-hint"
                    >
                      📋 {patchCount}개 변경 제안 — 에디터 우측 카드에서 검토
                    </div>
                  </>
                );
              }
              // Fallback: target 미마운트 시 inline.
              return (
                <div className="mt-2 border-t border-border pt-2">{cards}</div>
              );
            })()
          : null}
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

/**
 * 0.4.17 — Claude Code 식 tool entry grouping. 인접한 read entries 는
 * 하나의 ReadGroup 으로 접고, write entries 는 카드로 단독 렌더.
 * 정렬 보존 + write 가 read run 을 끊는 동작 보장.
 */
type ToolEntryGroup =
  | { kind: 'read-group'; id: string; entries: UiToolEntry[] }
  | { kind: 'write'; entry: UiToolEntry };

function groupToolEntries(entries: UiToolEntry[]): ToolEntryGroup[] {
  const out: ToolEntryGroup[] = [];
  let buffer: UiToolEntry[] = [];
  const flush = (): void => {
    if (buffer.length === 0) return;
    out.push({ kind: 'read-group', id: `rg-${buffer[0].id}`, entries: buffer });
    buffer = [];
  };
  for (const e of entries) {
    if (e.kind === 'read') {
      buffer.push(e);
    } else {
      flush();
      out.push({ kind: 'write', entry: e });
    }
  }
  flush();
  return out;
}

/**
 * 0.4.17 — 인접한 read tool 호출들을 하나의 접힘 row 로 표시.
 * 진행중: "🔍 자료 수집 중 (n)". 완료: "✓ 자료 수집 (n)" + 펼치기.
 * 펼치면 개별 ToolEntryRow (read 스타일).
 */
function ReadGroup({
  entries,
  onResolveApproval,
}: {
  entries: UiToolEntry[];
  onResolveApproval: ((id: string, accept: boolean) => void) | null;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const running = entries.some((e) => e.status === 'running');
  const failed = entries.filter((e) => e.status === 'failed').length;
  const total = entries.length;
  const summary = running
    ? `자료 수집 중 (${total})`
    : failed > 0
      ? `자료 수집 (${total - failed}/${total} 성공)`
      : `자료 수집 (${total})`;
  return (
    <div
      data-testid="chat-tool-read-group"
      data-tool-status={running ? 'running' : failed > 0 ? 'failed' : 'ok'}
      data-count={total}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid="chat-tool-read-group-toggle"
        data-expanded={expanded ? 'true' : 'false'}
        className={cn(
          'flex w-full min-w-0 items-center gap-2 rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground/80 hover:bg-muted/40 hover:text-muted-foreground',
          failed > 0 && 'text-destructive/80',
        )}
        aria-label={expanded ? '읽기 그룹 접기' : '읽기 그룹 펼치기'}
      >
        <span className="shrink-0">
          {running ? '⏳' : failed > 0 ? '⚠' : '✓'}
        </span>
        <span className="shrink-0">🔍</span>
        <span className="min-w-0 flex-1 truncate italic">{summary}</span>
        <span className="shrink-0 text-[10px]">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded ? (
        <div
          className="mt-1 flex flex-col gap-0.5 border-l border-border/40 pl-2"
          data-testid="chat-tool-read-group-detail"
        >
          {entries.map((e) => (
            <ToolEntryRow
              key={e.id}
              entry={e}
              onResolveApproval={onResolveApproval}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 0.4.11 — 한 줄 tool 호출 row + 확장 가능한 result 패널.
 * 한 row 에 status icon / 🔧 / name / argsPreview (truncate) / chevron.
 * chevron 클릭 시 result preview (JSON or status string) 가 monospace
 * panel 로 펼쳐짐. 결과가 없으면 (running / pending) chevron 숨김.
 *
 * 0.4.17 — kind='read' 는 dim한 muted 한 줄, kind='write' 는 강조 카드.
 */
function ToolEntryRow({
  entry,
  onResolveApproval,
}: {
  entry: UiToolEntry;
  onResolveApproval: ((id: string, accept: boolean) => void) | null;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const hasDetail =
    entry.resultPreview !== undefined && entry.resultPreview.length > 0;
  const statusGlyph =
    entry.status === 'running'
      ? '⏳'
      : entry.status === 'ok'
        ? '✓'
        : entry.status === 'pending'
          ? '⏸'
          : entry.status === 'rejected'
            ? '↩'
            : '✗';
  const isWrite = entry.kind === 'write';
  return (
    <div
      data-testid="chat-tool-entry"
      data-tool-name={entry.name}
      data-tool-status={entry.status}
      data-tool-kind={entry.kind}
      title={entry.reason ?? ''}
      className={cn(
        isWrite &&
          'rounded border border-border/60 bg-muted/30 px-2 py-1.5 shadow-xs',
      )}
    >
      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
          isWrite ? 'font-mono' : 'font-mono text-[11px]',
          entry.status === 'failed' && 'text-destructive',
        )}
      >
        <span
          className={cn(
            'shrink-0',
            entry.status === 'failed'
              ? 'text-destructive'
              : isWrite
                ? 'text-foreground/80'
                : 'text-muted-foreground/70',
          )}
        >
          {statusGlyph}
        </span>
        <span
          className={cn(
            'shrink-0',
            isWrite ? 'font-semibold' : 'font-medium text-muted-foreground/80',
          )}
        >
          {isWrite ? '✏️' : '🔍'} {entry.name}
        </span>
        <span
          className={cn(
            'min-w-0 flex-1 truncate',
            entry.status === 'failed'
              ? 'text-destructive/80'
              : isWrite
                ? 'text-muted-foreground'
                : 'text-muted-foreground/60',
          )}
        >
          {entry.argsPreview}
          {entry.status === 'failed' && entry.reason
            ? ` — ${entry.reason}`
            : ''}
        </span>
        {hasDetail ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            data-testid="chat-tool-expand"
            data-expanded={expanded ? 'true' : 'false'}
            className="shrink-0 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={expanded ? '결과 접기' : '결과 펼치기'}
            title={expanded ? '결과 접기' : '결과 펼치기'}
          >
            {expanded ? '▼' : '▶'}
          </button>
        ) : null}
        {entry.status === 'pending' && onResolveApproval ? (
          <span className="ml-auto flex shrink-0 gap-1">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={() => void onResolveApproval(entry.id, true)}
              data-testid="chat-tool-approve"
              className="h-6 px-2 text-[10px]"
            >
              승인
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void onResolveApproval(entry.id, false)}
              data-testid="chat-tool-reject"
              className="h-6 px-2 text-[10px]"
            >
              거절
            </Button>
          </span>
        ) : null}
      </div>
      {expanded && hasDetail ? (
        <pre
          data-testid="chat-tool-result"
          className="mt-1 max-h-60 overflow-auto rounded border border-border/50 bg-muted/30 p-2 text-[10px] leading-relaxed"
        >
          {entry.resultPreview}
        </pre>
      ) : null}
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
      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}
