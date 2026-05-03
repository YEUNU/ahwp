# Phase 3 — Agent 모드 (Tool Use)

이 문서는 Phase 3 진입 청사진. ROADMAP의 항목별 대신 청크 단위 + 의사결정·블로커를 박제. 시간 순 일지는 PROGRESS.md에.

## 목표

사용자가 채팅창의 **Agent 모드 토글**을 켜면, AI가 ahwp 도구를 직접 호출해 활성 문서를 자동 수정. 모든 변경은 한 turn = 한 묶음 undo. 사용자는 진행 상황을 단계별로 보고, 중간에 중단 가능.

검증 시나리오 (받아치기 테스트):

> "이 표의 합계 행을 추가하고 모든 셀을 가운데 정렬해줘"

한 줄 입력 → AI가 tool 호출 시퀀스로 처리 → 결과 적용 → 묶음 undo로 한 번에 되돌리기.

## 현재 상태 (Phase 2 마감 시점)

- **chunk 19** — `\`\`\`ahwp-tools\`\`\`` JSON 블록 텍스트 dispatcher. 12개 tool 화이트리스트 (`shared/ai-tools.ts`). 결정론적이지만 model이 응답 형식을 따라야 동작.
- **chunk 27** — `beginUndoGroup`/`endUndoGroup` 으로 N op 묶음 undo. Agent 한 turn 단위 collapse 준비됨.
- **chunk 29** — "되돌리기" 토스트 (15s). Agent turn 후에도 동일 패턴으로 노출 가능.
- Provider tool-use API 정식 통합은 **미구현**. text-block 응답에서만 동작.

## 설계 결정

### D-1. Tool 카탈로그 — 재사용 vs 신규?

**결정**: chunk 19의 `AHWP_TOOL_NAMES` 12개를 그대로 Phase 3 tool 스키마로 import. `shared/ai-tools.ts`의 `validateToolCall` / `AHWP_TOOL_LIMITS` 도 재사용.

**이유**: provider tool-use 응답이든 text-block dispatcher든, 결국 같은 IR에 도달. validator를 두 군데 두면 drift 위험. 중복 제거가 안전성 + 유지보수 양쪽 이익.

후속 추가 후보 (chunk 38~):

- `insertTextAtCaret` / `deleteRange` — 본문 raw 편집 (현재 applyHtml 우회)
- `applyParagraphStyle` — 현재 createNamedStyle만, 적용은 미노출
- `insertTable` / `mergeCells` / `splitCells` — 표 구조 ops
- `runFormula` — chunk 34 `evaluateTableFormula` 노출

### D-2. Provider 별 tool-use API 매핑

각 provider의 native tool-use 형식이 다르지만 **공통 contract** 로 어댑터에서 정규화:

```ts
// shared/ai.ts 신규
export type ChatStreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-use'; id: string; name: string; args: unknown } // 신규
  | { type: 'tool-result'; id: string; result: unknown } // 신규
  | { type: 'done'; usage?: ChatUsage }
  | { type: 'error'; message: string };

export interface ChatTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface ChatRequest {
  // ... 기존
  tools?: ChatTool[];
  toolChoice?: 'auto' | 'none' | { name: string };
}
```

| Provider             | API 이름                     | 호출 형식                                                                 | 응답 형식                                                                                 |
| -------------------- | ---------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| OpenAI               | `tools` (chat completions)   | `{tools: [{type:'function', function: {name, description, parameters}}]}` | `tool_calls: [{id, function: {name, arguments}}]` (stream `delta.tool_calls` 누적)        |
| Anthropic            | `tools` (messages)           | `{tools: [{name, description, input_schema}]}`                            | `content: [{type:'tool_use', id, name, input}]` (stream `content_block_start` `tool_use`) |
| Google Gemini        | `tools.functionDeclarations` | `{tools: [{functionDeclarations: [{name, description, parameters}]}]}`    | `candidates[0].content.parts[].functionCall: {name, args}`                                |
| Custom (OpenAI-호환) | OpenAI와 동일                | —                                                                         | — (모델별 능력 분기)                                                                      |

각 어댑터에서 native → `ChatStreamEvent` 정규화. 렌더러는 provider-agnostic 이벤트만 본다.

### D-3. Agent 루프 (multi-turn tool-result)

```
[사용자 메시지]
  ↓
fireChat(messages, tools=[...12])
  ↓
provider stream:
  → text-delta (선택 — 모델이 설명을 추가하면)
  → tool-use { id, name='applyAlignment', args={align:'center'} }
  → done
  ↓
runToolCall(name, args) → IR 호출 → result (성공/실패/IR 결과 텍스트)
  ↓
fireChat([...messages, assistant-with-toolUse, tool-result-block], tools=[...])
  ↓
provider stream:
  → tool-use { id, name='insertTextAtCaret', args={...} }
  → done
  ↓
... (반복, 한 턴에 K번 가능)
  ↓
provider가 더 이상 tool 호출 안 하고 text-only 응답 → 종료
```

**한계**:

- 한 turn 안 tool 호출 횟수 cap (default 10) — 무한 루프 방어
- tool 호출 사이 사용자가 "중단" 가능 — 진행 중 tool stream + queued result 모두 취소
- 부분 성공 모델 — 한 op 실패해도 다음 계속 (chunk 19 패턴 유지)

### D-4. docId-aware 라우팅

**결정**: 현재 chunk 19 dispatcher는 active doc만 수정 (single target). Phase 3에서 `runTools(docId, items)` 로 확장 예정이지만, **chunk 37 시점에는 active doc fixed** 로 시작. multi-doc write 는 후속 chunk.

이유: model 응답에 docId hint 가 없는 한 모호 (사용자 의도가 active 인지 reference 인지). 명시적 `target_document` 인자가 schema에 추가되어야 안전. Phase 3-B 또는 별도.

### D-5. Custom (OpenAI-호환) — 모델별 능력 분기

`custom` 슬롯의 baseUrl이 self-hosted Ollama / vLLM / LM Studio 등을 가리키면, `tools` 파라미터를 받는 모델만 Agent 모드 활성. 받지 않는 모델 (Llama 2 base 등) 은 Manual 모드만.

**검출**: 단순 capability flag 모델 ID에 hardcode — 사용자가 정확한 모델 이름을 입력했다면 ahwp가 알 수는 없음. **MVP**: settings 옵션 "이 모델은 tool 사용 가능" 체크박스. 후속에서 listModels 에 capability 메타 추가 시 자동.

### D-6. UI: Manual / Agent 토글

ChatPanel 상단에 모드 라디오:

```
[●] Manual (현재 동작)  [○] Agent (실험적)
```

Manual: 기존 chunk 18+19 (HTML/ahwp-tools 텍스트 블록). 후속에도 유지.
Agent: provider tool-use API + 자동 루프.

기본값 Manual. localStorage `ahwp:chat:mode` 영속.

Agent 모드 진행 중 ChatPanel:

- 각 tool 호출이 새 row로 표시 (`🔧 applyAlignment(...)` + spinner)
- 결과 도착 시 `✓ ok` / `✗ reason`
- 묶음 turn 끝나면 chunk 29 토스트 ("되돌리기" 15s)
- 중간 abort 버튼 — handle.abort() + 진행 중 IR 호출은 끝까지 (재진입 안전)

## 청크 분할

| 청크 | 작업                                                                                             | 의존   |
| ---- | ------------------------------------------------------------------------------------------------ | ------ |
| 37   | `shared/ai.ts` 에 `ChatTool` / `tool-use` / `tool-result` 이벤트 추가 + `ChatRequest.tools` 필드 | —      |
| 38   | OpenAI 어댑터 tool calling — `delta.tool_calls` 누적 + 정규화 + tool-result 메시지 형식          | 37     |
| 39   | Manual/Agent 모드 토글 + Agent 모드 fireChat 루프 (한 turn 내 multi-tool)                        | 37, 38 |
| 40   | Agent 진행 UI — tool 호출 row + spinner + 결과 표시 + 중단 버튼                                  | 39     |
| 41   | Agent 묶음 undo — `beginUndoGroup` 으로 turn 전체 wrap                                           | 39     |
| 42   | Anthropic 어댑터 tool_use — API 키 받으면 (블로커)                                               | 37     |
| 43   | Google function calling — 키 받으면 (블로커)                                                     | 37     |
| 44   | Custom 어댑터 capability flag (Settings 토글)                                                    | 38, 39 |
| 45   | 추가 tool: `insertTextAtCaret` / `deleteRange` / `applyParagraphStyle`                           | 39     |
| 46   | 추가 tool: 표 구조 (`insertTable` / `mergeCells` / `splitCells` / `runFormula`)                  | 39     |
| 47   | docId-aware 라우팅 — `runTools(docId, items)` 다중 문서 write                                    | 39     |

**MVP (37~41 + 45)**: OpenAI provider + 기본 12 tool + 본문 편집 3 tool + UI + 묶음 undo. Anthropic/Google/Custom 은 키 결정 후.

## 검증 기준

- e2e 신규 spec — `chat-agent.spec.ts`:
  1. fake provider 가 tool-use 이벤트 emit → 실제 IR 호출 → 결과 검증
  2. multi-tool turn (2~3 ops) — undo 1회로 모두 롤백
  3. 중단 버튼 — 진행 중 tool stream abort 확인
  4. 부분 성공 — 1번째 tool 성공, 2번째 reject (validator), 3번째 성공
- live NIM smoke — 실제 모델 응답으로 받아치기 테스트
- typecheck / lint / 단위 청정

## 위험 및 대응

| 위험                            | 영향                               | 대응                                                                                |
| ------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| 무한 tool 호출 루프             | 사용자 quota 소진 + 응답 지연      | 한 turn cap (10), 제한 도달 시 강제 종료 + 사용자 알림                              |
| tool 호출 결과 IR mutation 실패 | 부분 적용 상태                     | per-op try/catch + tool-result 에 reason 포함 → 모델이 retry 또는 다른 경로 시도    |
| 사용자가 도중 다른 탭으로 전환  | active doc 바뀌어 잘못된 곳에 적용 | turn 시작 시 docId 캡처 → tool 호출 시 그 docId 와 active 비교, 다르면 abort + 알림 |
| provider 응답에 unknown_tool    | dispatch 거절                      | chunk 19 패턴 유지 — 무시하고 다음 op 계속                                          |
| 묶음 undo 중간 실패             | undo group 누설                    | finally 블록에서 `endUndoGroup` 호출 보장                                           |

## 후속 (Phase 3 종료 후)

- Agent persona / system prompt 사용자화
- tool 사용 가이드 prompt (대상 도구 카탈로그 자동 inject — 길이 제어)
- 비용 / 토큰 추정 표시 (provider 메타데이터 활용)
- multi-doc write (D-4 후속)
- tool 결과 시각 diff (chunk 57 inline diff 와 통합)
