# 진행 상황

ahwp 개발 기록. 단순 체크리스트는 [ROADMAP.md](ROADMAP.md), 사용자 영향 변경은 [CHANGELOG.md](../CHANGELOG.md), 청크별 상세는 `git log --oneline` + `git show <hash>` 참고. 일지는 라운드/Phase 단위로만 적습니다.

## 현재 스냅샷

| 항목        | 상태                                                                                                                                                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase       | **Phase 3 카탈로그 완성 (chunks 37~49 + 43)** — Agent 모드 + Google Gemini 어댑터 + tool 카탈로그 12 → 45개로 확장 (한컴 한글 lib mutation API ~90% 커버). Manual/Agent 양쪽 동일 카탈로그 사용. 잔여 (외부 의존): chunk 42 (Anthropic — API 키 대기), chunk 44 (Custom capability flag), chunk 50 (docId-aware multi-doc) |
| 버전        | `0.3.3`                                                                                                                                                                                                                                                                                                                    |
| 빌드        | ✅ `npm run dev` · `npx vite build`                                                                                                                                                                                                                                                                                        |
| 타입        | ✅ `npm run typecheck`                                                                                                                                                                                                                                                                                                     |
| 린트        | ✅ `npm run lint` (0 warnings, 0 errors)                                                                                                                                                                                                                                                                                   |
| 포맷        | ✅ `npm run format:check`                                                                                                                                                                                                                                                                                                  |
| 단위 테스트 | ✅ 3/3 (`App.test.tsx`)                                                                                                                                                                                                                                                                                                    |
| e2e         | ✅ 270 케이스 · studio 213 + chat 56 + 1 skipped · live NIM 5/5 + Gemini 2/2                                                                                                                                                                                                                                               |
| Electron    | 33.2 · sandbox=true · contextIsolation=true                                                                                                                                                                                                                                                                                |
| 의존성      | runtime: `@rhwp/core` · `chokidar` · `react-resizable-panels` · `clsx` · `tailwind-merge` · `class-variance-authority` · `lucide-react` · `tailwindcss-animate` · `@radix-ui/react-slot` · `better-sqlite3`                                                                                                                |

## Phase 요약

### Phase 0 — 부트스트랩 (2026-04-29) ✅

Electron + Vite + React + TypeScript strict + Tailwind + shadcn/ui 셸. IPC 토대 + 단위/포맷/lint/CI. 패키지 매니저는 pnpm 시도 후 corepack EPERM 이슈로 npm으로 전환.

### Phase 1 — 3-Pane 레이아웃 + 자체 Studio + 풀 편집 (2026-04-29 ~ 2026-04-30) ✅

| 단계                 | 내용                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1-A 레이아웃         | 리사이저블 3-Pane (`react-resizable-panels`), 네이티브 메뉴, light/dark 테마                                                                                                                                                                                              |
| 1-B 폴더 트리        | VS Code 스타일 — 단일 루트, lazy expand, chokidar 동기화, 컨텍스트 메뉴(생성/이름변경/휴지통/탐색기), F2/Delete, DnD 이동                                                                                                                                                 |
| 1-C 파일 IPC         | `file:new` (blank seed) / `file:open` / `file:save` / `file:save-as`. atomic write (tmp+rename). `.hwpx` → `.hwp` 자동 라우팅 (lib HWPX round-trip 이슈, KNOWN_ISSUES L-001)                                                                                              |
| 1-D Studio viewer    | `@rhwp/editor` iframe 폐기 → `@rhwp/core` 직접 사용. 멀티 페이지 lazy SVG, hitTest, 시각 커서, dirty 추적, undo/redo (snapshot, 100 cap), 144 페이지 부하 e2e                                                                                                             |
| 풀 편집 (chunk 1~17) | 텍스트/IME, 선택 모델 (drag/shift+arrow/더블·트리플), B/I/U + 단축키, 정렬/폰트크기/색상, Find/Replace, 하단 status bar, 줄간격/들여쓰기/문단간격, 페이지 네비, 리스트/페이지 나누기, 표 삽입(8×8 picker) + 셀 편집 v3 (Tab nav + 인-셀 서식 + 우클릭 행/열), 이미지 삽입 |
| 탭 시스템            | 다중 탭 mount-유지, dirty 점, ⌘W, 미들 클릭, 세션 복원 (`session.json`)                                                                                                                                                                                                   |
| 성능                 | WASM pre-init, off-viewport unmount, Find paragraph cache, inactive-tab guard                                                                                                                                                                                             |

**핵심 결정**: `@rhwp/editor` iframe 모델 폐기. `@rhwp/core` (Rust+WASM) 직접 사용으로 오프라인 동작 + 외부 origin 의존 0. 저장 canonical은 HWP/CFB.

### Phase 2 — AI 챗봇 + IR-only UI + UX 라운드 (2026-05-01 ~ 2026-05-02) ✅

#### 2-A/B/C 채팅 토대 (chunks 1~7)

| chunk | 내용                                                                      |
| ----- | ------------------------------------------------------------------------- |
| 1     | BYOK secrets (`safeStorage` 암호화) + Provider 타입                       |
| 2     | OpenAI 스트리밍 + ChatPanel 골격                                          |
| 3     | NVIDIA NIM (OpenAI 호환) + provider/model 셀렉터 + chat e2e + 4 워커 병렬 |
| 4     | Settings 모달 + `ai:ping` 연결 테스트                                     |
| 5     | 마크다운 + 코드 syntax highlight                                          |
| 6     | 메시지 복사 / 재생성 / 삭제                                               |
| 7     | 찾아 바꾸기 (⌘H, `replaceOne` / `replaceAll` IR)                          |

#### 2-D rhwp 시리즈 — IR API 활용 (chunks 8~17)

페이지 설정, 머리말/꼬리말, 책갈피, 각주, 스타일 관리, 수식 미리보기, 표/셀 속성, 도형(사각형 MVP), 표 셀 합치기/나누기, status bar.

라이브러리: `@rhwp/core` 0.7.8 → 0.7.9. 새 IR (`replaceOne`, `replaceAll`, `applyParaFormat` props 확장, `getStyleListJson`, `evaluateTableFormula`, `applyCellStyle`, `getPictureProperties`, `setPictureProperties`, `deletePictureControl`, `copyControl`, `pasteControl`, `insertParagraph`, `deleteParagraph`).

#### 2-E Manual 편집 흐름 (chunks 18~28)

| chunk | 내용                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------- |
| 18    | HTML 내보내기/붙이기 + ChatPanel 문서 컨텍스트 (`exportDocumentHtml` / `applyHtmlAtCaret`). NIM live e2e |
| 19    | Manual 도구 디스패치 (`ahwp-tools` JSON 블록 + 11개 화이트리스트 tool)                                   |
| 20    | 발췌 첨부 (anchor stale 검증 + 자동 재바인딩)                                                            |
| 21    | 멀티 문서 컨텍스트 (target / reference 칩)                                                               |
| 22    | HTML5 drag UX (selection rect → ChatPanel 칩)                                                            |
| 23    | 셀 스타일 적용 (`applyCellStyle`)                                                                        |
| 24    | 그림 속성 IR                                                                                             |
| 25    | 컨트롤 클립보드                                                                                          |
| 26    | 채팅 히스토리 (better-sqlite3, WAL, FK cascade)                                                          |
| 27    | 묶음 Undo (AI 한 턴 = 1 entry)                                                                           |
| 28    | Multi-paragraph 발췌 (span anchor)                                                                       |

#### IR-only UI 노출 + Phase 2 잔여 마무리 (chunks 29~42)

| chunk | 내용                                                 |
| ----- | ---------------------------------------------------- |
| 29    | AI 변경 되돌리기 토스트 (15초, 묶음 undo)            |
| 30    | 채팅 히스토리 인라인 rename                          |
| 32    | 셀 selection v4 — **deferred** (대형)                |
| 33    | 도형 라인/곡선/그룹 — **rhwp 0.8 대기**              |
| 34    | 표 수식 evaluate (`TableFormulaDialog`)              |
| 35    | 머리말/꼬리말 다중 라인 + 페이지 템플릿 (홀/짝/양쪽) |
| 36    | 스타일 char/para shape — **rhwp 0.8 대기**           |
| 38    | 표/셀 속성 다이얼로그                                |
| 39    | 그림 속성 다이얼로그 (`enumeratePictures`)           |
| 40    | 컨트롤 클립보드 단축키 (⌘⇧C/V)                       |
| 41    | HTML로 내보내기 메뉴 + IPC                           |
| 42    | 셀 스타일 적용 우클릭 메뉴                           |

#### UI/UX 1차 리뉴얼 + 안정화 (0.2.42~0.2.49)

| 라운드          | 내용                                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| UI/UX 리뉴얼    | warm paper / 잉크 팔레트, 36px 커스텀 타이틀바, 웰컴 카드                                                                    |
| UX 회귀 fix     | 캐럿 이동 toolbar 동기화, 페이지 경계 드래그, ⌘A 스코프                                                                      |
| P0 편집 UX 보강 | ArrowUp/Down 시각 라인 nav, shift+click selection 확장, 드래그 자동 스크롤(rAF), Esc로 드래그 취소, `commitCaretMove` helper |
| P1 데이터 보호  | `.bak` 사이드카, HWPX 라우팅 알림(banner), 외부 파일 변경 감지 (`file:watch-paths` + chokidar + dirty-aware reload)          |
| chunk 48        | provider 모델 동적 fetch + 24h 디스크 캐시 (OpenAI / NIM, datalist autocomplete + ⚠ 폴백)                                    |
| chunk 49        | `ollama` provider 슬롯 제거 → `custom` (OpenAI 호환) 통합                                                                    |

#### 1차 UX 라운드 (chunks 50~55, 0.2.55) — 최근

| chunk | 내용                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------ |
| 50    | 명령 팔레트 (⌘K) — 자체 fuzzy scorer, 카테고리(action/tab/recent/theme), MenuAction 카탈로그 자동 노출 |
| 51    | status bar 단어/글자 카운터 (200ms debounce)                                                           |
| 52    | 자동 저장 (60s 간격 `.ahwp-draft` 사이드카, openTab 시 복구 confirm)                                   |
| 53    | 단축키 치트시트 (⌘/) — 6 카테고리                                                                      |
| 54    | 다크 모드 본문 종이 흰색 유지 (`--paper` CSS 변수)                                                     |
| 55    | 탭 고정 (📌) — bulk close 보호                                                                         |

## 핵심 결정 / 제약 (영구 보존)

### 아키텍처

- **저장 canonical = HWP/CFB** — `@rhwp/core` v0.7.x HWPX 라운드트립이 이미지 IR 깨뜨림 (KNOWN_ISSUES L-001). 라이브러리 fix 시 HWPX로 복귀
- **`@rhwp/core` ESM-only** — `await import(...)`로 동적 import (vite-plugin-electron 기본 CJS와 호환). `vite.config.ts`에서 externalize
- **자체 Studio viewer** — `@rhwp/editor` iframe 폐기 (chunk 6). 오프라인 동작 + 외부 origin 의존 0
- **Save 안전망** — atomic write (tmp+rename) + `.bak` 사이드카 (편집 세션 시작 시점 박제) + 60s `.ahwp-draft` 자동 저장
- **Provider 슬롯** — `openai` / `anthropic` / `google` / `nvidia` / `custom` (OpenAI 호환 — Ollama / vLLM / LM Studio 통합)

### 운영

- **패키지 매니저 = npm** — pnpm은 corepack EPERM 이슈로 폐기
- **PR 대상 브랜치 = `dev`** (`main`은 release-only)
- **CI** — PR-only + `workflow_dispatch`. 4 워커 / retries=1
- **examples/ 추적** — .hwp 부하 fixture를 git에 포함 (E2E 안정성)

### 라이브러리 quirks

- `applyCharFormat`이 빈 단락(length=0)에서 silent no-op
- `pasteInternal`이 IR 캐럿 자동 진행 X — 호출자가 `{paraIdx, charOffset}` sync
- `getStyleAt + getStyleDetail`은 정적 style 템플릿 (active state는 `getCharPropertiesAt` / `getParaPropertiesAt`)
- `HwpDocument.createEmpty()` 셸은 `sectionCount=0` → 후속 `insertText` 실패. base64 blank seed로 우회 (`electron/hwp/blank-seed.ts`)

## 최근 일지

### 2026-05-03 — Phase 3 카탈로그 전수 노출 (chunks 45~49, 0.3.3)

Agent tool 카탈로그를 chunk 19 의 12개 → **45개** 로 확장. 한컴 한글
lib (`@rhwp/core` 0.7.9) 의 주요 mutation API ~50개 중 ~90% 커버.
Manual + Agent 양쪽 동일 카탈로그 사용 (`shared/ai-tools.ts` 단일 진실).

신규 33개 (waves 1~6):

- Wave 1 (본문 primitive): insertText, deleteRange, insertParagraph,
  deleteParagraph, mergeParagraph
- Wave 2 (서식 통합): applyCharFormat (props 통합), applyParaProps
  (props 통합), applyStyle
- Wave 3 (표 구조 12): createTable, insertTable*Row*/Column,
  deleteTable*Row*/Column, mergeTableCells, splitTableCellInto,
  unmergeCell, setTableProperties, setCellProperties,
  evaluateTableFormula, deleteTableControl
- Wave 4 (이미지/도형): set/deletePictureControl, set/delete
  ShapeControl, changeShapeZOrder, insertPicture (base64)
- Wave 5 (페이지/섹션): insertPage/ColumnBreak, setColumnDef,
  setSectionDef, setPageHide
- Wave 6 (HF + 책갈피): applyHfTemplate, create/deleteHeaderFooter,
  deleteBookmark

인프라: ViewerHandle 에 `ir*` 메서드 28개 추가 (lib API thin wrap).
shared/ai-tools.ts 의 AhwpToolArgs/validateArgs/TOOL_DESCRIPTORS 세
군데 lockstep 확장. nonNegInts 헬퍼로 좌표 validation 중복 제거.
chat/tools.ts runOne switch + previewArgs switch 33 케이스 확장 —
exhaustive switch 로 컴파일러가 drift 차단.

새 문서: docs/AGENT_TOOLS.md (카테고리별 표 + 사용 예 + 좌표 시스템 +
lib 한계 + 신규 도구 추가 절차 8단계).

검증: studio 213 + chat 56 (+2 신규 chunk 45/46 fake provider 케이스)
= 269 통과 / 1 skipped + gemini-live 2/2 + nvidia-live 5/5 라이브 통과.

### 2026-05-03 — Google Gemini live + schema 호환 fix (0.3.1, 0.3.2)

Phase 3 chunk 43 — Google Gemini provider unlock + 라이브 검증 fix.
어댑터 신설 (`streamGenerateContent?alt=sse`, system → systemInstruction,
assistant → role='model', tool result → user role + functionResponse,
tools → functionDeclarations, toolChoice → toolConfig).

라이브 라운드에서 발견한 Gemini API 제약 3건 fix (0.3.2):

- sanitize 함수가 `properties` 안의 property name 까지 schema keyword
  로 잘못 처리해서 dropping → properties 분기 추가
- `enum` 만 지정 시 거부 → `type: 'string'` 명시
- exclusiveMinimum/pattern 등 Gemini 미지원 keyword sanitize drop
  (validator 가 우리 측에서 강제하므로 영향 0)

기본 모델 gemini-2.0-flash → gemini-2.5-flash (free tier quota 0
회피). playwright.config.ts 에 dependency-free dotenv 로더 (.env
KEY=VALUE 자동 로드).

라이브 e2e: gemini-live 2/2 + nvidia-live 5/5 = 7/7 통과.

### 2026-05-03 — Phase 3 MVP 진입 (chunks 37~41, 0.3.0)

Agent 모드 — provider native tool-use API 정식 통합. ChatPanel 상단 Manual/
Agent 토글, Agent 활성 시 AI가 ahwp 도구 직접 호출 → 자동 적용 + 묶음 undo.

- **chunk 37**: `shared/ai.ts` 에 `tool-use` 이벤트 + `ChatRequest.tools` +
  `ChatMessage.toolUses/toolResult` + `getAhwpToolCatalog()` (chunk 19 의 12
  tool 을 JSON Schema 카탈로그로 노출).
- **chunk 38**: OpenAI 어댑터 tool calling — `delta.tool_calls` index 누적,
  assistant + role='tool' native 변환, `finish_reason` 매핑. fake provider
  `TOOL:` / `TOOL_DONE:` 모드 추가.
- **chunk 39**: Manual / Agent 토글 + Agent fireChat 루프 — `tool-use` 누적
  → `validateToolCall` + `runTools` (chat/tools.ts) → tool result 메시지 →
  fireChat 재귀. turn cap 10.
- **chunk 40**: Agent 진행 UI — assistant 메시지 안 inline tool entry row
  (`🔧 toolName | argsPreview | ⏳/✓/✗`). role='tool' 메시지는 화면 숨김.
- **chunk 41**: Agent 묶음 undo — `runTools` 가 이미 `beginUndoGroup`/
  `endUndoGroup` collapse, ⌘Z 1회로 turn 전체 롤백.

**Phase 3 잔여 (외부 의존)**: chunks 42 (Anthropic) / 43 (Google) — API 키
결정 대기. chunks 44 (Custom capability) / 45 (본문 편집 tool 추가) / 46
(표 구조 tool 추가) / 47 (docId-aware 라우팅) — 사용자 피드백 받아 점진 추가.

신규 회귀 가드 spec — `chat-agent.spec.ts` (3 케이스). 전체 e2e: studio 213

- chat 54 = 267 통과 / 1 skipped.

### 2026-05-03 — Phase 2 마무리 (chunks 31, 32, 0.2.94)

Phase 2 잔여 청크 일괄 마감.

- **chunk 31 자동 제목 요약**: 4 메시지 누적 후 1회 한정 background ai chat
  → 한국어 5단어 명사구 → `chatHistory.rename`. dedup ref + silent 실패.
- **chunk 32 셀 selection v4**: cell-block selection 시 `copySelection`이
  TSV (cells `\t`/rows `\n`) 작성, `pasteAtCaret`이 cell caret + multi-cell
  TSV → row/col 격자 분배. 병합 셀, 중첩 표 path-based 분기. drag cell
  selection (Phase A) + merge·split 우클릭 (chunk 5+9)은 이미 통합.

**Phase 2 잔여 (외부 의존)**: chunk 33 (도형 라인/곡선/그룹) + chunk 36
(스타일 char/para shape) — `@rhwp/core` 0.8 대기 / Anthropic + Google 어댑터
— API 키 결정 대기.

신규 회귀 가드 spec 4 (`chat-auto-title.spec.ts` 2 + `studio-cell-block-
clipboard.spec.ts` 2). 전체 e2e: studio 213 + chat 51 통과.

### 2026-05-02~03 — 셀 드래그 안정성 + caret blink (0.2.85~0.2.93)

다층 방어 — 0.2.89 mouseup empty wipe 차단 / 0.2.90 sticky cell-block 모드
(anchor 셀 복귀해도 모드 유지) / 0.2.91→0.2.92 글로벌 hit nudge revert +
drag-only bbox validation / 0.2.93 caret hard-blink (`steps(1, end)`).

### 2026-05-02 — 1차 UX 라운드 (chunks 50~55, 0.2.55, `3f6f842`)

UI/UX 격차 16개 분석 후 3차 묶음으로 분할, 1차 6개. 자체 fuzzy scorer로 외부 lib 미도입. 60s autosave는 dirty 탭만 + temp 파일 제외. 회귀 e2e 5건. typecheck/lint/format 청정.

### 2026-05-02 — chunk 49 provider 통합 (0.2.49, `fb2769d`)

`ollama` provider 슬롯 제거 → `custom` (OpenAI 호환) 흡수. Ollama 사용자는 `custom`에 `http://localhost:11434/v1` 입력. 코드 변경: `ProviderId` union, `PROVIDERS` 메타, registry 주석 + 문서 일괄 갱신.

### 2026-05-02 — chunk 48 모델 동적 fetch (0.2.48, `6a82bbf`)

`Provider.listModels()` optional + 24h 디스크 캐시 (`userData/model-cache.json`). 새 IPC `ai:list-models` (응답 union: ok / stale-cache / error) + `ai:clear-models-cache`. ChatPanel에 `<datalist>` autocomplete + 새로고침 버튼 (↻/⟳/⚠). 자유 입력은 폴백으로 항상 가능.

### 2026-05-02 — Phase 2 마무리 chunks 29/30/34/35 (0.2.47, `35332ac`)

| 청크 | 핵심                                                         |
| ---- | ------------------------------------------------------------ |
| 29   | "되돌리기" 버튼 + 15s 노출. `ViewerHandle.canUndo()` 추가    |
| 30   | 📚 popover에 ✎ 버튼 / 더블클릭 inline rename                 |
| 34   | `TableFormulaDialog` + 셀 우클릭 "수식 다시 계산"            |
| 35   | `HeaderFooterDialog` 단일 라인 → 4행 textarea + applyTo 토글 |

신규 e2e 5건. Phase 2 사용자-facing 종료.

### 2026-05-02 — P0/P1/P2 보강 (0.2.43, `2457054`)

UX 회귀 3건 fix (caret 동기화 / 페이지 경계 드래그 / ⌘A 스코프) + ArrowUp/Down 시각 라인 nav + shift+click + 드래그 자동 스크롤(rAF, 36px edge) + Esc 드래그 취소 + `commitCaretMove` helper + `.bak` 사이드카 + HWPX 라우팅 banner + 외부 변경 감지(chokidar). 신규 e2e 11건.

## 향후 작업

| 영역             | 항목                                                                                         | 상태             |
| ---------------- | -------------------------------------------------------------------------------------------- | ---------------- |
| 2차 UX 라운드    | chunks 56~60 — AI 우클릭 메뉴 / AI inline diff / 목차 사이드바 / PDF 미리보기 / 검색 in 폴더 | 다음             |
| 3차 UX 라운드    | chunks 61~65 — 룰러 / 버전 히스토리 / 한국어 맞춤법 / 슬래시 명령 / 다중 창                  | 후속             |
| Phase 2 deferred | chunk 31 자동 title summary, chunk 32 셀 selection v4                                        | 보류 (대형/복잡) |
| Phase 2-B        | Anthropic / Google / `custom` 어댑터 잠금 해제                                               | 키 결정 대기     |
| Phase 3          | provider tool-use API 정식 통합, docId-aware 라우팅, Agent 모드                              | 후속             |
| Phase 4          | 아이콘, notarization, electron-updater, rhwp 자산 로컬 번들링                                | 후속             |
| Phase 5          | crash reporter, 사용자 가이드, 다국어, 접근성                                                | 후속             |

라이브러리 의존: chunk 33 (도형 라인/곡선/그룹) + chunk 36 (스타일 char/para shape) — `@rhwp/core` 0.8 대기.

## 트래킹

각 Phase 진입 시 GitHub Project 보드 또는 issue 라벨(`phase-1`, `phase-2`...)로 관리. Phase 완료 시 데모 영상 + CHANGELOG 갱신. 일지는 라운드/Phase 단위로만 압축 기록 (청크별 디테일은 git log + commit body에 위임).
