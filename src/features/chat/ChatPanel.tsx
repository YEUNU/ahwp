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
import {
  getAhwpToolCatalog,
  parseToolBlock,
  validateToolCall,
  type AhwpPreflightItem,
  type AhwpToolResult,
} from '@shared/ai-tools';
import {
  EXCERPT_HARD_CHAR_LIMIT,
  EXCERPT_SOFT_CHAR_LIMIT,
  hashText,
  type ExcerptAttachment,
  type ExcerptStatus,
  type TextRange,
} from '@shared/ai-excerpt';
import type { AiChatHandle } from '@shared/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MessageContent } from './MessageContent';
import { previewArgs } from './tools';

type ChatProviderId = Extract<ProviderId, 'openai' | 'nvidia' | 'google'>;

const PROVIDER_OPTIONS: { id: ChatProviderId; label: string }[] = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'nvidia', label: 'NVIDIA NIM' },
  { id: 'google', label: 'Google (Gemini)' },
];

const DEFAULT_MODELS: Record<ChatProviderId, string> = {
  openai: 'gpt-4o-mini',
  nvidia: 'meta/llama-3.1-70b-instruct',
  google: 'gemini-2.0-flash',
};

const STORAGE_PROVIDER = 'ahwp:chat:provider';
const STORAGE_MODELS = 'ahwp:chat:models';
const STORAGE_CHAT_MODE = 'ahwp:chat:mode';

export type ChatMode = 'manual' | 'agent';

/** Phase 3 — Agent 한 turn당 tool 호출 cap. 무한 루프 방어. */
const AGENT_MAX_TOOLS_PER_TURN = 10;

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

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadProvider(): ChatProviderId {
  try {
    const raw = localStorage.getItem(STORAGE_PROVIDER);
    if (raw === 'openai' || raw === 'nvidia' || raw === 'google') return raw;
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
   * Run a pre-flighted ahwp-tools op list against the active doc — chunk 19.
   * Wraps `runTools` from src/features/chat/tools.ts. Surfaced as a
   * "도구 실행" button on assistant messages that contain
   * ```ahwp-tools``` JSON blocks.
   */
  runTools?: (items: AhwpPreflightItem[]) => AhwpToolResult[];
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

const SYSTEM_PROMPT_DOC_CONTEXT = `너는 한컴 한글 문서 어시스턴트야. 사용자의 요청을 두 가지 코드 블록 중 하나(또는 둘 다)로 표현해서 응답해. 사용자가 코드 블록을 한 번의 클릭으로 문서에 적용해.

[A] 흐르는 글자/문단 양식 → \`\`\`html ... \`\`\` 한 블록만:
- 단락 정렬: <p style="text-align: left|center|right|justify;">...</p>
- 줄 간격: <p style="line-height: 1.5;"> (배수, 1.0/1.15/1.5/2.0/3.0)
- 문단 들여쓰기: <p style="margin-left: 30px;">
- 첫 줄 들여쓰기: <p style="text-indent: 20pt;">
- 문단 위/아래 간격: <p style="margin-top: 12px; margin-bottom: 6px;">
- 글자 서식: <strong>, <em>, <u>, <s>, <span style="color:#ff0000;font-size:14pt;">
- 표: <table><tr><td>...</td></tr></table>

[B] 한컴 컨트롤 객체(각주·머리말·책갈피·페이지 설정·스타일·도형) → \`\`\`ahwp-tools ... \`\`\` 한 블록 (JSON):
{
  "ops": [
    { "tool": "applyHtml",          "args": { "html": "<p style='text-align:center;'>제목</p>" } },
    { "tool": "applyAlignment",     "args": { "align": "left|center|right|justify" } },
    { "tool": "applyFontSize",      "args": { "pt": 12 } },
    { "tool": "applyTextColor",     "args": { "hex": "#RRGGBB" } },
    { "tool": "toggleCharFormat",   "args": { "key": "bold|italic|underline" } },
    { "tool": "insertFootnote",     "args": { "text": "각주 본문" } },
    { "tool": "addBookmark",        "args": { "name": "section1" } },
    { "tool": "setHeaderFooterText","args": { "sectionIdx": 0, "isHeader": true, "applyTo": 0, "text": "머리말 텍스트" } },
    { "tool": "applyPageDef",       "args": { "props": { "landscape": true } } },
    { "tool": "createNamedStyle",   "args": { "name": "본문2", "englishName": "Body2" } },
    { "tool": "createRectShape",    "args": { "widthHwpunit": 5670, "heightHwpunit": 2835 } }
  ]
}

분리 기준: 양식(정렬/간격/글자 서식/표) = [A] HTML, 컨트롤 객체 = [B] ahwp-tools. 같은 일을 두 갈래로 보내지 마. 각 형식은 응답에 최대 한 블록만 포함해. 코드 블록 외에 짧은 설명을 함께 써도 돼.`;

/**
 * Phase 3 chunk 51 — Agent 모드 system prompt 추가. provider tool-use
 * API 가 활성일 때 (`chatMode === 'agent'`) 만 inject. 양식 매칭 워크
 * 플로우 (read → reason → write) 와 우선순위 (applyStyle > applyParaProps
 * > applyHtml) 를 모델에 가이드.
 */
const SYSTEM_PROMPT_AGENT_GUIDE = `너는 한컴 한글 문서 편집 Agent. 도구 호출 능력이 있어.

#### 워크플로우 — 양식 매칭이 필요한 작업 (사용자가 "내 주장 추가" / "이 단락처럼 작성" 같이 막연하게 말할 때)

1. **읽기**: \`getCaretPosition\`/\`getDocumentOutline\` → 위치 결정. \`getStyleAt\`+\`getParaPropertiesAt\` → 인접 단락의 양식 파악. 필요하면 \`findInDocument\` 로 근거/인용 위치 찾기.
2. **추론**: 사용자 의도 + 읽은 양식 → 어떤 styleId 사용할지 / 어떤 props 매칭할지 결정.
3. **쓰기**: 우선순위 — \`applyStyle\` (named style id) > \`applyParaProps\`/\`applyCharFormat\` (props 직접) > \`applyHtml\` (sledgehammer). 같은 양식 매칭의 가독성과 회귀 안전성 측면에서 named style 이 베스트.

#### 도구 호출 원칙

- 모르는 좌표를 추측하지 마. 먼저 read tool 로 확인.
- 한 turn 안 호출 한도 10. 무한 read 루프 방지. 불필요한 read 는 생략.
- 부분 성공 OK — 한 op 실패해도 다음 op 계속. 사용자에게 결과 toast 로 표시됨.
- write tool 은 모두 묶음 undo (turn 전체 ⌘Z 1회 롤백).

#### 흔한 실수

- \`applyHtml\` 만으로 모든 변경 처리 — 가능하지만 named style 매칭이 깨짐. 인접 단락 스타일을 모를 땐 먼저 \`getStyleAt\` 호출.
- 좌표 추측 — paragraphIdx 0 부터 시작하는 0-indexed. \`getCaretPosition\` 으로 현재 위치를 확인하거나, \`getDocumentOutline\` 으로 제목 좌표를 받아서 사용.
- 셀 편집 직진 — 표 안 작업은 \`getCellInfo\` 로 병합 상태 확인 후 진행.

응답에는 코드 블록을 쓰지 마 (Manual 모드 형식). Agent 모드는 도구를 직접 호출하고, 텍스트는 사용자에게 설명/요약만.`;

/** Collect `{ label, outline }` for each reference doc the user has
 * opted in — chunk 21. Filters out paths that no longer correspond to
 * an open tab (closed since the user checked it) and active-tab paths
 * (target is implicit, never a reference). */
function collectReferenceOutlines(
  referencePaths: string[],
  getOpenDocs?: () => { path: string; label: string; isActive: boolean }[],
  getDocOutline?: (path: string) => string,
): { label: string; outline: string }[] {
  if (!getOpenDocs || !getDocOutline || referencePaths.length === 0) return [];
  const docs = getOpenDocs();
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const out: { label: string; outline: string }[] = [];
  for (const path of referencePaths) {
    const meta = byPath.get(path);
    if (!meta || meta.isActive) continue;
    const outline = getDocOutline(path);
    if (outline.length === 0) continue;
    out.push({ label: meta.label, outline });
  }
  return out;
}

/** Serialize references into the system prompt — chunk 21. Read-only
 * by contract; the system prompt explicitly forbids modification. */
function buildReferenceSystemBlock(
  refs: { label: string; outline: string }[],
): string {
  const lines: string[] = ['[참조 문서]:'];
  refs.forEach((r, i) => {
    lines.push(`[ref ${i + 1}] doc="${r.label}" (read-only)`);
    lines.push(r.outline);
    lines.push('');
  });
  lines.push(
    '참조 규칙: [참조 문서]는 읽기·인용·문체 분석만 허용. 절대 수정 대상으로 삼지 마. 변경 적용 (` ```html``` ` / ` ```ahwp-tools``` `) 은 활성 문서(target)에만 한다.',
  );
  return lines.join('\n');
}

/** Serialize chips into the system message for chunk 20. The block
 * mirrors the spec in `docs/AI_INTEGRATION.md` §발췌 드래그 첨부 ›
 * 프롬프트 직렬화: numbered entries with role/doc/anchor metadata so
 * the model can refer to "[1]" without ambiguity. */
function buildExcerptSystemPrompt(excerpts: ExcerptAttachment[]): string {
  const lines: string[] = [SYSTEM_PROMPT_DOC_CONTEXT, '', '[발췌]:'];
  excerpts.forEach((ex, i) => {
    lines.push(
      `[${i + 1}] role=${ex.role}  doc="${ex.docLabel}"  anchor={para:${ex.anchor.startParagraphIndex}${ex.anchor.endParagraphIndex !== ex.anchor.startParagraphIndex ? `..${ex.anchor.endParagraphIndex}` : ''}, [${ex.anchor.startOffset},${ex.anchor.endOffset}]}`,
    );
    lines.push(`    "${ex.text.replace(/\s+/g, ' ').trim()}"`);
  });
  lines.push('');
  lines.push(
    '발췌 규칙: 사용자가 "이 단락"이라고 하면 [발췌]의 첫 항목을 가리킴. 변경 대상은 role=target 발췌만. role=reference는 인용·문체 참고용으로만 읽고 절대 수정 대상으로 삼지 마.',
  );
  return lines.join('\n');
}

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
    // chunk 26 — history list for the popover. Loaded on demand when
    // the user opens the dropdown; refreshed after rename/delete.
    const [historyList, setHistoryList] = useState<
      {
        id: number;
        docPath: string | null;
        title: string;
        updatedAt: number;
      }[]
    >([]);
    const [historyOpen, setHistoryOpen] = useState(false);
    // chunk 21 — paths the user opted in as references. Active tab is
    // implicit target (always included) and never appears in this set.
    // Stored as an array (not Set) so React equality is straightforward.
    const [referencePaths, setReferencePaths] = useState<string[]>([]);
    const handleRef = useRef<AiChatHandle | null>(null);
    const scrollerRef = useRef<HTMLDivElement>(null);
    const assistantIdRef = useRef<string | null>(null);

    const model = models[provider];

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

    /** Buffer the assistant's streamed text so we can persist it once
     * — chunk 26. setMessages would also work but reading state from
     * onEvent (a useCallback with [] deps) requires an extra ref hop;
     * a local string ref is cleaner.
     */
    const assistantBufferRef = useRef('');

    // Phase 3 — Agent 한 turn 내 누적 상태. fireChat → onEvent → fireChat
    // 재귀 호출 사이를 잇는다. chatMode='agent' 진입 시 reset.
    const agentToolUsesRef = useRef<
      { id: string; name: string; args: unknown }[]
    >([]);
    const agentTurnDepthRef = useRef(0);
    const agentVerifiedExcerptsRef = useRef<ExcerptAttachment[]>([]);
    // fireChat 자체가 useCallback이라 onEvent에서 직접 호출하면 stale
    // closure. ref hop으로 회피.
    const fireChatRef = useRef<
      | ((history: UiMessage[], verifiedExcerpts?: ExcerptAttachment[]) => void)
      | null
    >(null);
    // runTools prop을 ref로 mirror — onEvent 안에서 stale 없이 접근.
    const runToolsPropRef = useRef(runTools);
    useEffect(() => {
      runToolsPropRef.current = runTools;
    }, [runTools]);

    /**
     * chunk 31 — 자동 제목 요약. 대화의 메시지 4개 이상 누적 후 1회만
     * 호출. 대화의 user/assistant 메시지를 모아 짧은 system prompt와
     * 함께 보내고 응답 텍스트 첫 줄을 30자 이내 trim → renameConversation.
     *
     * - 같은 conversationId에 대해 한 번만 (autoTitledConvIdsRef로 dedup).
     * - 모든 실패는 silent — 첫 user 메시지 60자 truncated title이 유지.
     * - 사용자 진행 중인 chat과 별도 IPC 호출 (window.api.ai.chat) — abort
     *   handle은 잡지 않음 (5단어 응답이라 곧 끝남).
     */
    const refreshHistoryRef = useRef<(() => Promise<void>) | null>(null);
    const maybeAutoTitle = useCallback(
      (convId: number, finalMessages: UiMessage[]): void => {
        if (autoTitledConvIdsRef.current.has(convId)) return;
        if (finalMessages.length < 4) return;
        autoTitledConvIdsRef.current.add(convId);
        const provNow = providerRef.current;
        const modelNow = modelRef.current;
        if (!modelNow || modelNow.length === 0) return;
        const transcript = finalMessages
          .map(
            (m) =>
              `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`,
          )
          .join('\n')
          .slice(0, 4000);
        const req: ChatRequest = {
          provider: provNow,
          model: modelNow,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                '다음은 사용자와 AI의 대화 일부야. 이 대화의 핵심 주제를 한국어 5단어 이내의 명사구로 요약해줘. 따옴표나 마침표 없이 본문만 출력. 예: "표 합계 행 추가", "이미지 정렬 문의".',
            },
            { role: 'user', content: transcript },
          ],
        };
        let buf = '';
        try {
          window.api.ai.chat(req, {
            onEvent: (evt) => {
              if (evt.type === 'text-delta') {
                buf += evt.text;
                return;
              }
              if (evt.type === 'done') {
                const title = buf
                  .split('\n')[0]
                  .replace(/^["'`「『\s]+|["'`」』.\s]+$/g, '')
                  .slice(0, 30);
                if (title.length === 0) return;
                void window.api.chatHistory
                  .rename(convId, title)
                  .then(() => refreshHistoryRef.current?.())
                  .catch((err: unknown) =>
                    console.warn('[chat] auto-title rename failed', err),
                  );
              } else if (evt.type === 'error') {
                console.warn('[chat] auto-title stream error', evt.message);
              }
            },
          });
        } catch (err) {
          console.warn('[chat] auto-title chat failed', err);
        }
      },
      [],
    );

    const onEvent = useCallback(
      (evt: ChatStreamEvent) => {
        if (evt.type === 'text-delta') {
          // Capture the id eagerly: the setMessages updater may run later in a
          // React batch, by which point a terminal event might have cleared
          // assistantIdRef. Reading it inside the updater drops late deltas.
          const id = assistantIdRef.current;
          if (!id) return;
          assistantBufferRef.current += evt.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === id ? { ...m, content: m.content + evt.text } : m,
            ),
          );
          return;
        }
        // Phase 3 — tool-use 이벤트. assistant 메시지 안에 inline tool
        // 호출 row 표시. dispatch는 done 까지 누적했다가 한 번에 (provider
        // 가 한 turn 안 여러 호출을 모두 emit 한 후 finishReason).
        if (evt.type === 'tool-use') {
          const id = assistantIdRef.current;
          agentToolUsesRef.current.push({
            id: evt.id,
            name: evt.name,
            args: evt.args,
          });
          if (id) {
            const argsPreview = (() => {
              try {
                const json = JSON.stringify(evt.args);
                return json.length > 80 ? `${json.slice(0, 80)}…` : json;
              } catch {
                return '<unserializable>';
              }
            })();
            const entry: UiToolEntry = {
              id: evt.id,
              name: evt.name,
              argsPreview,
              status: 'running',
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === id
                  ? { ...m, toolEntries: [...(m.toolEntries ?? []), entry] }
                  : m,
              ),
            );
          }
          return;
        }
        if (evt.type === 'error') {
          setError(evt.message);
        }
        // chunk 26 — persist the assistant turn (best-effort). Errors here
        // are logged but don't surface to the user; a chat history blip
        // shouldn't block the conversation flow.
        const convId = conversationIdRef.current;
        const buf = assistantBufferRef.current;
        if (convId !== null && buf.length > 0) {
          void window.api.chatHistory
            .append(convId, 'assistant', buf)
            .catch((err: unknown) =>
              console.warn('[chat] history.append assistant failed', err),
            );
          // chunk 31 — auto-title trigger. setMessages updater로 prev (현재
          // assistant turn 이 들어간 messages) 길이를 보고 4 이상이면 1회.
          setMessages((prev) => {
            maybeAutoTitle(convId, prev);
            return prev;
          });
        }

        // Phase 3 — Agent 루프. done 시점에 finishReason='tool_calls' 면
        // 누적된 tool-use 들을 dispatch 하고 결과를 새 메시지로 추가한 뒤
        // fireChat 재귀. cap 도달 시 강제 종료.
        const isAgentTurn =
          chatModeRef.current === 'agent' &&
          evt.type === 'done' &&
          (evt.finishReason === 'tool_calls' ||
            agentToolUsesRef.current.length > 0);
        if (isAgentTurn && agentToolUsesRef.current.length > 0) {
          const toolUses = agentToolUsesRef.current;
          agentToolUsesRef.current = [];
          const assistantId = assistantIdRef.current;
          // assistant 메시지 finalize — toolUses 채움.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    toolUses: toolUses.map((t) => ({
                      id: t.id,
                      name: t.name,
                      args: t.args,
                    })),
                  }
                : m,
            ),
          );
          // dispatch 각 tool — validate + runTools (단일 op group).
          const dispatcher = runToolsPropRef.current;
          const toolResults: {
            id: string;
            name: string;
            ok: boolean;
            reason?: string;
            /** Phase 3 chunk 51 — read tool 결과. JSON 직렬화해서 모델에
             *  회신. write tool 은 undefined. */
            data?: unknown;
          }[] = [];
          for (const tu of toolUses) {
            const v = validateToolCall({ tool: tu.name, args: tu.args });
            if (!v.ok) {
              toolResults.push({
                id: tu.id,
                name: tu.name,
                ok: false,
                reason: v.reason,
              });
              continue;
            }
            if (!dispatcher) {
              toolResults.push({
                id: tu.id,
                name: tu.name,
                ok: false,
                reason: 'dispatcher-unavailable',
              });
              continue;
            }
            const out = dispatcher([{ ok: true, call: v.value }]);
            const first = out[0];
            if (first && first.ok) {
              toolResults.push({
                id: tu.id,
                name: tu.name,
                ok: true,
                data: first.data,
              });
            } else {
              toolResults.push({
                id: tu.id,
                name: tu.name,
                ok: false,
                reason: first?.ok === false ? first.reason : 'unknown',
              });
            }
          }
          // UI tool-entry 상태 업데이트.
          if (assistantId) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== assistantId || !m.toolEntries) return m;
                return {
                  ...m,
                  toolEntries: m.toolEntries.map((te) => {
                    const r = toolResults.find((x) => x.id === te.id);
                    if (!r) return te;
                    return {
                      ...te,
                      status: r.ok ? 'ok' : 'failed',
                      reason: r.reason,
                    };
                  }),
                };
              }),
            );
          }
          // 다음 turn 호출 — cap 검사.
          agentTurnDepthRef.current += 1;
          if (agentTurnDepthRef.current >= AGENT_MAX_TOOLS_PER_TURN) {
            setError(
              `Agent: 한 턴 도구 호출 한계 (${AGENT_MAX_TOOLS_PER_TURN}) 도달.`,
            );
            agentTurnDepthRef.current = 0;
            agentVerifiedExcerptsRef.current = [];
            assistantBufferRef.current = '';
            setStreaming(false);
            handleRef.current = null;
            assistantIdRef.current = null;
            return;
          }
          // 새 history — 현재 메시지 (위 setMessages가 반영됐다고 가정)
          // + tool result 메시지들. setMessages prev로 안전하게 접근.
          setMessages((prev) => {
            const toolMsgs: UiMessage[] = toolResults.map((r) => {
              // Phase 3 chunk 51 — read tool 결과는 JSON 직렬화해서 모델
              // 에 회신 (read 결과를 다음 turn 의 reasoning input 으로 사용).
              // 4096B cap — 거대 dump 차단.
              let content: string;
              if (r.ok) {
                if (r.data !== undefined) {
                  let json: string;
                  try {
                    json = JSON.stringify(r.data);
                  } catch {
                    json = String(r.data);
                  }
                  if (json.length > 4096) json = json.slice(0, 4096) + '…';
                  content = json;
                } else {
                  content = `ok: ${r.name}`;
                }
              } else {
                content = `error: ${r.reason ?? '?'}`;
              }
              return {
                id: newId(),
                role: 'tool' as const,
                content,
                toolResult: { id: r.id, content, isError: !r.ok },
              };
            });
            const next = [...prev, ...toolMsgs];
            // Recurse — setMessages 반환 후 fireChat이 새 assistant 메시지
            // 를 더 추가. agentToolUsesRef는 이미 비웠으니 다음 stream에서
            // 재누적.
            queueMicrotask(() => {
              fireChatRef.current?.(next, agentVerifiedExcerptsRef.current);
            });
            return next;
          });
          // streaming flag는 keep on — 다음 fireChat이 다시 set true.
          // assistantIdRef는 다음 fireChat이 새 id 발급.
          assistantBufferRef.current = '';
          handleRef.current = null;
          assistantIdRef.current = null;
          return;
        }

        // 정상 종료 (manual 모드 또는 agent의 finishReason='stop').
        agentTurnDepthRef.current = 0;
        agentToolUsesRef.current = [];
        agentVerifiedExcerptsRef.current = [];
        assistantBufferRef.current = '';
        setStreaming(false);
        handleRef.current = null;
        assistantIdRef.current = null;
      },
      [maybeAutoTitle],
    );

    /**
     * Append a fresh assistant bubble to `history` and start streaming the
     * provider's response into it. `history` should already end in the user
     * message that the assistant is replying to. The optional
     * `verifiedExcerpts` arg is the chip list after `send`'s stale check;
     * passed in so we serialize exactly what the user is committing to,
     * not whatever excerpts state happens to be by the time React has
     * batched updates through.
     */
    const fireChat = useCallback(
      (history: UiMessage[], verifiedExcerpts: ExcerptAttachment[] = []) => {
        setError(null);
        const assistantMsg: UiMessage = {
          id: newId(),
          role: 'assistant',
          content: '',
        };
        assistantIdRef.current = assistantMsg.id;
        setMessages([...history, assistantMsg]);
        setStreaming(true);

        // Build provider-bound message list. The system message
        // composition picks one of three context strategies for the
        // *target* doc (the active tab):
        //   (1) excerpts present  → `[발췌]:` block, narrowly anchored
        //   (2) attach toggle on  → `[현재 문서]:` whole-doc HTML
        //   (3) neither           → no target body in prompt (just refs)
        // Excerpts win over the toggle when both are set, per
        // memory/project_chat_context_pipeline.md priority rule.
        //
        // Reference docs (chunk 21) are appended as an additional
        // `[참조 문서]:` block when the user has opted any in. They are
        // read-only — write tools (chunk 19) still target the active doc
        // by construction since the dispatcher hands them to the active
        // viewer's IR.
        // Phase 3 — Agent 모드는 toolUses / toolResult 도 같이 직렬화.
        // OpenAI 어댑터가 native (tool_calls / role='tool') 로 변환한다.
        const messages: ChatMessage[] = history.map((m) => ({
          role: m.role,
          content: m.content,
          toolUses: m.toolUses,
          toolResult: m.toolResult,
        }));

        const refOutlines = collectReferenceOutlines(
          referencePaths,
          getOpenDocs,
          getDocOutline,
        );

        let systemContent: string | null = null;
        if (verifiedExcerpts.length > 0) {
          systemContent = buildExcerptSystemPrompt(verifiedExcerpts);
        } else if (attachDoc && getDocHtml) {
          const docHtml = getDocHtml();
          if (docHtml.length > 0) {
            systemContent = `${SYSTEM_PROMPT_DOC_CONTEXT}\n\n[현재 문서]:\n${docHtml}`;
          }
        }
        if (refOutlines.length > 0) {
          const refBlock = buildReferenceSystemBlock(refOutlines);
          systemContent =
            systemContent === null
              ? `${SYSTEM_PROMPT_DOC_CONTEXT}\n\n${refBlock}`
              : `${systemContent}\n\n${refBlock}`;
        }
        if (systemContent !== null) {
          messages.unshift({ role: 'system', content: systemContent });
        }
        // Phase 3 chunk 51 — Agent 모드면 양식 매칭 워크플로우 가이드 추가.
        // 기존 SYSTEM_PROMPT_DOC_CONTEXT (Manual 모드용 코드 블록 가이드)
        // 와 별개로 inject — Agent 는 코드 블록 안 쓰고 도구 직접 호출.
        if (chatModeRef.current === 'agent') {
          messages.unshift({
            role: 'system',
            content: SYSTEM_PROMPT_AGENT_GUIDE,
          });
        }

        const request: ChatRequest = { provider, model, messages };
        // Phase 3 — Agent 모드 활성 시 tool 카탈로그 주입. provider 어댑터
        // 가 native 형식(OpenAI tool_calls 등)으로 변환.
        if (chatModeRef.current === 'agent') {
          request.tools = getAhwpToolCatalog().map((d) => ({
            name: d.name,
            description: d.description,
            inputSchema: d.inputSchema,
          }));
          request.toolChoice = 'auto';
          // Agent 루프 재진입에서도 verifiedExcerpts를 유지하려면 ref 에
          // stash. 첫 turn 만 진짜 "사용자 의도"라 다음 turn 부터는 보통
          // [] 로 진행해도 OK 지만 일관성을 위해 같은 칩을 그대로 유지.
          agentVerifiedExcerptsRef.current = verifiedExcerpts;
        }
        handleRef.current = window.api.ai.chat(request, { onEvent });
      },
      [
        attachDoc,
        getDocHtml,
        getDocOutline,
        getOpenDocs,
        model,
        onEvent,
        provider,
        referencePaths,
      ],
    );
    // Phase 3 — Agent 루프 재진입을 위한 ref. onEvent → microtask →
    // fireChatRef.current(...) 로 새 turn 시작.
    useEffect(() => {
      fireChatRef.current = fireChat;
    }, [fireChat]);

    // chunk 20 — capture the active viewer selection as a chip. The
    // button is disabled when nothing's selectable, so the null-return
    // path is only hit during a race (selection cleared between hover
    // and click). Drag-and-drop wiring is a follow-up; this gives us
    // the data model NOW.
    /** Push a captured excerpt onto the chip list. Shared between the
     * `📌 발췌 첨부` button click and the HTML5 drag-and-drop path
     * (chunk 22). The payload differs only in the source: the button
     * reads via captureExcerpt(); drop reads via dataTransfer's
     * `application/x-ahwp-excerpt` MIME. */
    const addExcerptFromPayload = useCallback(
      (cap: {
        sectionIndex: number;
        startParagraphIndex: number;
        startOffset: number;
        endParagraphIndex: number;
        endOffset: number;
        text: string;
        docPath?: string | null;
      }) => {
        if (cap.text.length > EXCERPT_HARD_CHAR_LIMIT) {
          setExcerptError(
            `발췌가 너무 깁니다 (${cap.text.length} / ${EXCERPT_HARD_CHAR_LIMIT}자 상한).`,
          );
          return;
        }
        setExcerptError(null);
        const path =
          cap.docPath !== undefined ? cap.docPath : (activeDocPath?.() ?? null);
        const label = path
          ? (path.split(/[/\\]/).pop() ?? path)
          : '(이름 없음)';
        const chip: ExcerptAttachment = {
          id: newId(),
          docPath: path,
          docLabel: label,
          role: 'target',
          anchor: {
            sectionIndex: cap.sectionIndex,
            startParagraphIndex: cap.startParagraphIndex,
            startOffset: cap.startOffset,
            endParagraphIndex: cap.endParagraphIndex,
            endOffset: cap.endOffset,
          },
          text: cap.text,
          hash: hashText(cap.text),
          status: 'fresh',
        };
        setExcerpts((prev) => [...prev, chip]);
      },
      [activeDocPath],
    );

    const onCaptureExcerpt = useCallback(() => {
      if (!captureExcerpt) return;
      const cap = captureExcerpt();
      if (!cap) {
        setExcerptError(
          '선택된 텍스트가 없습니다. 먼저 문서에서 텍스트를 선택해 주세요.',
        );
        return;
      }
      addExcerptFromPayload(cap);
    }, [addExcerptFromPayload, captureExcerpt]);

    /** Drop handler for the input form — chunk 22. Accepts the custom
     * `application/x-ahwp-excerpt` MIME emitted by `studio-selection-rect`
     * dragstart. Falls back to creating a chip from `text/plain` if the
     * structured payload is missing — that case has no anchor and so is
     * marked stale-relocated immediately on send (verifyExcerpt will
     * either find the text or reject). */
    const onDropExcerpt = useCallback(
      (e: React.DragEvent<HTMLFormElement>) => {
        const types = Array.from(e.dataTransfer.types);
        if (!types.includes('application/x-ahwp-excerpt')) return;
        e.preventDefault();
        const raw = e.dataTransfer.getData('application/x-ahwp-excerpt');
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw) as {
            docPath?: string | null;
            sectionIndex: number;
            startParagraphIndex: number;
            startOffset: number;
            endParagraphIndex: number;
            endOffset: number;
            text: string;
          };
          addExcerptFromPayload(parsed);
        } catch {
          setExcerptError('발췌 페이로드를 읽지 못했습니다.');
        }
      },
      [addExcerptFromPayload],
    );

    /** preventDefault on dragover lets the drop fire. Without it the
     * browser rejects the drop ahead of our handler. */
    const onDragOverExcerpt = useCallback(
      (e: React.DragEvent<HTMLFormElement>) => {
        const types = Array.from(e.dataTransfer.types);
        if (!types.includes('application/x-ahwp-excerpt')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      },
      [],
    );

    // chunk 26 — history list pull. Filtered by active doc when one is
    // loaded so the dropdown is scoped to the doc you're editing.
    const refreshHistory = useCallback(async () => {
      try {
        const docPath = activeDocPath?.() ?? null;
        const rows = await window.api.chatHistory.list(docPath);
        setHistoryList(
          rows.map((r) => ({
            id: r.id,
            docPath: r.docPath,
            title: r.title,
            updatedAt: r.updatedAt,
          })),
        );
      } catch (err) {
        console.warn('[chat] history.list failed', err);
      }
    }, [activeDocPath]);
    useEffect(() => {
      refreshHistoryRef.current = refreshHistory;
    }, [refreshHistory]);

    const newConversation = useCallback(() => {
      if (streaming) return;
      setMessages([]);
      setConversationId(null);
      conversationIdRef.current = null;
      setError(null);
      setExcerpts([]);
      setExcerptError(null);
      setHistoryOpen(false);
      // chunk 31 — 새 대화 시작 시 auto-title 마킹은 conversation id 단위
      // 라 따로 clear할 필요 없음 (id가 새로 발급될 때 자연히 미마킹 상태).
    }, [streaming]);

    const loadConversation = useCallback(async (id: number) => {
      try {
        const r = await window.api.chatHistory.get(id);
        setMessages(
          r.messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({
              id: `db-${m.id}`,
              role: m.role,
              content: m.content,
            })),
        );
        setConversationId(id);
        conversationIdRef.current = id;
        setHistoryOpen(false);
        setError(null);
      } catch (err) {
        console.warn('[chat] history.get failed', err);
      }
    }, []);

    const deleteHistoryItem = useCallback(
      async (id: number) => {
        try {
          await window.api.chatHistory.delete(id);
          // If we deleted the currently-loaded conversation, reset to a fresh chat.
          if (conversationIdRef.current === id) {
            newConversation();
          }
          await refreshHistory();
        } catch (err) {
          console.warn('[chat] history.delete failed', err);
        }
      },
      [newConversation, refreshHistory],
    );

    // Inline rename — chunk 30. Double-click on a conversation title swaps
    // it for an input; Enter persists, Esc cancels. The conversation row
    // shows the new title immediately via optimistic local update; the
    // chatHistory.rename IPC writes through to SQLite. On failure we revert
    // by re-fetching the list.
    const [renamingId, setRenamingId] = useState<number | null>(null);
    const [renameDraft, setRenameDraft] = useState('');
    const beginRename = useCallback(
      (id: number, currentTitle: string | null): void => {
        setRenamingId(id);
        setRenameDraft(currentTitle ?? '');
      },
      [],
    );
    const cancelRename = useCallback(() => {
      setRenamingId(null);
      setRenameDraft('');
    }, []);
    const commitRename = useCallback(
      async (id: number): Promise<void> => {
        const next = renameDraft.trim();
        if (next.length === 0) {
          cancelRename();
          return;
        }
        // Optimistic update so the row reflects the new title before the
        // IPC round-trip completes.
        setHistoryList((prev) =>
          prev.map((row) => (row.id === id ? { ...row, title: next } : row)),
        );
        setRenamingId(null);
        setRenameDraft('');
        try {
          await window.api.chatHistory.rename(id, next);
        } catch (err) {
          console.warn('[chat] history.rename failed', err);
          // Revert: re-fetch authoritative list from SQLite.
          await refreshHistory();
        }
      },
      [renameDraft, cancelRename, refreshHistory],
    );

    const removeExcerpt = useCallback((id: string) => {
      setExcerpts((prev) => prev.filter((e) => e.id !== id));
    }, []);

    const send = useCallback(async () => {
      const text = input.trim();
      if (text.length === 0 || streaming) return;

      // Per-chip stale verification — chunk 20. Each chip's anchor is
      // re-read from the IR. Fresh = pass through. Relocated = update
      // anchor in place (silent). Missing = block send and surface a
      // toast so the user can re-select. We reset to fresh chips so
      // subsequent turns don't keep re-checking the same anchors.
      const verified: ExcerptAttachment[] = [];
      const stillMissing: string[] = [];
      if (excerpts.length > 0 && verifyExcerpt) {
        for (const ex of excerpts) {
          const r = verifyExcerpt(ex.anchor, ex.text);
          if (!r) {
            stillMissing.push(ex.docLabel);
            continue;
          }
          if (r.status === 'fresh') {
            verified.push({ ...ex, status: 'fresh' });
          } else if (r.status === 'stale-relocated' && r.newAnchor) {
            verified.push({
              ...ex,
              anchor: r.newAnchor,
              status: 'stale-relocated',
            });
          } else {
            stillMissing.push(ex.docLabel);
          }
        }
        if (stillMissing.length > 0) {
          setExcerptError(
            `발췌 위치를 찾을 수 없습니다 (${stillMissing.join(', ')}). 다시 선택해 주세요.`,
          );
          return;
        }
        setExcerpts(verified);
        setExcerptError(null);
      }

      const userMsg: UiMessage = { id: newId(), role: 'user', content: text };
      setInput('');

      // chunk 26 — ensure the conversation exists BEFORE starting the
      // stream so onEvent's terminator (which persists the assistant
      // turn) sees a non-null conversationIdRef. We await the create +
      // user-append so persistence is in lockstep with the visual turn.
      try {
        if (conversationIdRef.current === null) {
          const docPath = activeDocPath?.() ?? null;
          const title = text.slice(0, 60);
          const r = await window.api.chatHistory.create(docPath, title);
          conversationIdRef.current = r.id;
          setConversationId(r.id);
        }
        await window.api.chatHistory.append(
          conversationIdRef.current,
          'user',
          text,
        );
      } catch (err) {
        console.warn('[chat] history.append user failed', err);
        // Persistence failure shouldn't block the chat — proceed even if
        // the DB write threw.
      }

      fireChat([...messages, userMsg], verified);
    }, [
      activeDocPath,
      excerpts,
      fireChat,
      input,
      messages,
      streaming,
      verifyExcerpt,
    ]);

    // chunk 56 — AI selection menu trigger. Builds and fires a chat turn
    // directly from `text` (the menu wraps the user's selection in a
    // template prompt before calling), bypassing the input field. We
    // skip the excerpt-chip verification path because the caller has
    // already inlined the relevant text.
    const sendDirect = useCallback(
      async (text: string): Promise<void> => {
        const trimmed = text.trim();
        if (trimmed.length === 0 || streaming) return;
        const userMsg: UiMessage = {
          id: newId(),
          role: 'user',
          content: trimmed,
        };
        try {
          if (conversationIdRef.current === null) {
            const docPath = activeDocPath?.() ?? null;
            const title = trimmed.slice(0, 60);
            const r = await window.api.chatHistory.create(docPath, title);
            conversationIdRef.current = r.id;
            setConversationId(r.id);
          }
          await window.api.chatHistory.append(
            conversationIdRef.current,
            'user',
            trimmed,
          );
        } catch (err) {
          console.warn('[chat] history.append user (direct) failed', err);
        }
        fireChat([...messages, userMsg], []);
      },
      [activeDocPath, fireChat, messages, streaming],
    );

    useImperativeHandle(
      ref,
      () => ({
        prefillAndSend: (text: string) => {
          void sendDirect(text);
        },
      }),
      [sendDirect],
    );

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
        void send();
      },
      [send],
    );

    const onKeyDown = useCallback(
      (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void send();
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
            list={`chat-model-list-${provider}`}
          />
          {/* chunk 48 — datalist autocomplete. Free-text input still wins
            (user can type any model id), but a list of fetched ids
            appears as suggestions on focus. Empty list (error / idle)
            silently degrades to plain free-text. */}
          {(() => {
            const state = modelList[provider];
            const list =
              state.kind === 'ok' || state.kind === 'stale' ? state.models : [];
            return (
              <datalist
                id={`chat-model-list-${provider}`}
                data-testid="chat-model-datalist"
              >
                {list.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
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
        {/* Phase 3 — Manual / Agent 모드 토글. Manual: 기존 응답-텍스트
          dispatcher (사용자가 "도구 실행" 버튼 클릭). Agent: provider
          native tool-use API + 자동 루프 + 묶음 undo. */}
        <div
          className="flex items-center gap-1 border-b border-border px-2 py-1 text-[11px]"
          data-testid="chat-mode-bar"
        >
          <span className="text-muted-foreground">모드</span>
          <button
            type="button"
            disabled={streaming}
            onClick={() => setChatMode('manual')}
            className={cn(
              'rounded-md border px-2 py-0.5 transition',
              chatMode === 'manual'
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-input text-muted-foreground hover:bg-muted',
              'disabled:opacity-50',
            )}
            data-testid="chat-mode-manual"
            title="Manual: AI 응답에 도구 블록이 있으면 사용자가 버튼 눌러 적용"
          >
            Manual
          </button>
          <button
            type="button"
            disabled={streaming}
            onClick={() => setChatMode('agent')}
            className={cn(
              'rounded-md border px-2 py-0.5 transition',
              chatMode === 'agent'
                ? 'border-primary bg-primary/10 text-foreground'
                : 'border-input text-muted-foreground hover:bg-muted',
              'disabled:opacity-50',
            )}
            data-testid="chat-mode-agent"
            title="Agent (실험적): AI가 도구를 직접 호출해 자동으로 적용. 한 turn 내 묶음 undo."
          >
            Agent <span className="opacity-60">⚡</span>
          </button>
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
