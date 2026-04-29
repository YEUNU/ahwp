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

## 공통 인터페이스

`shared/ai.ts`:

```ts
export interface ChatRequest {
  conversationId: string;
  filePath: string;
  messages: ChatMessage[]; // user/assistant/tool
  mode: 'manual' | 'agent';
  documentContext: DocumentContext; // 현재 문서 발췌·메타
}

export interface DocumentContext {
  hwpxPath: string;
  selectionRange?: TextRange;
  outline?: HeadingNode[];
  // Agent 모드에서는 추가로 tool 호출 가능 영역 정의
}

export interface ChatStreamEvent {
  type:
    | 'token'
    | 'tool-call'
    | 'tool-result'
    | 'edit-proposal'
    | 'done'
    | 'error';
  payload: unknown;
}

export interface Provider {
  id: ProviderId;
  listModels(): Promise<ModelInfo[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatStreamEvent>;
}
```

## 웹검색 (Built-in)

"단일 API 호출만으로 모델이 웹을 검색하고 결과를 답변에 반영하는가"의 관점. 별도 검색 API(Serper, Tavily 등)나 RAG 파이프라인을 ahwp가 직접 호스트하지 않아도 되는 provider만 ✅.

| Provider   | 활성화 방법                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------ |
| OpenAI     | Responses API의 `tools: [{ type: "web_search" }]` (또는 Chat Completions의 `web_search_preview`) |
| Anthropic  | Messages API의 `tools: [{ type: "web_search_20250305", name: "web_search" }]` 서버 도구          |
| Google     | `tools: [{ googleSearch: {} }]` grounding (Gemini 2.x)                                           |
| NVIDIA NIM | 미지원 — 추론 전용. 필요 시 NeMo Retriever 등 별도 서비스로 검색 후 메시지에 컨텍스트로 주입     |
| Ollama     | 미지원 — 로컬 추론 전용. 필요 시 사용자가 직접 검색 결과를 메시지에 첨부하거나 외부 도구 호출    |
| 커스텀     | 엔드포인트 구현체에 따라 다름. 기본은 미지원으로 가정                                            |

ahwp의 단일 채팅 인터페이스가 어디까지 책임지는지를 명확히 하기 위해 **MVP 범위에서는 외부 검색 서비스(Serper/Tavily/SerpAPI 등)를 직접 통합하지 않습니다.** 사용자가 "웹에서 찾아줘" 같은 요청을 했을 때:

- ✅ 가능 provider(OpenAI/Anthropic/Google) 활성: 해당 SDK의 server tool을 켜고 결과를 일반 응답으로 받아 챗 패널에 출력 (인용 메타데이터는 별도 컴포넌트로 표시)
- ❌ 미지원 provider 활성: 채팅창에 "현재 백엔드는 웹검색을 지원하지 않습니다. 다른 provider로 전환하거나, 검색 결과를 직접 첨부해 주세요" 안내

설정 토글: provider별로 **"이 provider에서 웹검색 허용"** 체크박스(기본 off). 켜진 경우에만 SDK tool 정의에 검색 도구가 추가됨. 한 turn당 검색 호출 수 상한과 fetch 도메인 화이트리스트는 `agent` 모드의 안전 장치(아래 §Agent 모드)와 동일한 메커니즘 재사용.

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
      "anchor": { "kind": "paragraph", "index": 4 },
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

## Agent 모드 — Tool Use

각 provider의 tool 정의로 hwpctl 호환 함수를 노출. 예시:

```ts
{
  name: "insert_text",
  description: "Insert text at the given anchor in the current document.",
  parameters: {
    type: "object",
    properties: {
      anchor: { $ref: "#/$defs/Anchor" },
      text: { type: "string" }
    },
    required: ["anchor", "text"]
  }
}
```

### 화이트리스트 (초기)

- `insert_text` / `replace_text` / `delete_range`
- `apply_paragraph_style` / `apply_char_style`
- `insert_table` / `set_cell_text` / `delete_row` / `delete_column`
- `insert_heading`
- `find` (검색만, 수정 X)

### 안전 장치

- 한 turn 내 tool 호출 횟수 상한 (기본 20회)
- 한 번 호출에 영향 받는 텍스트 길이 상한 (기본 5000자)
- 모든 tool 호출은 한 묶음 undo로 grouping
- 사용자가 채팅창에서 "중단" 클릭 시 즉시 abort
- Agent 모드에서도 destructive 액션(전체 문서 삭제, 파일 저장 등)은 불가 — 저장은 항상 사용자 명시 액션

## 두 가지 시작 시나리오

ahwp는 **빈 문서 작성**과 **기존 문서 수정** 두 워크플로우를 같은 챗·도구 인터페이스로 처리합니다. 차이는 시스템 프롬프트에 주입되는 컨텍스트뿐입니다.

### 빈 문서 작성

- `documentContext.outline`이 비어있고 본문도 비어있음
- AI에게 "이번 분기 매출 보고서 양식 만들어줘" 같은 요청 가능
- Manual 모드: AI가 처음에는 큰 구조(제목·소제목·표 골격)를 `ahwp-edit` 패치로 제안 → 승인 후 점진적으로 채움
- Agent 모드: AI가 `insert_heading`, `insert_text`, `insert_table` 등을 연쇄 호출해 한 번에 양식 작성. 사용자는 결과를 보고 수정 요청

### 기존 문서 수정

- `documentContext.outline`에 제목 트리, `selection`이 있으면 사용자가 가리킨 영역
- "이 단락 더 격식 있게 다듬어" / "표 두 번째 행 합계 다시 계산" 등 **국소 편집** 위주
- AI가 본문 추가 영역을 보려면 Agent 모드에서 `find` tool 호출

> 모드(Manual/Agent)와 시작 시나리오(빈 문서/기존)는 직교(orthogonal). 어느 조합도 가능.

## 시스템 프롬프트 (초안)

````
You are ahwp, an editing assistant for Korean (HWPX) documents.

Hard rules:
- Reply in Korean unless the user writes in another language.
- The document may be empty (a new blank file) or an existing file the user
  is editing. Adapt accordingly:
  - If empty: help the user draft from scratch. You may propose structural
    edits (headings, tables, sections) without asking, since there's nothing
    to break. Still ask for clarification on ambiguous goals.
  - If non-empty: never invent existing document content — if you don't
    have the relevant section in context, say so and ask, or use the `find`
    tool (Agent mode) to locate it.
- In Manual mode you MUST emit changes as ```ahwp-edit JSON blocks. Do not
  edit by writing prose like "change X to Y" — use the protocol.
- In Agent mode you MUST use the provided tools. Never describe edits in
  prose; call the tool.
- Preserve formatting, tables, and styles unless the user asks to change them.

Document context:
- File: {{filePath or "(새 빈 문서)"}}
- State: {{"empty" | "existing"}}
- Outline: {{outline or "(없음)"}}
- Selection: {{selection or "none"}}
````

문서 본문 전체는 토큰 비용 때문에 매번 넣지 않음. 대신:

- 아웃라인(제목 트리)은 항상 포함
- 사용자가 선택한 영역은 본문 그대로 포함
- 그 외 영역이 필요해지면 AI가 `find` tool로 검색해 가져감 (Agent 모드)
- Manual 모드에서는 사용자가 "이 단락" 같은 표현 사용 시, 클라이언트가 현재 caret/selection 부근 N단락을 자동 첨부

## 토큰 비용·성능

- 큰 문서는 outline + 선택 영역 + 최근 N개 메시지만 매 요청에 포함
- 사용자가 "전체 문서 검토" 류 요청 시 명시적 확인 다이얼로그 (예상 토큰 안내)
- 응답 캐시는 하지 않음 (편집 의도가 매번 다름)
- 실패 시 retry는 2회까지 지수 백오프

## 에러·재시도

| 상황                      | 처리                                                          |
| ------------------------- | ------------------------------------------------------------- |
| 키 누락                   | UI에서 즉시 Settings로 안내                                   |
| 네트워크 실패             | 채팅창에 인라인 에러 + 재시도 버튼                            |
| Rate limit                | provider별 응답 헤더 파싱 → 백오프 후 자동 재시도 1회         |
| Tool 인자 검증 실패 (zod) | 모델에게 에러 메시지 피드백, 1회 재시도 후 사용자에게 보고    |
| Agent 모드 무한 루프 의심 | tool 호출 한도 초과 시 강제 종료 + "수동으로 확인하세요" 안내 |
