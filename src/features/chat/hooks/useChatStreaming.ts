/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
/**
 * `useChatStreaming` — Phase R2.3 refactor (REFACTORING_PLAN.md).
 *
 * ChatPanel.tsx 의 streaming + agent loop 구역을 hook 으로 분해.
 * `assistantBufferRef` / agent turn refs / `maybeAutoTitle` /
 * `onEvent` (streaming 이벤트 처리) / `fireChat` (요청 발사) /
 * `send` / `sendDirect` / `regenerate` / `deleteMessage` /
 * `copyMessage` / `onSubmit` / `onKeyDown` / `stop` 모두 1:1 이전.
 *
 * 외부 동작 / 내부 closure / 모든 ref·setter 호출 verbatim. opts 가
 * 워낙 많아 file-level any 허용. caller 가 보유한 useState/useRef 가
 * 정확한 타입을 결정.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
import type { ChatMessage, ChatRequest, ChatStreamEvent } from '@shared/ai';
import {
  getAhwpToolCatalog,
  isReadOnlyTool,
  validateToolCall,
  type AhwpToolCall,
} from '@shared/ai-tools';
import type { ExcerptAttachment } from '@shared/ai-excerpt';
import {
  SYSTEM_PROMPT_DOC_CONTEXT,
  SYSTEM_PROMPT_AGENT_GUIDE,
  SYSTEM_PROMPT_PLAN_MODE_SUFFIX,
  collectReferenceOutlines,
  buildReferenceSystemBlock,
  buildExcerptSystemPrompt,
} from '../prompts';
import { selectToolsViaLlm, resetRouterCache } from '../toolRouter';

interface UiToolEntry {
  id: string;
  name: string;
  argsPreview: string;
  status: 'running' | 'ok' | 'failed';
  reason?: string;
  /** 0.4.11 — JSON-stringified tool 결과 (read tools 의 data 또는 write
   *  tools 의 ok/error). chat UI 의 확장 버튼 클릭 시 노출. read tools
   *  는 16k cap, write tools 는 4k cap (advanceAgentLoop 정합). */
  resultPreview?: string;
  /** 0.4.17 — Claude Code 식 시각 분리. read tools 는 muted, write
   *  tools 는 강조 카드. isReadOnlyTool(name) 의 boolean 을 캐싱 — UI
   *  단계에서 catalog import 안 하도록. */
  kind: 'read' | 'write';
  /** 0.4.23 — write tool 의 synthetic diff. dispatcher 가 영향 paragraph
   *  의 before/after 를 snapshot 한 결과. UI 가 inline mini-diff 렌더. */
  diff?: {
    paragraphIdx: number;
    before: string;
    after: string;
    label?: string;
  };
}

interface UiMessage extends ChatMessage {
  id: string;
  toolEntries?: UiToolEntry[];
  /** chunk 99 follow-up — true 이면 plan mode 에서 생성된 어시스턴트
   *  메시지. UI 가 "이 계획대로 실행" 버튼 surface. */
  planMode?: boolean;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Agent 한 turn (= LLM 응답 한 사이클) 안의 fireChat 재귀 깊이 한계.
 *
 * Phase 3 chunk 39 에선 10 으로 핀했으나 Claude Code 식 agentic 흐름
 * 에선 read → reason → write → verify 시퀀스가 한 작업당 20~40 회 사이.
 * 사업계획서 전체 작성 같은 long-form 은 더 필요. 디폴트 50 + 사용자
 * Settings 조절 (max 200) 로 변경.
 *
 * localStorage `ahwp:chat:max-turns` (정수, 1~200 clamp). 비어있으면 50.
 */
export const AGENT_MAX_TURNS_DEFAULT = 50;
export const AGENT_MAX_TURNS_HARD_CAP = 200;
const AGENT_MAX_TURNS_KEY = 'ahwp:chat:max-turns';

export function loadAgentMaxTurns(): number {
  try {
    const raw = localStorage.getItem(AGENT_MAX_TURNS_KEY);
    if (!raw) return AGENT_MAX_TURNS_DEFAULT;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return AGENT_MAX_TURNS_DEFAULT;
    return Math.min(AGENT_MAX_TURNS_HARD_CAP, n);
  } catch {
    return AGENT_MAX_TURNS_DEFAULT;
  }
}

export function saveAgentMaxTurns(n: number): void {
  try {
    const clamped = Math.max(
      1,
      Math.min(AGENT_MAX_TURNS_HARD_CAP, Math.round(n)),
    );
    localStorage.setItem(AGENT_MAX_TURNS_KEY, String(clamped));
  } catch {
    /* localStorage unavailable — silent */
  }
}

/**
 * Plan mode — Claude Code 식 dry-run. 활성 시 모델은 read tool 만 호출
 * 가능하고, 본문엔 "이렇게 할 계획" 의 bullet plan 만 작성. 사용자
 * 검토 후 (a) "이 계획대로 실행" 버튼 / (b) "건너뛰기" 인라인 버튼 /
 * (c) 같은 prompt 재전송 — 모두 next-send 1회만 plan 우회.
 *
 * 기본 ON (안전 우선) — 큰 변경 전 매 prompt 마다 검토 강제. Settings
 * → AI 공급자 → "Plan mode 기본 활성화" 에서 OFF 가능.
 *
 * 영속 상태 = "default" 한 가지뿐 (localStorage). turn-by-turn active
 * 값은 메모리 ref (`planSkipNextRef`) 로만 관리 — 한 번 소비되면
 * default 로 복귀. 이렇게 해야 "매 prompt 마다 dry-run" 패턴이 자동
 * 유지됨.
 */
const PLAN_MODE_DEFAULT_KEY = 'ahwp:chat:plan-mode-default';

export function loadPlanModeDefault(): boolean {
  try {
    const raw = localStorage.getItem(PLAN_MODE_DEFAULT_KEY);
    // chunk 99 follow-up — default OFF (자동 적용 흐름이 main). Plan
    // mode 는 큰 변경 / 불확실한 작업에 opt-in 하는 검토 모드. Settings
    // 에서 사용자가 켜야 함.
    return raw === '1';
  } catch {
    return false;
  }
}

export const PLAN_MODE_DEFAULT_CHANGED_EVENT = 'ahwp:plan-mode-default-changed';

export function savePlanModeDefault(on: boolean): void {
  try {
    localStorage.setItem(PLAN_MODE_DEFAULT_KEY, on ? '1' : '0');
    // Same-tab subscribers (ChatPanel indicator) listen for this — the
    // browser 'storage' event only fires across tabs, so we synthesize.
    window.dispatchEvent(new Event(PLAN_MODE_DEFAULT_CHANGED_EVENT));
  } catch {
    /* silent */
  }
}

export interface UseChatStreamingOptions {
  // refs (from caller)
  conversationIdRef: MutableRefObject<number | null>;
  autoTitledConvIdsRef: MutableRefObject<Set<number>>;
  providerRef: MutableRefObject<any>;
  modelRef: MutableRefObject<any>;
  chatModeRef: MutableRefObject<any>;
  handleRef: MutableRefObject<any>;
  scrollerRef: MutableRefObject<HTMLDivElement | null>;
  assistantIdRef: MutableRefObject<string | null>;
  refreshHistoryRef: MutableRefObject<(() => Promise<void>) | null>;
  // state
  messages: any;
  setMessages: any;
  input: string;
  setInput: any;
  streaming: boolean;
  setStreaming: any;
  setError: any;
  /** chunk 99 follow-up — agent turn depth state mirror for UI step
   *  counter ("Turn 3/50"). Hook bumps on each turn entry, resets on
   *  finalize / abort / cap. Optional — when omitted, counter UI hides. */
  setAgentTurn?: (n: number) => void;
  hasKey: any;
  provider: any;
  model: any;
  chatMode: any;
  modelList: any;
  attachDoc: boolean;
  /** chunk 75 — clear the attach toggle after a successful send so the
   *  user explicitly opts in for each context-attached turn. */
  setAttachDoc: (v: boolean) => void;
  excerpts: any;
  excerptError: string | null;
  setExcerptError: any;
  setExcerpts: any;
  conversationId: number | null;
  setConversationId: any;
  referencePaths: string[];
  // props (from ChatPanel)
  onOpenSettings?: () => void;
  getDocHtml?: () => string;
  applyHtml?: (html: string) => void;
  runTools?: (items: any, targetPath?: string | null) => any;
  captureExcerpt?: () => any;
  activeDocPath?: () => string | null;
  verifyExcerpt?: (anchor: any, expected: string) => any;
  getOpenDocs?: () => Array<{ path: string; label: string; isActive: boolean }>;
  getDocOutline?: (path: string) => string;
  undoLastApply?: () => boolean;
  /** chunk 99 follow-up — switchTargetDoc 가 닫힌 탭 path 를 받았을 때
   *  자동으로 file:open-by-path → tab 추가 → mount 까지 처리. true =
   *  성공 (탭이 mount 되어 후속 lookup 가능). caller (AppShell) 가
   *  실제 IPC + tabsState 갱신 책임. */
  openDocByPath?: (path: string) => Promise<boolean>;
  /** chunk 99 follow-up — plan 응답 turn 종료 시 자동 호출. ChatPanel
   *  이 React state 의 planMode 를 false 로 동기화 (localStorage 는
   *  hook 안에서 이미 갱신). */
  onPlanModeAutoDisengage?: () => void;
}

export interface ChatStreamingHandle {
  fireChat: (history: any, verifiedExcerpts?: any) => void;
  send: () => Promise<void>;
  sendDirect: (text: string) => Promise<void>;
  regenerate: (assistantId: string) => void;
  deleteMessage: (id: string) => void;
  copyMessage: (id: string) => Promise<boolean>;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  stop: () => void;
  agentToolUsesRef: MutableRefObject<any>;
  agentTurnDepthRef: MutableRefObject<number>;
  agentVerifiedExcerptsRef: MutableRefObject<any>;
  /** chunk 97 — pending write tool 에 대한 사용자 결정. accept=true 면
   *  dispatch + tool_result 'ok', false 면 'user-rejected'. 모든 pending
   *  이 resolve 되면 자동으로 다음 turn 진입. */
  resolveApproval: (toolUseId: string, accept: boolean) => Promise<void>;
  /** chunk 99 follow-up — plan mode 를 next send 1회만 우회. "이 계획
   *  대로 실행" 버튼 / "건너뛰기" 버튼이 호출. fireChat 가 1회 소비. */
  requestPlanSkip: () => void;
}

export function useChatStreaming(
  opts: UseChatStreamingOptions,
): ChatStreamingHandle {
  const {
    conversationIdRef,
    autoTitledConvIdsRef,
    providerRef,
    modelRef,
    handleRef,
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
    provider,
    model,
    attachDoc,
    setAttachDoc,
    excerpts,
    setExcerptError,
    setExcerpts,
    setConversationId,
    referencePaths,
    getDocHtml,
    applyHtml,
    runTools,
    activeDocPath,
    verifyExcerpt,
    getOpenDocs,
    getDocOutline,
    undoLastApply,
  } = opts;
  void applyHtml;
  void undoLastApply;
  void getOpenDocs;

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
  /** 0.4.19 — Agent loop 가 누적하는 도구 호출 이력. router phase-aware
   *  결정에 사용. send/regenerate/stop 시 reset. ok/fail + 짧은 summary. */
  const agentToolHistoryRef = useRef<
    { name: string; ok: boolean; summary?: string }[]
  >([]);
  const agentTurnDepthRef = useRef(0);
  const agentVerifiedExcerptsRef = useRef<ExcerptAttachment[]>([]);
  // chunk 99 follow-up — stop 버튼이 turn loop 도 강제 종료. flag 가
  // true 이면 advanceAgentLoop 가 다음 turn 진입 직전 short-circuit.
  // 매 send / sendDirect / regenerate / acceptDirect 시작 시 false 로
  // reset.
  const agentStoppedRef = useRef(false);
  // chunk 99 follow-up — plan mode 1회 우회 ref. ChatPanel 의 "이 계획
  // 대로 실행" / "건너뛰기" 액션이 set, fireChat 가 1회 소비 후 false.
  const planSkipNextRef = useRef(false);

  // Phase 5 chunk 97 — Manual/Agent 통합. autoApprove=false 일 때 write
  // tool 호출은 즉시 dispatch 하지 않고 사용자 Accept/Reject 를 기다린다.
  // 한 turn 안의 모든 pending 이 resolve 되면 next turn 으로 진행.
  type PartialToolResult = {
    id: string;
    name: string;
    ok: boolean;
    reason?: string;
    data?: unknown;
    diff?: {
      paragraphIdx: number;
      before: string;
      after: string;
      label?: string;
    };
  };
  const pendingTurnRef = useRef<{
    toolUses: { id: string; name: string; args: unknown }[];
    partialResults: Map<string, PartialToolResult>;
    pendingCalls: Map<string, AhwpToolCall>;
    assistantId: string | null;
  } | null>(null);
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

  // Phase 3 chunk 50 — turn 시작 시점의 target doc path. Agent 루프
  // 가 여러 turn 을 거쳐도 동일 doc 으로 dispatch 하기 위해 ref 에 핀.
  // 사용자가 mid-turn 에 탭을 바꿔도 write tool 은 원본 target 으로 감.
  // null = legacy fallback (active viewer).
  const turnTargetPathRef = useRef<string | null>(null);

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
  // refreshHistoryRef comes from caller via opts (R2.1).
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
          (m) => `${m.role === 'user' ? '사용자' : '어시스턴트'}: ${m.content}`,
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
    async (evt: ChatStreamEvent) => {
      if (evt.type === 'text-delta') {
        // Capture the id eagerly: the setMessages updater may run later in a
        // React batch, by which point a terminal event might have cleared
        // assistantIdRef. Reading it inside the updater drops late deltas.
        const id = assistantIdRef.current;
        if (!id) return;
        assistantBufferRef.current += evt.text;
        setMessages((prev: any) =>
          prev.map((m: any) =>
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
            kind: isReadOnlyTool(evt.name) ? 'read' : 'write',
          };
          setMessages((prev: any) =>
            prev.map((m: any) =>
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
        setMessages((prev: any) => {
          maybeAutoTitle(convId, prev);
          return prev;
        });
      }

      // Phase 3 — Agent 루프. done 시점에 finishReason='tool_calls' 면
      // 누적된 tool-use 들을 dispatch 하고 결과를 새 메시지로 추가한 뒤
      // fireChat 재귀. cap 도달 시 강제 종료.
      // chunk 97 — Manual/Agent 통합 후 모든 turn 이 tool-use 가능. 단,
      // autoApprove=false 면 write tool 은 사용자 Accept/Reject 게이트.
      const isAgentTurn =
        evt.type === 'done' &&
        (evt.finishReason === 'tool_calls' ||
          agentToolUsesRef.current.length > 0);
      if (isAgentTurn && agentToolUsesRef.current.length > 0) {
        const toolUses = agentToolUsesRef.current;
        agentToolUsesRef.current = [];
        const assistantId = assistantIdRef.current;
        // assistant 메시지 finalize — toolUses 채움.
        setMessages((prev: any) =>
          prev.map((m: any) =>
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
        const dispatcher = runToolsPropRef.current;
        const partialResults = new Map<string, PartialToolResult>();
        const pendingCalls = new Map<string, AhwpToolCall>();

        // chunk 99 follow-up — Phase 1 (validate + immediate-dispatch
        // routing) split into 3 buckets:
        //   (a) immediate sync resolves: validation fail / dispatcher
        //       unavailable / switchTargetDoc (chat-ref mutation only) /
        //       cross-doc auto-open (file:open IPC chain)
        //   (b) read-only or auto-approved writes  → parallel dispatch
        //       via Promise.all (IPC reads — searchWorkspaceOutlines /
        //       readParagraphByPath — get true concurrency)
        //   (c) write tools in 검토 모드 → pendingCalls (사용자 승인 대기)
        const parallelBatch: {
          tu: { id: string; name: string };
          call: AhwpToolCall;
        }[] = [];
        for (const tu of toolUses) {
          const v = validateToolCall({ tool: tu.name, args: tu.args });
          if (!v.ok) {
            partialResults.set(tu.id, {
              id: tu.id,
              name: tu.name,
              ok: false,
              reason: v.reason,
            });
            continue;
          }
          if (!dispatcher) {
            partialResults.set(tu.id, {
              id: tu.id,
              name: tu.name,
              ok: false,
              reason: 'dispatcher-unavailable',
            });
            continue;
          }
          // switchTargetDoc — viewer dispatch 우회, 즉시 처리 (chat
          // 라우팅 ref 갱신). 닫힌 탭이면 자동 열기 시도.
          if (tu.name === 'switchTargetDoc') {
            const path = (v.value as { args: { path: string } }).args.path;
            const openDocsLocal = getOpenDocs?.() ?? [];
            let matched = openDocsLocal.find((d) => d.path === path);
            if (!matched && opts.openDocByPath) {
              try {
                const ok = await opts.openDocByPath(path);
                if (ok) {
                  // 새 탭이 mount 되도록 마이크로태스크 잠시 양보 후 재조회.
                  await new Promise((r) => setTimeout(r, 50));
                  const fresh = getOpenDocs?.() ?? [];
                  matched = fresh.find((d) => d.path === path);
                }
              } catch (err) {
                console.warn('[chat] openDocByPath threw:', err);
              }
            }
            if (!matched) {
              partialResults.set(tu.id, {
                id: tu.id,
                name: tu.name,
                ok: false,
                reason: `target-not-open:${path}`,
              });
              continue;
            }
            turnTargetPathRef.current = path;
            partialResults.set(tu.id, {
              id: tu.id,
              name: tu.name,
              ok: true,
              data: {
                switchedTo: path,
                label: matched.label,
              },
            });
            continue;
          }
          // chunk 99 follow-up — 사용자 승인 게이트 폐기 (autoApprove
          // 토글 제거). 모든 도구가 즉시 dispatch. 사용자가 만족 못하면
          // stop / undo (⌘Z) 로 롤백 — 명시적 confirm 대신 옵트아웃.
          parallelBatch.push({
            tu: { id: tu.id, name: tu.name },
            call: v.value,
          });
        }
        // pendingCalls 는 더 이상 채워지지 않음 (legacy 호환 — 빈 Map
        // 유지해 아래 size>0 분기가 자연 dead code).

        // 0.4.10 — 다중 dispatch 시 read 와 write 분리:
        //   reads  → Promise.allSettled (true 병렬, IR 무변경이라 안전)
        //   writes → for-of 직렬 (race 차단 + AI 가 호출한 순서 보존)
        // 이전엔 둘 다 병렬이라 다중 write 시 비결정적 interleaving 가능.
        // (paragraph index shift 문제는 별개 — AI 가 bottom-up 순서로
        //  호출하거나 매 write 사이 re-read 해야 함. prompt 가이드 참조.)
        if (parallelBatch.length > 0 && dispatcher) {
          const dispatch = dispatcher;
          const reads = parallelBatch.filter((b) => isReadOnlyTool(b.tu.name));
          const writes = parallelBatch.filter(
            (b) => !isReadOnlyTool(b.tu.name),
          );

          // reads — 병렬
          const readResults = await Promise.allSettled(
            reads.map((b) =>
              dispatch([{ ok: true, call: b.call }], turnTargetPathRef.current),
            ),
          );
          // writes — 직렬 (AI 가 호출한 순서 보존)
          const writeResults: typeof readResults = [];
          for (const b of writes) {
            try {
              const v = await dispatch(
                [{ ok: true, call: b.call }],
                turnTargetPathRef.current,
              );
              writeResults.push({ status: 'fulfilled', value: v });
            } catch (err) {
              writeResults.push({ status: 'rejected', reason: err });
            }
          }
          // 결과 병합 — parallelBatch 의 원래 순서 (id) 로 다시 매핑
          const ordered: typeof readResults = [];
          let ri = 0;
          let wi = 0;
          for (const b of parallelBatch) {
            if (isReadOnlyTool(b.tu.name)) {
              ordered.push(readResults[ri++]);
            } else {
              ordered.push(writeResults[wi++]);
            }
          }
          const settled = ordered;
          for (let i = 0; i < parallelBatch.length; i++) {
            const b = parallelBatch[i];
            const s = settled[i];
            if (s.status === 'rejected') {
              partialResults.set(b.tu.id, {
                id: b.tu.id,
                name: b.tu.name,
                ok: false,
                reason: `dispatch-threw:${String(s.reason).slice(0, 100)}`,
              });
              continue;
            }
            const first = s.value[0];
            if (first && first.ok) {
              partialResults.set(b.tu.id, {
                id: b.tu.id,
                name: b.tu.name,
                ok: true,
                data: first.data,
                diff: first.diff,
              });
            } else {
              partialResults.set(b.tu.id, {
                id: b.tu.id,
                name: b.tu.name,
                ok: false,
                reason: first?.ok === false ? first.reason : 'unknown',
              });
            }
          }
        }
        // 0.4.19 — 도구 이력 누적. router 가 phase 판단에 사용.
        for (const r of partialResults.values()) {
          let summary: string | undefined;
          if (!r.ok) summary = r.reason;
          else if (r.data !== undefined) {
            try {
              const j = JSON.stringify(r.data);
              summary = j.length > 120 ? `${j.slice(0, 120)}…` : j;
            } catch {
              /* ignore */
            }
          }
          agentToolHistoryRef.current.push({
            name: r.name,
            ok: r.ok,
            summary,
          });
        }

        // UI 갱신 — 즉시 처리된 entries 는 ok/failed 로, write pending 은
        // 'pending' 으로 마킹.
        if (assistantId) {
          setMessages((prev: any) =>
            prev.map((m: any) => {
              if (m.id !== assistantId || !m.toolEntries) return m;
              return {
                ...m,
                toolEntries: m.toolEntries.map((te: any) => {
                  if (partialResults.has(te.id)) {
                    const r = partialResults.get(te.id)!;
                    let resultPreview: string | undefined;
                    try {
                      if (r.ok && r.data !== undefined) {
                        let json = JSON.stringify(r.data, null, 2);
                        const cap = isReadOnlyTool(r.name) ? 16384 : 4096;
                        if (json.length > cap) json = json.slice(0, cap) + '…';
                        resultPreview = json;
                      } else if (r.ok) {
                        resultPreview = `ok: ${r.name}`;
                      } else {
                        resultPreview = `error: ${r.reason ?? '?'}`;
                      }
                    } catch {
                      resultPreview = '(non-serializable)';
                    }
                    return {
                      ...te,
                      status: r.ok ? 'ok' : 'failed',
                      reason: r.reason,
                      resultPreview,
                      diff: r.diff,
                    };
                  }
                  if (pendingCalls.has(te.id)) {
                    return { ...te, status: 'pending' };
                  }
                  return te;
                }),
              };
            }),
          );
        }

        if (pendingCalls.size > 0) {
          // Phase 2 — turn 보류. 사용자가 모든 pending 을 Accept/Reject 할
          // 때 까지 fireChat 재귀 안 들어감.
          pendingTurnRef.current = {
            toolUses,
            partialResults,
            pendingCalls,
            assistantId,
          };
          // 스트리밍은 종료 (assistant turn 자체는 끝났음). 사용자 결정
          // 후 resolveApproval 안에서 setStreaming(true) + fireChat.
          assistantBufferRef.current = '';
          setStreaming(false);
          handleRef.current = null;
          assistantIdRef.current = null;
          return;
        }

        // 모두 즉시 처리됨 — 다음 turn 으로 진행.
        await advanceAgentLoop(toolUses, partialResults, assistantId);
        return;
      }

      // 정상 종료 (manual 모드 또는 agent의 finishReason='stop').
      agentTurnDepthRef.current = 0;
      setAgentTurn?.(0);
      agentToolUsesRef.current = [];
      agentToolHistoryRef.current = [];
      resetRouterCache();
      agentVerifiedExcerptsRef.current = [];
      assistantBufferRef.current = '';
      setStreaming(false);
      handleRef.current = null;
      assistantIdRef.current = null;
      // chunk 99 follow-up — Plan mode auto-disengage. plan 응답 1턴은
      // 의도상 "다음 turn dry-run"; 응답 완료 후 자동으로 토글 off.
      // 사용자가 다음 메시지를 보내면 한 번은 정상 모드로 (검토 결과
      // 반영). 그 다음 turn 부터는 default 값에 따라 다시 on (default
      // chunk 99 follow-up — plan turn 종료 후 자동 disengage 는 더
      // 이상 필요 없음 (active 키 폐기). default 가 ON 이라도 사용자가
      // "이 계획대로 실행" 버튼 / "건너뛰기" 클릭 시 planSkipNextRef
      // 를 set, fireChat 가 1회 소비. 그 외에는 매 turn 이 자동으로
      // dry-run 으로 시작됨 (default=ON 시).
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
    async (
      history: UiMessage[],
      verifiedExcerpts: ExcerptAttachment[] = [],
    ) => {
      setError(null);
      // chunk 99 follow-up — plan mode 결정. planSkipNextRef 가 set 이면
      // 1회 소비하고 false. 아니면 default 사용. flag 를 message 에 박제
      // 해 UI 가 assistant 메시지 옆에 "이 계획대로 실행" 버튼 노출 여부
      // 결정.
      const planModeNow = planSkipNextRef.current
        ? false
        : loadPlanModeDefault();
      planSkipNextRef.current = false;
      const assistantMsg: UiMessage = {
        id: newId(),
        role: 'assistant',
        content: '',
        planMode: planModeNow ? true : undefined,
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
          systemContent = `${SYSTEM_PROMPT_DOC_CONTEXT}\n\n[Active doc]:\n${docHtml}`;
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
      // chunk 97 — Manual/Agent 통합. tool catalog + Agent 워크플로우
      // 가이드는 무조건 inject. 사용자가 검토 모드 (autoApprove=false) 일
      // 때도 모델은 그대로 tool 호출하고, 게이트는 dispatch 단계에서
      // 적용된다 (UX 만 변하고 모델 perspective 는 동일).
      // chunk 99 follow-up — plan mode suffix. catalog 가 read-only 로
      // 필터링되므로 모델은 write 호출 자체가 불가능. suffix 로 "plan 만
      // 작성" 지시 + 사용자 검토 흐름 안내.
      messages.unshift({
        role: 'system',
        content: planModeNow
          ? SYSTEM_PROMPT_AGENT_GUIDE + SYSTEM_PROMPT_PLAN_MODE_SUFFIX
          : SYSTEM_PROMPT_AGENT_GUIDE,
      });

      const request: ChatRequest = { provider, model, messages };
      // chunk 99 — LLM 기반 tool 라우터. 사용자 선택 모델로 router LLM 호출
      // → JSON tool 이름 배열 응답 → 본 LLM 호출에 그 subset 만 주입. 60+
      // 의 tool catalog 전체를 본 turn 마다 노출하면 (a) NIM hosted 모델
      // 일부 stall, (b) 모델이 후보 너무 많아 호출 정확도 ↓. router 실패
      // (timeout / parse error) 시 full catalog fallback.
      const selection = await selectToolsViaLlm({
        history,
        provider,
        model,
        hasKey: !!opts.hasKey,
        recentToolCalls: agentToolHistoryRef.current,
      });
      const allowed = new Set(selection.tools);
      request.tools = getAhwpToolCatalog()
        .filter((d) => allowed.has(d.name))
        // chunk 99 follow-up — plan mode 일 땐 catalog 를 read-only 로
        // 한정. 모델이 write 도구를 호출하려고 시도해도 catalog 에 없어
        // 무시. 이중 안전망 (suffix prompt + catalog filter).
        .filter((d) => !planModeNow || isReadOnlyTool(d.name))
        .map((d) => ({
          name: d.name,
          description: d.description,
          inputSchema: d.inputSchema,
        }));
      request.toolChoice = 'auto';
      // chunk 99 — main turn 도 reasoning_effort='low' 로 thinking 단축.
      // 문서 편집 task 는 깊은 reasoning 불필요. gpt-5.x 기본 effort 가
      // turn 당 1~2 분 추가하는 비용 회피. non-reasoning 모델은 무시.
      request.reasoningEffort = 'low';
      console.info(
        `[chunk99 tool-router] reason=${selection.reason} latency=${selection.latencyMs}ms isFull=${selection.isFullCatalog} tools=${request.tools.length}`,
      );
      // Agent 루프 재진입에서도 verifiedExcerpts를 유지하려면 ref 에
      // stash. 첫 turn 만 진짜 "사용자 의도"라 다음 turn 부터는 보통
      // [] 로 진행해도 OK 지만 일관성을 위해 같은 칩을 그대로 유지.
      agentVerifiedExcerptsRef.current = verifiedExcerpts;
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (text.length === 0 || streaming) return;
    // chunk 99 follow-up — 매 턴 시작 시 stop flag clear.
    agentStoppedRef.current = false;
    // 0.4.19 — 새 user turn 시작 시 router 이력 + cache reset.
    agentToolHistoryRef.current = [];
    resetRouterCache();

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

    // Phase 3 chunk 50 — pin the target doc path at turn start so the
    // Agent loop dispatches to the original doc even if the user
    // switches tabs mid-turn.
    turnTargetPathRef.current = activeDocPath?.() ?? null;

    // chunk 26 — ensure the conversation exists BEFORE starting the
    // stream so onEvent's terminator (which persists the assistant
    // turn) sees a non-null conversationIdRef. We await the create +
    // user-append so persistence is in lockstep with the visual turn.
    try {
      if (conversationIdRef.current === null) {
        const docPath = turnTargetPathRef.current;
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
    // chunk 75 — clear the attach toggle after a successful send so
    // the user explicitly opts in for each context-attached turn (the
    // doc HTML is already serialized into this turn's system prompt).
    if (attachDoc) setAttachDoc(false);
  }, [
    activeDocPath,
    attachDoc,
    excerpts,
    fireChat,
    input,
    messages,
    setAttachDoc,
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
      agentStoppedRef.current = false;
      const userMsg: UiMessage = {
        id: newId(),
        role: 'user',
        content: trimmed,
      };
      // Phase 3 chunk 50 — pin target doc at turn start (parity with
      // `send`). selection-menu invocation always runs against the doc
      // the selection lives in, which is the active doc here.
      turnTargetPathRef.current = activeDocPath?.() ?? null;
      try {
        if (conversationIdRef.current === null) {
          const docPath = turnTargetPathRef.current;
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
      // chunk 75 — same auto-unset as `send`. selection-menu invocation
      // counts as one explicit attach turn.
      if (attachDoc) setAttachDoc(false);
    },
    [activeDocPath, attachDoc, fireChat, messages, setAttachDoc, streaming],
  );

  // useImperativeHandle for ChatPanelHandle stays in ChatPanel — it
  // needs the `ref` from forwardRef. We expose `sendDirect` for the
  // caller to wire up.

  const regenerate = useCallback(
    (assistantId: string) => {
      if (streaming) return;
      agentStoppedRef.current = false;
      const idx = messages.findIndex((m: any) => m.id === assistantId);
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
      setMessages((prev: any) => prev.filter((m: any) => m.id !== id));
    },
    [streaming],
  );

  const copyMessage = useCallback(
    async (id: string): Promise<boolean> => {
      const m = messages.find((x: any) => x.id === id);
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
    // chunk 99 follow-up — Agent loop 도 강제 종료. abort 만으로는
    // (a) 이미 dispatch 된 tool 의 결과 메시지가 들어가고
    // (b) queueMicrotask 로 예약된 fireChat 재귀가 순서대로 실행돼
    // 다음 turn 이 시작될 수 있음. agentStoppedRef 를 set 하면
    // advanceAgentLoop 가 next turn 진입 전에 short-circuit.
    agentStoppedRef.current = true;
    agentTurnDepthRef.current = 0;
    agentVerifiedExcerptsRef.current = [];
    assistantBufferRef.current = '';
    setStreaming(false);
    assistantIdRef.current = null;
  }, []);

  // chunk 97 — turn finalization helper. 모든 tool 결과가 모이면 호출되어
  // (1) UI tool-entry 상태 갱신 (2) tool_result 메시지 합성 (3) cap 검사
  // (4) fireChat 재귀로 next turn 진입. 즉시 dispatch 경로 (read /
  // autoApprove) 와 사용자 승인 경로 (resolveApproval) 가 같은 종착점.
  async function advanceAgentLoop(
    toolUses: { id: string; name: string; args: unknown }[],
    partialResults: Map<string, PartialToolResult>,
    assistantId: string | null,
  ): Promise<void> {
    const toolResults: PartialToolResult[] = toolUses.map((tu) => {
      return (
        partialResults.get(tu.id) ?? {
          id: tu.id,
          name: tu.name,
          ok: false,
          reason: 'no-result',
        }
      );
    });
    if (assistantId) {
      setMessages((prev: any) =>
        prev.map((m: any) => {
          if (m.id !== assistantId || !m.toolEntries) return m;
          return {
            ...m,
            toolEntries: m.toolEntries.map((te: any) => {
              const r = toolResults.find((x) => x.id === te.id);
              if (!r) return te;
              if (r.reason === 'user-rejected') {
                return { ...te, status: 'rejected', reason: r.reason };
              }
              // 0.4.11 — 결과 JSON 미리 stringify 해 UI 의 확장 패널이
              // 클릭 시 즉시 보여줄 수 있게. read tools 16k / write 4k cap
              // (advanceAgentLoop 의 tool-result 메시지 cap 정합).
              let resultPreview: string | undefined;
              try {
                if (r.ok && r.data !== undefined) {
                  let json = JSON.stringify(r.data, null, 2);
                  const cap = isReadOnlyTool(r.name) ? 16384 : 4096;
                  if (json.length > cap) json = json.slice(0, cap) + '…';
                  resultPreview = json;
                } else if (r.ok) {
                  resultPreview = `ok: ${r.name}`;
                } else {
                  resultPreview = `error: ${r.reason ?? '?'}`;
                }
              } catch {
                resultPreview = '(non-serializable)';
              }
              return {
                ...te,
                status: r.ok ? 'ok' : 'failed',
                reason: r.reason,
                resultPreview,
              };
            }),
          };
        }),
      );
    }
    agentTurnDepthRef.current += 1;
    setAgentTurn?.(agentTurnDepthRef.current);
    const maxTurns = loadAgentMaxTurns();
    if (agentTurnDepthRef.current >= maxTurns) {
      setError(
        `Agent: 한 작업 turn 한계 (${maxTurns}) 도달. Settings → AI 공급자 → "Agent turn 한계" 에서 조절 가능.`,
      );
      agentTurnDepthRef.current = 0;
      setAgentTurn?.(0);
      agentVerifiedExcerptsRef.current = [];
      assistantBufferRef.current = '';
      setStreaming(false);
      handleRef.current = null;
      assistantIdRef.current = null;
      return;
    }
    setMessages((prev: any) => {
      const toolMsgs: UiMessage[] = toolResults.map((r) => {
        let content: string;
        if (r.ok) {
          if (r.data !== undefined) {
            let json: string;
            try {
              json = JSON.stringify(r.data);
            } catch {
              json = String(r.data);
            }
            // Read tools (outline, find, style list, search workspace 등)
            // 의 결과는 모델의 reasoning 입력. 잘리면 양식 매칭 / 좌표
            // 결정 부정확. 16k 까지 허용. write tools 는 ok/error
            // 정도면 충분 — 4k 유지.
            const cap = isReadOnlyTool(r.name) ? 16384 : 4096;
            if (json.length > cap) json = json.slice(0, cap) + '…';
            content = json;
          } else {
            // chunk 99 follow-up — write 성공 시 상태 hint 를 모델에
            // 알려서 retry / verification 판단 도움. e.g. "ok: insertText
            // (14자 추가)" 같은 메타. 현재는 인자 메타 없으니 단순 ok.
            content = `ok: ${r.name}`;
          }
        } else {
          // chunk 99 follow-up — 실패 사유에 retry hint 추가. agent loop
          // 가 다음 turn 에 같은 도구를 그대로 재호출하지 않도록.
          const reason = r.reason ?? '?';
          content = `error: ${reason}. 재호출 전에 인자를 점검하거나 다른 접근을 검토해.`;
        }
        return {
          id: newId(),
          role: 'tool' as const,
          content,
          toolResult: { id: r.id, content, isError: !r.ok },
        };
      });
      const next = [...prev, ...toolMsgs];
      queueMicrotask(() => {
        // chunk 99 follow-up — stop 버튼이 mid-loop 에 눌리면 다음
        // turn 진입을 차단. tool 결과 메시지는 그대로 history 에 남음.
        if (agentStoppedRef.current) return;
        fireChatRef.current?.(next, agentVerifiedExcerptsRef.current);
      });
      return next;
    });
    assistantBufferRef.current = '';
    handleRef.current = null;
    assistantIdRef.current = null;
  }

  // chunk 97 — pending write tool 사용자 결정 처리. accept=true: dispatch
  // 후 결과 stash. false: rejected 결과 stash. 모든 pending 처리되면
  // advanceAgentLoop 로 next turn 진입.
  const resolveApproval = useCallback(
    async (toolUseId: string, accept: boolean) => {
      const turn = pendingTurnRef.current;
      if (!turn) return;
      if (!turn.pendingCalls.has(toolUseId)) return;
      const call = turn.pendingCalls.get(toolUseId)!;
      const tu = turn.toolUses.find((t) => t.id === toolUseId);
      if (!tu) return;

      // 입력 단계 UI: 즉시 status=running 으로 표기 (dispatch 중).
      if (turn.assistantId && accept) {
        setMessages((prev: any) =>
          prev.map((m: any) => {
            if (m.id !== turn.assistantId || !m.toolEntries) return m;
            return {
              ...m,
              toolEntries: m.toolEntries.map((te: any) =>
                te.id === toolUseId ? { ...te, status: 'running' } : te,
              ),
            };
          }),
        );
      }

      const dispatcher = runToolsPropRef.current;
      if (accept) {
        if (!dispatcher) {
          turn.partialResults.set(toolUseId, {
            id: tu.id,
            name: tu.name,
            ok: false,
            reason: 'dispatcher-unavailable',
          });
        } else {
          const out = await dispatcher(
            [{ ok: true, call }],
            turnTargetPathRef.current,
          );
          const first = out[0];
          if (first && first.ok) {
            turn.partialResults.set(toolUseId, {
              id: tu.id,
              name: tu.name,
              ok: true,
              data: first.data,
            });
          } else {
            turn.partialResults.set(toolUseId, {
              id: tu.id,
              name: tu.name,
              ok: false,
              reason: first?.ok === false ? first.reason : 'unknown',
            });
          }
        }
      } else {
        turn.partialResults.set(toolUseId, {
          id: tu.id,
          name: tu.name,
          ok: false,
          reason: 'user-rejected',
        });
      }
      turn.pendingCalls.delete(toolUseId);

      if (turn.pendingCalls.size > 0) {
        // 부분 갱신 — 이 entry 만 ok/failed/rejected 로 표기. 나머지 pending.
        if (turn.assistantId) {
          const r = turn.partialResults.get(toolUseId)!;
          setMessages((prev: any) =>
            prev.map((m: any) => {
              if (m.id !== turn.assistantId || !m.toolEntries) return m;
              return {
                ...m,
                toolEntries: m.toolEntries.map((te: any) =>
                  te.id === toolUseId
                    ? r.reason === 'user-rejected'
                      ? { ...te, status: 'rejected', reason: r.reason }
                      : {
                          ...te,
                          status: r.ok ? 'ok' : 'failed',
                          reason: r.reason,
                        }
                    : te,
                ),
              };
            }),
          );
        }
        return;
      }

      // 모든 pending resolve — next turn 진입. streaming 다시 켜서 사용자
      // 가 새 입력을 못 보내도록 하고 fireChat 재귀.
      const finalized = turn;
      pendingTurnRef.current = null;
      setStreaming(true);
      await advanceAgentLoop(
        finalized.toolUses,
        finalized.partialResults,
        finalized.assistantId,
      );
    },
    // setMessages / setError / setStreaming 은 안정 ref. 다른 deps 없음.

    [],
  );

  return {
    fireChat,
    send,
    sendDirect,
    regenerate,
    deleteMessage,
    copyMessage,
    onSubmit,
    onKeyDown,
    stop,
    agentToolUsesRef,
    agentTurnDepthRef,
    agentVerifiedExcerptsRef,
    resolveApproval,
    requestPlanSkip: () => {
      planSkipNextRef.current = true;
    },
  };
}
