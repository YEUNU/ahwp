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
import { getAhwpToolCatalog, validateToolCall } from '@shared/ai-tools';
import type { ExcerptAttachment } from '@shared/ai-excerpt';
import {
  SYSTEM_PROMPT_DOC_CONTEXT,
  SYSTEM_PROMPT_AGENT_GUIDE,
  collectReferenceOutlines,
  buildReferenceSystemBlock,
  buildExcerptSystemPrompt,
} from '../prompts';

interface UiToolEntry {
  id: string;
  name: string;
  argsPreview: string;
  status: 'running' | 'ok' | 'failed';
  reason?: string;
}

interface UiMessage extends ChatMessage {
  id: string;
  toolEntries?: UiToolEntry[];
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const AGENT_MAX_TOOLS_PER_TURN = 10;

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
}

export function useChatStreaming(
  opts: UseChatStreamingOptions,
): ChatStreamingHandle {
  const {
    conversationIdRef,
    autoTitledConvIdsRef,
    providerRef,
    modelRef,
    chatModeRef,
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
    (evt: ChatStreamEvent) => {
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
          // Phase 3 chunk 50 — Agent 루프 안에서는 turn 시작 시점의
          // target path 로 고정 dispatch. 사용자가 mid-turn 에 탭을
          // 전환해도 원본 doc 에 적용된다.
          const out = dispatcher(
            [{ ok: true, call: v.value }],
            turnTargetPathRef.current,
          );
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
          setMessages((prev: any) =>
            prev.map((m: any) => {
              if (m.id !== assistantId || !m.toolEntries) return m;
              return {
                ...m,
                toolEntries: m.toolEntries.map((te: any) => {
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
        setMessages((prev: any) => {
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
    setStreaming(false);
    assistantIdRef.current = null;
  }, []);

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
  };
}
