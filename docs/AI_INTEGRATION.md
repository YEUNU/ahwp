# AI 통합 설계

## 공급자 매트릭스

| Provider   | SDK                            | 스트리밍 | Tool Use              | 단일 API 웹검색             | 비고                                                                                           |
| ---------- | ------------------------------ | -------- | --------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| OpenAI     | `openai`                       | ✅       | ✅ (function/tool)    | ✅ Responses `web_search`   | GPT-4o, GPT-5 등. 가장 안정                                                                    |
| Anthropic  | `@anthropic-ai/sdk`            | ✅       | ✅                    | ✅ `web_search` server tool | Claude. 긴 문서 편집 강점                                                                      |
| Google     | `@google/genai`                | ✅       | ✅ (function calling) | ✅ `googleSearch` grounding | Gemini 2.x                                                                                     |
| NVIDIA NIM | `fetch` (OpenAI 호환 endpoint) | ✅       | 모델별로 다름         | ❌                          | 호스티드(`https://integrate.api.nvidia.com/v1`) 또는 셀프호스트 NIM 컨테이너. 검색은 외부 처리 |
| Ollama     | `fetch` (OpenAI 호환 endpoint) | ✅       | 모델별로 다름         | ❌                          | base URL 사용자 입력 (`http://localhost:11434/v1`)                                             |
| 커스텀     | `fetch` (OpenAI 호환)          | ✅       | 모델별로 다름         | ❌ (기본)                   | 사용자가 IP/포트/키 직접 입력 — vLLM, LM Studio, 사내 서빙 등                                  |

## 오케스트레이션 — LangChain/LangGraph 미도입

자체 `Provider` 인터페이스 + 한 turn 안의 단순 tool-call 루프로 구현. LangChain/LangGraph는 다음 이유로 채택하지 않음.

- 각 provider의 server-side 기능(OpenAI Responses `web_search`, Anthropic `web_search_20250305`, Google `googleSearch` grounding)은 native SDK를 직접 호출해야 가장 빠르고 정확하게 활용 가능. 추상화를 한 단계 더 거치면 새 기능 반영이 늦어짐.
- 화이트리스트 tool이 ~10여 개이며 `@rhwp/core` IR 호출에 1:1 매핑되는 단순 구조. graph orchestration의 가치가 작음.
- Electron 데스크탑 번들의 transitive 의존성·공급망 표면·업데이트 주기 부담.
- 멀티 에이전트, 장기 체크포인트, 복잡한 분기 같은 LangGraph 강점이 필요해지면 Phase 5+에서 재평가.

대신 `electron/ipc/ai.ts`에 ~80–150줄짜리 turn 루프를 직접 작성하고, provider별 어댑터가 SDK 스트림을 공통 `ChatStreamEvent`로 정규화.

## 공통 인터페이스

`shared/ai.ts`:

```ts
export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'nvidia'
  | 'ollama'
  | 'custom';

export interface ChatRequest {
  conversationId: string;
  requestId: string; // 스트림/툴콜 매칭용
  mode: 'manual' | 'agent';
  messages: ChatMessage[]; // user/assistant/tool
  context: ChatContext;
  webSearch: 'off' | 'on'; // provider 지원 시에만 효력
}

export interface ChatContext {
  target: DocRef; // 편집 대상 (활성 탭이 디폴트)
  references: DocRef[]; // 읽기 전용 참조
}

export interface DocRef {
  docId: string; // 메모리상 UUID
  path: string | null; // 새 빈 문서면 null
  outline: HeadingNode[]; // 항상 포함 (저렴)
  selection?: TextRange; // target 전용
  role: 'target' | 'reference';
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  excerpts?: ExcerptAttachment[]; // 사용자 드래그 첨부 (§발췌 드래그)
  toolCalls?: ToolCall[]; // assistant 메시지의 tool 요청
  toolCallId?: string; // tool 메시지의 매칭 id
}

export interface ExcerptAttachment {
  id: string;
  docId: string;
  path: string | null;
  role: 'target' | 'reference';
  anchor: TextRange; // {paragraphIndex, startOffset, endOffset}
  text: string; // 드롭 시점 박제 본문
  hash: string; // 전송 직전 stale 검증용 (sha1(text))
}

export type ChatStreamEvent =
  | { type: 'token'; text: string }
  | { type: 'tool-call'; callId: string; name: string; args: unknown }
  | {
      type: 'tool-result';
      callId: string;
      ok: boolean;
      value?: unknown;
      error?: string;
    }
  | { type: 'edit-proposal'; patch: AhwpEdit } // Manual 모드
  | { type: 'web-search'; query: string; sources: WebSource[] } // 인용 표시용
  | { type: 'done'; usage?: TokenUsage }
  | { type: 'error'; message: string };

export interface Provider {
  id: ProviderId;
  capabilities: {
    toolUse: boolean;
    webSearch: boolean; // 단일 API 웹검색 지원 여부
    streaming: boolean;
  };
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;
}
```

`capabilities.webSearch`는 정적 플래그로 시작: OpenAI/Anthropic/Google = `true`, NIM/Ollama/커스텀 = `false`. 셀프호스트 환경의 커스텀이 검색 도구를 지원하면 사용자 설정에서 override.

## 웹검색 (Built-in)

"단일 API 호출만으로 모델이 웹을 검색하고 결과를 답변에 반영하는가" 관점. 별도 검색 API(Serper, Tavily 등)나 RAG 파이프라인을 ahwp가 직접 호스트하지 않는다는 의미로 ✅. **MVP 범위에서는 외부 검색 서비스 직접 통합 안 함.**

### Provider별 활성화

| Provider   | 활성화 방법                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ |
| OpenAI     | Responses API의 `tools: [{ type: "web_search" }]` (또는 Chat Completions의 `web_search_preview`) |
| Anthropic  | Messages API의 `tools: [{ type: "web_search_20250305", name: "web_search" }]` 서버 도구          |
| Google     | `tools: [{ googleSearch: {} }]` grounding (Gemini 2.x)                                           |
| NVIDIA NIM | 미지원 — 추론 전용                                                                               |
| Ollama     | 미지원 — 로컬 추론 전용                                                                          |
| 커스텀     | 엔드포인트 구현체에 따라 다름. 기본 미지원 가정                                                  |

### 어댑터 라우팅 규칙

각 provider 어댑터는 `req.webSearch === 'on'` 이고 자기 `capabilities.webSearch === true` 일 때만 SDK tool 정의에 검색 도구를 주입. 그 외엔 무시. 토글이 켜졌는데 active provider가 미지원이면:

- 채팅창 인라인 안내: "현재 백엔드는 단일 API 웹검색을 지원하지 않습니다. 다른 provider로 전환하거나 검색 결과를 직접 첨부해 주세요."
- 토글은 켠 상태 유지 — provider를 바꾸면 자동 효력 발생

### Agent tool 루프와의 관계

웹검색 server tool은 provider 측에서 **자동 호출**됨. ahwp의 화이트리스트 tool 루프(`insert_text`, `read_range` 등)와는 **별개 채널**:

- OpenAI/Anthropic: 검색 결과가 본문/citations로 들어옴 → 어댑터가 `{type:'web-search', query, sources}` 이벤트로 정규화 후 토큰 스트림 이어짐
- Google grounding: `groundingMetadata`의 source URL 동일하게 정규화

검색 호출은 우리 화이트리스트 tool 카운터에 잡히지 않음. 다만 다음 안전장치는 동일 적용:

- **턴당 검색 호출 상한 5회** (provider 응답 메타에서 도구 호출 횟수 누적)
- **fetch 도메인 화이트리스트** — provider가 노출하는 경우만(OpenAI Responses의 `allowed_domains` 등). 미지원 provider는 모델 신뢰
- 사용자 "중단" → `AbortSignal`로 stream 끊으면 검색도 함께 중단

### UI

- Settings: provider별 "웹검색 허용" 체크박스 (기본 off)
- ChatInput 옆 🔍 토글 — 현재 active provider의 `capabilities.webSearch`가 true일 때만 활성. 켠 채로 메시지 보내면 그 메시지에만 검색 적용 (대화 단위로 기억하지 않음 → 비용/의도 명시성)
- 응답에 인용 포함 시 메시지 하단 source 카드 (URL + 발췌)

### 사용자 의도 자동 감지는 안 함

"최신 환율 알려줘" 같은 메시지를 보고 검색을 자동 활성하는 휴리스틱은 도입하지 않음. BYOK 모델에서 비결정적 비용이 발생하고 사용자 통제를 해치므로 **명시 토글만**.

## 멀티 다큐먼트 모델

사용자가 "B의 뉘앙스로 A 다듬어줘" 같은 cross-document 요청을 하므로, 채팅은 다중 문서 컨텍스트를 1급으로 다룸.

### DocRef 역할

- **target**: 편집 대상. 활성 탭이 자동 지정. write tool 호출은 항상 target에만 적용
- **reference**: 읽기 전용 참조. read/분석 tool은 호출 가능, write tool은 차단

ChatPanel 상단에 "이 대화에 포함할 문서" 칩 — 활성 탭은 자동 잠긴 target, 다른 열린 탭은 체크박스로 reference 추가. 칩 옆에 outline 토큰 추정치 표시.

### 컨텍스트 주입 전략 (토큰 절약)

- target: outline + selection 주변 ±N 단락
- reference: **outline만**. 본문은 모델이 `read_range(refDocId, ...)` / `analyze_style(refDocId)`로 필요 시 fetch
- 예외: reference가 짧고(<1500자) 사용자가 명시적 "통째로 참고" 토글 시 인라인

### Tool 분류 (read는 모든 doc, write는 target)

| 종류  | 도구                                                                                                                                                                    | docId 인자         |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| write | `insert_text`, `replace_text`, `delete_range`, `apply_para_style`, `apply_char_style`, `insert_table`, `set_cell_text`, `delete_row`, `delete_column`, `insert_heading` | 없음 (target 고정) |
| read  | `read_range`, `read_outline`, `find`, `get_style_at`, `get_paragraph_text`                                                                                              | 필수 (target/ref)  |
| 분석  | `analyze_style(docId, range?)` — 평균 문장 길이, 격식·구어 종결어 비율, 한자어 비율, 정렬·들여쓰기 분포, 자주 쓰는 접속사 통계 + 샘플 발췌                              | 필수               |

`analyze_style`이 멀티 doc 시나리오 핵심. 모델이 "B의 톤"을 직접 추정하지 않고 IR 기반 정량 지표를 받아 결정성·재현성↑.

### Tool 실행 위치

`@rhwp/core`의 살아있는 IR은 렌더러의 `StudioViewer`가 보유 (`docs/ARCHITECTURE.md` L62). 따라서:

```
Renderer (IR 보유)              Main (키·SDK·오케스트레이션)
─────────────────              ───────────────────────────
ChatPanel ──ai:chat-start──►   Provider 어댑터
                                 │ SDK 스트림 → tool-call 감지
   ai:tool-execute  ◄──────────  │
   ToolRouter                    │
   (docId로 HwpDocument dispatch)│
   ai:tool-result  ───────────►  결과를 모델에 피드백
                                 │ ...
                                 └─ ai:chat-stream {type:'done'}
```

이 분리로 (a) API 키는 main에만, (b) IR 일관성은 렌더러에만 유지.

### IPC 채널

```
ai:chat-start    R→M    { reqId, ctx, mode, messages, webSearch }   ack
ai:chat-cancel   R→M    { reqId }                                   void
ai:chat-stream   M→R    { reqId, event: ChatStreamEvent }           event
ai:tool-execute  M→R    { reqId, callId, name, args }               event
ai:tool-result   R→M    { reqId, callId, ok, value|error }          ack
ai:apply-diff    R→M    { docId, patch }                            { ok }
```

`docs/ARCHITECTURE.md`의 IPC 테이블도 동기화할 것.

## 발췌 드래그 첨부

문서에서 드래그한 텍스트를 채팅 입력의 1급 첨부(`ExcerptAttachment`)로 받음. 명령 + 발췌가 한 메시지로 묶여서 가는 형태.

### 드래그 발생 — `StudioViewer`

기존 selection 모델 위에 HTML5 드래그 훅 추가:

```ts
e.dataTransfer.setData(
  'application/x-ahwp-excerpt',
  JSON.stringify({
    docId,
    path,
    anchor: selectionRange,
    text,
    hash: sha1(text),
  }),
);
e.dataTransfer.setData('text/plain', text); // 외부 앱 폴백
```

`text/plain` 폴백 덕에 메모장·브라우저 등으로 끌어도 일반 텍스트로 떨어짐. 채팅 입력만이 `application/x-ahwp-excerpt`를 인식해서 칩으로 승격.

### 드롭 — `ChatInput`

- 드롭 → 칩으로 변환. 활성 탭 출처면 기본 `target`, 다른 탭이면 `reference` (클릭 토글)
- 외부 탭에서 끌어왔는데 그 탭이 reference 칩 목록에 없으면 자동 추가
- 칩 X로 제거. 길이 큰 발췌(>2000자)는 ⚠️ 토큰 경고
- 입력란 텍스트(명령) + 칩 배열이 함께 한 메시지로 전송

### anchor stale 처리

드래그 시점과 전송 시점 사이에 사용자가 그 단락을 편집하면 offset 어긋남:

1. 드롭 시 `hash = sha1(text)` 박제
2. 전송 직전 ToolRouter가 anchor에서 다시 읽어 hash 비교
3. 일치 → 사용
4. 불일치 → IR 전체에서 `text` 재탐색(1회) → 찾으면 anchor 자동 갱신 + 칩 "위치 갱신됨" 표시
5. 못 찾음 → 칩 빨강, 전송 차단, 사용자에 "다시 선택" 요구

### 프롬프트 직렬화

발췌는 user 메시지 본문 뒤에 구조화 블록으로 부착:

```
{user.content}

첨부:
[1] role=target  doc="제안서.hwp"  anchor={para:4, [12,58]}
    "현행 문안을 다음과 같이 변경합니다."
[2] role=reference doc="규정집.hwp" anchor={para:12, [0,87]}
    "이에 따라 본 위원회는 다음과 같이 의결한다."
```

시스템 프롬프트 규칙:

- target 발췌 = 수정 대상. 패치/도구 호출의 anchor로 직접 사용
- reference 발췌 = 읽기 전용 인용. 절대 수정 대상 아님
- 사용자가 "이 단락"이라 쓰면 첨부의 target 발췌를 가리킴

### 모드별 동작

- **Manual**: target 발췌의 anchor를 `ahwp-edit` 패치에 그대로 사용 → 매칭/find 단계 생략
- **Agent**: target anchor → `replace_text(anchor, with=...)` 직접 호출. reference 본문이 첨부에 충분하면 추가 `read_range` 호출 없이 끝나는 경우가 많음 → tool 호출↓, 비용↓, 지연↓

## 키 관리

- 키는 절대 `electron-store` JSON에 평문 저장하지 않음
- `safeStorage.encryptString(key)` 결과를 base64로 SQLite `secrets` 테이블에 보관
- 렌더러는 키 자체를 받아보지 않음 — 메인이 요청 시 복호화해 즉시 사용 후 폐기
- 설정 화면에서 키 표시는 마스킹(`sk-...abc1`), 새로 입력해야 변경

## Manual 모드 — Edit Proposal 프로토콜

AI가 일반 텍스트 응답 안에 변경 제안을 JSON 블록으로 반환:

````
이 단락을 더 격식 있게 다듬으면 다음과 같습니다.

```ahwp-edit
{
  "rationale": "구어체 종결을 격식 종결로 변경",
  "patches": [
    {
      "anchor": { "kind": "paragraph", "index": 4, "range": [12, 58] },
      "replace": "현행 문안을 다음과 같이 변경합니다.",
      "with":    "현행 문안을 아래와 같이 개정합니다."
    }
  ]
}
```

이렇게 변경하면 보고서 톤에 더 적합합니다.
````

렌더러는:

1. 마크다운 렌더 시 ```ahwp-edit` 블록을 별도 컴포넌트로 치환
2. Accept 버튼 → `ai:apply-diff` IPC 호출
3. 메인에서 `@rhwp/core` API로 patch 적용 후 새 hwpx 반환

> 명세는 `shared/edit-protocol.ts`에 zod 스키마로 박제 — 모델 응답 검증 + 프롬프트에서도 같은 스키마 인용.

target 발췌가 첨부된 경우 모델은 발췌의 `anchor`를 그대로 패치 anchor로 사용해야 함 (시스템 프롬프트에 명시). 따라서 렌더러는 fuzzy 매칭 없이 즉시 적용 가능.

## Agent 모드 — Tool Use

각 provider의 tool 정의로 hwpctl 호환 함수를 노출. 화이트리스트 정의는 §멀티 다큐먼트 모델의 표 참고. 예시 schema:

```ts
{
  name: "replace_text",
  description: "Replace text in the target document at the given anchor.",
  parameters: {
    type: "object",
    properties: {
      anchor: { $ref: "#/$defs/Anchor" },
      with: { type: "string" }
    },
    required: ["anchor", "with"]
  }
}
```

`read_*` / `analyze_*` 도구는 추가로 `docId: string` 파라미터를 받음.

### 안전 장치

- **턴당 화이트리스트 tool 호출 상한**: 기본 20회
- **턴당 웹검색 호출 상한**: 기본 5회 (별개 카운터)
- 한 번 호출에 영향 받는 텍스트 길이 상한 (기본 5000자)
- 모든 write tool 호출은 한 turn = 한 묶음 undo로 grouping
- 사용자 "중단" 클릭 → `AbortSignal` 즉시 전파 (SDK stream + tool dispatch 동시 취소)
- destructive 액션(전체 문서 삭제, 파일 저장 등)은 화이트리스트에서 제외 — 저장은 항상 사용자 명시 액션
- write tool은 `target` doc에만 dispatch. ToolRouter가 이를 enforce하며, reference에 write 시도 시 tool-result에 에러 반환 후 모델에 재시도 기회 1회

## 두 가지 시작 시나리오

ahwp는 **빈 문서 작성**과 **기존 문서 수정** 두 워크플로우를 같은 챗·도구 인터페이스로 처리합니다. 차이는 시스템 프롬프트에 주입되는 컨텍스트뿐입니다.

### 빈 문서 작성

- `target.outline`이 비어있고 본문도 비어있음
- AI에게 "이번 분기 매출 보고서 양식 만들어줘" 같은 요청 가능
- Manual 모드: AI가 처음에는 큰 구조(제목·소제목·표 골격)를 `ahwp-edit` 패치로 제안 → 승인 후 점진적으로 채움
- Agent 모드: AI가 `insert_heading`, `insert_text`, `insert_table` 등을 연쇄 호출. 사용자는 결과 보고 수정 요청

### 기존 문서 수정

- `target.outline`에 제목 트리, `selection`이 있으면 사용자가 가리킨 영역, 발췌 칩이 있으면 그것이 1차 컨텍스트
- "이 단락 더 격식 있게" / "표 두 번째 행 합계 다시 계산" 등 **국소 편집** 위주
- "B의 뉘앙스로 A 다듬어" 같은 cross-document 요청 시 reference 칩 + `analyze_style(B)` / `read_range(B, ...)` 조합

> 모드(Manual/Agent), 시작 시나리오(빈/기존), 문서 수(단일/다중)는 직교(orthogonal). 어느 조합도 가능.

## 시스템 프롬프트 (초안)

````
You are ahwp, an editing assistant for Korean (HWP) documents.

Hard rules:
- Reply in Korean unless the user writes in another language.
- The session has one TARGET document (you may edit) and zero or more REFERENCE
  documents (read-only). Never invoke write tools on a reference document.
  Reference docs are for citation/style only.
- The target may be empty (a new blank file) or existing. Adapt accordingly:
  - If empty: help the user draft from scratch. You may propose structural edits
    without asking, since there's nothing to break.
  - If non-empty: never invent existing content — if you don't have the relevant
    section in context, say so and ask, or use `find` / `read_range` (Agent mode).
- If the user message has attached EXCERPTS:
  - role=target excerpts are the exact thing to modify. Use the excerpt's
    `anchor` directly in your patch / `replace_text` call. Do not re-locate by
    text matching.
  - role=reference excerpts are inline citations of style/nuance. Do not modify them.
  - When the user writes "이 단락" / "this paragraph", they refer to the target
    excerpts.
- In Manual mode you MUST emit changes as ```ahwp-edit JSON blocks with the
  schema in `shared/edit-protocol.ts`. Do not edit by writing prose like
  "change X to Y".
- In Agent mode you MUST use the provided tools. Never describe edits in prose;
  call the tool.
- Preserve formatting, tables, and styles unless the user asks to change them.
- Web search (when available): the platform may give you a server-side
  `web_search` tool. Use it only when the user explicitly asks to search the web
  or when the answer requires information you don't have. Cite sources in your reply.

Document context:
- Target file: {{target.path or "(새 빈 문서)"}}
- Target state: {{"empty" | "existing"}}
- Target outline: {{target.outline or "(없음)"}}
- Target selection: {{target.selection or "none"}}
- References: {{references[].path or "(없음)"}}
  - Outlines provided inline; bodies must be fetched via read_range/analyze_style.
- Web search capability: {{"on" | "off (provider unsupported)" | "off (user toggle)"}}
````

문서 본문 전체는 토큰 비용 때문에 매번 넣지 않음:

- 모든 doc의 outline은 항상 포함 (저렴)
- target의 selection 부근만 본문 인라인
- target 외 본문은 `read_range` / `analyze_style`로 fetch
- Manual 모드에서 사용자가 "이 단락" 같은 표현을 쓰면 클라이언트가 caret/selection 부근 N단락 자동 첨부

## 토큰 비용·성능

- 큰 문서는 outline + 선택 영역 + 발췌 + 최근 N개 메시지만 매 요청에 포함
- reference 문서는 outline만 (본문은 tool fetch). 짧고 명시 토글된 경우만 인라인
- "전체 문서 검토" 류 요청 시 명시적 확인 다이얼로그 (예상 토큰 안내)
- 응답 캐시는 하지 않음 (편집 의도가 매번 다름)
- 실패 시 retry는 2회까지 지수 백오프
- 웹검색 활성 메시지는 비용 추정에 검색 호출당 추가 요금 가산 (provider 단가표 기준, Settings에 표시)

## 에러·재시도

| 상황                            | 처리                                                                  |
| ------------------------------- | --------------------------------------------------------------------- |
| 키 누락                         | UI에서 즉시 Settings로 안내                                           |
| 네트워크 실패                   | 채팅창 인라인 에러 + 재시도 버튼                                      |
| Rate limit                      | provider 응답 헤더 파싱 → 백오프 후 자동 재시도 1회                   |
| Tool 인자 검증 실패 (zod)       | 모델에게 에러 메시지 피드백, 1회 재시도 후 사용자에게 보고            |
| Agent 모드 무한 루프 의심       | tool 호출 한도 초과 시 강제 종료 + "수동으로 확인하세요" 안내         |
| Reference에 write tool 호출     | tool-result에 "write tools are restricted to target" 반환, 1회 재시도 |
| 발췌 anchor stale (재탐색 실패) | 클라이언트 측에서 전송 차단, 칩 빨강 표시, "다시 선택" 요구           |
| 웹검색 토글 on, provider 미지원 | 채팅창 인라인 안내 + 검색 없이 진행 (응답 생성은 계속)                |
| 웹검색 호출 한도 초과           | provider tool 비활성 후 일반 응답 계속 (강제 종료 X)                  |
