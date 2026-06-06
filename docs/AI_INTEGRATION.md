# AI 통합 설계

> **STATUS (0.7.50 기준)**: 이 문서는 Phase 2/3 설계 **초안**(대략 chunk 18-37)으로, 상당 부분이
> 이후 구현으로 대체됨. 핵심 가치(BYOK·키는 main 만 보유, 도구 화이트리스트·eval 금지, multi-doc
> target/reference, anti-heuristic)는 유효하나 구체적 타입/채널/도구명은 아래 권위 소스를 따른다 —
> `shared/ai.ts` (ChatRequest / ChatStreamEvent / ProviderId), `shared/ai-tools-defined/` (도구 정의,
> 80개), `src/features/chat/` (agent loop, 도구 디스패치), `src/features/rhwp-studio/` (iframe IR).
> 주요 변경: 편집기 = vendored rhwp-studio **iframe** (StudioViewer 폐기), **provider-native tool calling
> 이 라이브 주경로**(턴 cap 50), NIM 제거(0.6.18), Anthropic 어댑터 미구현, provider SDK 미사용(전부 fetch).

## 공급자 매트릭스

| Provider             | 어댑터         | 스트리밍 | Tool Use | 단일 API 웹검색             | 비고                                                                                          |
| -------------------- | -------------- | -------- | -------- | --------------------------- | --------------------------------------------------------------------------------------------- |
| OpenAI               | `fetch` (REST) | ✅       | ✅       | ✅ Responses `web_search`   | 구현됨. provider SDK 미사용                                                                   |
| Google               | `fetch` (REST) | ✅       | ✅       | ✅ `googleSearch` grounding | 구현됨. Gemini 2.x                                                                            |
| 커스텀 (OpenAI 호환) | `fetch`        | ✅       | 모델별   | ❌ (기본)                   | base URL + 키 — Ollama / vLLM / LM Studio / on-prem / **셀프호스트 NIM** 모두 한 슬롯 통합    |
| Anthropic            | — (미구현)     | —        | —        | —                           | `ProviderId` union 에 예약돼 있으나 어댑터 없음 — 호출 시 "not implemented yet". 키 결정 대기 |

> ~~NVIDIA NIM 전용 어댑터~~ 는 0.6.18 에서 제거 (vision 부재로 form-fill 시각 검증 비호환). 셀프호스트 NIM 은 OpenAI-호환이라 `custom` 슬롯으로 흡수.

## 오케스트레이션 — LangChain/LangGraph 미도입

자체 `Provider` 인터페이스 + 한 turn 안의 단순 tool-call 루프로 구현. LangChain/LangGraph는 다음 이유로 채택하지 않음.

- 각 provider의 server-side 기능(OpenAI Responses `web_search`, Anthropic `web_search_20250305`, Google `googleSearch` grounding)은 native SDK를 직접 호출해야 가장 빠르고 정확하게 활용 가능. 추상화를 한 단계 더 거치면 새 기능 반영이 늦어짐.
- 화이트리스트 tool이 **80개**(read-only 22 + mutating 58, `shared/ai-tools-defined/`)이며 대부분 `@rhwp/core` IR 호출에 매핑되는 단순 구조. graph orchestration(LangChain 등)의 가치가 작음 — 자체 라우팅으로 충분.
- Electron 데스크탑 번들의 transitive 의존성·공급망 표면·업데이트 주기 부담.
- 멀티 에이전트, 장기 체크포인트, 복잡한 분기 같은 LangGraph 강점이 필요해지면 Phase 5+에서 재평가.

대신 `electron/ipc/ai.ts`에 turn 루프를 직접 작성하고, provider별 어댑터가 HTTP(fetch) SSE 스트림을 공통 `ChatStreamEvent`로 정규화.

## 공통 인터페이스

`shared/ai.ts`:

```ts
// shared/ai.ts (0.7.50 실제). 'nvidia' 제거(0.6.18), anthropic 은 union 에만 있고 어댑터 미구현.
export type ProviderId = 'openai' | 'anthropic' | 'google' | 'custom'; // custom = OpenAI-compatible: Ollama / vLLM / LM Studio / on-prem / 셀프호스트 NIM

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  messages: ChatMessage[]; // system / user / assistant / tool
  temperature?: number;
  tools?: ChatTool[]; // provider-native tool 스키마 (Agent — 있으면 tool-use 경로)
  toolChoice?: ChatToolChoice;
  reasoningEffort?: 'low' | 'medium' | 'high';
  modeContext?: ModeContext; // task mode (form-fill / audit / edit / author)
}

export type ChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; id: string; name: string; args: unknown }
  | { type: 'done'; usage?: ChatUsage; finishReason?: ChatFinishReason }
  | { type: 'error'; message: string };

export interface Provider {
  meta: { id: ProviderId; label: string; requiresApiKey: boolean };
  listModels(opts: ProviderRuntimeOptions): Promise<ModelInfo[]>;
  // opts = { apiKey?, baseUrl?, signal } — main 이 요청 시점에 주입
  chat(
    req: ChatRequest,
    opts: ProviderRuntimeOptions,
  ): AsyncIterable<ChatStreamEvent>;
}
```

> 위 초안의 `conversationId`/`requestId`/`mode`/`context`/`webSearch` 필드와 `token`/`tool-call`/`tool-result`/`edit-proposal`/`web-search` 스트림 이벤트는 **구현되지 않음**. 실제로는 — 요청별 매칭은 IPC 채널 이름의 `id`(`ai:chat-event:<id>`)로, manual↔agent 구분은 `tools?` 유무 + `modeContext` 로, 멀티 문서 target/reference 는 렌더러의 `turnTargetPath` + `switchTargetDoc` 도구로 처리한다. 발췌 첨부(`ExcerptAttachment`)와 `analyze_style` 도구는 폐기/미구현. 웹검색은 별도 `webFetch`/`webSearch` 도구(렌더러 → `web:*` IPC)로.

## 웹검색 (Built-in)

"단일 API 호출만으로 모델이 웹을 검색하고 결과를 답변에 반영하는가" 관점. 별도 검색 API(Serper, Tavily 등)나 RAG 파이프라인을 ahwp가 직접 호스트하지 않는다는 의미로 ✅. **MVP 범위에서는 외부 검색 서비스 직접 통합 안 함.**

### Provider별 활성화

| Provider             | 활성화 방법                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| OpenAI               | Responses API의 `tools: [{ type: "web_search" }]` (또는 Chat Completions의 `web_search_preview`)       |
| Anthropic            | Messages API의 `tools: [{ type: "web_search_20250305", name: "web_search" }]` 서버 도구                |
| Google               | `tools: [{ googleSearch: {} }]` grounding (Gemini 2.x)                                                 |
| ~~NVIDIA NIM~~       | 어댑터 0.6.18 제거 (셀프호스트는 `custom` 슬롯)                                                        |
| 커스텀 (OpenAI 호환) | 엔드포인트 구현체에 따라 다름. 기본 미지원 가정 (Ollama / vLLM / LM Studio 등 로컬 추론은 모두 미지원) |

### 어댑터 라우팅 규칙

각 provider 어댑터는 `req.webSearch === 'on'` 이고 자기 `capabilities.webSearch === true` 일 때만 SDK tool 정의에 검색 도구를 주입. 그 외엔 무시. 토글이 켜졌는데 active provider가 미지원이면:

- 채팅창 인라인 안내: "현재 백엔드는 단일 API 웹검색을 지원하지 않습니다. 다른 provider로 전환하거나 검색 결과를 직접 첨부해 주세요."
- 토글은 켠 상태 유지 — provider를 바꾸면 자동 효력 발생

### Agent tool 루프와의 관계

웹검색 server tool은 provider 측에서 **자동 호출**됨. ahwp의 화이트리스트 tool 루프(`insertText`, `getTextRange` 등)와는 **별개 채널**:

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

- target: outline + 현재 문서 컨텍스트
- reference: **outline만**. 본문은 모델이 `readParagraphByPath` / `searchWorkspaceOutlines` 로 필요 시 fetch
- 멀티 문서 target/reference 는 `switchTargetDoc` + 워크스페이스 read 도구로 처리 (초안의 chip strip UI 는 폐기)

### Tool 분류 (read는 모든 doc, write는 target)

도구는 `shared/ai-tools-defined/*.ts` 에서 `defineTool` 로 정의(80개 = read-only 22 + mutating 58)되고 **camelCase** 이름을 쓴다. 대표 예:

| 종류          | 예 (권위 목록은 `shared/ai-tools-defined/`)                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| write         | `insertText`, `replaceText`, `deleteRange`, `applyStyle`, `applyParaProps`, `createTable`, `insertTextInCell`, `fillFormCells`, `insertPicture`, `setHeaderFooterText` … |
| read          | `getTextRange`, `getDocumentOutline`, `findInDocument`, `getStyleAt`, `getCharPropertiesAt`, `getEmptyFormFields`, `getPageSvg`, `readParagraphByPath` …                 |
| 외부·에이전트 | `webFetch`, `webSearch`, `runCommand`(게이트·allowlist), `runAgent`(서브에이전트), `updatePlan`                                                                          |

> 초안의 snake_case 이름(`insert_text` / `read_range` / `get_style_at` …)과 `analyze_style` 도구는 실제 코드에 **없다**. write 도구는 턴 시작 시 고정된 active target doc 의 IR 에만 작용.

### Tool 실행 위치 — 렌더러-로컬

`@rhwp/core` 의 살아있는 편집 IR 은 **vendored rhwp-studio iframe**(의 `WasmBridge`)이 보유한다. 도구는 main↔renderer 왕복 없이 렌더러에서 직접 실행된다:

```
Renderer                                   Main (키·스트리밍만)
────────                                   ────────────────────
ChatPanel / useChatStreaming               Provider 어댑터 (fetch)
  │ ai:chat-start {id, request} ───────►     │ HTTP 스트림 정규화
  │ ◄──── ai:chat-event:<id> ───────────────  │  text-delta / tool-use / done
  │ tool-use 수신 → runTools (tools.ts)
  │   └ BridgeIrHelper → iframe WasmBridge (IR mutate)
  │ tool 결과를 다음 턴 messages 에 role:'tool' 로 추가
  │ ai:chat-start (다음 턴) …  (turn cap 50)
```

분리: API 키·provider 호출은 main 에만, 편집 IR·도구 실행은 렌더러에만.

### AI IPC 채널 (실제)

```
ai:chat-start       R→M   { id, request: ChatRequest }   ack (스트림은 아래 채널로)
ai:chat-event:<id>  M→R   ChatStreamEvent                event (요청별 채널)
ai:chat-abort       R→M   id                             void (해당 id AbortController)
ai:ping / ai:list-models / ai:provider-config-get·set    reachability / 모델 / 설정
```

> `ai:tool-execute` / `ai:tool-result` / `ai:apply-diff` / `ai:chat-stream` / `ai:chat-cancel` 채널은 **없다** — 도구는 렌더러-로컬, diff Accept 도 렌더러에서 patch 적용(`shared/ai-patches.ts`). 전체 채널은 `electron/preload.ts` 가 권위.

## 발췌 드래그 첨부 (폐기됨)

> 이 초안의 발췌-드래그 칩 모델(`ExcerptAttachment`, `application/x-ahwp-excerpt` 드롭 → target/reference 칩, anchor stale 재탐색)은 **폐기됨** (0.7.46 라운드 — ViewerHandle 발췌/HTML-적용 클러스터 제거). 편집기가 vendored rhwp-studio iframe 으로 바뀌며 자체 selection-drag 훅이 사라졌고, AI 컨텍스트는 이제 active 문서에서 자동 공급된다(`turnTargetPath`). 멀티 문서 참조가 필요하면 `switchTargetDoc` + `searchWorkspaceOutlines` / `readParagraphByPath` 도구로 처리.

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
2. Accept 버튼 → 렌더러가 직접 patch 적용 (`shared/ai-patches.ts` → `BridgeIrHelper` → iframe `WasmBridge`). main 왕복·`ai:apply-diff` 채널 **없음** — 편집 IR 은 iframe 이 보유
3. (구) "메인에서 patch 적용 후 hwpx 반환" 경로는 폐기

> patch 스키마·정규화는 `shared/ai-patches.ts`. 초안의 `shared/edit-protocol.ts`(zod) 는 **미구현** — defineTool 레지스트리 + ai-patches 로 대체됨.

target 발췌가 첨부된 경우 모델은 발췌의 `anchor`를 그대로 패치 anchor로 사용해야 함 (시스템 프롬프트에 명시). 따라서 렌더러는 fuzzy 매칭 없이 즉시 적용 가능.

## Manual 모드 — 도구 디스패치 (`ahwp-tools`, 청크 19)

청크 18의 ` ```html``` ` 라운드트립은 흐르는 글자/문단 양식(정렬·줄간격·들여쓰기·문단간격·글자 서식)을 커버합니다. 그러나 한컴 한글의 **분리된 컨트롤** — 각주 / 머리말 / 책갈피 / 페이지 설정 / 스타일 / 도형 — 은 HTML 어휘로 표현하기 어렵습니다. 이를 메우는 것이 청크 19의 **`ahwp-tools` JSON 블록** 입니다.

> 이 절은 **Manual 모드 안의 결정론적 도구 호출**을 정의합니다. provider 측 tool-use API(Anthropic/OpenAI function calling)는 사용하지 않으며, AI가 평문 응답에 단일 JSON 블록을 작성하면 렌더러가 화이트리스트 핸들러로 라우팅합니다. provider tool-use API와 다중 턴 자동 실행은 이후 §Agent 모드의 별도 절로 다룹니다.

### 응답 형식

AI는 변경 의도를 다음 한 블록 안에 직렬화:

````
변경 사항을 적용합니다.

```ahwp-tools
{
  "ops": [
    { "tool": "applyHtml",       "args": { "html": "<p style='text-align:center;'>제목</p>" } },
    { "tool": "applyAlignment",  "args": { "align": "center" } },
    { "tool": "insertFootnote",  "args": { "text": "참고 문헌 1" } },
    { "tool": "addBookmark",     "args": { "name": "section1" } },
    { "tool": "applyPageDef",    "args": { "props": { "landscape": true } } },
    { "tool": "setHeaderFooterText",
      "args": { "sectionIdx": 0, "isHeader": true, "applyTo": 0, "text": "기밀 - 2026" } }
  ]
}
```

각주를 추가하고 가운데 정렬했습니다.
````

- 응답 어디에 위치해도 됩니다. 마크다운 fence(` ```ahwp-tools `)로 감지
- 한 응답에 **블록 하나**. 시스템 프롬프트에 명시
- `ops`는 IR 호출 순서대로 실행. 각 op는 독립 IR 호출 — 부분 실패 시 이전 op까지의 변경은 보존(롤백 없음, Undo로 일괄 되돌리기는 후속)

### 도구 카탈로그 (청크 19)

`shared/ai-tools.ts`의 `AhwpToolName` 합집합으로 **화이트리스트 enforcement**. 등록되지 않은 tool은 즉시 `unknown_tool` 에러로 거절.

| `tool`                | `args`                                                              | 위임 IR / `ViewerHandle`      |
| --------------------- | ------------------------------------------------------------------- | ----------------------------- |
| `applyHtml`           | `{ html: string }`                                                  | `applyHtmlAtCaret` (chunk 18) |
| `applyAlignment`      | `{ align: 'left'\|'center'\|'right'\|'justify' }`                   | `applyAlignment`              |
| `applyFontSize`       | `{ pt: number }` (1~999)                                            | `applyFontSizePt`             |
| `applyTextColor`      | `{ hex: string }` (`#RRGGBB`)                                       | `applyTextColor`              |
| `toggleCharFormat`    | `{ key: 'bold'\|'italic'\|'underline' }`                            | `toggleCharFormat`            |
| `insertFootnote`      | `{ text: string }`                                                  | `insertFootnoteAtCaret`       |
| `addBookmark`         | `{ name: string }`                                                  | `addBookmarkAtCaret`          |
| `setHeaderFooterText` | `{ sectionIdx, isHeader, applyTo, text }`                           | `setHeaderFooterText`         |
| `applyPageDef`        | `{ props: Record<string, unknown>, sectionIdx?: number }`           | `applyPageDef`                |
| `createNamedStyle`    | `{ name: string, englishName?: string }`                            | `createNamedStyle`            |
| `createRectShape`     | `{ widthHwpunit, heightHwpunit, opts?: { treatAsChar?: boolean } }` | `createRectShapeAtCaret`      |

> **HTML과 tool의 분리 기준** — 흐르는 글자·문단의 양식은 `applyHtml`(혹은 `applyAlignment`/`applyFontSize` 등 단일 명령) 한 가지로 충분. 각주·머리말·책갈피·페이지 설정·스타일·도형 같은 **컨트롤 객체**는 별도 tool. 시스템 프롬프트에 이 분리 기준을 명시해 모델이 같은 일을 두 갈래로 보내지 않도록 유도.

### 검증

각 tool은 `validateArgs(toolName, args): { ok: true; value } | { ok: false; reason }`를 통과해야 디스패처가 실행. 검증 항목:

- 필수 키 존재 / 타입 매칭
- enum 값 화이트리스트 (`align` 4개, `key` 3개)
- 숫자 범위 (`pt` 1~999, `widthHwpunit`/`heightHwpunit` 1~283500 — A1 한 변)
- 색상 정규식 (`/^#[0-9a-fA-F]{6}$/`)
- 문자열 길이 상한 (`html` 64KB, `text` 4KB, `name` 256B)

검증 실패는 결과 배열에 `{ ok: false, reason }`로 기록되고 사용자에게 토스트로 표시. 후속 op는 **계속 실행** (부분 성공 모델) — 모델은 실패 결과를 다음 턴에서 보고 수정 가능.

### UX — 미리보기와 적용

`ChatPanel`은 어시스턴트 응답에 `ahwp-tools` 블록이 감지되면:

1. JSON 파싱 + 각 op `validateArgs` 1차 검사
2. 메시지 본문 하단에 **ops 미리보기 리스트** 렌더 (tool 이름 + 핵심 args 요약, 잘못된 op는 빨간색)
3. **"도구 실행"** 버튼 — 클릭 시 `runTools(ViewerHandle, ops)` 순차 호출
4. 실행 결과: 성공/실패 카운트 토스트 (`✓ 적용됨 (5/6)`)

`html` 적용 버튼과는 **별도 버튼**으로 표시 (한 메시지에 두 형식이 함께 와도 가능). 모델이 둘 다 보내면 사용자가 원하는 쪽만 선택 적용.

### 안전 장치

- **화이트리스트만 실행** — `AhwpToolName` 합집합 외의 문자열은 dispatch 거절
- **`eval` 절대 금지** — 핸들러는 명시적 switch 분기로 등록. 동적 메서드 dispatch 안 함
- **사용자 명시 액션** — AI는 JSON만 생성. 실제 mutation은 사용자가 버튼을 클릭한 직후에만 실행
- **ops 상한** — 한 블록 50개. 초과 시 전체 거절 (검증 단계)
- **Undo 호환** — 각 tool은 IR snapshot을 남기는 기존 mutation을 그대로 사용. 사용자는 `⌘Z`로 op별 단계적 되돌리기 가능. 한 묶음 undo grouping은 후속 (chunk 20+)
- **시크릿 / 파일 시스템 / 셸 접근 없음** — 모든 tool은 활성 문서의 IR mutation으로 한정. 저장(`file:save`)·키 관리(`secrets:*`)·임의 IPC 호출은 카탈로그에서 제외

### 의도적 제외 (후속 청크)

- ~~**provider tool-use API 바인딩**~~ — Phase 3 Agent 모드 (§Agent 모드 — Tool Use에서 다룸). chunk 19는 응답-텍스트-기반 디스패처
- ~~**다중 턴 자동 실행 / tool-result 응답**~~ — Phase 3
- **표 셀 병합 / 셀 배경 / 그림 삽입** — Phase 2 시리즈 13~ 별도 청크
- **각 op 별 진단 위치 (anchor)** — 현재는 caret 기반. paragraph anchor는 chunk 20+ Edit Proposal 합쳐서

## Phase 3 진입 정비 (chunk 37+) — ✅ 구현 완료

> 아래 항목은 모두 **구현됨** (0.7.x). provider-native tool calling + 다중 턴 자동 실행(turn cap 50)이 라이브 주경로다. `runTools` 는 path-기반(`switchTargetDoc` 로 target 전환), 도구 카탈로그는 `shared/ai-tools-defined/`. 아래는 당시 진입 체크리스트의 역사적 기록.

1. **provider tool-use API 바인딩** — Anthropic / OpenAI function calling 정식 통합. 같은 `AhwpToolName` 카탈로그(`shared/ai-tools.ts`)를 양 진입점에서 공유 — 응답 파싱 경로 vs SDK tool_calls 경로
2. **docId-aware 라우팅** — 현재 `runTools(viewer, items)`는 single-target dispatch. Phase 3에서 `runTools(docId, items)`로 확장하고 reference docId 대상 write 시도는 `write-on-reference` 거절 결과 반환
3. **다중 턴 자동 실행 + tool-result 응답 루프** — 모델이 tool 호출 → ahwp가 결과 반환 → 모델이 다음 호출 또는 final 응답. 턴당 화이트리스트 호출 상한 / 영향 길이 상한 / abort 전파 (이미 §Agent 모드 안전 장치에 박제)
4. **chunk 28 multi-paragraph 발췌의 prompt 직렬화 검증** — span anchor가 시스템 프롬프트의 `[발췌]` 블록에 정확히 표현되는지 + Phase 3 read_range tool이 같은 anchor 형식 받도록 정합

## Agent 모드 — Tool Use

각 provider의 tool 정의로 hwpctl 호환 함수를 노출. 화이트리스트 정의는 §멀티 다큐먼트 모델의 표 참고. 예시 schema:

```ts
// 실제 도구는 shared/ai-tools-defined/*.ts 의 defineTool 항목 (camelCase). 예:
{
  name: "insertText",
  description: "Insert text at (sectionIdx, paragraphIdx, charOffset) in the target document.",
  inputSchema: {
    type: "object",
    properties: {
      sectionIdx: { type: "integer", minimum: 0 },
      paragraphIdx: { type: "integer", minimum: 0 },
      charOffset: { type: "integer", minimum: 0 },
      text: { type: "string" }
    },
    required: ["sectionIdx", "paragraphIdx", "charOffset", "text"]
  }
}
```

> 도구는 항상 active target doc 에 작용 — 별도 `docId` 인자는 없다 (멀티 문서는 `switchTargetDoc` 로 target 을 전환). `analyze_style` / `read_range` 등 snake_case 도구는 미구현.

### 안전 장치

- **Agent 턴 상한**: 기본 50회 (사용자 조정 가능, hard cap 200) — `AGENT_MAX_TURNS_DEFAULT`
- 블록당 op 상한 50; destructive 액션(전체 삭제·저장)은 카탈로그에서 제외 — 저장은 항상 사용자 명시
- 모든 write tool 호출은 한 turn = 한 묶음 undo 로 grouping
- 사용자 "중단" 클릭 → `AbortSignal` 즉시 전파 (provider stream + tool dispatch 동시 취소; in-flight 서브에이전트도 abort)
- **Plan mode**: 기본 ON 가능한 Claude Code 식 dry-run — read-only 도구만 허용, write 차단
- write tool 은 턴 시작 시 고정된 `target` doc 에만 dispatch (렌더러 `runTools` 디스패처가 enforce)
- 외부 도구(`runCommand`/`webFetch`/`webSearch`)·서브에이전트(`runAgent`)는 별도 게이트·cap (`runCommand` 기본 OFF + allowlist)

## 두 가지 시작 시나리오

ahwp는 **빈 문서 작성**과 **기존 문서 수정** 두 워크플로우를 같은 챗·도구 인터페이스로 처리합니다. 차이는 시스템 프롬프트에 주입되는 컨텍스트뿐입니다.

### 빈 문서 작성

- `target.outline`이 비어있고 본문도 비어있음
- AI에게 "이번 분기 매출 보고서 양식 만들어줘" 같은 요청 가능
- Manual 모드: AI가 처음에는 큰 구조(제목·소제목·표 골격)를 `ahwp-edit` 패치로 제안 → 승인 후 점진적으로 채움
- Agent 모드: AI가 `applyStyle`(제목 스타일), `insertText`, `createTable` 등을 연쇄 호출. 사용자는 결과 보고 수정 요청

### 기존 문서 수정

- `target.outline`에 제목 트리, `selection`이 있으면 사용자가 가리킨 영역, 발췌 칩이 있으면 그것이 1차 컨텍스트
- "이 단락 더 격식 있게" / "표 두 번째 행 합계 다시 계산" 등 **국소 편집** 위주
- "B의 뉘앙스로 A 다듬어" 같은 cross-document 요청 시 `switchTargetDoc` + 워크스페이스 read 도구(`searchWorkspaceOutlines` / `readParagraphByPath`) 조합 (초안의 `analyze_style` 도구는 미구현)

> 모드(Manual/Agent), 시작 시나리오(빈/기존), 문서 수(단일/다중)는 직교(orthogonal). 어느 조합도 가능.

## 시스템 프롬프트 (초안)

> 아래 영문 블록은 Phase 2/3 **초안**이다. 실제 라이브 system prompt 는 `src/features/chat/prompts.ts` (mode 별 fragment + form-guard) 가 권위. 아래의 EXCERPTS 규칙·`shared/edit-protocol.ts`·snake_case 도구명(`read_range`/`replace_text`/`analyze_style`)은 현재 구현과 다르다 (발췌 폐기, ai-patches + defineTool, camelCase).

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
- target 외 본문은 워크스페이스 read 도구(`readParagraphByPath` / `searchWorkspaceOutlines`)로 fetch
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
