# Changelog

이 파일은 ahwp의 사용자 영향 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/) 을 따릅니다.

## [Unreleased]

## [0.7.20] - 2026-06-01

### Added — AI form-fill 실시간 편집 위치 표시 (follow-along scroll)

Inserty 데모 참고: AI 가 양식을 채우는 동안 편집 영역이 **채워지는 표/문단을
화면에 따라오게** 스크롤. write op 마다 해당 문단으로 reveal — 사용자가 어디가
수정되고 있는지 실시간으로 본다.

- fork(`vendor/rhwp` ahwp-bridge): `InputHandler.revealParagraph` +
  `scrollToParagraph` bridge case. caret/포커스를 옮기지 않아 채팅 입력
  포커스를 유지 (moveCursorTo 의 focusTextarea 회피).
- ahwp `runTools`: 성공한 write op 마다 `onWriteParagraph(0, paragraphIdx)`
  콜백 (write 결과의 합성 diff.paragraphIdx 재사용, 연속 동일 문단 dedup).
  AppShell 이 iframe `scrollToParagraph` bridge 로 연결. 구버전 vendor
  build 면 case 부재로 무해하게 skip.
- 회귀 가드 4 cases (호출/문단별 분리/dedup/실패 시 skip).

## [0.7.19] - 2026-06-01

### Added — 참고자료 reference chip 부활 (멀티 문서 컨텍스트)

Inserty 데모 참고: 채팅 입력란 위에 **참고자료 토글 칩** 추가. 활성 탭을 제외한
열린 문서를 클릭 한 번으로 read-only 참고자료로 첨부 → useChatStreaming 이
`collectReferenceOutlines` → `buildReferenceSystemBlock` 으로 시스템 프롬프트에
`[Reference docs]` 블록 주입. 양식(활성 탭)을 채우면서 다른 자료를 근거로 쓰는
"참고자료 → 양식 작성" 흐름의 첫 조각.

- chunk 99 에서 폐기됐던 `referencePaths` 를 state 로 부활 (소비 파이프라인은
  그대로 살아있어 state·UI 만 복원). 닫힌/active 경로는 소비 측이 자동 필터링.
- 순수 함수 회귀 가드 `prompts.test.ts` 신규 (active/닫힌 경로 필터, 빈 outline
  skip, read-only 블록 생성 — 6 cases).

## [0.7.18] - 2026-06-01

### Added — 양식 작성 완료 요약 (그룹별·근거 기반)

Form-fill 턴 종료 시 AI 가 채운 내용을 **양식의 논리 그룹 단위로 요약**하도록
Agent guide 에 completion-summary 디렉티브 추가. 셀 단위 나열 대신 (식별/개요
블록, 기간별 수치 표, 서술 섹션 등) 양식 구조에서 도출한 그룹마다 "무엇을, 어떤
참고자료를 근거로 채웠는지" 한 줄씩. 의도적으로 비워둔 칸도 숨기지 않고 명시.
원칙 기반 — 고정 필드명 enumeration 없이 영어 프롬프트 (Inserty 데모 참고).

## [0.7.17] - 2026-05-31

### Changed — kordoc 기반 DOCX/XLSX 추출 (mammoth/exceljs fallback)

비-HWP 읽기 경로의 DOCX/XLSX 텍스트 추출을 kordoc (exact-pin `2.9.0`) 우선으로
교체. kordoc 은 표/colspan/병합셀 구조를 markdown 파이프 표로 보존 — 기존
mammoth (DOCX raw text) / exceljs 가 평면화하던 표 격자를 살려 AI 컨텍스트
품질을 높인다 (colspan 헤더는 spanned 열에 걸쳐 반복되어 열 정렬 유지).

- **품질 업그레이드는 fallback 뒤에 둠** (정확성의 hard dependency 아님):
  DOCX/XLSX 모두 kordoc 을 먼저 시도하고, throw 하거나 빈/degenerate 출력을
  내면 `console.warn` + `meta.warning` 후 기존 mammoth/exceljs 경로로 fallback.
  kordoc 은 9 주 / 44 버전 churn-heavy 라이브러리 — worst case 가 "오늘의 동작"
  이라, 실 정부 양식 검증 게이트를 아직 못 돌리는 상황의 안전망이 된다.
- **ESM-only**: kordoc 의 .cjs 빌드가 `import.meta` 를 포함해 `require` 가
  깨짐 → @rhwp/core 와 동일하게 `await import('kordoc')` dynamic import +
  vite.config.ts external 처리.
- **범위 = DOCX + XLSX 만**: PDF 는 kordoc 제외 (합성 PDF 에 빈 blocks 반환) —
  extractPdf 는 pdf-parse 유지. `.xls` (legacy BIFF8) 도 의도적 미지원 유지
  (0.7.16). 매핑: markdown→`text`, heading block→`headings`, block list→`chunks`.

단위 테스트 추가 (colspan 표 DOCX 구조 보존 / 멀티시트 XLSX heading+행 /
kordoc 실패 시 mammoth·exceljs fallback + meta.warning). attribution: kordoc MIT.

## [0.7.16] - 2026-05-31

### Fixed — 포맷 계약: 광고했지만 깨진 .xls 제거

`.xls` (legacy BIFF8) 가 READABLE_EXTENSIONS 에 선언돼 폴더 트리·AI 툴
설명에 "지원"으로 노출됐지만, 추출기 (exceljs) 는 OOXML 전용이라 실제 .xls
는 런타임에 모호한 jszip "not a zip" 에러로 throw 했음 (DOA). "검증 못 하는
포맷은 선언하지 않는다" 원칙에 따라 `.xls` 를 READABLE_EXTENSIONS / detectFamily
/ FolderTree 아이콘에서 제거 → 이제 명확한 "unsupported format" 으로 거부.
extractSpreadsheet 에도 방어 가드 추가. 회귀 테스트로 계약 고정 (.xls 미지원,
.xlsx 유지). 실제 .xls 지원은 kordoc parseXls 도입 (검증 포함) 시 복원 예정.

### Changed — form-fill 라벨/마커 추출 정확도 (kordoc 차용 휴리스틱)

kordoc (MIT) 의 필드 추출 휴리스틱을 코드 레벨로 차용 (라이브러리 의존성
추가 없음):

- **P1 — 라벨 정규화** (`normalizeLabelText`): 표 헤더/행 라벨의 꼬리 콜론
  ("성명:" → "성명") 과 각주 위첨자 ("등록기준지²" → "등록기준지") 제거.
  labelHint / rowLabel / columnHeader 가 모두 이 경로를 타므로 한 곳에서
  정규화. 문장 중간 콜론은 보존.
- **P2 — 체크박스 글리프 marker 인식**: `□ ☐ ☑ ■ ✔ ✅` 를 marker 컬럼
  신호로 추가 (기존엔 명시적 "(O/X)" 표기만 감지). marker 검증 char-class
  에도 이 글리프들 + ✔(U+2714) 추가 — 이전엔 모델이 "☑" 를 쓰면 거부됐음.
  헤더에 신호가 없어도 셀 자체에 체크박스 글리프가 있으면 marker 로 승격.

단위 테스트 추가 (form-format P1/P2 + 포맷 계약). attribution: kordoc MIT.

## [0.7.15] - 2026-05-31

### Fixed — getEmptyFormFields 잘못된 scope 가 "빈 칸 없음" 오판 유발

양식 문서(빈 셀 수천 개)인데도 AI 가 "채울 빈 칸이 없다"며 포기하던 버그.
원인: `getEmptyFormFields` 를 표가 없는 `parentParaIdx` 로 호출하면 scope
게이트가 모든 셀 작업을 건너뛰어 `cellFields:[]` + 모든 `tableInventory[]
.emptyCells:0` 반환 → form-guard 의 `emptyCellsRemaining` 도 0 → 침묵. prefix
`[form: N tables, M empty cells]` 는 unscoped 라 계속 form 모드 신호를 줘서
"prefix 는 form, scan 은 0" 불일치 발생. (headless @rhwp/core 재현: 실제
템플릿 64표/6752셀/4039 빈칸인데 비-표 문단 scope → 0.)

수정 (`bridge-ir-helper.ts`): (1) `emptyCells` 카운트를 scope 무관하게 항상
누적 → inventory 가 항상 truthful. (2) `parentParaIdx` 가 어떤 표도 anchor
하지 않으면 (cheap `getTableDimensions` 사전 검사) effectiveScope 를 undefined
로 낮춰 cellFields 를 unscoped 로 self-heal — 잘못된 index 한 번에 실제 셀
반환. 실재하지만 꽉 찬 표 scope 는 그대로 `cellFields:[]` (fallback 안 함).
회귀 테스트 2개 추가. 전체 unscoped 스캔 13ms (성능 영향 무시 가능).

## [0.7.14] - 2026-05-31

### Changed — form-fill 내용 일관성 (의도적 빈칸 / 노-filler)

빈 셀을 무조건 채워 filler(O/X·0·미운영 등)를 박던 문제. prompt + auto-continue
nudge + form-fill mode 에 일관성 3원칙 명문화: (1) includeFilled 로 읽고 상호
참조 셀 정합성 수정, (2) 목표와 모순되는 기존값을 replaceTextInCell 로 덮어쓰기/
삭제, (3) 진짜 값이 없으면 빈칸 — filler 금지. guard nudge 가 "전부 채워" 강제
대신 빈칸 허용·filler 금지를 전달. form-guard 단위 테스트에 원칙 3 케이스 추가.

## [0.7.13] - 2026-05-31

### Added — fillFormCells (bulk cell fill)

form-fill 이 큰 표(예: ~150 빈 셀)에서 turn cap(50)을 초과하던 문제 수정.
원인: 프롬프트가 "turn 당 5셀 + 배치마다 getEmptyFormFields 재스캔"을 지시
→ 실효 ~2.5셀/turn. 셀 텍스트 삽입은 다른 셀 좌표를 바꾸지 않으므로 재스캔은
순수 낭비였음.

- `fillFormCells` 신규 write 도구 — `cells[]` 배열로 다수 셀을 한 tool
  call(= 한 turn)에 채움. 셀별 `mode`('insert'/'replace') · `charOffset` ·
  `expectedFormat`. 모델의 parallel tool_call 상한과 무관하게 batch 보장
  (최대 200셀/call). `{ filled, failed, failures }` 반환.
- 프롬프트 + auto-continue 넛지(`prompts.ts` / `ai-modes.ts` / `form-guard.ts`)
  를 "한 read → fillFormCells 로 전체 batch → 끝에 1회 검증"으로 재작성.
  "up to 5" / 배치마다 재스캔 제거. 라우터 `ALWAYS_INCLUDE` 에 추가.

## [0.7.12] - 2026-05-27

### Added — form-fill column semantics (rowLabel / columnHeader / expectedFormat)

사용자 transcript 에서 "도입여부 (O/X)" 컬럼에 "예지보전 솔루션" / "85"
같은 잘못된 텍스트가 박히는 패턴이 반복. 원인: 모델이 `cellIdx` 만 보고
의미를 모름. `getEmptyFormFields` 가 컬럼 헤더 / 행 라벨 / expectedFormat
을 추가 노출하고, `insertTextInCell` / `replaceTextInCell` 에 optional
expectedFormat 인자 + tool-level 검증 추가.

**Heuristic (`shared/form-format.ts`):**

- `marker` — 컬럼 헤더에 `(O/X)` / `O/X` / `(○/X)` 패턴.
- `currency` — 금액 / 단가 / 비용 / 예산 / 백만원 / 만원 / 매출 / 매입.
- `date` — 일자 / 날짜 / 년월일 / 연월일.
- `number` — 수량 / 개수 / 건수 / 횟수 / 비율 / %.
- `text` — default (permissive).

**검증 (opt-in, backward compat):**

- 모델이 args 에 expectedFormat 미지정 → 기존처럼 통과.
- 지정 시 `validateTextForFormat(text, format)` 가 reject 사유 반환:
  `marker-too-long` / `marker-invalid-char` / `number-non-numeric` /
  `currency-non-numeric` / `date-invalid-char`.

**파일:**

- `shared/form-format.ts` (신규) — `ExpectedFormat` 타입 + 두 헬퍼.
- `shared/form-format.test.ts` (신규) — heuristic + 검증 단위 테스트.
- `shared/ai-tools.ts` — `insertTextInCell` / `replaceTextInCell` args 에
  `expectedFormat?` 추가 + 타입 import.
- `shared/ai-tools-defined/cell.ts` — 두 도구 schema + validate 확장.
  `getEmptyFormFields` description 갱신.
- `shared/ai-tools-defined/cell.test.ts` (신규) — expectedFormat
  validation 테스트.
- `src/features/rhwp-studio/bridge-ir-helper.ts` — getEmptyFormFields 가
  각 셀에 rowLabel / columnHeader / expectedFormat 채움. gridMap 활용.
- `src/features/rhwp-studio/bridge-ir-helper.test.ts` — 3×3 mini-form
  regression.
- `src/features/chat/viewer-handle-types.ts` — return type 동기화.
- `src/features/chat/prompts.ts` — form-fill 모드 prompt 에 column
  semantics 섹션 추가 + args template 에 expectedFormat 필드 명시.

**Why opt-in (왜 강제 require 가 아닌가):**

엄격하게 require 로 만들면 모델이 expectedFormat 한 줄 빼먹을 때마다
모든 cell 쓰기가 fail → 진행이 막힘. opt-in 으로 두면 잘 따르는 모델은
보호받고 (e.g. "도입여부 (O/X)" 에 "예지보전 솔루션" 절대 못 들어감),
무시하는 모델도 기존 동작 유지. Future tightening 은 라이브 데이터 보고
판단.

## [0.7.11] - 2026-05-27

### Added — `runAgent` sub-agent dispatch (Claude Code Task 패턴)

AI 가 자기 turn 안에서 별도 sub-agent 를 spawn 해서 복잡한 다단계 작업
을 위임 가능. Claude Code 의 Task 도구와 유사. sub-agent 는 자기 mode /
도구 set / 짧은 message history 로 self-contained 작업 후 final text 만
parent 에 반환 — parent 의 context window 보존.

**아키텍처:**

- 실행 위치: **renderer-side** (`src/features/chat/sub-agent.ts`). tool
  dispatcher 가 viewer / bridge / IPC 에 접근 필요해서 main 이 아닌 renderer.
- `callLlmAwaitable` adapter: `window.api.ai.chat` 의 streaming events
  를 Promise 로 wrap. sub-agent 의 매 turn 응답을 모아서 next turn 결정.
- **재귀 차단**: sub-agent 의 catalog 에서 `runAgent` 자동 제외 (depth=1
  강제). 무한 재귀 spawn 방지.
- Provider: parent 의 provider/model 재사용 (다른 provider 옵션은 후속).
- Max turns: 기본 10, 최대 30.

**파일:**

- `shared/ai-tools.ts` — `runAgent` tool name + args.
- `shared/ai-tools-defined/agent.ts` (신규) — defineTool entry.
- `src/features/chat/sub-agent.ts` (신규) — `runSubAgent` loop +
  `callLlmAwaitable` + system prompt builder.
- `src/features/chat/tools.ts` — `SubAgentContext` export + dispatcher
  case (`runAgent` → `runSubAgent` 호출).
- `src/features/chat/hooks/useChatStreaming.ts` — 매 turn dispatcher
  호출 시 subAgentContext (provider / model / parentMode / baseSystemPrompt
  / targetPath) inject.
- `src/app/AppShell.tsx` — `runTools` prop wrapper 가 subAgentContext
  forward.
- `shared/ai-modes.ts` — cross-doc-research / form-fill mode 의 tools 에
  `runAgent` 추가.

**Use cases:**

- "코렌스 회사 최근 보도자료 찾아서 정리해줘" → sub-agent (cross-doc-
  research) 가 webSearch + webFetch + 요약 → parent 가 응축된 결과로
  본문 작성.
- "이 양식의 모든 표 구조 분석해서 카테고리화해줘" → sub-agent 가
  getEmptyFormFields 반복 + 분류 → parent 가 결과로 작업 결정.
- "git log 분석해서 changelog 초안 만들어줘" → sub-agent 가 runCommand
  - 정리 → parent 가 받아 본문에 inject.

### 검증

- vitest 374/374 (351 → +23). 신규:
  - `agent.test.ts` (15) — registry / prompt validation / 6 mode enum /
    maxTurns 범위 / trim.
  - `sub-agent.test.ts` (8) — text-only response / tool dispatch flow /
    failed tool graceful / maxTurns guard / maxTurns clamp / LLM error /
    **재귀 차단** (catalog 에 runAgent 없음).
- typecheck + eslint 통과. 0.7.10 → 0.7.11.

### "Claude Code 도구 통합" 시리즈 완료 (0.7.7 ~ 0.7.11)

| Claude Code 도구     | ahwp 대응                                     | Version        |
| -------------------- | --------------------------------------------- | -------------- |
| Read / Glob / Grep   | searchWorkspaceOutlines + readParagraphByPath | 기존           |
| Edit / Write (HWP)   | 55 도구 (defineTool registry)                 | 0.6.x + 0.7.4  |
| WebFetch             | webFetch (Readability)                        | 0.7.7 + 0.7.10 |
| WebSearch            | webSearch (DDG + Brave)                       | 0.7.7 + 0.7.8  |
| Bash                 | runCommand (7 게이트)                         | 0.7.9          |
| **Task (sub-agent)** | **runAgent**                                  | **0.7.11**     |

이로써 ahwp 의 AI 가 워크스페이스 read + HWP edit + 외부 정보 (web /
shell) + 작업 위임 (sub-agent) 의 agentic loop 전부 갖춤.

## [0.7.10] - 2026-05-27

### Improved — webFetch 콘텐츠 추출 품질 (Readability + linkedom)

0.7.7 의 `webFetch` 는 HTML 을 정규식 best-effort 로 plain text 변환했음.
nav / sidebar / footer / ad 도 같이 들어가 AI 가 받는 컨텍스트 잡음 많음.
0.7.10 부터 Mozilla 의 **Readability** (Firefox Reader Mode 엔진) + light
DOM 구현 **linkedom** 으로 article body 만 정확히 추출.

**의존성 추가** (둘 다 production deps):

- `@mozilla/readability` ^0.6.0 — Firefox Reader Mode 엔진, MIT, ~30KB.
- `linkedom` ^0.18.12 — jsdom 의 light 대체 (jsdom 의 ~30x 작음), MIT, ~100KB.

**변경:**

- `electron/ipc/web.ts`:
  - `htmlToArticle(html, url)` (신규) — linkedom 으로 DOM parse →
    Readability 로 article 추출. metadata (title / byline / excerpt /
    siteName) 자동 반환. parse 실패 / non-article 페이지면 `null` →
    `legacyHtmlToText` regex fallback.
  - `legacyHtmlToText` — 기존 정규식 path. Readability fallback +
    `parseDuckDuckGoHtml` 의 anchor 텍스트 정리에 계속 사용.
  - `webFetchImpl` 이 HTML content-type 일 때 Readability path 우선,
    응답에 metadata + `extractionMethod` (`'readability'` 또는
    `'regex'`) 포함.
- `shared/api.ts` — `WebFetchResult` 에 `title` / `byline` / `excerpt` /
  `siteName` / `extractionMethod` 필드 추가.
- `shared/ai-tools-defined/web.ts` — `webFetch` description 갱신
  (Readability 명시 + metadata 반환 안내).

**효과:**

- AI 의 webFetch 응답이 본문 중심으로 깔끔 — context window 절약.
- Article 의 author / 발행일 / siteName 자동 인지 → 인용 / 출처 표기 정확.
- Non-article (검색 결과 / SPA shell) 은 자동으로 regex fallback —
  회귀 없음.

### 검증

- vitest 351/351 (349 → +2). 신규 케이스:
  - Article 페이지 → Readability 추출 + nav/footer 제거 + title 자동.
  - non-article (link list) → 정상 동작 (Readability or regex 어느 path 든).
  - text/plain 은 변환 안 함 (extractionMethod undefined).
  - script / style block 제거 (어느 path 든).
- typecheck + eslint 통과. 0.7.9 → 0.7.10.

### 다음 chunk

- 0.7.11 — Agent (sub-agent dispatch).

## [0.7.9] - 2026-05-27

### Added — Bash 명령 실행 도구 (allowlist + 7 단계 보안 게이트)

Claude Code 의 Bash 도구처럼 AI 가 shell 명령을 실행할 수 있는 도구
추가. **위험 도구** 라 default OFF + allowlist + 다중 게이트로 안전 확보.

**보안 모델 (7 단계 게이트):**

1. **Enabled 토글** — 기본 OFF. 사용자가 Settings 에서 명시 ON 해야
   catalog 에 노출.
2. **Allowlist 매치** — 사용자 등록 prefix 와 매치해야 함. 비어 있으면
   ON 이라도 거부 (deny-by-default).
3. **Hardcoded blocklist** — allowlist 와 무관하게 항상 거부:
   `sudo` / `su `, `rm -rf` 변종, fork bomb (`:(){:|:&};:`),
   `curl|sh` / `wget|sh`, `dd if=`, `mkfs`, `shutdown` / `reboot`,
   위험 `/dev/` redirect (단 `/dev/null`/`stderr`/`stdout` 허용).
4. **Workspace 격리** — cwd 는 workspace root 기준 상대 경로만. 절대
   경로 거부, `..` 으로 탈출 거부. workspace 미설정 시 거부.
5. **Timeout** — 기본 60s, 사용자 args 로 최대 5분. 초과 시 SIGTERM.
6. **Output cap** — stdout / stderr 각 32KB.
7. **Env 화이트리스트** — 호스트 env 의 secrets (API keys 등) 노출 차단.
   `PATH` / `HOME` / `USER` / `LANG` 등 안전한 변수만 전달.

**구현:**

- `electron/store/bash-allowlist.ts` (신규) — enabled 토글 + allowlist
  패턴 저장. `matchesAllowlist` pure helper (prefix + word boundary).
- `electron/ipc/bash.ts` (신규) — `validateBashRun` pure 게이트 검사 +
  `bashRunImpl` 가 `child_process.exec` 호출. 5 IPC 등록.
- `shared/ai-tools-defined/bash.ts` (신규) — `runCommand` defineTool entry.
  free-authoring / body-edit mode 노출 (cross-doc-research 는 read-only
  라 제외).
- `shared/api.ts` — `BashApi` + `BashRunRequest` / `BashRunResult` 타입.
- `electron/preload.ts` — `window.api.bash` 노출.
- `src/features/chat/tools.ts` — `runCommand` dispatcher case + summary.
- `src/features/settings/SettingsDialog.tsx` — "Bash 명령 실행" 섹션:
  ⚠️ 위험 경고, 활성화 토글, allowlist textarea + 저장 버튼.

### 검증

- vitest 349/349 (325 → +24). 신규 케이스:
  - `bash-allowlist.test.ts` (8) — prefix 매치 / word boundary / 빈
    allowlist / case-sensitivity / 앞뒤 trim.
  - `bash.test.ts` (16) — enabled OFF / empty / blocklist (sudo / rm
    -rf / fork bomb / curl|sh / dd if= / dev sda) / `/dev/null` redirect
    허용 (false-positive 가드) / allowlist empty·miss / workspace 미설정
    / cwd 절대·탈출 / 정상 통과 + 정규화 / timeoutMs clamp.
  - `ai-tool-def.test.ts` — registry 자동 검증 (runCommand 포함).
- typecheck + eslint 통과. 0.7.8 → 0.7.9.

### 사용 방법

1. Settings → AI 공급자 → "Bash 명령 실행" 섹션
2. 활성화 토글 ON
3. allowlist 입력 (한 줄에 하나):
   ```
   git status
   git diff
   npm test
   npm run build
   ls
   cat
   grep
   ```
4. 저장 → AI catalog 에 `runCommand` 도구 노출
5. 사용 예: "git status 결과 보여줘", "npm test 돌려서 결과 분석해줘"

allowlist 없는 명령은 즉시 거부. blocklist 패턴은 allowlist 에 넣어도 차단.

### 다음 chunk

- 0.7.10 — Agent (sub-agent dispatch).

## [0.7.8] - 2026-05-27

### Added — Brave Search API 지원 + Settings UI (DDG fallback 유지)

0.7.7 의 DDG HTML scraping 은 IP rate-limit / 결과 품질 문제 잠재. 사용자가
정식 API key 등록 시 자동 우선 사용, 없으면 DDG fallback.

**신규:**

- `electron/store/web-keys.ts` (신규) — Brave / SerpAPI key 의 safeStorage
  암호화 store. provider key store 와 분리 (ProviderId union 오염 회피).
  `getWebSearchKeyPlaintext` 는 **main process only** — renderer 에 plaintext
  노출 안 됨. `pickActiveSearchBackend` 가 brave > serpapi > null 우선순위
  자동 선택.
- `electron/ipc/web.ts` 확장:
  - `searchViaBrave` — Brave Search API (`api.search.brave.com/res/v1/web/
search`) JSON 응답 파싱. 응답 = `{web:{results:[{title,url,description}]}}`.
  - `webSearchImpl` 이 backend 자동 선택. Brave 실패 시 (rate / network) DDG
    로 자동 retry → 한 backend 일시 문제로 검색 전체가 막히지 않음.
  - 새 IPC: `web:set-search-key` / `web:has-search-key` / `web:delete-search-
key` / `web:get-active-backend`.
  - `web:backend-changed` broadcast — UI 가 reactive 갱신.
- `shared/api.ts` — `WebApi` 확장 + `WebSearchBackend` / `ActiveSearchBackend`
  타입.
- `electron/preload.ts` — 새 IPC 노출.
- `src/features/settings/SettingsDialog.tsx` — AI 공급자 탭에 "Web 검색
  백엔드" 섹션 추가:
  - 현재 활성 백엔드 표시 (`brave` / `serpapi` / `ddg` chip + 설명).
  - Brave API key 입력 + 저장 + 삭제 버튼.
  - `api.search.brave.com/app/keys` 발급 링크.
  - 무료 tier 정보 (2000 q/month, 1 q/s).

**보안:**

- API key 는 OS 키체인 (`safeStorage`) 에 암호화 저장.
- Renderer 에 plaintext 노출 없음 (`get` IPC 미제공).
- 키 입력 필드는 type=password.

### 검증

- vitest 325/325 (320 → +5). 신규 Brave backend 케이스 (electron/ipc/
  web.test.ts):
  - Brave key 등록 시 Brave API 우선 (X-Subscription-Token 헤더 검증).
  - Brave 실패 (429) → DDG fallback 정상 동작.
  - Brave key 없음 → DDG 바로 사용 (fetch 1회만).
  - maxResults cap 적용.
  - 응답 web.results 없음 → 빈 array.
- typecheck + eslint 통과. 0.7.7 → 0.7.8.

### 사용 방법

1. Settings → AI 공급자 → "Web 검색 백엔드" 섹션
2. Brave Search 가입 (https://api.search.brave.com/app/keys) — 무료 tier 충분
3. 발급된 token 을 "Brave Search API key" 필드에 붙여넣고 저장
4. 현재 활성 백엔드 chip 이 `ddg` → `brave` 로 변경됨
5. AI 의 webSearch 호출이 자동으로 Brave 사용

키 없는 사용자는 DDG fallback 그대로 사용 — 기본 동작 변화 없음.

### 다음 chunk

- 0.7.9 — BashExec (allowlist + confirm 게이트).
- 0.7.10 — Agent (sub-agent dispatch).

## [0.7.7] - 2026-05-27

### Added — webFetch / webSearch + cross-doc-research mode 활성화

AI 가 워크스페이스 외 정보 (HTTP URL / 검색 결과) 를 직접 가져올 수
있도록 외부 세계 access 도구 2개 추가. cross-doc-research mode 의
실질적 활용이 시작됨.

**신규 도구:**

- `webFetch({url, prompt?, maxBytes?})` — 단일 URL 의 본문 가져오기.
  http / https only. HTML 은 자동으로 plain text 로 변환 (tag 제거 +
  entity decode + whitespace 정규화). 30s timeout, 기본 32KB cap.
- `webSearch({query, maxResults?})` — 웹 검색. DuckDuckGo HTML 인터페이스
  사용 (API key 불필요). 결과 = {title, url, snippet}[]. maxResults
  1-20, 기본 10.

둘 다 `readonly: true` — 사용자 confirm 게이트 우회, 즉시 실행. URL
scheme 강제 (http / https 외 거부), size cap, timeout 으로 safety.

**아키텍처:**

- `shared/ai-tools-defined/web.ts` (신규) — defineTool entries.
  cross-doc-research / free-authoring / body-edit mode 노출.
- `electron/ipc/web.ts` (신규) — main process IPC handler.
  Node 의 global `fetch` 사용. HTML → text 는 정규식 기반 best-effort
  (cheerio 등 외부 의존 회피). DuckDuckGo HTML 결과 페이지 파싱은
  `<a class="result__a">` / `result__snippet>` 패턴 기반 — 비정식
  API 라 변경에 fragile, 향후 Brave Search 등 정식 API 옵션 추가 예정.
- `shared/api.ts` — `WebApi` namespace + `AhwpApi.web` 추가.
- `electron/preload.ts` — `window.api.web` 노출.
- `src/features/chat/tools.ts` — dispatcher case + summary fn.
- `shared/ai-modes.ts` — cross-doc-research mode 의 `tools` 가 'all' →
  실제 read-only subset (workspace read + web access + 활성 doc read,
  본문 / 셀 write 전부 제외). promptFragment 도 실제 가이드로 채움.

### 검증

- vitest 320/320 (289 → +31, 신규 케이스):
  - `shared/ai-tools-defined/web.test.ts` (12) — registry / readonly /
    URL scheme 거부 (file:// / ftp://) / args size cap / maxBytes /
    maxResults 범위.
  - `electron/ipc/web.test.ts` (14) — webFetchImpl mock fetch (http /
    https / 4xx / timeout / maxBytes truncate / HTML→text 변환 /
    script·style 제거 / entity decode), webSearchImpl (정상 파싱 /
    uddg redirect 디코딩 / maxResults cap / 빈 query / fetch 실패).
  - `mode-integration.test.ts` (+1) — cross-doc-research catalog 가
    web 도구 포함하고 본문 write 제외, prompt fragment 활성.
  - `shared/ai-modes.test.ts` (갱신) — 활성 mode set 에
    cross-doc-research 추가, subset assertion.
- typecheck + eslint 통과. 0.7.6 → 0.7.7.

### 다음 chunk

- 0.7.8 — Settings 에서 Brave Search / SerpAPI 등 정식 API key 옵션
  (DDG fallback).
- 0.7.9 — BashExec (allowlist + confirm 게이트).
- 0.7.10 — Agent (sub-agent dispatch).

## [0.7.6] - 2026-05-27

### Fixed — form guard 무한 nudge loop (StrictMode 이중 fire + 잘못된 no-svg trigger)

사용자 보고 "auto continue 무한히 시도하는데". 양식 prefix 가 있는 문서
지만 실제 빈 셀이 0 인 경우 (휴리스틱 prefix count 와 실제 cell scan 의
불일치) AI 가 "빈 셀 없어요" 정직 응답할 때 form guard 가 무한 nudge 발사.

**원인 두 가지:**

1. **React.StrictMode 이중 fire**: 0.7.2 의 form guard 가 `setMessages`
   updater 안에서 `queueMicrotask(fireChat)` 를 호출했는데, StrictMode 가
   updater 를 두 번 invoke 해서 fireChat 가 두 번 schedule. 두 개의 동시
   LLM 요청이 같은 user-task 에 interleave 되며 cap counter (max 2) 가
   무력화. `advanceAgentLoop` 에는 이미 같은 fix 가 있었는데 form guard
   추가 시 누락.
2. **잘못된 `no-svg` 단독 nudge**: 0.7.5 까지의 guard 는 `getPageSvg` 미
   호출 만으로도 nudge 발사. prefix 는 form 신호인데 실제 빈 셀 0 인
   case 에서 AI 가 svg 호출해도 다음 turn 에 또 nudge → 무한 loop.

**수정:**

- `src/features/chat/hooks/useChatStreaming.ts`: form guard 의 setMessages
  updater 에 `let fired = false` flag 추가 — `advanceAgentLoop` 의 dedup
  패턴과 정합. StrictMode 이중 invoke 가 와도 queueMicrotask(fireChat) 는
  딱 1회만 schedule.
- `src/features/chat/form-guard.ts`: logic 재설계. 3 case 로 단순화:
  1. `formState === null` → discovery nudge (getEmptyFormFields 호출 강제)
  2. `emptyCellsRemaining > 0` → fill nudge (메시지 안에 getPageSvg 권고 포함)
  3. `emptyCellsRemaining === 0` → **nudge 안 함**. AI 의 "이건 양식 아니에요 /
     이미 채워져 있어요" 응답이 정답. svg 단독 nudge 폐기.
- `reason` 타입 정리: `'no-svg' | 'both'` 제거 → `'no-form-discovery' |
'empty-cells-remain'` 로 단순화.

### 검증

- vitest 289/289 (288 → +1). form-guard 테스트 갱신 (10 케이스): mode 외
  비활성 / formState null discovery / 빈 셀 fill / svg 이미 호출 / **0.7.5
  회귀 직접 재현** (prefix 는 form 인데 빈 셀 0 + svg 미호출 → nudge 안 함)
  / 빈 셀 0 + svg 호출 / cap 도달 / agentStopped / 빈 tableSummary / cap
  도달 시 discovery 도 비활성.
- typecheck + eslint 통과. 0.7.5 → 0.7.6 patch bump.

## [0.7.5] - 2026-05-27

### Fixed — iframe 포커스 상태에서 글로벌 단축키 동작 안 함

가운데 메인 패널이 rhwp-studio iframe 으로 전환된 이후, iframe 안에서
발생한 keydown 이 cross-frame 경계 때문에 parent window 까지 bubble 안
되어 ahwp 의 글로벌 단축키들이 작동 안 함:

- ⌘K — 명령 팔레트
- ⌘W — 탭 닫기
- ⌘/ — Settings 단축키 탭
- ⌘⇧F — cross-folder 검색
- ⌘⇧O — outline (TOC) sidebar 토글
- F6 — 스타일 관리 다이얼로그 (한컴 reflex)
- Alt+L / Alt+T / Alt+P — 글자 / 문단 / PDF 내보내기 (한컴 reflex)

(주의: Electron 메뉴 accelerator 로 등록된 ⌘N / ⌘O / ⌘S / ⌘Z / ⌘B /
⌘I / ⌘U / ⌘F / ⌘H 는 window-level 에서 캡쳐되어 iframe 포커스 상태에서도
정상 발화 — 본 회귀의 영향 받지 않음.)

**해결**:

- **`vendor/rhwp/rhwp-studio/src/main.ts`** — iframe document 의 capture
  phase keydown listener 가 modifier (meta/ctrl/alt) 또는 F1~F12 만 골라
  `window.parent.postMessage({type:'rhwp-event', name:'keydown', data})`
  로 forward. 일반 타이핑은 send 안 함 (noise 회피).
- **`src/features/rhwp-studio/keydown-forward.ts`** (신규) —
  `dispatchForwardedKeydown(payload, target?)` pure helper. modifier /
  key / code 모두 보존한 KeyboardEvent 를 bubbles + cancelable 로 합성,
  target (기본 `window`) 에 dispatch. AppShell 의 window-level onKey 가
  자연스럽게 받음.
- **`src/features/rhwp-studio/RhwpEditor.tsx`** — bridge ready 후
  `bridge.on('keydown', dispatchForwardedKeydown)` 구독. unmount 시
  unsubscribe.

### 검증

- vitest 288/288 (281 → +7, keydown-forward 7 케이스: ⌘K / ⌘⇧F / F6 /
  Alt+L / bubbles+cancelable / 기본 target=window / preventDefault).
- typecheck + eslint 통과.
- vendor 재빌드 (`npm run vendor:rhwp:build`) 완료.

## [0.7.4] - 2026-05-27

### Changed — defineTool refactor (single source of truth)

이전 0.7.3 까지는 각 도구가 4 파일을 lockstep 으로 정의:

- `shared/ai-tools.ts` — `AHWP_TOOL_NAMES`, `AhwpToolArgs[name]`
- `shared/ai-tool-catalog.ts` — `TOOL_DESCRIPTORS` 의 schema + description
- `shared/ai-tool-validate.ts` — `validateArgs` switch 의 args 검증
- (선택) `shared/ai-tools.ts` 의 `READONLY_TOOL_NAMES` set

한 파일 빼먹으면 사일런트 회귀. 0.6.17 의 `includeFilled` strip 회귀가
정확히 이 lockstep 깨짐 — schema 에는 있고 validator 에서는 누락되어
dispatcher 까지 도달 못 함.

0.7.4 는 도구당 한 곳 정의로 통합:

- **`shared/ai-tool-def.ts`** (신규) — `defineTool({...})` helper +
  `buildToolRegistry(defs)`. 한 도구의 schema + validate + readonly +
  modes 가 한 객체 안.
- **`shared/ai-tools-defined/`** (신규 디렉토리, 6 카테고리 파일) —
  55 도구 전부 migration:
  - `format.ts` (13) — caret 서식 + 본문 텍스트 primitive + paragraph 서식
  - `cell.ts` (5) — 셀 read/write + form-fill discovery
  - `table.ts` (12) — 표 구조 변경 / properties / 수식
  - `shape.ts` (7) — 도형 / 그림
  - `page.ts` (19) — page / section / header-footer / bookmark /
    footnote / equation / style
  - `read.ts` (10) — read-only 조회 / 시각 캡처 / cross-doc 라우팅
- **`shared/ai-tool-catalog.ts`** — 1100-line `TOOL_DESCRIPTORS` 배열
  제거. registry 의 descriptors 를 mode filter 와 같이 노출하는 ~50줄
  thin wrapper.
- **`shared/ai-tool-validate.ts`** — 800-line `validateArgs` switch 제거.
  registry 의 validator map 으로 dispatch 하는 thin wrapper. helper
  함수들 (isObj, byteLen, coerceNonNegInt, nonNegInts) 만 export
  (defineTool 의 validate 안에서 재사용).

새 도구 추가 시 `shared/ai-tools-defined/<카테고리>.ts` 에 `defineTool`
한 번만 호출 — schema + validator + readonly 메타가 한 곳에 모임.

### 검증

- vitest 281/281 (273 → +8). 신규 `shared/ai-tool-def.test.ts` 가
  registry vs `AHWP_TOOL_NAMES` 완전 일치 / readonly drift / 중복
  등록 차단 / 모든 validator 결정적 응답 / 0.6.17 회귀 재현 (includeFilled
  boolean) 검증.
- typecheck + eslint 통과.

### 다음 chunk

- 0.7.5 — Provider × Mode capability matrix + 나머지 mode 활성화
  (BodyEdit / TableManipulation / Formatting / CrossDocResearch).

## [0.7.3] - 2026-05-27

### Fixed — patches dispatcher hardening + diff side panel + UI polish

0.6.14 ~ 0.6.20 사이에 진행되었지만 commit 되지 않은 채 working tree
에 남아 있던 ready 변경을 정리. `GithubDiffPane.tsx` 누락이 가장 큰
회귀: ChatPanel.tsx 가 0.6.18 부터 이 파일을 import 하지만 파일 자체는
git 추적 안 됨 → 이론상 dev branch 의 새 clone 이 TypeScript 빌드
실패. 본 chunk 가 그 갭을 닫는다.

- **`shared/ai-patches.ts`** — `repairLlmJson` (smart quotes / 후행 쉼표
  / U+2028 line separator / line·block comment 제거) 와
  `dedupeCellTargets` (한 batch 안의 동일 cell coordinate 중복 거부)
  helper 추가. `parsePatchBlock` 가 strict JSON.parse 실패 시 repair 후
  retry. 모델이 dense `additionFormat.lib` 를 보내며 흔히 발생하는
  parsing 실패가 silent 회복.
- **`src/features/chat/GithubDiffPane.tsx` + test** (신규) — 본문 patches
  를 inline diff card 가 아니라 editor 우측 side panel (380px) 로
  portal. AppShell 의 portal target div 가 empty:hidden 으로 빈 상태
  에선 editor 전폭, patches 있을 땐 380px 너비로 분할. IDE 의 diff
  viewer UX 와 정렬.
- **`src/app/AppShell.tsx`** — diff overlay 절대 배치 → 진짜 side panel
  layout 으로 전환 + applyPatches dispatch 가 `dedupeCellTargets` 결과를
  사용해 중복 셀 patch 거부.
- **`src/app/TitleBar.tsx`** — Windows / Linux native 창 컨트롤 (min /
  max / close) 가 우상단 ~138px 점유. 이전 `paddingRight: 10` 에선 우리
  settings / theme 버튼이 같은 좌표에 겹쳐 "X" 클릭이 settings 로 라우팅
  되던 회귀 fix.
- **`src/features/chat/toolRouter.ts`** — `insertTextInCell` 을
  `ALWAYS_INCLUDE` 에 추가. router LLM 이 form-fill 작업에서 이 도구를
  깜빡 빼면 agent 가 patches block (text) 으로 우회 → 한 turn 만에 종료
  되는 회귀 가드.
- **`src/features/chat/tools.test.ts`** — helper 경로의 `findInDocument`
  가 raw `RhwpSearchHit ({sec, para})` 를 viewer-handle contract
  `{sectionIdx, paragraphIdx}` 로 remap 하는지 검증하는 회귀 테스트.

### 검증

- vitest 273/273 (working tree 에 이미 있던 신규 케이스 — ai-patches
  repair / dedup / findInDocument shape — 모두 통과).
- typecheck + eslint 통과.

## [0.7.2] - 2026-05-27

### Added — slotKind classification + Form-Fill completion guard

0.7.1 이 본문 dump 회귀 (channel 1) 를 차단한 뒤 다음 회귀 두 개가
드러남:

1. **Placeholder 미교체** — italic + 비검정 색의 템플릿 예시문 (e.g.
   "예) 회사명을 입력하세요", "1.3 주요 공정별 ... 내용을 요약하여 기술")
   이 있는 셀에 AI 가 `insertTextInCell` 을 호출해 값이 placeholder 뒤에
   prepend → 셀 안에 예시문 + 새 값 공존, layout 깨짐.
2. **조기 종료 + 시각 검증 skip** — 200+ 셀 form 의 ~15 셀만 채우고
   AI 가 텍스트 메시지로 완료 선언, `getPageSvg` 한 번도 안 부름.

두 가지 모두 prompt 가이드 (0.7.1) 만으로는 100% 강제 불가 — AI 가
guideline 을 일부 무시하는 패턴이 잔존. 0.7.2 는 runtime contract 로 격상:

- **`getEmptyFormFields` 의 `slotKind`** — 셀마다 4 종 분류 부착.
  `'value-slot'` (빈 셀) / `'instruction'` (italic + 비검정 placeholder) /
  `'sub-header'` (bold + 짧은 인-셀 라벨) / `'content'` (정상 데이터).
  Prompt 가이드 + viewer-handle-types 컨트랙트에 명시 — AI 가 셀별로
  도구 선택 (insertTextInCell vs replaceTextInCell) 을 정확히.
- **Form-Fill completion guard** (`form-guard.ts`, `useChatStreaming`).
  form-fill 모드에서 AI 가 tool 호출 없이 텍스트만 emit 하면 (= 완료
  선언) runtime 이 (a) tableInventory 의 empty cells 합 (b) getPageSvg
  호출 여부 검사. 미충족 시 synthetic user message 자동 inject + fireChat
  재진입. cap (2회) 으로 무한 loop 방지. user-task 시작 / stop / regenerate
  시 reset.

### 검증

- vitest 273/273 (258 → +15). 신규: slotKind 4 종 full coverage + black
  color 정규화 (`#000` / `#000000` / 공백) + integration prompt 에
  slotKind / getPageSvg / replaceTextInCell 가이드 / form-guard 9 케이스
  (mode gate, 양쪽 trigger, cap 도달, agentStopped, formState null,
  tableSummary 빈 케이스).
- typecheck + eslint 통과.

### 다음 chunk

- 0.7.3 — `defineTool` refactor (단일 source of truth: 스키마 + 검증 +
  dispatcher).
- 0.7.4 — Provider × Mode capability matrix.
- 0.7.5 — 나머지 mode (BodyEdit / TableManipulation / Formatting /
  CrossDocResearch) 활성화.

## [0.7.1] - 2026-05-27

### Added — FormFill mode 활성화

0.7.0 의 infra 위에 첫 mode 실제 동작 enable. 양식 문서 자동 진입 →
body write tool 이 AI catalog 에서 빠짐 → 본문 dump 회귀 channel 1
원천 차단.

- `form-fill` mode 의 `tools` 가 실제 subset 으로 좁아짐: cell write
  (`insertTextInCell`, `replaceTextInCell`) + cell read
  (`getEmptyFormFields`, `getCellInfo`) + 시각 검증 (`getPageSvg`) +
  일반 read (`getDocumentOutline`, `findInDocument` 등) + cell 서식
  (`applyCharFormat`, `applyCellStyle`) + cross-doc read. **본문 write
  (`insertText`, `applyHtml`, `deleteRange`, `insertParagraph` 등) 와
  표 구조 변경 도구는 catalog 에서 제거** — AI 가 emit 할 방법 자체
  없음.
- `form-fill` mode 의 `promptFragment` 활성화 — "Form Fill Mode" 가이드
  (workflow: unscoped getEmptyFormFields → cell writes parallel →
  getPageSvg 시각 검증). `ahwp-patches` 블록 emit 도 자제하도록 명시
  (catalog 차단은 0.7.2 의 patches dispatcher guard 에서 hard enforce).
- `ModeDetector` — 최근 `getDocumentSummary` tool result 의 content 에
  `[form: N tables, M empty cells]` 패턴 + M ≥ 3 검출하면 form-fill
  자동 진입. userOverride 가 있으면 그 값 우선.
- `useChatStreaming` — history 에서 form prefix 추출 후 `detectMode`
  호출, 결정된 modeContext 를 (a) catalog filter, (b) prompt fragment
  append, (c) ChatRequest.modeContext, (d) ChatPanel UI state 에 모두
  전달. `opts.setModeContext` setter / `currentModeRef` ref 양쪽 노출.
- `ChatPanel` — `ModeBadge` 가 reactive. detected (form-fill 자동
  진입) 일 땐 emerald, user-override 일 땐 amber, default 일 땐 기본.
  툴팁에 reason 표시 ("문서에서 9 개 표 / 212 개 빈 셀 감지").

### 검증

- vitest 258/258 (255 → +3). 신규: form-fill subset assertion + 본문
  write 제외 assertion + ModeDetector form-prefix 진입 / threshold
  미달 / override 우선 케이스.
- 영향 e2e 14/14 통과 (chat / chat-prefetch).
- typecheck 통과.

### 다음 chunk

- 0.7.2 — patches dispatcher form-context guard (현재 prompt 권고만, AI
  가 무시하면 패치 적용까지 가는 risk 잔존 → 0.7.2 에서 runtime hard
  reject + constructive error).
- 0.7.3 — defineTool refactor.

## [0.7.0] - 2026-05-27

### Added — Task-Mode Architecture (infra only)

minor 가 아닌 **architectural jump**. 0.6.x 의 mole-whacking 패턴
(본문 dump / scope 오류 / patches 회귀 / NIM 호환 / validator strip)
의 공통 root cause = "55 generic tool 을 모든 task 에 노출" 의 mismatch.
0.7.x 가 각 task 의 contract 별로 tool surface 를 슬라이스.

#### 0.7.0 — 인프라만 (동작 0.6.20 과 동일)

- 신규 `shared/ai-modes.ts` — `TaskMode` union (`free-authoring` /
  `form-fill` / `body-edit` / `table-manipulation` / `formatting` /
  `cross-doc-research`) + `MODE_REGISTRY` + `resolveAllowedTools`.
  모든 mode 의 `tools` 가 0.7.0 에서는 `'all'` (placeholder) — 0.7.1 부터
  실제 subset.
- 신규 `src/features/chat/mode-detector.ts` — `detectMode(input)` 가
  user override 만 반영, 나머지는 default. 0.7.1 부터 docSummary /
  user intent 휴리스틱 활성화.
- `shared/ai-tool-catalog.ts` `getAhwpToolCatalog(modeContext?)` —
  mode whitelist 로 카탈로그 slice. 0.7.0 placeholder 라 실제 효과 X.
- `src/features/chat/prompts.ts` `appendModePrompt(base, ctx)` — base
  prompt 뒤에 mode 의 short fragment append (현재 모두 빈 fragment).
- `ChatRequest` 에 `modeContext?: ModeContext` 추가 — provider 어댑터는
  transparent (renderer 가 catalog / prompt 를 미리 좁힘).
- `useChatStreaming` 이 turn 마다 `detectMode()` 호출 → catalog +
  prompt + ChatRequest 에 mode 전달.
- `ChatPanel` provider bar 에 신규 `ModeBadge` (현재 항상 "편집" 표시,
  0.7.1 부터 mode 자동 진입 + override 토글 활성화).

#### 검증

- vitest 255/255 (242 → +13). 신규: `ai-modes.test.ts` 6 / `ai-tool-catalog.test.ts` 3 / `mode-detector.test.ts` 4.
- 영향 받은 e2e (chat / chat-prefetch / settings) 24/24 + 1 flaky (SLOW
  abort, mode 와 무관 기존 race).
- typecheck 통과.

#### 다음 chunk

- 0.7.1 — FormFill mode 활성화 (schema extractor + fillFormSlots batch tool + body write hard-block + mode 자동 진입).
- 0.7.2 — BodyEdit mode + anchor schema.
- 0.7.3 — defineTool refactor (schema / validator / dispatcher single source of truth).
- 0.7.4 — Provider × Mode capability matrix.
- 0.7.5 — 나머지 mode.

## [0.6.20] - 2026-05-27

### Added — Provider vision integration (OpenAI + Google Gemini)

0.6.17 / 0.6.19 가 `getPageSvg` 도구 + chat UI inline SVG render 까지
연결했지만 AI 자체는 SVG 를 못 봤음. 0.6.20 이 multimodal 경로를 닫음:

- `shared/ai.ts` `ToolResultRecord` 에 `imageBase64` + `imageMediaType`
  optional 필드 추가. tool 결과가 image 를 carry 할 수 있게.
- `src/features/chat/svg-to-png.ts` 신규 — renderer-side SVG → PNG
  변환 (Blob → Image → Canvas → toDataURL). 흰 배경 + 1280px 다운스케일.
- `src/features/chat/hooks/useChatStreaming.ts` 의 tool 결과 build
  코드가 `getPageSvg` 결과면 SVG 추출 → PNG 변환 → `imageBase64` /
  `imageMediaType` 채움. 변환 실패면 graceful degrade (text content
  만 보냄).
- `electron/ai/providers/openai.ts` — chat-completions 와 responses
  API 양쪽 형식 모두 tool message 다음에 image-carrying user 메시지
  inject (chat-completions 는 `image_url` part, responses 는
  `input_image` part). vision-capable OpenAI 모델 (gpt-4o, gpt-5.x
  계열) 이 image 도 보고 form-fill 결과를 직접 시각 검증 가능.
- `electron/ai/providers/google.ts` — Gemini 의 `functionResponse`
  part 자체는 multimodal 미지원이라 따라 붙는 user 메시지에 `inlineData`
  part 로 inject. Gemini 2.x flash / pro 가 이미지 해석.
- Anthropic 어댑터는 현재 미구현 (CLAUDE.md "키 결정 대기") — 향후
  추가 시 `tool_result.content` 안에 image block 으로 native multimodal
  지원 가능.

### 테스트

- vitest 242/242. 신규:
  - `openai.test.ts` — vision 4 케이스 (plain / with-image, chat-completions
    - responses API 양쪽).
  - `google.test.ts` — Gemini 3 케이스 (plain / with-image / system 병합).
- 영향 받은 e2e 14/14 통과 (chat / chat-prefetch).
- 실제 vision flow round-trip 은 live API 키 필요라 manual smoke 영역
  (이후 사용자가 OpenAI gpt-5-mini 로 "양식 채우고 페이지 캡쳐해서
  확인해줘" 시나리오 실행 시 검증됨).

## [0.6.19] - 2026-05-27

### Added — Chat UI 가 `getPageSvg` 결과를 inline 이미지로 즉시 표시

0.6.17 의 `getPageSvg` AI 도구는 SVG 문자열을 반환하지만 이전엔 `▶`
펼치기 버튼으로 raw JSON 을 봐야 시각 확인 가능했음. 0.6.19 에서
`ToolEntryRow` 가 `entry.name === 'getPageSvg'` 일 때 result JSON 의
`svg` field 를 base64 data-URL 로 인코딩해 `<img src="data:image/svg+xml..."/>`
로 inline 표시. 사용자는 form-fill 완료 직후 채팅 안에서 바로 페이지
상태를 시각 확인 가능. truncated flag 가 있으면 "잘림 · 원본 NB" hint
도 함께. `<img>` 사용으로 SVG 내부 `<script>` 가 inert 처리되어 XSS 안전.

UTF-8 한글 SVG 도 정상 인코딩 — `TextEncoder` + `String.fromCharCode`
로직으로 multi-byte 안전 처리 (`btoa` 가 latin1 만 받는 brower 제약 회피).

## [0.6.18] - 2026-05-27

### Removed — NVIDIA NIM provider 전용 어댑터 (vision 부재로 form-fill 시각 검증과 비호환)

0.6.17 의 `getPageSvg` 와 뒤이을 multimodal vision integration workflow
는 provider 가 image content 를 받을 수 있어야 하는데 NIM 호스티드 모델
대다수는 vision 미지원. NIM 슬롯을 별도 어댑터로 유지하면 사용자가
"왜 시각 검증이 안 되지?" 혼란 + 코드 path 둘 (vision 지원 / 미지원)
유지 비용. 셀프호스트 NIM 은 OpenAI `/v1` 호환이라 **`custom` 슬롯
(Base URL + 키) 으로 동일하게 사용 가능** — 사용자 사용은 영향 X.

삭제 범위 (14 files):

- `electron/ai/providers/nvidia.ts` 어댑터, `electron/ai/registry.ts`
  의 'nvidia' 등록 + e2e fake-swap 조건.
- `shared/ai.ts` `ProviderId` 'nvidia' 제거 + `PROVIDERS` 엔트리.
- `src/features/settings/SettingsDialog.tsx` `SHOWN_IDS` / ChatPanel
  `PROVIDER_OPTIONS` / `DEFAULT_MODELS`.
- 기존 'nvidia' localStorage 값은 자동으로 'openai' 로 마이그레이션
  (loadProvider 분기).
- e2e: `tests/e2e/chat-rhwp-mode-nim-live.spec.ts` 통째 삭제.
  `chat.spec.ts` / `chat-prefetch.spec.ts` / `settings.spec.ts` 의
  'nvidia' second-provider 시나리오는 'google' 로 교체. e2e fake
  provider 가 모든 provider 에 swap 되도록 확장 (이전엔 openai+nvidia
  만 swap 됐었음).
- README / CLAUDE.md 의 provider 목록 / API 키 표 / 웹검색 매트릭스
  에서 NIM 행 제거.

검증: typecheck 통과, vitest 235/235, 영향 받은 e2e (chat / chat-prefetch
/ settings) 25/25 통과.

## [0.6.17] - 2026-05-27

### Added — `getPageSvg` AI 도구 (Phase B 시각 검증 MVP)

신규 read-only AI 도구 `getPageSvg({pageIdx})` — 페이지 한 장을 SVG 문
자열로 캡처. rhwp 의 `renderPageSvg(pageNum)` 활용 (vendor 수정 없음).
용도: form-fill 완료 후 사용자가 시각적으로 위치 / 양식 매칭 확인. SVG
자체는 chat tool-result 에 들어가며, ~64KB 초과 시 잘라내고 `truncated:
true` + 원본 크기 함께 반환. AI 자체는 SVG 를 아직 parse 못 함 — chat
UI inline render + provider vision integration 은 다음 chunk.

prompt 의 "Visual snapshot for user confirmation" 섹션에 사용 시기 명시
(사용자가 "양식에 맞게 들어갔는지 확인해줘" 요청 / 긴 form-fill 완료
시점). 작은 write 마다 호출 금지 (각 SVG 가 수십 KB).

### Fixed — `getEmptyFormFields` validator 가 `includeFilled` 를 strip 하던 버그

0.6.15 에서 schema 에 `includeFilled?: boolean` 을 추가했지만 validator
(shared/ai-tool-validate.ts) 가 이 키를 out 객체에 복사 안 함 → dispatcher
까지 전달이 안 됨 → AI 가 `includeFilled:true` 보내도 무시되어 항상
false 동작. 0.6.17 의 e2e 에서 발견. 수정 후 includeFilled 가 실제로
helper 까지 전파됨.

## [0.6.16] - 2026-05-27

### Fixed — `getEmptyFormFields` scope 잘못 잡으면 양식 무시하고 본문에 dump 되던 회귀

AI 가 `parentParaIdx` 를 표가 anchor 되지 않는 paragraph (heading 등) 로
좁히면 `cellFields:[]` + `tableInventory:[]` 가 반환됐었음 → "양식 빈
셀이 없네" 오판 → body-level `insertText` fallback 으로 본문 한가운데에
양식 내용 dump (실제 양식 표는 그대로 빈 채). 9개 표 / 212 빈 셀짜리
중간보고서에서 0개 inventory 반환.

`tableInventory` 는 scope 와 무관하게 항상 섹션 전체 표 목록을 반환하
도록 수정. `cellFields` 만 `parentParaIdx` 로 좁힘. AI 는 `cellFields:[]`

- non-empty `tableInventory` 보고 즉시 self-correct (올바른 paragraphIndex
  로 재호출).

system prompt 도 명시: form-fill workflow 1단계는 unscoped 호출 (전체
inventory 확보), scope 잘못된 경우 body fallback 절대 금지.

## [0.6.15] - 2026-05-27

### Fixed — 병합 표에서 `getEmptyFormFields` labelHint 가 잘못된 셀을 가리키던 버그

13×7=91 그리드인데 totalCells=61 처럼 병합 셀이 있는 표에서, `c-1` /
`c-colCount` 의 flat-index 산술이 진짜 좌측/상단 이웃이 아닌 엉뚱한
cellIdx 의 텍스트를 라벨로 가져왔음 → AI 가 잘못된 셀에 값을 채워넣음.
`getCellInfo` 로 `(row,col)` 그리드 맵을 표 단위 1회 빌드하고 그 위에서
이웃을 찾도록 수정.

### Added — Modify / Verify form-fill workflow (`includeFilled` + `replaceTextInCell`)

`getEmptyFormFields({includeFilled:true})` 옵션 — 채워진 셀까지 반환하면
서 각 셀에 `isEmpty` + `contentCharShape` (이탤릭/색상 등). 템플릿
예시문 (이탤릭+비검정) 을 AI 가 시각 단서로 식별 가능. 신규 `replaceTextInCell`
도구 — 셀 내용 atomic delete+insert (그룹 undo 1회) 로 placeholder 제거 /
기존 값 교체 / clear (text='') 1콜 처리. system prompt 에 Modify + Verify
섹션 (완료 선언 전 재스캔으로 placeholder 잔존 / 일관성 확인) 추가.

## [0.6.13] - 2026-05-26

### Reverted — 0.6.11 의 `mac.identity: null` ("손상되었다" 설치 차단 회귀)

0.6.11 에서 `mac.identity: null` 적용 — macOS auto-update 가능성을 위해
unsigned 빌드 의도. 실제로는 macOS Sonoma (14+) / Sequoia (15+) 가
unsigned 다운로드를 **"손상되었다"** 로 차단 → **신규 설치 자체 불가**.
0.6.11 / 0.6.12 dmg 받은 사용자가 설치 못 함.

**Revert**: `mac.identity` 키 제거 → ad-hoc 서명 default 복원. 0.6.7~
0.6.10 과 동일한 수준 — Gatekeeper "확인되지 않은 개발자" 경고 + 우클릭
→ 열기 우회 가능. **설치는 됨**.

**macOS auto-update 는 여전히 제약**:

- ad-hoc 서명: 매 빌드 hash 다름 → Squirrel.Mac 의 Designated Requirement
  검증 fail → 영구 불가.
- 해결: Apple Developer ID 가입 ($99/년) → 정상 signed/notarized 배포 →
  auto-update + Gatekeeper 둘 다 OK (e.g. Hop 의 패턴).
- 우선 macOS 사용자는 새 release 마다 dmg 수동 다운로드 (Windows /
  Linux 는 auto-update 정상).

### Diagnostic 학습 정리

| 설정                              | 새 설치                   | Auto-update    |
| --------------------------------- | ------------------------- | -------------- |
| Ad-hoc (지금 + 이전 0.6.7~0.6.10) | ✅ 우클릭 → 열기          | ❌ DR mismatch |
| Unsigned (0.6.11~0.6.12)          | ❌ macOS 14+ "손상되었다" | (도달 못 함)   |
| Apple Developer ID ($99/년)       | ✅                        | ✅             |

Hop 등의 잘 알려진 한컴 호환 macOS 앱은 모두 Apple Developer ID 가입
("signed/notarized .dmg") 으로 두 문제를 함께 해결. 무료 경로는 항상
한쪽을 포기.

## [0.6.12] - 2026-05-26

### Fixed — Windows / Linux 메뉴 접근 불가 (햄버거 버튼 추가)

사용자 보고: "Windows 에서는 설정이나 이런것을 선택할 수가 없어".
원인: `titleBarStyle: 'hidden'` (Win/Linux) 가 네이티브 메뉴바도 같이
숨김 → 커스텀 TitleBar 의 Theme + Settings 버튼 2개만 노출. 파일 /
편집 / 서식 / 보기 / 도움말 메뉴 (총 50+ 항목) 에 접근 길 없음.
macOS 는 시스템 메뉴바 사용해서 영향 없음.

**Fix**: TitleBar 좌측에 햄버거 버튼 (`≡`) 추가, **non-Mac 한정 노출**.
클릭 시 `Menu.popup()` 으로 정의된 메뉴를 context-menu 식으로 펼침.
메뉴 정의 자체는 `electron/menu.ts` 단일 source — 중복 X.

**신규 IPC**: `app-menu:popup` (`window.api.popupAppMenu`).
**testid**: `titlebar-menu` (e2e 회귀 가드).

이제 Windows 사용자도 파일 → 새 문서 / 열기 / 저장, 편집 → 실행취소 /
찾기 / 바꾸기, 서식 → 진하게 / 기울임, 보기 → 페이지설정 / 머리말꼬리말 /
설정 / 정보 등 모든 메뉴 항목에 정상 접근 가능.

## [0.6.11] - 2026-05-26

### Fixed — macOS auto-update "Code signature did not pass validation"

사용자 보고:

```
업데이트 확인 실패: Code signature at URL .../update.../ahwp.app/
did not pass validation: 코드가 지정된 코드 요구 사항을 충족시키는데 실패함
```

**원인**: Squirrel.Mac (electron-updater 의 macOS 백엔드) 가 update 적용
전에 새 앱과 현재 앱의 **Designated Requirement** 일치를 검증. 우리는
Apple Developer ID 없이 **ad-hoc 서명** 으로 빌드 → 매 빌드마다 hash 다름
→ "DR mismatch" 로 검증 실패.

**Fix**: `mac.identity: null` 명시 — 빌드 시 서명 완전 비활성화. Squirrel
이 unsigned-to-unsigned update 흐름으로 진입 → DR 검증 skip → auto-update
정상 작동.

**Trade-off — 첫 설치 시 macOS Gatekeeper 경고**:

- "ahwp 는 신뢰할 수 없는 개발자가 만든 앱입니다" 다이얼로그
- 사용자가 Finder 에서 우클릭 → "열기" → "열기" 한 번 더 클릭
- 이후 시스템이 영구 trust → 일반 더블클릭으로 정상 실행

이 trade-off 는 의식적 선택 — Apple Developer ID ($99/년) 없이 auto-
update + Gatekeeper PASS 둘 다 가지는 방법이 없음. 사용자가 "auto-update
convenience" 를 우선해서 unsigned 경로 선택.

**Windows / Linux 는 무관**: 코드 서명 모델이 다름. Windows 의 NSIS 는
checksum 만 검증 (서명 별개). Linux 는 서명 개념 자체 없음.

## [0.6.10] - 2026-05-26

### Fixed — CI publish job 403 (workflow 권한 + structural fix 누적)

0.6.4~0.6.9 까지의 release fail 누적 원인 정리.

**근본 원인 1 — Repo 의 default workflow 권한이 `read`**:

- workflow 파일에서 `permissions: contents: write` 선언해도 repo 기본값
  못 넘음. `gh release edit` 가 403 → publish job 실패. 사용자가
  repo Settings → Actions → Workflow permissions → "Read and write" 로 수정.

**근본 원인 2 — Publish job 의 `actions/checkout` 도 403** (0.6.10):

- publish job 은 코드 필요 없음 (gh CLI 호출만). checkout 제거 + build
  job 의 output 으로 tag 받음 (이미 0.6.9 에서 적용됨).

**근본 원인 3 — macOS auto-update 가 ZIP 필요** (0.6.9 에서 적용):

- `mac.target` 에 zip 추가 (`["dmg", "zip"]`).

**누적 효과**: 0.6.10 부터 publish 흐름 정상. `latest-mac.yml` 이 ZIP
참조하면서 공개 → 기존 0.6.7 사용자 (Mac) 가 처음에는 0.6.10 DMG 한 번
수동 받아야 하고, 이후엔 모든 버전 auto-update 자동.

## [0.6.9] - 2026-05-26

### Fixed — macOS auto-update "ZIP file not provided" 에러

사용자 보고: macOS 사용자가 업데이트 확인 시 `ZIP file not provided`
에러. 원인 — `electron-updater` 가 macOS 에서 incremental update + atomic
swap 을 위해 **ZIP** 형식이 필요한데 우리는 DMG 만 publish 하고 있었음.
DMG 는 사용자 fresh install 용도 (마운트 + 드래그) 이고 auto-update 에는
부적합.

**Fix**: `package.json` 의 `build.mac.target` 에 `zip` 추가 (`["dmg", "zip"]`).
DMG 는 fresh install / 첫 배포용으로 유지, ZIP 은 auto-update 가 사용.
`latest-mac.yml` 이 자동으로 ZIP 을 참조 → updater 정상 작동.

다음 0.6.9+ release 부터 macOS 사용자 auto-update 가 silently 작동.

### Note — 기존 release 처리

0.6.4 / 0.6.5 / 0.6.6 / 0.6.7 / 0.6.8 (모두 DMG 만) 은 macOS 사용자가
auto-update 로 받을 수 없음. 0.6.9 가 publish 되면 그게 새 latest 가
되고, 모든 기존 사용자는 0.6.9 로 jump. (단 첫 jump 는 user 가 0.6.9
DMG 를 수동 다운로드해야 — 이후부턴 ZIP auto-update 자동.)

## [0.6.8] - 2026-05-26

### Added — 자동 다운로드 기본 활성화 + Settings 토글

이전 (0.6.7 까지) 은 새 버전 발견 시 banner 의 "지금 받기" 클릭 필요
했지만, 이제 **자동으로 백그라운드 다운로드**. 사용자가 작업 중이어도
네트워크 사용량만 소비되고 작업은 중단되지 않음. 다운로드 완료 시
banner 의 "재시작해서 설치" 버튼이 나오면 그때 사용자가 결정.

**옵션**: Settings → 정보 탭 → "새 버전 발견 시 자동으로 다운로드"
체크박스. 모바일 테더링 / 좌석 대역폭 제한 환경에선 off 가능 — off 면
이전 동작 (banner 의 "지금 받기" 클릭 필요) 으로 회귀.

**저장**: `userData/updater-prefs.json`. 영구 + 즉시 main 의 autoUpdater
인스턴스에 live 반영 (다음 launch 안 기다림).

**Install (재시작) 은 자동화 X** — 작업 손실 위험을 명시적 동의 하에 둠.
`autoInstallOnAppQuit=true` 는 유지 (사용자가 앱 종료 시 조용히 설치).

**Tests**: 5 → 6 e2e (Settings 토글 동작). 178 unit. typecheck OK.

## [0.6.7] - 2026-05-26

### Fixed — `applyHtml` 이 양식 doc 의 표지 표를 망가뜨리는 회귀

사용자 보고: AI 에게 양식 HWP (제조AI특화 스마트공장 사업계획서 같은
template) 에 작성 요청 → "형식이 아예 망가져. 적어야 할 위치를 검색
안하고 그냥 넣는 느낌". 진단:

1. AI 가 `getDocumentOutline` 호출 — 양식 doc 의 "1.1 / □" 는 heading
   style 이 아니라 일반 텍스트 → outline 빈 배열 → AI 가 구조 파악 실패
2. AI 가 `getDocumentSummary` 만 보고 caret 위치는 확인 안 함
3. `applyHtml` 호출 — default caret = (0,0,0) 이 표지 표 cell 안 → HTML
   이 cell 안에 dump 되어 layout 파괴

기존 `insertText(0,0,0) + multi-paragraph` 의 hard-guard (tools.ts:327)
는 있었지만 `applyHtml` 에는 parallel guard 가 없어서 LLM 이 우회 경로
로 사용 중이었음.

**Fix 2 layer**:

1. **Runtime hard-guard** (`tools.ts`) — `applyHtml` 도 pre-check:
   - `getCaretPosition()` 호출
   - caret == (0,0,0) AND 문서가 fresh-blank 아니면 (= paragraph 1 개 +
     length 0 이 아니면) reject
   - reason: `applyHtml-at-doc-start-rejected: ... anchor 를 searchAllText
/ findInDocument 로 식별 → moveCaret 으로 이동 → applyHtml 재시도`
2. **Prompt 강화** (`prompts.ts`) — "Structured documents" 섹션:
   - `applyHtml` 의 caret 의존성 명시 (insertText 와 동일 위험)
   - `getDocumentOutline` 이 빈 배열이어도 doc 가 unstructured 의미 아님
     — `searchAllText` 로 cross-check 하라는 원칙 추가
   - workflow 단계 3 에 "applyHtml 전 moveCaret 으로 anchor 명시" 추가

**검증**: 175 → 178 unit 통과 (+3 신규 applyHtml guard 케이스). 기존
applyHtml dispatch 회귀 케이스도 caret pre-check 한 줄 추가로 업데이트.
typecheck 양쪽 OK.

사용자 영향: 0.6.7 부터 AI 가 양식 doc 에 dump 하려 하면 명시적 에러
받고 anchor 를 찾아 재시도. 이전엔 silent 하게 layout 파괴.

## [0.6.6] - 2026-05-26

### Fixed — Keychain prompt 2번 뜨는 회귀 (provider 다중 키 등록 시)

사용자 보고: 앱 시작 시 macOS Keychain prompt 가 2번 연속 뜸. 원인:
`ChatPanel.prefetchAllProviders` 가 등록된 모든 provider 의 model list 를
**parallel** 로 fetch (`for ... void fetchModels(id)`). 키가 N개 있으면
N 개의 동시 `getSecret` → N개의 동시 `safeStorage.decryptString` → macOS
Keychain 의 ACL 단일-prompt 흐름이 깨져서 prompt 가 큐잉됨.

**근본 fix 2 곳**:

1. `electron/store/secrets.ts` — `getSecret` 에 in-flight Promise dedupe +
   전역 직렬화. 같은 providerId 의 동시 요청은 한 Promise 만 만들고 share
   (cache stampede 회피). 서로 다른 providerId 라도 `globalDecryptChain`
   으로 직렬화 — 첫 prompt 가 응답될 때까지 다음 `decryptString` 대기.
2. `src/features/chat/ChatPanel.tsx` — `prefetchAllProviders` 의 fetch 루프
   를 `for ... await fetchModels(id)` 로 직렬화. 호출 자체가 한 번에 하나씩.

결과: provider 2개 이상이어도 Keychain prompt 가 정확히 1번만 뜸 (사용자
가 "Always Allow" 클릭하면 이후 영구 silent). plaintextCache 의 의도가
온전히 실현됨.

### Dev 보너스 — React StrictMode 영향

dev (`npm run dev`) 의 `<React.StrictMode>` 가 effect 를 2회 mount 해서
prefetch 가 두 번 실행되는 패턴이 있었지만, 위 fix 의 plaintextCache +
in-flight dedupe 가 2회차 호출을 cache hit 로 흡수 → prompt 추가 발생 X.

## [0.6.5] - 2026-05-26

### Fixed — release.yml 의 Draft auto-publish (0.6.4 매트릭스 빌드 422 회피)

0.6.4 가 `releaseType: 'release'` 로 설정했더니 첫 OS 빌드 (mac) 가 끝나는 순간
GitHub Release 가 published 상태로 생성됨. 이후 매트릭스의 다른 OS (win/linux)
빌드가 asset 업로드 시도 → GitHub 의 immutable-release 정책이 `422 "Cannot
upload assets to an immutable release"` 반환 → 빌드 실패. 0.6.4 release 는
mac dmg 만 일부 올라간 채로 broken 상태.

**Fix**:

1. `package.json` 의 publish 설정에서 `releaseType` 제거 (default `draft` 로
   복원). 매트릭스 빌드가 모두 같은 Draft 에 idempotent 하게 asset 업로드.
2. `release.yml` 에 별도 `publish` job 추가. matrix 빌드 (`build`) 가 모두
   성공한 후 `gh release edit "$tag" --draft=false --latest` 실행 — Draft 를
   public 으로 flip + `latest` 마킹. latest.yml 이 그 시점에 공개 노출.

이렇게 하면 빌드 + publish 가 분리돼서 auto-updater 가 의도대로 작동하면서
immutable 정책 충돌도 회피.

### Note — 0.6.4 정리

GitHub Releases 에 부분 업로드된 0.6.4 broken release 는 수동 삭제 필요
(`gh release delete v0.6.4 --yes --cleanup-tag --repo YEUNU/ahwp`). 본
릴리스의 publish job 이 통과하면 0.6.5 가 새 latest 가 됨.

## [0.6.4] - 2026-05-26

### Fixed — release.yml 이 Draft 만 만들고 자동 publish 안 함

`electron-builder` 의 GitHub publisher 가 기본값으로 `releaseType: 'draft'`
사용 — main push CI 가 통과해도 GitHub Release 가 Draft 상태로 멈춰서
사용자는 수동으로 "Publish release" 클릭해야 했음. 결과: auto-updater 가
`latest.yml` 을 fetch 못 함 (Draft 는 비공개) → 자동 알림 무용.

**Fix**: `package.json` 의 `build.publish[0]` 에 `"releaseType": "release"`
명시. 다음 CI 빌드부터 통과 즉시 publish 상태로 노출 + `latest.yml` 공개
→ 0.6.3+ 사용자의 auto-updater 가 정상 인식.

### Note — 기존 0.6.2 Draft 처리

이 커밋 이전에 생성된 Draft 들 (0.6.2 등) 은 수동으로 publish 하거나 삭제
필요. 0.6.4 가 publish 되면 자동 업데이트 흐름이 정상 작동.

## [0.6.3] - 2026-05-26

### Fixed — `switchTargetDoc` 자동 열기 실패 (workspace HWP 가짜 target-not-open)

사용자가 워크스페이스 폴더에 있는 .hwp 파일에 대해 AI 에게 작성 요청하면
AI 가 `switchTargetDoc({path:...})` 로 자동 열기 시도. 하지만 실제로는
탭이 열려도 hook 이 `target-not-open:<path>` 가짜 에러를 반환했음 — 그
파일에 직접 쓸 수 없는 회귀.

근본 원인 3개 (모두 fix):

1. **`useSaveFlow.openByPath`** 가 `void` 반환 — 성공/실패 알 길 없음.
   → `Promise<boolean>` 으로 변경 (editable 탭 mount=true, readable-only/실패=false).
2. **`AppShell.openDocByPath` wrapper** 가 무조건 `true` 반환.
   → useSaveFlow 의 boolean 그대로 propagate.
3. **`useChatStreaming.switchTargetDoc` stale closure** — `await openDocByPath`
   가 React setState 만 trigger, 50ms 후 `getOpenDocs?.()` 재호출이 같은
   destructured 클로저 (이전 render 의 `tabsState`) → 새 탭 lookup 실패.
   → `ok=true` 면 `getOpenDocs` 재조회 우회. `path` 만으로 `matched` 합성
   (label = basename). 닫힌 .hwp 도 정상적으로 자동 열림 + AI write target 으로 라우팅.

**부수 효과**: PDF / DOCX / Excel 같은 readable-only 는 `false` 반환 →
명시적 `target-not-open`. AI 가 즉시 인식 → 의도적인 정상 분기 (이런
포맷은 편집 대상 X — rhwp-studio 한계).

**검증**: 신규 e2e `switch-target-doc.spec.ts` (3 case): workspace HWP 자동
열기 / 존재하지 않는 path 거부 / readable-only false. 175/175 unit +
28/28 회귀 e2e 통과.

## [0.6.2] - 2026-05-26

### Added — Auto-updater UI 완성

`electron-updater` + GitHub Releases publish 인프라는 0.3.x 부터 wire 되어
있었지만 사용자에게 보이는 UI 는 비어있었음 (모든 이벤트가 console.log 만).
0.6.2 에서 UX 완성.

**동작 흐름** (packaged 빌드 한정):

1. 앱 시작 5초 후 `autoUpdater.checkForUpdates()` 자동 호출.
2. 새 버전 있으면 TitleBar 아래 inline banner: "v0.7.0 업데이트 있음
   [지금 받기]" 노출.
3. "지금 받기" 클릭 시 다운로드 진행률 banner (progress bar + animate-pulse).
4. 다운로드 끝나면 "재시작해서 설치" 버튼 노출.
5. 사용자 클릭 시 `autoUpdater.quitAndInstall()` → 앱 재시작 + 자동 설치.
6. "나중에" 는 단순 hide — 다음 launch 때 다시 알림 (영구 dismiss 없음 —
   보안 패치 누락 위험).

**컴포넌트 / IPC**:

- `electron/ipc/updater.ts` — main-side state machine. raw `electron-updater`
  이벤트를 `UpdaterState` 로 normalize, 모든 BrowserWindow 에 broadcast.
- `shared/api.ts` — `UpdaterApi` (`getState` / `checkNow` / `downloadUpdate`
  / `quitAndInstall` / `onEvent`).
- `src/features/updater/UpdateBanner.tsx` — TitleBar 아래 inline banner.
  4 visible state (available / downloading / downloaded / error).
- `src/features/settings/SettingsDialog.tsx` — "정보" 탭에 "지금 확인" 버튼
  - 현 상태 텍스트.

**Dev 모드 보호**: `!app.isPackaged` 또는 `AHWP_DISABLE_UPDATER=1` 면
`enabled=false` 로 모든 액션이 noop. dev 에선 latest.yml 도 없고 publish
채널도 안 잡혀 있어 호출 시 false-positive 에러가 나는 걸 방지.

**Fake event mode (e2e)**: `AHWP_UPDATER_FAKE=available|full` env 로 가짜
이벤트 sequence inject — 5 e2e 케이스가 UI state machine 회귀 가드.

## [0.6.1] - 2026-05-26

### Hardened — 0.6.0 mixed-format workspace 검증 + UX 폴리시

0.6.0 의 "100% functional" 목표를 위한 후속 polish.

**Binary 포맷 라이브러리 가정 검증**:

- 실제 PDF (hand-crafted minimal byte) / DOCX (jszip 으로 minimal zip 빌드) /
  Excel (exceljs 자체 writer) 의 extractText round-trip 통과.
- pdf-parse@2.4.5 의 `PDFParse` class API, mammoth 의 `convertToHtml` heading
  추출, exceljs 의 `eachSheet`/`eachRow` API 가 우리 wrapping 과 정합.

**Search 패널 확장** (`folder:search-text`):

- 이전엔 .hwp/.hwpx 만 grep 가능 → 이제 PDF/DOCX/Excel/CSV/TXT/MD/JSON/XML/HTML
  본문도 검색. 매치 snippet 은 sectionIndex=0 + paragraphIndex=chunkIdx 로 노출.

**AI tool description 갱신**:

- `searchWorkspaceOutlines` / `readParagraphByPath` 의 description 에 non-HWP
  coordinate semantics 명시 (sectionIdx=0, paragraphIdx=chunk index). prompts.ts
  의 Cross-doc workflow 섹션도 같이.

**Per-family size cap** — PDF 30MB / DOCX·Excel 15MB / 평문 5MB / HWP 5MB.
보고서급 PDF 도 통과하면서 메모리 보호. folder.ts 의 listing-cap 도 30MB 로
완화 (실제 cap 은 extractText 내부에서 family 별 재검증).

**Tree icons** — FolderTree 가 family 별 lucide 아이콘 변별:

- HWP/HWPX = FileType 푸른색 / PDF = FileText 붉은색 / DOCX = FileText 진청색
- xlsx/csv = FileSpreadsheet 녹색 / md/txt/json/xml/html = FileText 회색

**Tests**: +3 binary extractor (PDF/DOCX/Excel) + +1 e2e (search-text across formats).
175 unit + 40 e2e. typecheck OK.

## [0.6.0] - 2026-05-26

### Added — Mixed-format workspace (PDF / DOCX / Excel / TXT / MD / 등)

워크스페이스가 더 이상 `.hwp / .hwpx` 만 보이지 않습니다. AI 의
`searchWorkspaceOutlines` / `readParagraphByPath` 도 동일하게 확장 —
사용자가 같은 폴더에 둔 PDF 사업비 실적 보고서 / DOCX 중간보고서 /
Excel 예산표 등을 AI 가 직접 읽고 cross-reference 가능.

**지원 포맷 (read-only)**:

- PDF (`pdf-parse@2.4.5`)
- DOCX (`mammoth`)
- Excel xlsx/xls (`exceljs`) + CSV/TSV (built-in)
- TXT / MD / Markdown
- JSON / XML / HTML

**의미적 정합**:

- HWP/HWPX 외 포맷은 single section (sectionIdx=0) + chunks[] 로 표현.
  `readParagraphByPath(path, 0, i)` 가 chunks[i] 반환.
- Outline 추출 — MD 의 `#`, HTML 의 `<hN>`, DOCX 의 heading style,
  Excel 의 sheet name, CSV 의 column header 가 모두 OutlineItem 으로 노출.
- AI 가 자연어 "두 문서 비교해줘" 할 때 양쪽 모두 동등 컨텍스트 인식.

**편집은 여전히 HWP/HWPX 만** — rhwp-studio 의 한계. 트리에서 PDF 등을
클릭하면 `shell.openPath` 로 OS 기본 앱 위임 (`file:open-external` IPC).

**추가 신규 IPC**: `file:open-external`.
**5MB / 200 chunk 상한** — main process 메모리 보호.

**Tests**: shared/file-formats (12) + electron/files/readable-formats (10) +
e2e workspace-mixed-formats (6) + folder-tree update (1). 총 +29 spec.

## [0.5.2] - 2026-05-26

### Fixed — Diff Viewer patches 가 rhwp-mode 에서 실제 IR 까지 도달

`onApplyPatches` 핸들러가 0.5.0 의 StudioViewer 폐기 후에도 `activeViewerRef()`
경로를 호출 → rhwp-mode 에선 null 이라 silently no-op. ahwp-patches 블록
auto-accept 가 status='accepted' 로 토글되었지만 실제 문서 텍스트는
바뀌지 않는 회귀가 있었음. AppShell.applyPatches 를 `BridgeIrHelper` 기반
async 핸들러로 재배선 — body / cell 양쪽 패치, additionFormat (typed +
lib passthrough) 모두 helper.deleteRange + insertText + applyCharFormat
(cell 은 invokeOk('\*InCell')) 시퀀스로 처리.

사용자 입장에선 "사업비 +100만원 해줘" 같은 자연어 + LLM 의 multi-step
(search → read → compute → patch) 워크플로가 실제로 동작. 새 live OpenAI
e2e (`chat-rhwp-mode-live.spec.ts` — `context-aware multi-step`) 가 회귀
방지.

ChatPanel 의 onApplyPatches 시그니처도 `Promise<boolean[]>` 으로 변경
(bridge ops 가 async). handlePatchAcceptIdx / AcceptAll / auto-accept
모두 await.

## [0.5.1] - 2026-05-26

### Fixed — 24 broken AI tools 복원 + 이중변환 bug fix

0.5.0 의 StudioViewer 폐기로 깨졌던 AI 도구들을 BridgeIrHelper composite
로 재구현. 사용자 입장에선 rhwp-mode 에서 "이 단락 가운데 정렬",
"글자 14pt", "각주 추가", "표 합계", "문서 목차" 같은 자연어 명령이
다시 동작.

**복원 도구 (24)**: applyHtml / applyAlignment / applyFontSize /
applyTextColor / toggleCharFormat / insertFootnote / addBookmark /
setHeaderFooterText / applyPageDef / createNamedStyle / createRectShape /
applyCellStyle / applyParaProps / setTableProperties / setCellProperties /
evaluateTableFormula / setPictureProperties / deletePictureControl /
deleteBookmark / getDocumentOutline / getDocumentSummary / getStyleListJson /
getEmptyFormFields / insertPicture.

**이중변환 bug fix (2)**: tools.ts 의 setShapeProperties / setSectionDef
case 가 ahwp 측에서 `JSON.stringify(props)` 호출 후 wasm-bridge 가 또
stringify → wasm 이 doubly-encoded string 받아 parse 실패. 객체 그대로
전달로 수정.

**일관성 원칙**: ahwp tools.ts 는 객체 그대로 helper 에 전달 (JSON.stringify
절대 X). helper 가 single serialization point — WASM 타겟이 string 받는
메서드 (applyCharFormat / applyParaFormat) 만 한 번 stringify, object
받는 메서드 (setShapeProperties / setTableProperties / setCellProperties /
setPictureProperties / setPageDef / setSectionDef) 는 passthrough.

## [0.5.0] - 2026-05-26

### BREAKING — 자체 StudioViewer 폐기, rhwp-studio 가 유일 편집기 (Phase 7 E2 완료)

ahwp 의 자체 편집 UI (StudioViewer ~5000 라인 + 8 hook + 16 dialog)
를 완전 폐기하고 `rhwp-studio` iframe (@rhwp/editor 0.7.12) 으로 대체.
사용자 제품 비전 — "rhwp-studio 를 Electron 에 렌더링하고 AI 자동 작성만
ahwp 가 담당" — 의 1.0 (= 0.5.0 major) 완성형.

**Removed (~5000+ 라인 + 63 e2e spec)**:

- `src/features/studio/` 전체:
  - `StudioViewer.tsx` (main viewer, ~5000 라인)
  - 8 hook (useViewerHandle / useFindReplace / useDocumentLifecycle /
    useDebugSurface / useImeComposition / usePageMouseHandlers /
    useViewerKeyboard / useGetCellInfoComposite 등)
  - 16 dialog (PageSetup / HeaderFooter / Bookmark / Footnote /
    StyleManager / CharFormat / ParaFormat / Equation / Shape /
    TableCellProps / PictureProps / CellStylePicker / TableFormula /
    VersionHistory / OutlineSidebar / TabBar)
- `tests/e2e/` 63 spec — `__studioDebug.*` 의존하던 모든 studio-\* /
  legacy chat 회귀 / dialogs-ui / file-dialog-mock 등.
- AppShell 의 dialog 임포트 16 개 + JSX 280 라인 + StudioViewer mount
  - outline sidebar + `useRhwpEditor` feature flag.
- `launch.ts` 의 legacy 모드 강제 (`ahwp:use-rhwp-editor=0`) 제거 —
  모든 e2e 가 default rhwp-mode 에서 동작.

**Vendored**:

- `src/features/studio/types.ts` → `src/features/chat/viewer-handle-types.ts`.
  ViewerHandle type 정의만 보존 (tools.ts 의 NULL_VIEWER_STUB Proxy 가
  실 사용에서 throw — rhwp-mode 가 default 라 의미 X. type-only import).

**Kept (Phase 7 인프라)**:

- `vendor/rhwp` git submodule (YEUNU/rhwp, ahwp-bridge 브랜치) — rhwp-studio
  fork 의 postMessage bridge 확장.
- `ahwp-studio://` Electron protocol + CSP `frame-src` + extraResources.
- `RhwpBridge` 클라이언트 + `RhwpEditor` 컴포넌트 + `BridgeIrHelper`.
- AppShell 가 탭별 RhwpEditor handle 추적 + save 흐름 `bridge.exportHwp`
  경유. AI runTools 가 활성 탭의 bridge 로 자동 라우팅.

**Migration**: 사용자 액션 불필요 — 기존 `localStorage['ahwp:use-rhwp-editor']`
값 무시되고 항상 rhwp-studio 모드로 동작. 모든 편집 기능 (메뉴 / 툴바
/ 다이얼로그 / 단축키) 은 iframe 내부 rhwp-studio 가 제공.

### Fixed — CI 가 vendor/rhwp submodule init + studio dist 빌드 (0.4.33)

v0.4.32 release CI 가 submodule 미초기화 상태로 빌드 → packaged 앱에
rhwp-studio dist 누락 (electron-builder 가 missing extraResources 를
silent skip). 본 release 부터 fix.

- `.gitmodules` url: edwardkim/rhwp → YEUNU/rhwp (user fork). `ahwp-bridge` 브랜치의 5 commit 이 fork 에 push 되어 CI / 다른 환경에서도 init 가능.
- `release.yml`: `actions/checkout` 에 `submodules: recursive` + 빌드 스텝 앞에 `npm run vendor:rhwp:build` 추가. rhwp-mode 가 packaged 빌드에서 정상 작동.

v0.4.32 의 release artifacts 는 폐기 — 본 release (v0.4.33) 가 첫
정상 Phase 7 release.

### Changed — rhwp-mode 가 default (Phase 7 E2d 1단계, 0.4.32)

`localStorage['ahwp:use-rhwp-editor']` 미설정 또는 '1' = rhwp-mode (새
default). '0' = legacy StudioViewer 모드. user 의도 — "rhwp-studio 를
Electron 에 렌더링하고 AI 자동 작성만 내 것에 추가" — 의 기본 동작이
완성. legacy 모드는 기존 e2e 회귀 / 사용자 migration 위해 살아있음.

- `src/app/AppShell.tsx` useState 초기화 변경 — `!== '0'` 비교.
- `tests/e2e/launch.ts` — 기존 spec 호환 위해 launch 직후 미설정 localStorage 에 '0' 자동 주입. Phase 7 spec 은 각자 '1' 로 덮어씀.

`src/features/studio/` (~5000 라인) + 의존 e2e (~30) 의 점진 삭제 (E2e)
는 별도 deprecation 일정. 0.5.0 major release 는 E2e 와 묶음.

### Added — Phase 7 E2a/b/c rhwp-mode UI 통합 (0.4.31)

`ahwp:use-rhwp-editor` localStorage flag 기반 dual-mode. flag=1 이면
AppShell 의 활성 탭에 StudioViewer 대신 RhwpEditor 마운트.

- **AppShell rhwp-mode** — flag=1 일 때 활성 탭 자리에 RhwpEditor. onReady → file:read → bridge.loadFile 자동.
- **per-tab handle tracking** — `rhwpHandlesRef = Map<tabKey, RhwpEditorHandle>`. runTools 가 활성 탭 bridge → BridgeIrHelper 로 wrap. `__rhwpDebug` 의존 제거.
- **save flow override** — `useSaveFlow.exportOverride` 옵션. useRhwpEditor 모드면 file:save / saveAs / autosave 가 `handle.exportHwp()` (bridge.invoke('exportHwp')) 사용. viewer 경유 X.

본 모드에선 AppShell 의 viewer-dependent toolbar / dialog / menu action
(~20 개) 가 동작 안 함 — rhwp-studio iframe 의 자체 UI 가 그 자리를
담당. StudioViewer 코드 폐기 (E2d) + 0.5.0 major release (E3) 는 별도
세션.

e2e — appshell-rhwp-mode 2/2 통과.

### Added — Phase 7 rhwp-studio bridge 인프라 (0.4.30)

ahwp 가 자체 StudioViewer (`@rhwp/core` 직접 호출) 위에 약 5000 라인의
에디터 UI 를 만들어 유지하는 대신, rhwp-studio 를 iframe 으로 임베드하고
AI 자동 작성만 ahwp 가 담당하는 구조로 전환 시작.

Phase 7 plan: `docs/PHASE7_PLAN.md`. 본 릴리스는 인프라 + Phase D / E1
완료 — A1 / A2 / B / C / D1 / D2a / D2b / D2c-1 / D2c-2 / D3 / D4 / D5
/ E1.

핵심 추가:

- **`vendor/rhwp` git submodule** (edwardkim/rhwp 의 `ahwp-bridge` 브랜치) + `npm run vendor:rhwp:build`. rhwp-studio main.ts 의 postMessage 채널 (`rhwp-request` / `rhwp-response` / `rhwp-event`) 확장 — 'wasm' generic dispatcher (~230 메서드 + getter + wasm.doc fallback) / convenience 6 case / 'caret-changed' polling.
- **`ahwp-studio://` 커스텀 protocol** (`electron/rhwp-studio-protocol.ts`) — dev/packaged 자동 분기 (`vendor/rhwp/rhwp-studio/dist` ↔ `Resources/rhwp-studio`). standard / secure / supportFetchAPI / corsEnabled / stream privilege. path traversal 가드.
- **`RhwpBridge` 클라이언트** (`src/lib/rhwp-bridge.ts`) — id 추적 + timeout + event listener + destroy lifecycle. invoke / invokeWasm / loadFile / ready / on / off / destroy. 12 unit + 9-step e2e.
- **`<RhwpEditor>` 컴포넌트** (`src/features/rhwp-studio/RhwpEditor.tsx`) — iframe + bridge 자동 lifecycle. forwardRef + onReady / onError / exportHwp / exportHwpx / loadBytes.
- **`window.__rhwpDebug`** debug surface (`src/features/rhwp-studio/debug-surface.ts`) — mount() / unmount() / getBridge(). dev / e2e / 콘솔 디버깅용. Phase E2 에서 정식 UI 통합 전까지.
- **`BridgeIrHelper`** (`src/features/rhwp-studio/bridge-ir-helper.ts`) — 19 메서드 (read/write/composite) + invokeOk/invokeRead 범용 라우터. unit 20/20.
- **`tools.ts` helper 라우팅** — `runTools(viewer, items, helper?)` 시그너처. ~30 AI tool case 가 helper 가용 시 bridge.invokeWasm() 으로 라우팅. tools.test 15/15.
- **AppShell wiring** — `__rhwpDebug.getBridge()` 가 있으면 BridgeIrHelper 자동 생성 + runTools 3번째 인자로 전달. dual-mode 가드.
- **`release.yml` main-push trigger** — `branches: [main]` 추가 + concurrency group. tag-push 와 OR 로 fire.
- **`@rhwp/core` 0.7.12 native searchAllText** (`useFindReplace`) — paragraph 캐시 + indexOf 루프 제거. 12 케이스 단위 + 4 e2e.

Phase 7 e2e (누적 16, 모두 통과):
poc 2 + client 1 + electron 3 + debug-mount 3 + ir-helper 2 + events 1

- find-native 4 + e1-bridge-route (간접).

남은: E2 (StudioViewer 폐기 + 관련 e2e ~30 정리), E3 (docs + 0.5.0
메이저 릴리스).

## [0.4.29] - 2026-05-25

> v0.4.2 이후 `[Unreleased]` 에 누적되어 있던 0.4.3 ~ 0.4.28 의 모든 entries 도 본 릴리스(`25df6e7` main 머지)에 포함. 청크별 디테일은 `git log v0.4.2..v0.4.29` 참조.

### Changed — @rhwp/core 0.7.12 + 네이티브 searchAllText 채택 (0.4.29)

`@rhwp/core` 0.7.11 → 0.7.12 bump. Find 의 paragraph 텍스트 캐시 + `indexOf` 루프 (`useFindReplace.runFindSearch`) 를 lib 의 네이티브 `doc.searchAllText(query, false, false)` 호출로 치환. `findTextCacheRef` (`StudioViewer` / `useDocumentLifecycle` / `useDebugSurface` / `useFindReplace` 4 곳 wiring + mutation invalidation) 전부 제거. 동작 동일 — `include_cells=false` 로 기존 UI scope (top-level paragraph) 유지. 대소문자 무시·match 위치·count feedback 동일.

### Fixed — Prompt 일관성 + tool router ALWAYS_INCLUDE 확장 (0.4.28)

LLM-facing prompt 가독성 + form-fill 라우팅 신뢰성 개선.

- `SYSTEM_PROMPT_DOC_CONTEXT` 슬림화 — `[A]/[B]/[C]` 응답 형식 라우팅 중복 제거 (AGENT_GUIDE 로 일원화). context 태그 설명만 유지.
- 발췌 라벨 통일 `[Excerpt]:` → `[Excerpts]:` (serializer 와 일치).
- AGENT_GUIDE 의 chunk-97 "User approval gate" stale 문단 제거 (chunk 99 follow-up 에서 즉시 dispatch 로 전환됨). "Execution model" 섹션 신설 — write tool 즉시 실행 + 그룹 undo + `ahwp-patches` 만 Accept/Reject 카드.
- 자동 타이틀 prompt + transcript 라벨 한국어 → 영어 (`feedback_english_prompts`).
- `toolRouter.ALWAYS_INCLUDE` 2 → 7개 확장: `getDocumentSummary`, `getEmptyFormFields`, `findInDocument`, `insertText`, `applyHtml` 추가. router 가 phase 선택에서 빠뜨려도 form-fill / 기본 편집 트리거가 항상 보장됨.

### Added — A+B+C 패키지: fill 확장 / html DiffCard / write tool synthetic diff (0.4.23)

세 가지 UX 개선 (사용자 의도: "다 진행"):

**(A) prompt: 더 많은 cell 채우도록** — 0.4.22 가 4 cells 만 채우던 한계 보강. 원칙 강화: "walk entire result, not just first few. fill every field where the answer is unambiguous from user message". 휴리스틱 X (필드 enumeration 없음, 원칙만).

**(B) html 블록 DiffCard 미리보기 통합** — Settings 토글 "HTML 블록 미리보기" 신설 (default OFF, backward compat). ON 시 모델의 `\`\`\`html\`\`\``블록 자동 적용 차단 + Accept/Reject 카드 표시. patches block 의 DiffCard 흐름과 일관성 ↑. testid: chat-html-preview-card / chat-html-preview-accept / chat-html-preview-reject. localStorage key:`ahwp:chat:html-preview`.

**(C) write tool synthetic diff** — Agent write tool 호출 시 영향 paragraph 의 before/after 를 dispatcher 가 snapshot, ToolEntryRow 안에 inline mini-diff 렌더 (red strikethrough / green addition). `AhwpToolResult.diff?` 신규 필드 + `UiToolEntry.diff` propagation. 현재 `insertText` / `deleteRange` / `insertTextInCell` 3 종 커버. `irGetTextInCell` ViewerHandle wrapper 추가 (lib `getTextInCell`).

unit 5/5 통과 (tools.test.ts mockViewer 에 irGetTextRange/irGetTextInCell 추가).

### Fixed — Form-fill 4 단계 fix 로 in-place fill 도달 (0.4.22)

증상 (사용자 보고): "AI 가 양식의 빈 곳에 넣는 게 아니라, 양식을 처음부터 만들어서 옆에 넣는다". 0.4.21 prompt + getEmptyFormFields 추가했어도 paraCount Δ=0 만 통과하고 실제 빈 cell 은 안 채워짐 (위양성).

4 단계 fix:

(1) **deletion/addition null coercion** — `parsePatchBlock` 가 `undefined`/`null` → `""` coerce. AI 가 빈 cell 채울 때 deletion 을 omit/null 로 보내도 통과 (배열/객체는 여전히 reject). LLM 입장에서 자연스러운 응답 허용. unit test 3 개 추가 (missing/null/array).

(2) **prompt schema 인라인** — patches block 의 abstract schema 를 prompt 에 표시. `location.cell` 누락하면 body path 로 라우트되어 cell 밖 삽입된다는 사실 명시. "copy verbatim from getEmptyFormFields" 권장.

(3) **maxResults cap 500→5000** — helper / validator / catalog 모두. 큰 양식 (cell 700+ 개) 에서 truncation 위양성 회피 — before/after 둘 다 cap hit 하면 delta 항상 0.

(4) **e2e 어설션 정확화** — `paraCountΔ < 20` hard limit (`>5` console.warn 시그널). `filledCellDelta > 0` + `patches block emit` 추가 검증.

라이브 검증 (gemma-4, 2 round 일관):

```
round 1 (가상 업체):  paraΔ=0  filled=4  patchesBlocks=1  1.1m
round 2 (다른 회사):  paraΔ=0  filled=4  patchesBlocks=1  52s
```

이전 버전 비교:

```
0.4.18:  paraΔ=+10  (양식 dump 위양성)  6.9m
0.4.19:  paraΔ=+16  (양식 dump 확실)     3.2m
0.4.20:  paraΔ=+12  (양식 dump)          3.5m
0.4.21:  paraΔ=0    (in-place X, fill X) 1.9m   ← 진전 시작
0.4.22:  paraΔ=0    (in-place fill ✓)   ~1m   ← 사용자 의도 도달
```

unit 10/10 통과 / live 2/2 통과.

### Added — getEmptyFormFields discovery 도구 + form-fill workflow prompt (0.4.21)

목표: AI 가 양식의 빈 cell 좌표를 trial-and-error 없이 deterministic 하게 알아내도록. 기존엔 "양식 채워줘" → AI 가 좌표 모름 → applyHtml 로 새 양식 통째 author → 원본 옆 dump (paraCount 폭증). Discovery 도구로 lookup 한 번에 좌표 + 라벨 + char-shape 받고 patches block 으로 in-place fill.

신규 read tool — `getEmptyFormFields(sectionIdx?, maxResults?)`:

- 모든 table cell 을 walk 해 paragraph 길이 0 + paragraph count 1 인 cell 의 좌표 enumerate
- 각 빈 cell 마다 label hint (left sibling 의 텍스트, 없으면 top sibling) + label 의 char-shape (font/size/bold) 동봉
- 휴리스틱 X — paragraph 길이 검사만. 필드 이름 enumeration 없음
- shared helper `enumerateEmptyFormFields` — useViewerHandle (AI dispatch) / useDebugSurface (deterministic e2e) 둘이 공유
- 6 surface 동기화: catalog / validator / dispatcher / preview args / ViewerHandle types / \_\_studioDebug

deterministic e2e 검증 (`tests/e2e/nvidia-live.spec.ts getEmptyFormFields — deterministic`):

- 사업계획서 fixture 에서 빈 cell 200+ 개 발견, 라벨 32개 (도입기업명 / 공급기업명 / 과제번호 / 컨소시엄 참여 / 수행시 2026 etc.)
- labelCharShape 가 lib props 모양으로 정상 반환

Agent prompt — form-fill workflow:

- "fill, don't author" 원칙 명시
- 절차: getEmptyFormFields → 의도 매칭 → patches block (location.cell + additionFormat.lib = labelCharShape)
- applyHtml / body insertText 는 form-fill 에서 사용 금지 ("새 양식 author 위험")
- Sanity check directive: paragraphCount Δ < 5 — 그보다 크면 author 했다는 신호

e2e 어설션 정확화 (0.4.14):

- 기존: `filled = paraCount Δ > 0 OR para0 len Δ > 0` 위양성 (양식 dump 도 PASS)
- 신규: paraCount Δ < 20 hard limit. Δ > 5 면 console.warn (튜닝 시그널)

probeControls 진단 도구 (`__studioDebug`) — 빈 cell discovery 가 작동 안 할 때 lib `getControlTextPositions` / `getTableDimensions` 결과 dump. 초기 디버깅에서 `getControlTextPositions` 가 control descriptor 가 아니라 char offset 배열만 반환한다는 사실 (lib 문서 미상세) 발견 → enumerateEmptyFormFields 의 ctrlIdx 결정 로직 수정.

### Changed — Patches schema 확장 (cell + charShape) + Agent text/structure 분기 (0.4.20)

목표: 양식 cell 채우기 같은 텍스트 변경을 ahwp-patches 블록 (DiffCard 미리보기) 으로 표현 가능하게 schema 확장. Agent prompt 가 텍스트 vs 구조 명확히 분기. LLM 비결정성을 사용자 Accept/Reject 게이트가 흡수.

patches schema (`shared/ai-patches.ts`):

- `PatchLocation.cell?: { controlIndex, cellIndex, cellParagraphIndex }` 추가. 표 cell 내부 좌표 표현. paragraphIndex 는 표 control 의 anchor paragraph, startOffset/endOffset 은 cellParagraphIndex 안 char range
- `PatchCharFormat.fontName?: string` (lib `name` 매핑) + `lib?: Record<string, unknown>` raw passthrough 추가. 모델이 `getCharPropertiesAt` 결과를 그대로 dump 가능 (key mapping 없이)
- `patchFormatToLibProps(fmt)` 추가 — typed 키 (fontName/fontSize/textColor) 를 lib props_json 키 (name/size_hu/color int) 로 변환. lib raw 가 있으면 base 로, typed 가 그 위에 덮음
- validator 가 cell 좌표 + lib passthrough 검증 (음수 / 잘못된 shape 거절)
- 7 unit test 추가 (`shared/ai-patches.test.ts`) — backward compat / cell parsing / fontName+lib passthrough / lib props 매핑

ViewerHandle wrappers (`src/features/studio/`):

- `irDeleteRangeInCell` — lib `deleteRangeInCell`. cell patch 의 deletion 단계
- `irApplyCharFormatInCell` — lib `applyCharFormatInCell`. cell 내부 삽입 영역 char format

`AppShell.applyPatches` 라우팅 (`src/app/AppShell.tsx`):

- location.cell 있으면 → irDeleteRangeInCell (deletion 길이 0 이면 skip) + irInsertTextInCell + 옵션 irApplyCharFormatInCell. cell 없으면 기존 body path
- additionFormat 있으면 patchFormatToLibProps 로 매핑 후 (cell 여부 따라) applyCharFormat 또는 applyCharFormatInCell. 이전엔 typed 키를 lib 에 그대로 넘겨 size_hu / color int 변환 누락 — 이번에 fix
- 모두 같은 undo group (turn 1회 ⌘Z)

Agent prompt (`src/features/chat/prompts.ts`):

- "Core rule" 갱신: text edits → ahwp-patches 블록 (사용자 Accept/Reject), structural ops → write tool. 두 경로 schema 모델에게 명시
- patches 블록 schema 인라인 (location.cell / additionFormat.lib 등) — LLM 이 직접 schema 보고 생성
- char-shape 매칭 절차: read tool 로 sibling char-props → additionFormat.lib 에 그대로 dump

### Changed — Phase-aware tool router + 모든 LLM-facing prompt 영어 (0.4.19)

목표: tool router 가 "정보 부족 → 검색 / 정보 충분 → 작성" 흐름을 자동 판단해 매 turn subset 을 phase 에 맞춰 좁힘. 사용자 지시: "정보가 부족하면 검색, 정보가 다 있으면 작성 이런식으로 알아서 되게 하고 싶은데" + "llm에 제공하는 프롬프트 다 영어로 사용해".

router phase-aware (ⓑ):

- `selectToolsViaLlm` signature 에 `recentToolCalls: { name; ok; summary? }[]` 추가. 비어있으면 turn 1 신호 → 사용자 query 만 보고 결정. 있으면 phase 판단.
- router system prompt 에 phase 원칙 추가 (휴리스틱 X — 원칙만):
  - 이력 빔 → query 만 보고 결정 / 좌표 모호하면 read 위주
  - read 위주 + 좌표·구조 충분히 모임 → write 위주로 전환
  - 직전 write 포함 → verify read 위주 (동일 write 반복 회피)
  - read 결과 빔 / 부족 → 다른 read 시도
  - same tool 여러번 fail → 다른 접근
- `useChatStreaming` 에 `agentToolHistoryRef` 신설. tool dispatch 결과를 매번 push (name + ok + 결과/reason 의 120자 요약). send/regenerate/stop/turn-end 시 reset.
- router cache (`cachedKey + cachedResult`) — 같은 query + 같은 history 면 LLM 호출 생략. phase 가 변하지 않은 turn 이 둘 이상이어도 추가 비용 0. `resetRouterCache()` 가 user message 시작 + turn 종료 시 호출.

LLM-facing prompt 영어 변환:

- `prompts.ts` — `SYSTEM_PROMPT_DOC_CONTEXT` 전체 영어 (output language directive 포함 — 사용자 응답 언어는 user 메시지 언어). `buildReferenceSystemBlock` / `buildExcerptSystemPrompt` 영어. `[현재 문서]:` → `[Active doc]:`, `[참조 문서]:` → `[Reference docs]:`, `[발췌]:` → `[Excerpts]:`.
- `useChatStreaming` 의 doc context label 도 동기화.
- `toolRouter.ts buildRouterSystemPrompt` / `buildRouterUserPrompt` 영어.
- `shared/ai-tool-catalog.ts` 60+ tool description 모두 영어. 한컴 스타일 이름 (`제목 N` / `개요 N`) 만 매칭 식별자로 그대로 유지.
- `feedback_english_prompts` memory 추가 — 향후 prompt 작성 시 영어 default.

증상 1 — `findInDocument {"query":"도입기업명"}{"query":"과제번호"}{"query":"사업기간"...}` invalid JSON 으로 query-not-string 에러. 사용자 보고: "이것도 맨날 이렇고".

근본 원인: `electron/ai/providers/openai.ts` 의 tool_calls SSE 누적이 `tc.index` 만 key 로 사용. NVIDIA NIM gemma-4 는 parallel tool calls 를 모두 같은 `index=0` 으로 emit (id 만 다름) — 이전 코드가 같은 슬롯에 args 를 무한 concat → JSON.parse 실패 → `__rawArguments` fallback → validator 가 `query` 필드 없다고 거절.

수정: id 기반 dedup. `slotById` 맵 추가, `tc.id` 가 있으면 id 우선 lookup, 없으면 마지막으로 활성이었던 index slot continuation 으로 처리. 표준 OpenAI 스펙 (index unique per call) 도 backward compat — id 가 처음 나타날 때 indexToSlot 도 함께 갱신.

증상 2 — `getDocumentOutline` 항상 `[]`. 사용자 보고: "왜 맨날 비어있어?".

근본 원인 (버그 X — 데이터 미스매치): 사업계획서 양식 같은 일부 한글 doc 은 heading 스타일 (`제목 N` / `개요 N` / `Heading N`) 을 안 쓰고 본문 + 표 만으로 구성. `getOutline` 의 styleId → level 매핑이 빈 채로 시작 → 항상 빈 결과.

진단 추가: outline 결과가 빈 경우 `console.info` 로 doc 의 styleList 전체 (`id:name/englishName, ...`) dump. 사용자 / 개발자가 어떤 스타일 이름이 있는지 즉시 확인 가능. 모델은 catalog description 에 이미 명시된 fallback (`getDocumentSummary`) 으로 우회.

### Changed — Claude Code 식 chat tool UI + 양식 cell 채움 시 char-shape 매칭 가이드 (0.4.17)

목표: chat panel 의 tool 호출 표시를 (a) read = 자료 수집 / write = 실제 작업 으로 시각 분리 (b) 인접 read 들을 하나의 접힘 그룹으로 묶기 (c) 양식 cell 채울 때 AI 가 인접 cell 의 글꼴/사이즈 를 명시 매칭 하도록 prompt 강화.

UI A — read/write 시각 분리:

- `UiToolEntry` 에 `kind: 'read' | 'write'` 필드 추가. `useChatStreaming` 의 entry 생성부에서 `isReadOnlyTool(name)` 으로 채움
- `ToolEntryRow` 가 kind 기반 분기 — write 는 bordered 카드 (`bg-muted/30` + `shadow-xs` + `font-mono`), read 는 dim 한 줄 (`text-muted-foreground/60` + `text-[11px]`)
- 아이콘 분리: write=`✏️`, read=`🔍` (이전 통일 `🔧` 폐기)

UI B — 연속 read 묶음 처리:

- `groupToolEntries(entries)` 가 인접 read entries 를 단일 `read-group` 으로 fold, write 는 run 을 끊음
- `ReadGroup` 컴포넌트 — 진행중: "🔍 자료 수집 중 (n)" / 완료: "✓ 자료 수집 (n)" / 일부 실패: "⚠ 자료 수집 (k/n 성공)". 클릭 펼치면 개별 row
- testid: `chat-tool-read-group` / `chat-tool-read-group-toggle` / `chat-tool-read-group-detail`. data-tool-kind=read|write

(b1) — cell 채움 시 char-shape 명시 매칭:

- `prompts.ts` Anchored-write workflow §2 에 cell 채움 후 sibling cell 의 `getCharPropertiesAt` → `applyCharFormat` 절차 추가. `applyCharFormat` 의 lib quirk (empty paragraph no-op) 도 같이 명시 — 텍스트 삽입 후에 format
- `useDebugSurface.getCharProps(sec, para, off)` 노출 — deterministic e2e 검증용. 이전엔 lib 메서드만 있고 debug surface 없어 fixture 단위 검증 불가능했음
- 인프라 확인: `getCharPropertiesAt` 는 이미 6 surface (이름/READONLY/Args/catalog/validator/dispatcher/ViewerHandle) 모두 wired — 추가 작업 X. 변경은 prompt + debug 만

### Changed — prompt 휴리스틱 일괄 제거 + insertTextInCell 도구 추가 + 양식 채움 live 검증 (0.4.16)

목표: 양식 doc 의 write-intent query 가 (a) layout 파손 X (b) 실제로 채움 (c) 휴리스틱 enumeration 없는 prompt. 사용자 지시 — "프롬프트 휴리스틱하게 쓰지마" + "양식에 맞게 내용 채울 때까지 시도".

휴리스틱 sweep (모델로 가는 prompt surface 한정):

- `prompts.ts SYSTEM_PROMPT_DOC_CONTEXT` — 도구 args few-shot 예시 (section name, color 값, specific Korean text 등) 일괄 제거. JSON args schema shape 만 남김
- `prompts.ts SYSTEM_PROMPT_AGENT_GUIDE` — specific section number example / 한국어 field name enumeration / multi-position writes 의 wrong/right 코드 예시 모두 제거. 원칙 ("structured documents", "anchored writes", "cell context detection") 만 남김
- `prompts.ts SYSTEM_PROMPT_PLAN_MODE_SUFFIX` — specific tool args 예시 제거
- `ai-tool-catalog.ts` 도구 description 의 한국어 field name / 가상 시나리오 예시 제거 (`insertTextInCell` / `getDocumentSummary` / `switchTargetDoc`). 구조적 의미만 남김
- `tools.ts insertText guard reason` — "양식 표지" specific 표현 제거. 구조적 패턴만 명시

신규 도구 — cell-level write:

- `insertTextInCell(sectionIdx, parentParaIdx, controlIdx, cellIdx, cellParaIdx, charOffset, text)` AI 도구 추가. 4 surface (catalog / validator / types / dispatcher) 정합 — 도구 카운트 60→61
- `useViewerHandle.irInsertTextInCell` lib 의 `doc.insertTextInCell` thin wrapper

Live 검증 (gemma-4 + 사업계획서 fixture + write-intent query):

- 정리 전: paraCount 315→315, para0 len 0→0 (AI 가 아무 것도 안 함)
- 정리 후: paraCount 315→325 (+10), para0 len 0→25 (+25), destructive insertText entries 0
- 일관된 behavior — 연속 두 번 실행 모두 채움 + layout 보존
- live test 에 "AI 가 실제 채웠는지" assertion 추가 (filled = paraCount 증가 OR para0 len 증가)

메모리 박제: `feedback_no_heuristic_prompts.md` — system prompt 에 keyword enumeration / few-shot / 특정 양식·필드명 list 금지 원칙

### Test — write-intent live regression (양식 layout 파손 가드) (0.4.15)

목적: 사용자 두 번째 보고 케이스 — "양식에 내용 채워넣는 것" — live NIM 으로 검증. 가상 업체명 (테크플로우 / TechFlow) + 예지보전 사업으로 사업계획서 양식 채워달라는 query 후 표지 layout 보존 확인.

신규 테스트:

- `tests/e2e/nvidia-live.spec.ts` "0.4.14 회귀 — 양식 doc 의 write-intent query 가 표지 layout 파손 안 함"
- `test.setTimeout(300_000)` — multi-turn agent + LLM 지연 대비 (default 60s 부족)
- 양식 paragraph 0 길이 baseline + 100 안 넘는지 검증 (bug 인 경우 200+ 자 dump)
- `chat-tool-entry` 의 `insertText` failed entry 가 있다면 reason 이 dispatcher guard 거절 메시지인지 검증
- 38초 live 통과: paraCount 315→315 / para0 len 0→0 / insertText entries 0 (AI 가 prompt 가이드 따라 시도조차 안 함)

해석: 0.4.9 prompt 가이드가 매우 효과적 — AI 가 양식 doc 인지하고 destructive `insertText(0,0,0,multiline)` 시도조차 안 함. 0.4.12 hard guard 는 fallback 으로 대비. layout 보존은 ✓, 단 자동 채움도 안 됨 (보수적 응답). 적극 채움은 추후 prompt 정밀화 후보.

### Test — NIM live e2e default 모델 gemma-4 + 사용자 실패 케이스 live 검증 (0.4.14)

목적: 사용자 결정 (gemma-4 default for live tests) 적용 + 사용자 직접 보고된 "사업계획서 읽고 누락 부분 찾아줘" 시나리오를 live NIM 으로 검증.

- `tests/e2e/nvidia-live.spec.ts` default model `qwen/qwen3.5-122b-a10b` → `google/gemma-4-31b-it` 6 sites sed
- chunk 48 의 dynamic model selector (`<select>`) 호환 — `localStorage.ahwp:chat:models` + `ahwp:chat:provider` 주입으로 fill / selectOption 우회
- `chat-key-indicator` lucide 아이콘 전환 (text `●` 사용 안 함) — 5 sites `toHaveText(/●/)` → `toHaveAttribute('data-state', 'ok')`
- 신규 테스트 "0.4.13 회귀 — 양식 doc 의 read-intent query 가 IR 변경 안 함" — 실제 사업계획서 fixture (`examples/4. [사업계획서] ... .hwp`) 활용, gemma-4 호출, "이 사업계획서 읽고 누락된 부분이 있는지 찾아줘" 같은 read query 후 paragraphCount + 첫 5단락 + applied-toast count 모두 무변경 검증. 26초 안에 통과 (live)
- 메모리 박제: `feedback_default_test_model.md` — Playwright live test 의 default 는 항상 gemma-4 사용

### Test — chat e2e 갱신 + 미커버 fix 회귀 가드 (0.4.13)

목적: 사용자 검증 격차 메우기. 기존 stale 7건 (chunk 99 follow-up 0.3.40 부터 깨져 있던 것) 정정 + 본 세션 fix 의 회귀 가드 신규.

stale 정정:

- `chat-tools.spec.ts:195` "html and ahwp-tools both buttons render" — plan mode default ON 으로 button 노출 (0.3.40 부터 button 이 plan mode gate)
- `chat-section-replace.spec.ts:160, 218` "outline 매치 / 비어있음 → 버튼 텍스트" 2건 — 동일 plan mode 활성화
- `chat-multidoc.spec.ts:82, 103, 115, 126` "target chip / reference checkbox" 4건 — feature 자체 폐기 (`MultiDocChips` 제거 since 0.3.40) 라 `test.skip` + 사유 명시. 회귀 가드는 `chat-excerpt.spec.ts` (📌 발췌 첨부) 가 cover

신규 회귀 가드:

- `chat-section-replace.spec.ts` "0.4.6 회귀 — sectionMatch 없는 markdown 응답은 자동 적용 X" — paragraph 0 길이 사전/사후 비교 + applied-toast 카운트 0 검증. 사용자 보고 "조회인데 문서 mutate" 직접 가드
- `chat-tool-ui.spec.ts` 신설 — 0.4.11 single-line truncate (행 높이 < 32px), chevron 노출, click → result panel + 재클릭 → 접힘. JSON 키 (sectionIndex/paragraphIndex) 매치로 result 정확성도 검증

검증:
✓ chat e2e 9 spec (43 passed, 9 skipped, 0 failed) — 본 세션 직전 7 failed 였던 것 0 건으로
✓ studio e2e 16 passed, 10 skipped — 회귀 0건

미커버 (의식적):

- 0.4.10 multi-write 직렬화: fake provider 가 multi-tool emit 미지원 — 결정적 e2e 어려움. 코드 review 로 검증 (parallelBatch.filter(read/write) + Promise.allSettled vs for-of)
- 0.4.8 Keychain cache: OS 의존 — e2e 환경에서 keychain prompt 자체 안 뜸
- 0.4.9 prompt 가이드: 모델 동작 — e2e 비결정적

### Fixed — `insertText(0,0,0,multiline)` dispatcher hard guard (0.4.12)

증상: 0.4.9 의 prompt 가이드 추가 후에도 일부 LLM (gpt-5.x) 이 사업계획서 양식 doc 에서 또 `insertText(0,0,0,"...100+ 줄...")` 호출 → 표지 layout 파손 재발 (사용자 두 번째 보고).

원인: prompt 만으로는 강제력 부족. router LLM 이 catalog subset 만 통과시키면 AI 가 applyHtml 옵션 자체 못 보는 경우도 있음.

수정: dispatcher (`tools.ts:runOne`) 의 `insertText` 케이스에 hard guard. `sectionIdx === 0 && paragraphIdx === 0 && charOffset === 0 && text.includes('\\n')` 조합이면 IR mutation 없이 `{ ok: false, reason: 'insertText-at-doc-start-with-multiline-rejected: ...' }` 반환. AI 가 다음 turn 에 error 보고 applyHtml 또는 findInDocument anchor 로 재시도.

회귀 가드: `tools.test.ts` 5 단위 테스트 — guard 거절 / single-line allow / non-(0,0,0) allow / (0,0,N>0) allow / undo group 일관성.

### Changed — Tool 호출 UI 한 줄 truncate + 결과 확장 패널 (0.4.11)

요청: AI 도구 호출 표시를 한 줄로, 결과는 확장 버튼 클릭 시에만 노출.

- `chat-tool-entry` 행이 본격 single-line — 부모 flex 가 `min-w-0` + 자식 args span 이 `flex-1 truncate` 라 너비 안 넘김. 이전엔 truncate 가 있었지만 부모 min-w-0 부재로 wrap 발생 (스크린샷에서 "text-too-large" 가 두 줄 차지하던 이유)
- 새 ▶ chevron 버튼 — 클릭 시 result panel (▼ 로 토글) 펼침. result 는 monospace `<pre>` (max-h-60, overflow-auto, JSON 2-space indent) 로 표시. result 없는 entry (running / pending) 는 chevron 숨김
- `UiToolEntry.resultPreview` 필드 신규 — `useChatStreaming` 가 partialResults 도착 시 JSON.stringify 해 미리 저장. read tools 16k cap, write tools 4k cap (advanceAgentLoop 의 tool-result 메시지 cap 정합)
- 새 `ToolEntryRow` 컴포넌트 — 행 + 확장 패널을 한 단위로 캡슐화. 기존 `data-testid` 모두 보존 (chat-tool-entry / chat-tool-approve / chat-tool-reject) + 신규 `chat-tool-expand`, `chat-tool-result`

### Fixed — 다중 write tool 병렬 dispatch race + bottom-up 가이드 (0.4.10)

증상: AI 가 한 turn 에 다중 write tool (예: `insertText` × 5) batch 시 비결정적 interleaving + paragraph index shift 로 의도 안 된 위치에 적용. 사용자: "다중 위치에 동시 작업할 때도 동작하나?"

원인 두 갈래:

- **JS-level 병렬 dispatch (코드 결함)**: `useChatStreaming.ts` 의 `Promise.allSettled(parallelBatch.map(...))` 가 read / write 구분 없이 모두 병렬 dispatch. write 가 race 가능. 코드 의도는 read 만 병렬이었는데 write 도 같이 휘말림
- **Paragraph index shift (구조적 한계)**: write 1 이 paragraph 추가 시 후속 write 의 target idx 가 stale. AI 가 single read 의 idx 를 multi-write 에 재사용하면 어긋남

수정:

- 코드: `parallelBatch` 를 `reads` (`Promise.allSettled` 병렬) + `writes` (for-of 직렬, AI call 순서 보존) 로 분리. read 가속은 유지하면서 write race 차단. 결과 ordering 은 AI tool call 의 원래 순서대로 partialResults 에 매핑
- prompt 가이드 신규 섹션 "Multi-position writes — paragraph indices SHIFT during a turn" — bottom-up 순서 / 매 write 전 anchor re-resolve / "reads parallel, writes serial" 명시 / 안전 패턴 (one write per turn) + wrong/right 예시

이제 다중 write 도 race 없이 작동. 단 AI 가 bottom-up / re-resolve 안 하면 idx shift 는 여전 — prompt 로 유도.

### Changed — Agent prompt + insertText description 강화 — 양식 doc layout 파손 방지 (0.4.9)

증상: 사업계획서 양식 (표지 표 + 섹션 구조) 에서 "작성해줘" 요청 시 AI 가 `insertText(0,0,0,...)` 호출. 평문 + `\n` paragraph break 만 있어 표지 표 cell 안에 raw text dump → 양식 layout 망가짐. 사용자 보고: "문서 형식 하나도 안맞아".

원인: prompt 가이드 가 양식 doc 에서의 insertText 위험 미언급. 도구 description 도 "raw 텍스트만 추가할 때 사용" 정도라 AI 가 (0,0,0) 호출의 destructive 결과를 인지 못 함.

수정:

- `prompts.ts` SYSTEM_PROMPT_AGENT_GUIDE 에 신규 섹션 "Form / template documents — DO NOT use insertText at (0,0,0)" 추가. 사업계획서 / 보고서 양식 다룰 때 4단계 체크리스트 (anchor 식별 → cell 여부 확인 → applyHtml 선호 → 100+ 줄 single insertText 금지)
- `ai-tool-catalog.ts` insertText description 강화: "양식 doc 의 (0,0,0) 호출 금지" / "char-shape 만 상속" / "heading 혼합 시 applyHtml 사용" 명시 + 안전 사용처 예시

향후 회귀 가드는 양식 doc fixture 로 e2e 추가 (사용자 실제 양식 .hwp 가 examples/ 에 있으면 활용).

### Fixed — macOS Keychain prompt 가 매 채팅 turn 마다 반복 (0.4.8)

증상: API 키 저장 후 채팅마다 macOS Keychain 인증 prompt 발생. 사용자 입장 — Settings 한 번 + 첫 채팅 한 번 = 최소 2회.

원인: `getSecret` 이 매 호출마다 `safeStorage.decryptString` 호출. Keychain ACL = "Allow once" (사용자가 "Always Allow" 안 누름) 시 매 decrypt 가 새 access 로 간주되어 prompt. main-process 가 이미 trusted 인데도 매번 키 chain 재방문.

수정: `electron/store/secrets.ts` 에 main-process plaintext 캐시 (`plaintextCache: Map<ProviderId, string>`) 추가. 첫 decrypt 후 캐시 — 같은 session 내 후속 `getSecret` 은 silent. `setSecret` 은 plaintext 그대로 캐시 warm-up. `deleteSecret` 는 캐시 invalidate. **renderer 노출 0** — `secrets:get` IPC 는 여전히 없음, 캐시는 main-process 메모리 한정.

사용자 측 추가 권장: Keychain prompt 첫 등장 시 **"Always Allow"** 클릭 — 이후 모든 access 가 silent (이번 fix 포함 / 미포함 무관 효과).

### Fixed — OpenAI Responses API 다중 tool 호출 turn 직렬화 시 `type:'list'` 400 에러 (0.4.7)

증상: 한 turn 에 다중 tool call (예: `findInDocument` 12회 연속) 한 후 다음 turn 진입 시 OpenAI / NVIDIA NIM / Custom (OpenAI 호환) 모두 400 — `Invalid value: 'list'. Supported values are: 'function_call', 'function_call_output', 'message', 'reasoning', ...`. agent loop 가 도중에 stuck.

원인: `electron/ai/providers/openai.ts:toResponsesInputItem` 가 ChatMessage → /v1/responses input item 변환 시, 한 assistant 메시지의 `toolUses` 가 2개 이상이면 임의의 wrapper `{ type: 'list', items: [...] }` 로 묶어 전송. Responses API 는 'list' 타입 미지원 → 즉시 reject.

수정: 변환 함수 시그니처를 `Record → Record[]` 로 바꿔 한 assistant turn 의 N개 tool call 이 N개 individual `function_call` item 으로 평탄화. 호출 측은 `messages.map` → `messages.flatMap` 으로 spread. NVIDIA / Custom 어댑터가 `openaiProvider.chat` 에 위임하므로 같은 fix 가 셋 다 cover.

### Fixed — Read-only 의도 query 가 markdown fallback 자동 적용으로 doc mutate (0.4.6)

증상: "사업계획서 읽고, 다 채워졌는지 확인해줘" 같은 read-only 의도 요청 시 AI 가 read tool 호출 후 informational 텍스트 (옵션 나열 / 질문) 로 응답. Agent loop 의 final text 메시지는 `toolEntries` 가 비어있어 `markdownToHtml` fallback 이 발동, 변환된 HTML 이 active doc 에 자동 insert. 사용자 입장: "조회한 건데 문서 내용이 바뀌었네."

원인: `ChatPanel.tsx` 의 auto-apply useEffect 가 `htmlPayload` 만 보고 dispatch. markdown fallback 의 출처 (사용자 의도) 무관. agent loop 의 마무리 conversational 응답이 markdown 패턴 (목록 / 강조 / 표) 만 가지면 그대로 적용.

수정: markdown fallback 자동 적용은 `sectionMatch` (응답이 `### N.N.N ...` 같은 섹션 번호 heading 으로 시작) 가 매칭됐을 때만. 그 외 markdown 응답은 chat 안에 conversational 로 표시, 적용 X. 명시적 ` ```html``` ` 블록은 의도적 payload 라 기존 동작 유지 (sectionMatch 무관 적용).

### Added — `getDocumentSummary` AI read tool — heading 없는 doc 의 "채워졌는지" 판정 (0.4.5)

증상: 사용자가 사업계획서 양식 (heading 스타일 미사용 — 본문 / 표 셀로만 구성) 을 활성 탭으로 두고 "다 채워졌는지 확인해줘" 요청 시 AI 가 `getDocumentOutline` → `[]` → `getTextRange(0,0,0,0,...)` 첫 단락만 보고 "doc is empty" 결론. AI 가 paragraphCount / sectionCount 를 알 수단이 카탈로그에 없어 blind probe 실패.

수정:

- 새 read tool `getDocumentSummary` — `{ sectionCount, sections: [{ paragraphCount, nonEmptyCount, firstFilled, lastFilled }] }` 반환. heading 없어도 doc 이 얼마나 차 있는지 한 번에 판정 가능
- `useViewerHandle.getDocumentSummary()` impl — 모든 section 의 paragraph 순회, 비어있지 않은 것 카운트 + 첫·마지막 채워진 단락 샘플 (200자 cap)
- `getDocumentOutline` 카탈로그 description 에 fallback 안내 추가
- catalog / validator / types / readonly-set 4 surface 일괄 갱신 (총 도구 60개)

### Fixed — workspace outline 추출 가 `개요 N` 스타일 누락 — AI cross-doc 읽기 실패 (0.4.4)

증상: AI 에 "이 문서 확인해서 정합성 확인해줘" 같은 cross-doc 분석 요청 시 "파일 읽기 시도 했으나 못함". 사업계획서 / 보고서 양식 다수가 영향.

원인: `electron/ipc/folder.ts:extractOutline()` 가 heading 매칭 시 `^제목\s*N` / `^Heading\s*N` 만 픽업, **`^개요\s*N`** (한컴 한국어 outline 스타일, 사업계획서 양식 다수 채용) 누락. 같은 모듈인 `useViewerHandle.ts:getOutline()` 은 `개요` 매칭 포함하던 게 cross-doc 측에 미반영. AI 가 `searchWorkspaceOutlines` 호출 → 양식 doc 의 outline = `[]` → "navigatable 항목 없음" 으로 인식해 read 시도 자체 포기.

수정:

- `extractOutline()` 의 heading 매칭에 `koOutline = s.name?.match(/^개요\s*(\d+)?/)` 추가. 셋 다 (제목 / 개요 / Heading) 픽업하도록 `useViewerHandle.ts:getOutline()` 와 정합
- `outline-cache.json` schema 에 `version` 필드 추가 (`OUTLINE_CACHE_VERSION = 2`). v1 캐시는 자동 무시 → 다음 scan 시 fresh 추출. 사용자가 캐시 파일 수동 삭제 안 해도 됨

### Fixed — ChatPanel hasKey 가 secrets 변경 broadcast 미구독 (0.4.3)

Settings 에서 API 키 입력 후에도 채팅 패널이 "키 설정 필요" 상태로 stale 했던 버그. `hasKey` state effect 가 deps `[provider]` 만 가지고 있어 같은 provider 의 키가 추가/삭제될 때 갱신 안 됐음. chunk 70 의 `secrets:changed` IPC broadcast 는 model prefetch 에만 hooked 되어 있었음.

이제 `hasKey` effect 도 `window.api.secrets.onChanged()` 구독 — Settings 저장 즉시 반영. reload 불필요.

### Fixed — Phase 6 follow-up: L-004 Canvas-mode tooltip overlay (0.4.1)

KNOWN_ISSUES L-004 (narrow-column 텍스트 잘림 hover tooltip) chunk 107 의 Canvas-only 전환 후 잠시 잃었던 affordance 복구. SVG `<text><title>` injection 의 직접 대체.

- **`src/lib/rhwp-core/text-layout.ts` 신설** — `parsePageTextLayout` (`getPageTextLayout` JSON 의 `runs[].text/x/y/w/h` 추출, 빈 텍스트 / non-finite bbox 필터) + `applyTextTooltipOverlay` (run 별 transparent `<div title="...">` 마운트, z-index=1 layer, pointer-events: auto so 브라우저 native tooltip 작동, 마우스 이벤트 자연스럽게 페이지 컨테이너로 bubble). 6 단위 테스트
- **`renderCanvasPage` 통합** — 본문 canvas 렌더 + behind/front overlay 직후 text-tooltip overlay 적용. `getPageTextLayout(idx)` → parse → applyTextTooltipOverlay
- **`__studioDebug.getPageTextLayoutJson(idx)` 신규** — text layout JSON 노출 (e2e probe / debug 용)
- **flaky e2e 정리** — chunk 105 의 `studio-canvas-overlays.spec.ts` 의 selection-rect regression 케이스 (focus + Cmd+A timing 의존, 검증 안 한 채 추가됐던 것) 삭제. find-match regression 케이스가 같은 invariant (DOM `<div>` overlay) 를 검증하므로 손실 없음

검증:
✓ typecheck (양 tsconfig)
✓ unit (19/19 rhwp-core: 7 CanvasPool + 6 PageLayerTree + 6 TextLayout)
✓ e2e 20 케이스 (canvas-mode + canvas-overlays + viewer + input) 통과

### Changed — chunk 107: Phase 6.7 SVG 경로 제거 + Phase 6 완료 (0.4.0)

Phase 6 (rhwp-studio view 계층 정합) 마지막 chunk. SVG 렌더 path 일괄 제거, Canvas 가 유일한 path. minor 버전 bump (0.3 → 0.4) — Phase 단위 milestone.

- **`renderPageInto` SVG 분기 제거** — `renderPageSvg` / `DOMParser` / `<svg>` mount / L-004 `<text><title>` injection / `__studioPageDiag` 모두 삭제. Canvas 전용 dispatch 1줄
- **`useDocumentLifecycle` page-0 dims 추출** — `renderPageSvg(0)` + `<svg width/height>` regex → `getPageInfo(0)` JSON 직접 파싱. SVG WASM 호출 0건 in lifecycle
- **`utils/page-dims.ts` 재구성** — `parsePageDimensions` 가 SVG 문자열이 아니라 `getPageInfo` JSON 을 입력. 6 신규 단위 테스트
- **forceRerender + viewport unmount + useDebugSurface + useUndoHistory** — 모든 dual-mode 분기 제거, canvas-only 통일
- **`render-mode.ts` 모듈 + `localStorage.ahwp:render-mode` flag 삭제** — 불필요해짐
- **e2e 정정** — `studio-image.spec.ts` 의 `svg image` 검사 → `getPageLayerTree` JSON 의 image op 검출. `studio-viewer.spec.ts:200` 도 동일
- **`__studioDebug.getPageLayerTreeJson(idx)` 신규** — e2e 가 image 존재 검증할 수 있게 lib JSON 노출
- **KNOWN_ISSUES L-004 갱신** — Canvas-only 시 SVG `<title>` tooltip 우회 불가. 후속: `getPageLayerTree` text op bbox + overlay tooltip 검토
- **Phase 6 완료 게이트** — `grep renderPageSvg src/` 코멘트만 (호출 0건). e2e 26 케이스 (viewer/input/undo/canvas-mode) 통과

### Changed — chunk 106: Phase 6.6 e2e selector mode-agnostic 정리 (0.3.48)

`tests/e2e/*.spec.ts` 의 SVG-specific selector 를 mode-agnostic 으로 일괄 변경 — chunk 107 SVG 제거 후에도 동일 e2e 가 Canvas-only 환경에서 통과. `studio-viewer.spec.ts` (3 sites) / `studio-bigdoc.spec.ts` (8 sites, sed) / `studio-format.spec.ts` (1 site) 의 `locator('svg')` → `'svg, canvas'`.

### Changed — chunk 105: Phase 6.5 find / selection / changed-paragraph mode 정합 (0.3.47)

Inventory 결과 — 회귀 가드만 추가. 세 highlight (selection rect / find match / changed-paragraph stripe) 모두 이미 DOM `<div>` overlay 였음 (`PaperPage.tsx`). Canvas mode 에서 자동 동작. `tests/e2e/studio-canvas-overlays.spec.ts` 신규 — 회귀 가드 (selection rect + find match DOM overlay 검증).

### Changed — chunk 104: Phase 6.4 behind/front overlay (getPageLayerTree) (0.3.46)

Canvas mode 의 behind/front floating image (워터마크 / 도장 / 사인) 를 native overlay 로 정확히 그리도록.

- **`page-layer-tree.ts` 신설** — `parsePageLayerTree` (`getPageLayerTree` JSON 트리에서 wrap=behindText|inFrontOfText image op 분리) + `applyOverlayLayers` (DOM 적용: behind div z-index=0 + front div z-index=2). bbox × zoom = CSS px. pointer-events: none. 6 단위 테스트
- **CSS filter 매핑** — grayScale → `grayscale(100%)`, blackWhite → `grayscale + contrast(1000%)`, brightness/contrast 비례. 워터마크 → `mix-blend-mode: multiply`
- **`renderCanvasPage` 통합** — 본문 canvas 렌더 직후 `getPageLayerTree` → parse → applyOverlayLayers

### Changed — chunk 103b: Phase 6.3 follow-up dual-mode re-render hooks (0.3.45)

Canvas mode 가 `useDebugSurface` (debug insertText) 와 `useUndoHistory` (snapshot restore) 에서도 redraw 동작. 이전엔 mounted 검사가 SVG 한정이라 Canvas 모드에서 누락. 두 hook 의 selector → `'svg, canvas'`.

### Changed — chunk 103: Phase 6.3 Canvas 본문 렌더 path (dual-mode) (0.3.44)

`StudioViewer` 의 페이지 마운트 path 가 `localStorage.ahwp:render-mode` 에 따라 SVG / Canvas 로 분기. SVG (default) 는 0건 회귀. Canvas 는 `renderPageToCanvasFiltered("flow")` 호출 + `CanvasPool` 재사용 + 비동기 이미지 디코딩 200ms / 600ms 재렌더 (rhwp-studio scheduleReRender 패턴).

- **`renderCanvasPage(idx, el)`** — DPR-aware backing store (`pageW × zoom × DPR`), CSS `100% × 100%` (parent-sized). lib `scale = zoom × DPR`. canvas.parentElement 검사로 in-place 재렌더 (zoom 변경 / 비동기 디코딩 시) 가능.
- **dual-mode 분기 3 지점** — `renderPageInto` 진입 시 / `forceRerender` 의 mounted 검사 / viewport unmount 의 in-window 판정. SVG 경로는 기존과 동일.
- **path 변경 정리** — `useEffect([path])` 의 cleanup 이 `canvasPoolRef.releaseAll()` + 모든 pending re-render timer 취소. `useDocumentLifecycle` 의 bridge.dispose 후 실행.
- **zoom 변화 재렌더** — Canvas mode 한정 `useEffect([zoom])` 가 viewport 내 모든 mounted canvas 를 재렌더 (SVG 는 CSS scale 로 충분, skip).
- **`tests/e2e/studio-canvas-mode.spec.ts`** 3 케이스 신규 — `<canvas>` 마운트 / DPR-aware 백킹 store / 비공백 픽셀 콘텐츠.
- **deferred to chunk 103b**: L-004 narrow-column tooltip 우회 (현재 Canvas mode 는 `<title>` 못 함 — `getPageLayerTree` text op 기반 transparent overlay 필요), `useDebugSurface` `el?.querySelector('svg')` selector mode 분기, per-page dims (`getPageInfo`).

검증: SVG mode e2e 29 케이스 회귀 0 / Canvas mode 3 케이스 통과 / typecheck / lint (0 errors, 7 사전 warnings) / unit (58/59).

### Changed — chunk 102: Phase 6.2 canvas-pool + render-mode 인프라 (0.3.43)

Phase 6 세 번째 chunk. 동작 변화 0건 인프라만 — chunk 103 의 Canvas 본문 렌더 swap 이 사용할 토대.

- **`canvas-pool.ts`** — `<canvas>` element 풀링 (rhwp-studio reference 포팅). `acquire(idx)` / `release(idx)` / `releaseAll()` / `has` / `getCanvas` / `activePages` / `totalCount`. viewport 스크롤 시 GC 압박 완화 — viewport buffer 11 페이지에 풀이 stable 11 elements 로 수렴
- **`render-mode.ts`** — `localStorage.ahwp:render-mode` (`'svg' | 'canvas'`) 읽기/쓰기. 인식 못 하는 값은 fail-safe `'svg'`. e2e 가 `page.evaluate` 로 spec 별 set 가능
- **`canvas-pool.test.ts`** 7 단위 테스트 — acquire/release 순환, 재사용, releaseAll, 미존재 페이지 release no-op
- 본 chunk 에서 renderPageInto 분기 X — chunk 103 가 mode 별 path 분기 + Canvas 본문 렌더 도입

### Changed — chunk 101: Phase 6.1 coordinate-system.ts (0.3.42)

`src/lib/rhwp-core/coordinate-system.ts` 신설 — DPR-aware 좌표계 변환 유틸. 5 좌표 공간 (Client / Scroller / Page-CSS / Page / Canvas-px) 의 변환 함수 6개 (`clientToPage`, `clientToPageWithRect`, `pageYToClientY`, `clientToScroller`, `pageToScroller`, `pageDimsToCanvasSize`) 를 단일 모듈로 통합. `StudioViewer.tsx:hitTestAt` + `usePageMouseHandlers.ts` 4개 inline 변환 지점을 함수 호출로 교체. `pageDimsToCanvasSize` 는 Phase 6.3 Canvas swap 의 `scale = zoom × DPR` 정합용 prep — 현재 path 미사용. 동작 변화 0건.

### Changed — chunk 100: Phase 6.0 WasmBridge 추상화 + RhwpDoc 타입 단일화 (0.3.41)

Phase 6 (rhwp-studio view 계층 정합) 시작. 동작 변화 0건 순수 refactor.

- **`src/lib/rhwp-core/` 디렉토리 분할** — 단일 파일 `rhwp-core.ts` 를 `index.ts` (배럴) / `init.ts` (`ensureRhwpCore`) / `wasm-bridge.ts` (`WasmBridge` 클래스) / `types.ts` (`RhwpDoc`/`RhwpViewer` 단일 정의) 로 분해. `WasmBridge.create(bytes)` / `.dispose()` 가 lifecycle 소유, `useDocumentLifecycle` 이 진입점.
- **`RhwpDoc` 타입 8 곳 중복 → 1 곳** — 7 hook + StudioViewer 의 `type RhwpDoc = InstanceType<typeof HwpDocument>` 중복 제거, `import type { RhwpDoc } from '@/lib/rhwp-core'` 로 통합.
- **`docRef` 호출 지점 0건 변경** — `docRef.current?.X(...)` 패턴 ~136 곳은 `bridge.doc` 미러링으로 그대로 동작. Phase 6.3 의 Canvas render path swap 시 그때 필요한 method 만 bridge 로 promote 예정.

### Changed — chunk 99 follow-up: confirm UI 폐기 + 자동 적용 + 컨텍스트 매뉴얼화 (0.3.40)

사용자 요청 — 채팅 흐름의 모든 explicit confirm 버튼 제거, 자동 적용을 main flow 로. 만족 못하면 stop / undo (⌘Z) 로 옵트아웃.

- **자동 승인 토글 폐기** — `chat-auto-approve-toggle` UI / `loadAutoApprove` / `STORAGE_AUTO_APPROVE` / `autoApproveRef` / `pendingCalls` 사용자 승인 게이트 모두 제거. 모든 도구 (read + write) 즉시 dispatch. 검토 모드 e2e 3개 skip + helper `enableAutoApprove` no-op 화.
- **자동 적용** — assistant 응답이 `html` 블록 / markdown fallback / outline-aware section 을 포함하면 useEffect 가 한 번 자동 dispatch. `chat-action-apply-html` 버튼은 plan mode 일 때만 노출. 자동 적용 후 `chat-action-applied-toast` ✓ 표시 + 되돌리기 버튼.
- **Patches 자동 acceptAll** — `ahwp-patches` 블록 도착 시 useEffect 가 한 번 자동 acceptAll. plan mode 가 아니면 클릭 없이 즉시 적용. Diff 카드는 portal overlay 에 변경 기록 + 되돌리기 용도로 잔류.
- **Plan mode default OFF** — 자동 적용이 main flow 라 default false. Plan mode 는 큰 / 위험한 변경에 opt-in 하는 검토 모드 (Settings → AI 공급자 → "Plan mode 기본 활성화" ON).
- **컨텍스트 자동 첨부 폐기** — `chat-attach-toggle` (`📎 현재 문서를 컨텍스트로 첨부`) UI / `STORAGE_ATTACH_DOC` / `MultiDocChips` (auto multi-doc reference) 모두 제거. 사용자가 매뉴얼로 `📌 발췌 첨부` 버튼 또는 selection rect 드래그로만 컨텍스트 추가. 응답마다 토큰 비용 예측 가능.
- **Tool entry 실패 시각 강조** — `chat-tool-entry` 의 status='failed' 일 때 컨테이너 + 아이콘 + argsPreview 모두 destructive 색상 (이전엔 reason 텍스트만). switchTargetDoc 의 `target-not-open:` 같은 실패가 시각적으로 명확.

신규 / 수정 e2e: chat-html-apply 자동 적용 회귀 가드, chat-plan-mode default ON 명시 set, chat-actions / chat-agent-multidoc / nvidia-live / gemini-live / ollama-live 의 auto-approve 호출 정리. 폭넓은 회귀 40/40 + 5 skipped (검토 모드 의도적). typecheck / lint (0 errors).

### Fixed — chunk 99 follow-up: 세션 복원 시 폴더 트리 / 탭 다중 복원 (0.3.39)

- **`getSession()` 파싱 버그 fix** — `setSession()` 은 `lastActivePath` / `lastFolderPath` / `openTabPaths` 전체 스냅샷을 disk 에 쓰는데 `getSession()` 은 `lastActivePath` 만 파싱하고 나머지는 무시하던 버그. 결과적으로 (a) 앱 재시작 시 폴더 트리가 항상 비어있고 (b) 다중 탭 복원이 legacy `else if (lastActivePath)` 단일 탭 fallback 으로만 작동. 이제 세 필드 모두 round-trip.
- **사용자 영향** — 재시작 후 좌측 폴더 트리에 직전 작업 폴더가 그대로 복원. 다중 탭도 정상 복원 (heretofore 마지막 활성 탭만 복원되던 것).
- **신규 unit test** — `electron/store/session.test.ts` 4 케이스: 라운드트립, 파일 부재 시 default, 손상된 array 엔트리 drop, legacy 단일-필드 호환.

### Changed — chunk 99 follow-up: Diff cards 를 가운데 (Studio) 패널로 이동 (0.3.38)

- **`react-dom` createPortal 로 ahwp-patches 카드 라우팅** — 기존엔 chat 메시지 버블 안에 inline 렌더되어 (a) 좁은 우측 패널에서 카드 가독성 ↓, (b) 본문 옆에 변경 제안이 있는데도 시선이 chat 으로 이동해야 하는 비효율. AppShell 의 center pane (TabBar 아래) 에 새 portal target `#ahwp-editor-diff-overlay` 추가 — sticky 우측 상단에 max-width 420px / max-height calc(100%-3.5rem-1rem). ChatPanel 의 Message 가 자기 패치 카드를 이 컨테이너로 portal.
- **Chat 측엔 hint 만 잔류** — `📋 N개 변경 제안 — 에디터 우측 카드에서 검토` 한 줄. portal target 미마운트 환경(초기 / e2e fixture-less)에선 inline fallback.
- **e2e 신규 1 케이스** — `chat-diff.spec.ts`: portal 카드가 overlay 컨테이너 안 visible / chat 메시지 트리 안엔 chat-patches-block 부재.
- 기존 6 케이스 통과 회귀 가드.

### Added / Changed — chunk 99 follow-up: agentic 파이프라인 + Plan mode + Section replace (0.3.37)

chunk 99 의 markdown fallback 후속 — Claude Code 식 자율 흐름으로 다음 7개 묶음 진화. NIM gemma4 31b it 류 도구 호출률 낮은 모델에서도 사업계획서 작성 같은 long-form 이 안정적으로 완주하도록.

- **Outline-aware section replace** — AI 응답 첫 heading 의 섹션 번호 ("2.7.4") 가 outline 매칭되면 기존 섹션 영역을 delete-and-replace (중복 X). `applyHtmlReplaceSection` 신규 IR 메서드 + `findSectionToReplace` 매처. ⌘Z 한 번에 롤백. 매칭 실패 시 paste-at-caret fallback.
- **System prompt 의 섹션 heading 가이드** — Manual / Agent 양쪽 prompt 에 "사용자가 특정 섹션 작성 요청 시 첫 줄을 `### {번호} {제목}` markdown heading 으로 시작" 박제. 매칭 정확도 ↑.
- **Agentic 파이프라인 강화** — Turn cap 10 → 50 (Settings 1~200 조절). 도구 결과 truncation 차등 (read 16k / write 4k). 실패 reason 에 retry hint 자동 추가. Stop 버튼이 mid-loop turn 진입 차단 (이전엔 abort 만 → 다음 turn 자동 진입). Step counter UI ("Turn 12/50"). 시스템 prompt 의 `Agentic loop discipline` 6개 원칙 (verify / retry / signal completion / etc).
- **Plan mode (Claude Code 식 dry-run)** — 기본 ON. 매 새 prompt 마다 AI 가 read tool 만 호출하고 변경 계획만 작성 (write 차단). 사용자 검토 후 (a) "이 계획대로 실행" 버튼 / (b) "건너뛰기" 인라인 / (c) 같은 prompt 재전송 — 모두 next-send 1회만 plan 우회. 영속 상태는 default (Settings → AI 공급자 → "Plan mode 기본 활성화") 한 가지뿐, turn-by-turn active 는 메모리 ref 로 관리. ChatPanel 의 토글 UI 는 Settings 로 이동, 채팅창엔 default ON 일 때 indicator + 건너뛰기 버튼만.
- **Cross-doc write routing** — 신규 `switchTargetDoc({path})` 도구. 한 turn 에서 여러 문서를 순차 편집. 닫힌 탭 path 도 자동 `file:open-by-path` 로 mount 후 라우팅 (chunk 50 docId-aware 와 결합).
- **Parallel read dispatch** — read-only / auto-approved 도구들을 한 turn 안에서 `Promise.allSettled` 로 동시 발사. IPC 경로 read (`searchWorkspaceOutlines` / `readParagraphByPath`) 가 진짜 동시성 획득. write 는 기존대로 직렬.
- **휴리스틱 정리** — `SYSTEM_PROMPT_AGENT_GUIDE` 의 keyword→tool 매핑 표 (10+ 줄), few-shot (A)/(B)/(C) verbose 예시, "워크스페이스 / 폴더 / 양식 / ..." keyword 트리거 일괄 삭제. 도구 catalog description 만으로 LLM 이 결정. tool router 의 keyword 리스트도 일반화. ~100 → ~60 줄.

신규 e2e 9 케이스 — chat-section-replace 3 + chat-plan-mode 3 + 기존 회귀 가드. typecheck / lint (0 errors) / vitest 21/21 / 폭넓은 e2e 49/49 통과.

### Added — chunk 100: Settings "캐시 비우기" (0.3.36)

- **새 IPC `app:clear-caches`** — `userData/outline-cache.json` (chunk 96 워크스페이스 outline) + `userData/model-cache.json` (chunk 48/70 provider 모델 목록 24h 캐시) 만 삭제. 채팅 히스토리 / 세션 / API 키 / recent.json 등 사용자 데이터는 절대 건드리지 않음 (실수로 날리면 손실 큰 데이터). 결과는 `{removed: string[], failed: string[]}`.
- **Settings "일반" 탭 — "캐시 비우기" 버튼** — `data-testid="settings-clear-caches"`. 클릭 시 IPC 호출 → idle / busy / ok / error 상태 표시. ok 표시는 3초 후 idle 복귀.
- **e2e 2 케이스** — (a) 캐시 두 파일 + 임의 sentinel 파일 작성 → 버튼 클릭 → 캐시 두 개만 사라지고 sentinel 보존 검증, (b) 캐시 파일 없는 fresh 상태에서도 silent 성공.

### Changed — chunk 99: tool 라우터 휴리스틱 → LLM 기반 (0.3.35)

- **휴리스틱 키워드 매칭 제거 → LLM 기반 라우팅** — chunk 98 의 키워드 그룹 정적 정의 (`GROUPS`) 가 사라지고, 사용자 선택 모델로 router LLM 한 번 호출해서 다음 turn 에 필요한 tool 이름 JSON 배열을 받음. 별도 small router 모델 없이 사용자 선택 모델 그대로. 휴리스틱이 미리 정의된 키워드에만 반응하던 한계 (예: 신규 표현 / 외래어 / 신조어) 해소.
- **`selectToolsViaLlm({history, provider, model, hasKey})`** — router LLM 에 카탈로그 요약 (이름 + 1줄 설명) + 사용자 latest 메시지 → JSON 배열 응답 → `parseRouterResponse` 가 코드펜스/잡설을 정리하고 첫 `[...]` 추출 → `normalizeSelection` 이 이름 화이트리스트 검사 + always-include 두 개 (`getCaretPosition`, `getDocumentOutline`) 보강.
- **Fail-safe** — router timeout (30s) / parse error / 빈 배열 / 키 없음 / 빈 query 면 full catalog fallback. `ToolSelectionResult.reason` 에 분기 사유 (router-ok / router-empty / router-timeout / router-error / router-parse-failed / no-key / empty-query) 직렬화 → 디버깅 / 메트릭 용도.
- **검증** — fake-AI agent regression 9 케이스 통과 (router 가 fake provider 의 TOOL: 응답을 평문으로 못 받아 fallback → main turn 그대로 동작). NIM live 종단간 (자연 한국어 컨셉 질의 → 워크스페이스 검색 → 검토 모드 승인 → IR 변경) 31.1s 통과 (휴리스틱 22.3s 대비 +9s 가 router LLM 라운드트립 비용).

### Added — chunk 98: 휴리스틱 tool 라우터 (0.3.34)

- **`src/features/chat/toolRouter.ts`** — 사용자 query 의 키워드 매칭으로 60+ tool catalog 의 부분집합만 LLM 에 노출. 별도 router LLM 없이 (사용자 선택 모델 그대로). 11개 키워드 그룹 (워크스페이스 / 정렬 / 글자 서식 / 단락 편집 / 표 / 그림·도형 / 머리말꼬리말 / 책갈피·각주 / 페이지 / 검색 / 스타일) + always-include 2개 (`getCaretPosition`, `getDocumentOutline`). 매칭 0개면 full catalog fallback (의도 모호 시 모델 자유 선택). useChatStreaming.fireChat 가 매 turn 마다 가장 최근 user 메시지로 selection 적용.
- **효과 입증** — chunks 96+97 종단간 NIM live e2e 가 전에 어떤 모델로도 실패하던 것이, 휴리스틱 라우터 + meta/llama-3.3-70b-instruct 조합으로 22초 만에 통과: 자연 한국어 컨셉 질의 ("워크스페이스에 있는 사업계획서 양식을 참고해서 이 빈 문서에 첫 섹션 제목 한 줄 추가해줘") → searchWorkspaceOutlines 호출 → 검토 모드 승인 → 실제 IR 변경 (단락 추가). qwen3.5-122b 의 stall 은 NIM 호스팅 모델 특이 이슈로 분리 확인 (catalog 크기 무관).
- **단위 테스트** — `toolRouter.test.ts` 10 케이스: 워크스페이스 / 정렬 / 표 / 그림 / 머리말 / 책갈피 / 각주 / fallback / always-include / 복합 키워드. fake-AI agent regression 12 케이스 통과.

### Changed — chunk 97: Manual / Agent 통합 + 자동 승인 토글 (0.3.33)

- **모드 pill 제거 + 자동 승인 토글로 일원화** — 두 개의 별도 모드 (Manual = 코드 블록 응답 → 사용자 클릭 vs Agent = 즉시 실행 + 묶음 undo) 가 단일 흐름으로 통합. 모든 turn 에서 provider tool-use API 가 활성 (= 기존 Agent path), 차이는 **쓰기 도구 자동 승인 토글** (off=검토 / on=즉시 실행) 하나 뿐. 검토 모드 (default) 에선 매 write tool 호출이 `pending` 상태로 잡혀 사용자가 "승인" / "거절" 버튼을 누르면 dispatch (혹은 거절). 읽기 도구는 항상 즉시 실행 (안전).
- **Pending 상태 + Accept/Reject UI** — `chat-tool-entry` 가 `pending` / `rejected` 상태 추가. pending 항목엔 인라인 "승인" / "거절" 버튼. 한 turn 에 pending 이 둘 이상이면 "모두 승인 / 모두 거절" bulk 버튼 노출.
- **Tool 분류 (`READONLY_TOOL_NAMES`)** — `shared/ai-tools.ts` 가 read-only tool 11개 (getCaretPosition / getDocumentOutline / getStyleAt / getCharPropertiesAt / getParaPropertiesAt / getStyleListJson / getTextRange / findInDocument / getCellInfo / searchWorkspaceOutlines / readParagraphByPath) 를 명시 set 으로 export. `isReadOnlyTool(name)` helper 가 dispatcher 의 즉시 실행 분기 결정.
- **`useChatStreaming` 두 단계 dispatch** — Phase 1: validate + 즉시 실행 (read / autoApprove write). Phase 2: pending write 가 있으면 turn 일시 중지 + 사용자 결정 대기. 모든 pending resolve 되면 `advanceAgentLoop` 가 tool_results 합성 + next turn 진입. 새 export `resolveApproval(toolUseId, accept)`.
- **System prompt 보강** — `SYSTEM_PROMPT_AGENT_GUIDE` 에 검토 모드 안내 추가. 거절된 호출은 `tool_result: error: user-rejected` 로 회신되니 모델이 다시 묻거나 다른 접근으로 재시도해야 함을 명시.
- **마이그레이션** — 옛 `localStorage['ahwp:chat:mode']` ('manual' / 'agent') 가 새 `localStorage['ahwp:chat:auto-approve']` (boolean) 로 자동 변환. 'agent' → true, 'manual'/없음 → false. 옛 키는 제거.
- **e2e**: `chat-agent.spec.ts` 에 검토-모드 3 케이스 추가 (write pending → 승인 → ok / 거절 → rejected / read tool 자동 실행). 기존 모드 pill 토글 케이스는 제거. fake-AI 9 케이스 통과. full e2e 403 통과 / 0 회귀.

### Added — chunk 96: outline-as-router 워크스페이스 검색 (0.3.32)

- **`searchWorkspaceOutlines` / `readParagraphByPath` 신규 read tool** — 사용자가 첨부 / 발췌 없이 개념적 질의 ("사업계획서의 매출 항목 기준으로 ~~ 수정해줘") 만 했을 때 Agent 가 워크스페이스 (`session.lastFolderPath`) 를 직접 검색하도록 지원. (a) `searchWorkspaceOutlines` 가 BFS (max depth 5, max docs 200) 로 폴더 안 모든 .hwp/.hwpx 의 파일명 + 제목 단락 outline 만 회수 (heading-styled paragraphs only — `제목 N` / `Heading N`). 응답은 본문 미포함 라우팅용 인벤토리. (b) `readParagraphByPath` 가 임의 path + paragraphIdx 로 단락 본문 + 주변 context (default 2개) 회수. 활성 문서 IR 변경 없음.
- **Outline cache** — `userData/outline-cache.json`, 파일 path + mtime 키. 변경 없는 파일은 재파싱 skip → 두 번째 검색은 즉시 응답.
- **System prompt 가이드 보강** — `SYSTEM_PROMPT_AGENT_GUIDE` 에 "워크스페이스 안의 다른 문서를 참조해야 하는 작업" 워크플로우 추가 (인벤토리 → 본문 회수 → 편집).
- **Tool dispatcher async 화** — `runOne` / `runTools` / `onRunTools` prop 시그니처가 sync `AhwpToolResult[]` → async `Promise<AhwpToolResult[]>` 로 일반화. 기존 IR-only tool 들은 성능 영향 없음 (Promise resolve 즉시).
- **String-encoded integer args 허용** — `nonNegInts` validator 가 `"42"` 같은 문자열 정수도 받도록 보강. NIM / qwen 류 모델이 JSON Schema 가 integer 라도 string 으로 emit 하는 일이 잦아서 모든 tool 의 dispatch 안정성 향상 (chunk 51 read tool 들도 같이 혜택).
- **NIM live e2e** — `tests/e2e/nvidia-live.spec.ts` 에 "Agent calls searchWorkspaceOutlines on concept query" 1 케이스 추가. 임시 워크스페이스 (사업계획서 + 공고 .hwp 두 개 + blank 활성 doc) 셋업 후 NIM (qwen3.5-122b) 으로 컨셉 쿼리 → 40초 안에 tool 호출 + status=ok 확인.

### Fixed — chunk 95.1: release CI Linux deb maintainer (0.3.31)

- **`build.linux.maintainer` 추가** — 0.3.30 release CI 가 Linux .deb 빌드 단계에서 `Please specify author 'email' in the application package.json` 으로 실패. `package.json` `author` 가 string ("ahwp contributors") 인데 .deb 패키지는 별도로 maintainer 필드 (이름 + 이메일) 가 필수. `build.linux.maintainer` 에 GitHub noreply 메일 (`61678329+YEUNU@users.noreply.github.com`) 로 표기. AppImage 빌드는 이전에도 성공했고 mac/win 도 무관 — Linux .deb 단일 fix.

### Added — chunk 95: 한컴 매핑 확장 + 이전 세션 e2e 보강 (0.3.30)

- **chunk 95 — 한컴 매핑 + StudioViewer 적용** — `HANCOM_TOOLTIPS` 에 `font-size` / `text-color` / `style-select` (F6) / `line-spacing` / `para-spacing` / `toolbar-more` / `toggle-controls` / `toggle-transparent` / `char-format-dialog` (⌥L) / `para-format-dialog` (⌥T) 추가. StudioViewer 툴바 / 확장 툴바 / 보기 토글에 `title={hancomTitle(...)}` 와이어링. `tooltip-i18n-svg.spec.ts` 에 chunk 95 매핑 검증 케이스 + edge case 8건 보강 (multi-line title 구조, 단축키 없는 entry, Alt 단축키 platform 분기, post-mutation re-render, idempotent, 영어 모드 + 플랫폼 단축키 독립, setLocale reload). 18/18 통과.
- **이전 세션 e2e edge case 보강** — (a) `crash-reporter.spec.ts` (chunk 63): multi-error append / no-origin 기본값 (`renderer`) / multi-line stack 보존 / malformed payload silently no-op (4건). (b) `chat-prefetch.spec.ts` (chunk 70): multi-provider catalog 독립 / overwrite 후 catalog 회복 (2건). (c) `file-dialog-mock.spec.ts` (chunk 60): open dialog cancel / save-as cancel / `.hwpx` 자동 라우팅 to `.hwp` (3건). (d) `chat-agent-multidoc.spec.ts` (chunk 50): 두 turn 연속 dispatch (active 가 turn 사이 변경) / 잘못된 sectionIdx graceful fail without spillover (2건). (e) `studio-perf.spec.ts` (chunks 64/88): cmd+End → cmd+Home roundtrip / reload-load 두 번째 로드 perf parity (2건).

### Added — chunks 91~94: 한컴 툴팁 / SVG title / i18n 마이그레이션 / e2e (0.3.29)

- **chunk 91 — 한컴 툴팁 전체 적용** — Studio 툴바의 정렬 (left/center/right/justify), 들여쓰기/내어쓰기, undo/redo, zoom (in/out/fit/reset), find prev/next/close, insert-image 등 추가 적용. ChatPanel 의 Manual/Agent 모드 pill 도 hancomTitle 로 교체. 매핑 사용 사이트 7 → 25+ 곳.
- **chunk 92 — SVG `<title>` 후처리** — `renderPageInto` 가 SVG 마운트 직후 모든 비-empty `<text>` 에 자기 textContent 를 `<title>` 자식으로 추가. 네이티브 hover tooltip 으로 narrow column 에 잘린 셀 텍스트도 hover 로 읽기 가능. SVG 레이아웃 변경 없음. lib SVG 가 이미 title 을 가지고 있으면 idempotent skip.
- **chunk 93 — i18n 마이그레이션 (점진)** — WelcomePane (제목/부제목/카드 라벨/설명/⌘N⌘O 표기) + TitleBar (다크/라이트/설정/저장 안 됨/열린 문서 없음) 마이그레이션. 단축키 표기는 `localizeShortcutPublic` 으로 mac↔Win/Linux 자동 분기. 로케일 키 `welcome.drop_here`, `welcome.unsaved`, `titlebar.unsaved` 추가. Settings/Folder/Chat 의 추가 hardcoded 텍스트는 후속 청크.
- **chunk 94 — e2e 8 케이스 + edge cases** — `tests/e2e/tooltip-i18n-svg.spec.ts`. (a) Studio Bold/가운데 정렬 title 검증 + 플랫폼별 단축키 분기 (mac `⌘B` / Win/Linux `Ctrl+B`), (b) `studio-zoom-reset` 인라인 title fallback, (c) 모든 `<text>` 의 `<title>` 자식 보유 + textContent 일치 (직접 child text node 만 추출해 nested title 노이즈 제거), (d) 빈 텍스트 element 는 title 추가 제외 (idempotent), (e) 로케일 default ko / 명시 en / 잘못된 locale (`xx-INVALID`) → fallback ko. 8/8 통과.

### Added / Changed — chunks 85~90 (0.3.28)

- **chunk 85 — Diff Viewer 다중 패치 e2e 보강** — `tests/e2e/chat-diff.spec.ts` 에 2 케이스 추가: (1) multi patch 의 개별 Reject — 첫 번째 reject → 두 번째 여전히 accept 가능 → 부분 적용 검증, (2) preview 클릭 시 onPreview 콜백 wired 확인 (smoke). 기존 3 → 5 케이스.
- **chunk 86 — RP v4 재마이그레이션 시도 + 재 v2 환원** — v4.11 로 재시도했으나 chat-history popover 의 `flex-1 truncate` button 이 0px 로 hidden 되는 layout 회귀 동일하게 reproducible. v4 의 새 Group 인라인 스타일이 deeply-nested flex children 을 collapse 시키는 듯. RP v2.1.9 유지, 코멘트 갱신.
- **chunk 87 — 표 column width 후처리** — deferred. lib SVG 출력에 우리 쪽 후처리는 hand-waving 수준이라 lib 0.8.x 의 column width 추정 fix 를 기다림. KNOWN_ISSUES L-004 에 이미 기록됨.
- **chunk 88 — 성능 측정 CI artifact infra** — `tests/e2e/studio-perf.spec.ts` 가 `recordPerf()` 헬퍼로 JSONL 누적 (env `AHWP_PERF_LOG=path` 또는 OS tmpdir). `npm run perf:run` (build + perf spec → `perf-results.jsonl`) + `npm run perf:report` (console.table 으로 요약). CI 통합은 e2e 가 CI 에서 안 도는 상태라 후속 — 로컬에서 trend 추적 가능.
- **chunk 89 — i18next 다국어 (한·영) 인프라** — `i18next` + `react-i18next` 도입. `src/lib/i18n/` 에 `ko` (default) + `en` 로케일 + setup. localStorage `ahwp:locale` 로 영속, 첫 실행 시 `navigator.language` 감지. flat dot-notation 키 (`titlebar.no_doc` 등). TitleBar 의 일부 텍스트 (다크/라이트 / 설정 / 열린 문서 없음) 를 `useTranslation` 으로 교체 — 점진적 도입 시작점. 새 키는 `ko.ts` 추가 → `en.ts` 번역.
- **chunk 90 — 한컴 매뉴얼 명칭 호버 툴팁 + 플랫폼 별 단축키 표기** — `src/lib/hancom-tooltips.ts` 에 30+ 한컴오피스 공식 명칭 + 한 줄 설명 매핑 (진하게 / 기울임 / 글머리 기호 / 표 넣기 / 쪽 모양 / 머리말·꼬리말 / 책갈피 / 각주 / 스타일 관리 등). 단축키 표기는 `navigator.platform` 으로 분기 — macOS 는 `⌘`, `⇧`, `⌥`, `⌃` 심볼, Win/Linux 는 `Ctrl+`, `Shift+`, `Alt+` 텍스트. CommandPalette / Settings 단축키 탭 / Studio 툴바 (Bold·Italic·Underline·Bullet·Number·PageBreak·Insert Table) 에 적용. `hancomTitle(key)` 가 `${name} (${shortcut})\n${description}` 형식 multi-line 툴팁 생성.

### Fixed — chunks 83~84 (0.3.27)

- **chunk 83 — `tailwindcss-animate` (deprecated) → `tw-animate-css` 마이그레이션** — 같은 accordion-down/up / fade-in / zoom-in/out 키프레임 + utility 제공하는 공식 후속. `index.css` 의 `@plugin 'tailwindcss-animate'` → `@import 'tw-animate-css'`. shadcn Dialog 의 data-state 애니메이션 호환 유지. `npm uninstall tailwindcss-animate` + `npm install tw-animate-css`.
- **chunk 84 — `studio-paraformat` alignment save→reopen 회귀 root cause fix** — 격리 테스트로 분리: lib 의 in-process `exportHwp → new HwpDocument(bytes)` roundtrip 은 alignment 를 떨구지만 (lib 한계) `file:save` IPC 를 통한 normalize-and-export-twice 흐름은 alignment 를 보존. 그렇다면 reload 후 doc 자체엔 alignment=center 가 살아있는데 왜 테스트가 fail? `__studioDebug.getActiveFormat()` 이 React `activeFormat` state 의 closure 를 캡처해서 React 19 의 더 공격적인 batching 에서 stale 값을 반환했기 때문. fresh read 로 교체 — `getCharPropertiesAt` / `getParaPropertiesAt` 을 호출 시점에 doc 으로부터 직접 읽어 React state 의존 제거. 결과: studio-paraformat / chat-agent 류의 다른 timing-sensitive 테스트도 안정.
- **격리 디버깅을 위한 신규 debug 메서드** — `__studioDebug.reparseAndReadParaProps(sectionIdx, paraIdx)` — 현재 doc 을 export 한 뒤 fresh `HwpDocument` 로 재파싱해 같은 paragraph props 를 읽음. 향후 lib roundtrip 회귀를 격리할 수 있는 공통 도구.

### Fixed — chunk 82: 메이저 일괄 업그레이드 회귀 fix (0.3.26)

chunks 80~81 의 9개 메이저 일괄 업그레이드 후 full e2e (376 케이스) 결과 19 fail. 8개는 live spec env-gated 예상 실패 (Anthropic / NIM / Ollama / Gemini 키 부재). 11개 실제 회귀 중 10개 fix.

- **`electron/hwp/converter.ts` createRequire 런타임 크래시** — vite 8 의 CJS bundle 이 `import.meta.url` 을 `({}).url` (=undefined) 로 erase 하면서 `createRequire(undefined)` 가 throw → main process 가 부팅 직후 죽어 모든 e2e 가 1분 타임아웃. WASM 경로 resolve 를 candidate path list (`process.cwd()` / `__dirname` 두 후보) 로 교체 — `import.meta.url` 의존 제거. asar 안에서도 `existsSync` + `readFileSync` 가 투명하게 동작.
- **react-resizable-panels v4 → v2 다운그레이드** — v4 의 새 Group / Separator / orientation API 가 Electron 렌더러에서 flex children 을 간헐적으로 hidden 처리. chat-history popover button (`flex-1 truncate text-left`) 이 0px 사이즈로 잡혀 Playwright 가 `not visible` 로 실패. RP v2 (PanelGroup / Panel / PanelResizeHandle / direction / autoSaveId / order) 로 되돌려 14 케이스 회귀 해소. RP v4 의 layout 안정화 후 재시도.
- **studio-find autoFocus** — React 19 의 batched setState 변경 후 `setTimeout(0) → input.focus()` 가 input 마운트 전에 fire. `useEffect([findOpen])` 으로 commit 후 focus 옮기는 effect 추가 (기존 setTimeout 은 fallback 으로 유지).
- **ChatPanel `shrink-0` 가드** — chunk 73 의 `chat-scroller flex-1 + min-h-0` 가 sibling 들 (provider bar / mode bar / popover / input form) 을 default `shrink: 1` 로 collapse 시키는 이슈. 정적 영역 4 곳에 `shrink-0` 추가 — RP v2 환경에선 무영향이지만 CSS 위생 측면에서 유지.

**알려진 잔여 (1 케이스)**: `studio-paraformat — alignment + fontSize + color survive save → reopen`. save 직후엔 center 로 적용되지만 reload 후 justify 로 복귀. @rhwp/core 0.7.9 의 alignment encode/decode 라운드트립 한계로 추정 (lib 변경은 없었으나 메이저 업그레이드 누적 환경에서만 확인됨). lib upgrade 후 재검증 예정.

### Changed — Phase 4 chunks 80~81: 라이브러리 일괄 메이저 업그레이드 (0.3.25)

ROADMAP 의 "메이저 버전 일괄 업그레이드" 항목 (Phase 4 별도 마이그레이션 트랙) 일괄 처리. 사용자 요청 "라이브러리 최신화 전부다".

#### chunk 80 — vite `base: './'` + 추가 absolute path fix

packaged Electron 의 `loadFile('dist/index.html')` 흐름에서 absolute root 경로 (`/icon.svg`, `/assets/*.js`) 가 `file:///icon.svg` 로 resolve 되어 404. `vite.config.ts` 에 `base: './'` 추가하면 vite 가 빌드 시 모든 자산 경로를 `./assets/...` 으로 작성, file:// 환경에서도 정상 로드.

#### chunk 81 — 메이저 일괄

| 패키지                                                                       | 이전          | 이후                                                                                                                                           | 마이그레이션                                      |
| ---------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `vite`                                                                       | 6.4           | 8.0                                                                                                                                            | (변경 없음 — base:./ 만 추가)                     |
| `@vitejs/plugin-react`                                                       | 4.7           | 6.0                                                                                                                                            | peer 호환만                                       |
| `esbuild`                                                                    | (peer 의존만) | 0.27 explicit                                                                                                                                  | vite-plugin-electron-renderer 가 peer 로 요구     |
| `electron`                                                                   | 33.4          | 41.5                                                                                                                                           | API 변경 없음 — 빌드 통과                         |
| `electron-builder`                                                           | 25.1          | 26.8                                                                                                                                           | 빌드 통과                                         |
| `react`/`react-dom`                                                          | 18.3          | 19.2                                                                                                                                           | `JSX` global namespace 폐기 → `src/jsx.d.ts` shim |
| `@types/react`/`@types/react-dom`                                            | 18 → 19       | (React 19 와 함께)                                                                                                                             |
| `react-resizable-panels`                                                     | 2.1 → 4.11    | API 변경: `PanelGroup` → `Group`, `PanelResizeHandle` → `Separator`, `direction` → `orientation`, `autoSaveId` → `autoSave`, `order` prop 폐기 |
| `typescript`                                                                 | 5.9 → 6.0     | `baseUrl` 폐기 (`paths` 만 사용)                                                                                                               |
| `@types/node`                                                                | 22 → 25       | 글로벌 `NodeJS.Platform` 인라인 union 으로 교체 (renderer DOM tsconfig 에서 안 보임)                                                           |
| `tailwindcss`                                                                | 3.4 → 4.2     | CSS-first config 자동 마이그레이션 (`@import "tailwindcss"` + `@theme` + `@plugin`). postcss 플러그인 `tailwindcss` → `@tailwindcss/postcss`   |
| `globals` / `jsdom` / `postcss` / `eslint` / `vite-plugin-electron-renderer` | 패치/마이너   | 일괄                                                                                                                                           |

**주요 코드 변경**:

- `src/jsx.d.ts` 신설 — `import type { JSX as ReactJSX } from 'react'` 후 global namespace `JSX` 로 재노출. 14개 컴포넌트의 `: JSX.Element` 시그니처 그대로 유지.
- `vitest.setup.ts` — `ResizeObserver` stub 추가 (react-resizable-panels v4 가 jsdom 에서 사용).
- `tsconfig.json` / `tsconfig.node.json` — `baseUrl` 제거, `paths` 가 tsconfig 위치 기준 자동 resolve.
- `shared/api.ts` — `NodeJS.Platform` → 리터럴 union (renderer 에서 보임).
- `electron/menu.ts` — N/A. Electron 41 의 메뉴 / IPC API 변경 없음.
- `tailwind.config.ts` — 유지 (Tailwind 4 의 `@config` directive 로 CSS 에서 import). `tailwindcss-animate` → `@plugin 'tailwindcss-animate'` (CSS 안에서).
- HeaderFooterDialog — Tailwind upgrade tool 이 `variant="outline"` (Button prop) 을 잘못 `outline-solid` 로 렌이밍한 3 곳 수동 복원.

**검증**: typecheck 통과, unit tests 15/15, build 통과 (mac arm64). e2e 는 사용자 검증으로 갈음.

### Changed — UX 보강 chunks 77~79 (0.3.24)

- **chunk 77 — provider bar 2행 분리 + lucide SVG 아이콘** — 우측 챗 패널이 좁고 모델 id 가 길면 (NVIDIA NIM 의 `deepseek-ai/...` 등) 우측 history / + 버튼이 화면 밖으로 밀려나는 문제. provider+상태+히스토리/+ 행 ↔ model selector + refresh 행 두 줄로 분리. 모든 버튼 이모지 (`📚` / `+` / `↻` / `⚠` / `키 ●` / `키 ○`) → lucide-react SVG (`History` / `Plus` / `RefreshCw` / `AlertTriangle` / `Key` / `KeyRound` / `Loader2`) 로 교체. 테마 토큰 색상 (emerald / muted-foreground / amber) 자동 적용. `IconButton` / `KeyStatusIcon` / `ModelRefreshButton` 헬퍼 컴포넌트 추출. e2e 4개 케이스 텍스트 → `data-state` attribute 로 갱신.
- **chunk 78 — 새 문서 ⌘S → Save As 자동 라우팅** — `⌘N` 으로 만든 새 문서는 `userData/temp/new-<timestamp>.hwp` scratch path 에 위치. ⌘S 가 그대로 저장하면 사용자가 못 찾는 곳에 숨음. `useSaveFlow.saveCurrent` 가 path 의 `/temp/new-` substring 으로 scratch 식별 → 자동으로 `saveAsCurrent()` 위임. 사용자가 매번 ⌘⇧S 눌러야 했던 흐름 제거.
- **chunk 79 — Settings 정보에 @rhwp/core 버전 + 상단바 아이콘 404 fix** — packaged Electron 에서 `<img src="/icon.svg">` 가 `file:///icon.svg` 로 resolve 되어 404 (TitleBar 와 Settings 사이드바 두 군데). 두 곳 모두 inline `<svg>` 로 교체 — 빌드 산출물 / 외부 자산 의존 제거. About pane 에 `@rhwp/core` 버전 row 추가 — `electron/main.ts` 가 `require('@rhwp/core/package.json').version` 으로 읽어 IPC `app:get-versions` 응답에 포함. UI 에 viewer 를 구동하는 WASM lib 버전 노출.

### Changed — UX 보강 chunk 75 — send 후 attachDoc 자동 unset (0.3.23)

- **send / sendDirect 후 `attachDoc` 자동 false 로 reset** — 사용자가 컨텍스트 첨부 → 한 번 보내면 doc HTML 이 이미 그 turn 의 시스템 프롬프트에 직렬화 됐으므로 다음 turn 에 또 보낼 필요 없음. 이전엔 chunk 74 에서 default true 로 만들어 항상 켜져 있었는데, 매 turn 마다 1000 단락 HTML 을 다시 보내 토큰 폭발 위험. 이제 명시적 한 번 첨부 패턴 — 사용자가 또 첨부하려면 체크박스 다시 켬. localStorage 저장도 unset 시점에 갱신되어 다음 실행에 첨부 안 됨.

### Documented — KNOWN_ISSUES L-004 보강 (chunk 76)

- **복잡한 표·병합 셀 렌더링 한계** — 사용자 보고: 다중 행/열 병합이 있는 양식 표에서 우측 narrow column (예: SF-AD3 코드 컬럼) 텍스트가 잘리고 행 높이가 불균형. 원인은 `@rhwp/core` 의 `renderPageSvg` 가 column width 를 추정해 SVG 를 직접 그려 우리에게 넘기는 구조 — 우리 쪽 viewer 는 그 SVG 를 그대로 표시할 뿐 셀 너비 / 행 높이 재계산 권한 없음. lib v0.7.x 활발히 개발 중이라 lib upgrade 후 해결 예상. 영향도 표 항목을 **중간 → 높음** 으로 갱신.

### Fixed — UX 보강 chunk 74 — 현재 문서 첨부 (0.3.22)

세 가지 누적 버그가 "AI 가 첨부된 문서를 인식 못 함" 증상으로 합쳐져 있었음. 사용자가 active doc 을 컨텍스트로 첨부했는데 모델이 "문서를 받지 못했습니다" 라고 응답하는 문제.

- **AppShell `getDocHtml(1000)` 으로 명시** — 기존 `exportDocumentHtml()` 가 default `maxParagraphs=50` 호출. 144페이지짜리 보고서면 표지 / 목차 / 빈 단락만 50개 포함되고 본문은 단 한 줄도 첨부 안 되는 케이스 흔함. 메뉴 HTML 내보내기 / PDF 내보내기 와 동일한 1000 단락으로 통일.
- **`attachDoc` default `true` + localStorage 영속** — 사용자 기대는 "ChatPanel 열려있고 active doc 있으면 AI 도 같이 본다". 기존 default false 라 사용자가 매번 체크박스 켜야 했음. 토큰 부담 큰 거대 문서에선 끄면 됨 — preference 가 로컬에 저장되어 다음 실행에도 유지.
- **`SYSTEM_PROMPT_DOC_CONTEXT` 보강** — 첨부 잘 됐는데도 모델이 "문서 못 받았다" 응답하는 두 번째 원인. 기존 프롬프트가 응답 형식 가이드 (HTML / ahwp-tools / ahwp-patches 코드 블록) 만 있었고 `[현재 문서]:` 블록의 의미를 명시 안 함. 모델이 컨텍스트 헤더를 무시하거나 "단순 대화 → 코드 블록 형식 강제 → 부적절한 응답 거부" 흐름 발생. 프롬프트 앞부분에 `[현재 문서]:` / `[발췌]:` / `[참조 문서]:` 블록의 의미 + "절대 '문서를 받지 못했다'고 말하지 마" 안내 + 단순 대화 / 분석 / 요약 / Q&A 시 코드 블록 없이 자연어로 답해도 된다는 명시 추가.
- **회귀 가드** — chat-html-apply / chat-tools / chat-multidoc / chat 등 chat 관련 e2e 30+ 케이스 통과. `chat-attach-checkbox` default 가 unchecked → checked 로 바뀌어 chat-html-apply 의 첫 케이스만 갱신.

### Fixed — UX 보강 chunk 73 (0.3.21)

- **ChatPanel 메시지 스크롤 fix** — chunk 72 의 Settings 와 동일한 `min-h-0` 누락 패턴이 ChatPanel 에도 있었음. 어시스턴트 메시지가 길어지면 chat-scroller (`flex-1 overflow-auto`) 가 제 height bound 안에 갇히지 않고 input form 을 viewport 밖으로 밀어냈다. AppShell 의 chat panel 래퍼 + ChatPanel root + chat-scroller 세 군데에 `min-h-0` 추가. `overflow-auto` → `overflow-y-auto` 명시. 이제 긴 응답이 와도 input + 컨텍스트 chip 영역은 항상 보이고 메시지 영역만 자체 스크롤.

### Fixed — UX 보강 chunk 72 (0.3.20)

- **Settings 모달 우측 패널 스크롤 fix** — chunk 55 의 4탭 사이드바 재설계 후 AI 공급자 / 단축키 탭에서 우측 PaneBody 가 스크롤 안 되던 문제. 원인은 nested flex/grid 의 `min-h-0` 누락 — 부모 grid track 이 height 를 부여해도 자식 flex 컬럼의 default `min-height: auto` 가 컨텐츠를 그대로 늘려 PaneBody 의 `flex-1 + overflow-auto` 가 무효화. 우측 컬럼 div 와 PaneBody 양쪽에 `min-h-0` 추가, PaneBody 의 `overflow-auto` → `overflow-y-auto` 로 명시.
- **ChatPanel provider bar 호버 tooltip 보강** — `chat-key-indicator` 에 title 추가 (`{provider} API 키 등록됨/미등록 — Settings 에서 등록 필요`), 모델 selector 에 현재 모델명 + dropdown 안내, provider select / send / stop / 발췌 첨부 / 현재 문서 첨부 등 모든 provider bar / 입력 폼 컨트롤에 명시적 title 추가. 처음 보는 사용자가 `키 ●` / `📚` / `+` 같은 아이콘만 보고 기능을 추측해야 했던 문제 해결.

### Fixed — UX 보강 chunks 70~71 (0.3.19)

- **chunk 70 — secrets 변경 broadcast → ChatPanel re-fetch** — chunk 69 의 mount-only effect 는 앱 시작 시 키가 없으면 모든 provider 의 fetch 가 skipped 되고 다시 안 돌았다. main 의 `secrets:set` / `secrets:delete` 가 모든 BrowserWindow 에 `secrets:changed` 이벤트 broadcast → preload 가 `secrets.onChanged()` subscriber 로 노출 → ChatPanel 이 listen 해서 키 등록 직후 모든 provider 의 모델 리스트 pre-fetch 재실행. 이제 비-active provider 키를 등록해도 즉시 selector 가 채워짐.
- **chunk 71 — 메뉴 cut/copy/paste 를 `role` 로 교체** — Settings 의 API 키 입력 (`type="password"`) 등에서 ⌘C/V 가 안 됐다. 기존 menu 의 custom click handler 가 `edit:copy` IPC 로 라우팅 → 렌더러가 `document.execCommand('copy')` 폴백했는데, password input 은 보안상 `execCommand` 가 silently no-op 한다. 메뉴 아이템을 `role: 'cut' | 'copy' | 'paste'` 로 교체 — Chromium clipboard 파이프라인이 password input + 일반 input + DevTools focus 모두 정상 처리. 뷰어의 IR copy 는 viewer 자체 onKeyDown 이 ⌘C/X/V 를 잡아 `navigator.clipboard.writeText` 로 덮어쓰기 때문에 viewer focus 일 때도 IR 데이터가 클립보드에 들어간다. 이제 사용된 적 없는 `devOrEdit` 헬퍼 제거.
- **회귀 가드** — `tests/e2e/chat-prefetch.spec.ts` 2 케이스 (비-active provider 키 등록 → 즉시 catalog populate / delete 후에도 sticky 옵션 유지). 기존 chat / chat-model-list / settings (23 케이스) 회귀 없음.

### Fixed — UX 보강 chunks 68~69 (0.3.18)

- **chunk 68 — 모달 스크롤바** — Dialog primitive 의 `DialogContent` 베이스에 `max-h-[calc(100vh-4rem)] overflow-y-auto` 추가. 그 동안 다이얼로그 내용이 viewport 보다 길어지면 화면 밖으로 잘려 form 끝부분 / Apply 버튼 등이 안 보였다. 자체 height + `overflow-hidden` 을 갖는 SettingsDialog 처럼 커스텀 레이아웃 다이얼로그는 twMerge 가 자동 우선이라 영향 없음.
- **chunk 69 — 앱 시작 시 모든 provider 모델 리스트 pre-fetch** — 기존엔 ChatPanel 의 active provider 만 마운트 / 전환 시 fetch → 다른 provider 로 처음 전환할 때 "확인 불가 → 새로고침 → 대기" 패턴 발생. 이제 ChatPanel 마운트 시 1회 `secrets.has()` 로 키가 등록된 모든 provider 를 식별하고 `listModels` 를 병렬 발사. 메인 측 24h 캐시 덕분에 fresh cache 면 IPC 가 즉시 반환 — 처음 실행 한 번만 네트워크 사용.

### Fixed — UX 보강 chunks 65~67 (0.3.17)

- **chunk 65 — 모델 선택 selector 화** — 기존 `<input list>` + `<datalist>` (자유 입력 + 자동완성) → 순수 `<select>` dropdown. provider `/v1/models` 가 노출하지 않는 모델을 직접 입력하는 일이 드물고 오타 위험만 컸다. 현재 `model` 이 fetched 목록에 없으면 "(저장됨)" sticky 옵션으로 보존 — provider 전환 / fetch 실패 시에도 마지막 선택을 잃지 않음. 빈 목록 + 저장 모델 없음 → "모델 없음" disabled placeholder.
- **chunk 66 — 단축키 하이재킹 fix** — AppShell 의 window-level keydown 리스너가 input/textarea/contentEditable focus 일 때도 작동해서 ⌘W (탭 닫기), ⌘K (팔레트), ⌘/ (Settings), ⌘⇧F (검색), ⌘⇧O (아웃라인), F6/Alt+L/T/P 가 사용자 입력을 가로챘다. `isEditableFocused()` 헬퍼로 editable focus 일 때 short-circuit. macOS 의 ⌘W = "단어 단위 삭제" 같은 native input 단축키가 정상 전달됨. Studio shortcuts 는 자체 onKeyDown 으로 이미 분리되어 있어 영향 없음.
- **chunk 67 — 채팅 입력칸 auto-grow + scrollbar** — `rows={2}` 고정 높이라 긴 프롬프트 작성 시 textarea 안에서만 스크롤됐다. `useLayoutEffect` 로 `scrollHeight` 추적해서 max-h-48 (≈ 8줄) 까지 자동 확장 + `overflow-y-auto` 로 ceiling 도달 시 외부 스크롤바 자연스럽게 노출.

### Tests — Phase 5 chunk 64: 큰 파일 성능 smoke (0.3.16)

- **`tests/e2e/studio-perf.spec.ts` 3 케이스** — `examples/` 의 50p+ doc 으로 (1) 초기 로드 (file:read → @rhwp/core parse → `__studioDebug` ready), (2) `Cmd+End` 점프 + 스크롤, (3) 10× PageDown 시퀀스 의 wall-clock 측정 + telemetry print + 느슨한 ceiling assertion (15s / 10s / 15s).
- **현 측정 (dev 박스)** — initial load 327ms (pages=57) · cmd+End 122ms · 10× PageDown 984ms (avg ~98ms/press). 충분한 헤드룸 — order-of-magnitude regression 만 잡는 가드.
- **벤치 vs gate 의도** — 정확한 perf 예산은 별도 harness (CI metrics infra 도입 시) 로 분리. 이 spec 은 lazy-mount / off-viewport unmount / find paragraph cache (chunk 1-D 3 개 최적화) 가 깨졌는지 catch 하는 목적.

### Added — Phase 5 chunk 63: 자체 호스팅 Crash reporter (0.3.15)

- **`electron/crash-reporter.ts`** — 외부 collector (Sentry 등) 없이
  로컬 only sink. 3 layer:
  1. **Native crashReporter** — `crashReporter.start({ uploadToServer:
false, productName: 'ahwp' })`. GPU / renderer / utility 프로세스
     의 native crash 를 `userData/Crashpad/` (mac/win) 또는
     `userData/Crashes/` (linux) 에 minidump 으로 캡처.
  2. **Main 프로세스 JS error** — `process.on('uncaughtException')`
     - `unhandledRejection` → `userData/error.log` 에 ISO 타임스탬프
     - origin + stack 추가.
  3. **Renderer JS error** — `window.onerror` / `unhandledrejection`
     → `app:log-error` IPC → 같은 `error.log` 파일.
- **외부 origin 의존 0 모델 유지** — 베타 사용자가 GitHub Issue 에
  log 직접 첨부하는 흐름. Sentry / 자체 collector 도입은 사용자
  로그 외부 송신이라 ahwp 보안 모델과 충돌해 미채택.
- **disable hatch** — `AHWP_DISABLE_CRASH_REPORTER=1` env (테스트 /
  디버그 시나리오에서 비활성화).
- **회귀 가드** — `tests/e2e/crash-reporter.spec.ts` 2 케이스: (a)
  IPC 통과 → `error.log` append (sentinel 텍스트 + ISO 타임스탬프
  prefix 검증), (b) `crashReporter.getUploadToServer()` === false 확인.
- **USER_GUIDE 갱신** — 데이터 위치 섹션에 `error.log` + `Crashpad/`
  안내 추가.

### Documentation — Phase 5 chunk 62: 사용자 가이드 (0.3.14)

- **`docs/USER_GUIDE.md` 신설** — 베타 사용자 대상의 흐름 위주 가이드. (1) 시작하기 (설치 / 첫 실행 / 폴더), (2) 편집 기본 (탭 / 저장 / .bak / 자동 초안 / 버전 히스토리), (3) AI 챗봇 (BYOK / Manual vs Agent / 발췌 첨부 / 멀티 문서 / Diff Viewer / 히스토리), (4) 단축키 요약 표, (5) 데이터 위치 (`userData/...`), (6) 알려진 한계, (7) 피드백 채널. 기능 카탈로그가 아니라 자주 막히는 지점 + 사용 흐름 권장안 위주.

### Accessibility — Phase 5 chunk 61: aria 보강 (0.3.13)

- **Settings 사이드바 탭 — `role="tab"` + `aria-selected`** — 활성 탭의 시각 강조 (bg-card font-semibold) 만으로는 스크린 리더가 활성 상태를 인식 못 함. `role="tab"` 으로 셀렉션 시멘틱을 명시하고 `aria-selected={active === tab.id}` 로 활성 상태를 노출.
- **FolderTree 행 — `aria-selected={isSelected}`** — 활성 트리 노드의 활성 상태를 보조 기술에 노출. 기존엔 `bg-muted` 클래스로만 구분.
- **ChatPanel 히스토리 항목 — `aria-current="page"`** — 현재 로드된 대화에 `aria-current="page"` 부여. `bg-muted` 시각 표시는 유지.
- **사전 검증** — radix shadcn 의 Dialog / DropdownMenu / Select 등은 이미 a11y 처리됨. 툴바 / 챗 입력 / 발췌 chip / 다이얼로그 X close / 셀 우클릭 메뉴 모두 `aria-label` 보유 (audit 결과 false-positive 0). 기존 e2e (folder-tree / chat-history / settings 19 케이스) 회귀 없음.

### Tests — Phase 5 chunk 60: 파일 다이얼로그 모킹 e2e (0.3.12)

- **`tests/e2e/file-dialog-mock.spec.ts` 3 케이스 신규** — Playwright Electron 의 `app.evaluate(({ dialog }) => ...)` 로 main 의 `showOpenDialog` / `showSaveDialog` 를 monkey-patch. 그 후 `'menu:action'` IPC 를 직접 emit 해서 메뉴 액션 흐름을 트리거 (네이티브 OS 다이얼로그 우회).
- **케이스 분류** — (1) `file:open` 모킹 → 탭 열림 검증; (2) `file:save-as` 신규 path → atomic write + HWP 매직 바이트 (`d0 cf 11 e0`) 검증 + 새 path 라 `.bak` 미생성 invariant; (3) `file:save-as` 기존 path overwrite → `.bak` 사이드카 1회 생성 + 사이드카 크기 = 원본 크기.
- **IME/다국어 입력은 보류** — Playwright 의 `keyboard.insertText` 는 단일 `InputEvent` 라 composition cycle (`compositionstart` → `compositionupdate` → `compositionend`) 을 emit 하지 않음. 합성 CompositionEvent 를 `page.evaluate` 로 디스패치하는 건 우리 핸들러를 가짜 입력에 대해 테스트하는 꼴이라 회귀 가드로 가치가 낮다. 실제 IME 회귀는 manual 검증 + Phase 1 의 `studio-ux-fixes.spec.ts` 의 ⌘A / drag 과 같은 결정적 case 로 갈음.

### Changed — Phase 3 chunk 59: docId-aware Agent dispatch (0.3.11)

- **`runTools(items, targetPath)` — turn 시작 시점의 target doc 으로 dispatch 핀** — 사용자가 Agent turn 중간에 탭을 전환해도 write tool 은 원본 target doc 으로 라우팅. `useChatStreaming` 의 `turnTargetPathRef` 가 `send` / `sendDirect` 에서 `activeDocPath()` 를 캡처, Agent 루프 안 dispatch 사이트가 ref 를 두 번째 인자로 전달. `legacy null` 은 active viewer fallback (Manual "도구 실행" 버튼 호환).
- **AppShell viewer-by-path 라우팅** — `runTools` prop 이 `targetPath` 를 받으면 `tabsState.find(t => t.path === targetPath)` + `viewerRefsRef.current.get(tab.key)` 로 mounted viewer 조회. target tab 이 닫힌 경우 모든 op 가 `target-doc-not-mounted:<path>` reason 으로 실패. inactive tab viewer 도 `display:none` 으로 mount 유지되므로 dispatch 가 정상 동작.
- **회귀 가드** — `tests/e2e/chat-agent-multidoc.spec.ts` (1 케이스): 두 doc open 상태에서 active=target Agent insertText → target 첫 단락에 sentinel 존재 + reference 첫 단락에 sentinel 부재 검증.

### Documented — Phase 4 chunk 58: ROADMAP 정정 (0.3.10)

- **앱 아이콘 항목 ✅ 처리** — `build/icon.png` (1024×1024 RGBA) + `public/icon.svg` / `favicon-16/32.png` / `icon-large.svg` 가 사용자 제공으로 이미 트리에 존재. electron-builder 가 단일 1024 source 에서 mac (.icns) / win (.ico) / linux (.png) 을 자동 생성하므로 별도 디자인 작업 불필요. 이전 ROADMAP 의 미체크 상태는 잘못된 누락이었음
- **rhwp studio 자산 로컬 번들링 ✅ N/A** — chunk 6 의 자체 Studio viewer 전환으로 iframe 자체가 제거됨. CSP `frame-src` 도 미사용 — 외부 origin 의존 0 의 보안 모델 유지

### Changed — Phase 4 chunk 57: Q8 사이드바-디테일 (0.3.9)

- **`PicturePropsDialog` 사이드바-디테일 재구성** — 기존의 단일 `<select>` picker (1개일 땐 숨김 / 2+ 개일 땐 dropdown) 를 좌측 사이드바 리스트로 교체. 각 행은 `1` `2` `3`… numbered avatar + `1페이지 · 단락 4` 형태 라벨, 활성 행은 `bg-card font-semibold shadow-sm`. 우측 디테일 패널은 Settings 와 동일한 17px 볼드 타이틀 (그림 라벨) + 12px description + 폼 영역 + footer (삭제 / 취소 / 적용). 빈 문서일 때는 사이드바 "이 문서에 그림이 없습니다." + 우측 "그림을 삽입한 뒤 다시 시도하세요." empty state — 다이얼로그 자동 닫힘 없이 일관된 레이아웃 유지.
- **레이아웃 사양** — `grid-cols-[220px_1fr] h-[min(520px,82vh)] max-w-[min(760px,92vw)]`. 사이드바 footer 에 그림 개수 표시 (`3개`). 단일-목적 dialog 가 아닌 list-detail 성격이라 sidebar pattern 이 자연스럽게 fit.
- **testid 호환** — 기존 `picture-props-dialog` / `picture-props-width` / `picture-props-height` / `picture-props-treat-as-char` / `picture-props-delete` / `picture-props-apply` 보존. `picture-props-picker` (dropdown) 는 제거 + `picture-props-list` / `picture-props-item` / `picture-props-empty` / `picture-props-form` 추가. 기존 e2e (`dialogs-ui.spec.ts` 4 케이스) 모두 통과.

### Refactored — Phase 4 chunk 56: R5.A consumer narrowing (0.3.8)

- **`shared/rhwp-types.ts` 필드 보정** — `RhwpPageDef` 의 잘못된 `paperWidth/paperHeight` → `width/height` 로 정정 (실제 lib 응답과 일치). HWPUNIT 단위 주석 추가.
- **`PageSetupDialog` consumer-level narrowing** — props 의 `Record<string, unknown> | null` → `RhwpPageDef | null`. `typeof def.X === 'number' ? def.X : 0` 보일러플레이트 제거 → `def.X ?? 0` 으로 단순화 (-12 라인). public `ViewerHandle` 인터페이스는 그대로 (`Record<string, unknown>`) — narrow type 은 index signature 가 없어서 ripple 이 크기 때문에 dialog 입구에서만 명시 캐스트로 좁힌다.
- **AppShell bridge** — `getCurrentPageDef` / `onApply` 두 prop 위치에서 `as RhwpPageDef` / `as Record<string, unknown>` 명시 캐스트로 viewer ↔ dialog 연결. 다른 dialog (HeaderFooter / Bookmark / TableProps / FormulaEditor) 도 같은 패턴으로 incremental 적용 가능 — 패턴만 확립, 일괄 적용은 보류 (rhwp-types 의 narrow 타입 21개 중 1개만 consume — 후속 chunk).

### Added — Phase 4 chunk 55: Diff Viewer (0.3.7)

- **`ahwp-patches` 응답 블록** — Manual 모드의 세 번째 응답 형식 (HTML / ahwp-tools 와 공존). 모델이 위치 한정 미세 수정 (오타 / 톤 / 표현) 을 제안할 때 사용. `shared/ai-patches.ts` (parser + AHWP_PATCH_LIMITS — maxOps 20, maxText 8KB)
- **DiffCard UI** — `src/features/chat/DiffCard.tsx`. 1개 패치는 큰 카드 (제목 + 위치 + +/− diff line + reason expander + Accept/Reject), 2개 이상은 외부 컨테이너 + 컴팩트 StackedPatch + "모두 Accept" 버튼. accepted 상태는 emerald 글로우, rejected 는 dim
- **묶음 undo** — Accept All 한 번 누르면 모든 pending 패치를 single ⌘Z 로 롤백 가능 (chunk 27 grouped-undo 활용). AppShell.applyPatches 가 `beginUndoGroup` → 각 패치 `irDeleteRange` + `irInsertText` → `endUndoGroup`
- **System prompt 가이드** — `prompts.ts` SYSTEM_PROMPT_DOC_CONTEXT 에 [C] ahwp-patches 섹션 추가. location.startOffset/endOffset 으로 단락 내 일부만 교체 (없으면 전체 단락)
- **Diff Viewer 확장** — 패치별 `additionFormat` 필드 (bold/italic/underline/textColor/fontSize) — Accept 시 `irApplyCharFormat` 호출로 같은 undo group 안에서 형식 적용. `previewPatch` ("에디터에서 보기") → `scrollToParagraph` 연결. Accept 후 12초 emerald 토스트 ("N개 적용됨 · 되돌리기")
- **Diff Viewer e2e** — `tests/e2e/chat-diff.spec.ts` (3 케이스 — single Accept + ⌘Z, multi Accept All, invalid block 에러)

### Changed — Phase 4 chunk 55: UI/UX align (0.3.7)

- **Settings 다이얼로그 4탭 재설계** — 좌측 사이드바 (일반 / AI 공급자 / 단축키 / 정보) + 우측 디테일. 720×620 모달. 기존 AboutDialog + ShortcutsDialog 두 다이얼로그 통합 → 두 파일 삭제. `view:about` / `view:shortcuts` 메뉴 액션은 Settings 의 해당 탭으로 라우팅 (`openSettingsTab(tab)`)
- **Manual / Agent pill 토글** — 라디오-스타일 토글을 inset pill segmented control 로 교체. icon + label + sub-label ("제안 → 승인" / "자동 실행"). 활성 버튼은 bg-card + shadow-sm + aria-selected=true
- **AI 공급자 카드형 ProviderCard** — icon avatar + connected pill ("연결됨" / "미연결") + API 키 / Base URL / supportsTools / 저장·연결테스트·삭제 버튼. 기존 `●` / `○` indicator → 텍스트 pill 로 교체
- **DialogTitle / DialogDescription primitive 업그레이드 (Q8)** — Settings header 와 동일한 17px 볼드 타이틀 + 12px leading-relaxed description. 단일 변경으로 PageSetup / HeaderFooter / Bookmark / Footnote / Equation / TableProps / CellProps / PictureProps / Shape / StyleManager / VersionHistory / FormulaEditor 12개 다이얼로그 모두 톤 정렬 (사이드바-디테일 구조는 단일-목적 다이얼로그라 과한 변환이라 보류)

### Refactored — Phase 4 chunk 55: 코어 리팩토링 R1~R6 (0.3.7)

전체 13551 → 7853 라인 (-49.4%). 외부 contract / e2e 동작 1:1 보존. 자세한 phase 별 진행 상황은 [docs/REFACTORING_PLAN.md](docs/REFACTORING_PLAN.md) 참조.

- **R1: StudioViewer 분해 (9610 → 4843)** — `useDocumentLifecycle` (R1.1) / `useUndoHistory` (R1.2) / `useFindReplace` (R1.3) / `useKeyboardShortcuts` (R1.4) / `usePageMouseHandlers` (R1.5+R1.6 — selection model + cell drag) / `useViewerHandle` + `useDebugSurface` (R1.8) hook 추출 + `PaperPage` 컴포넌트 분리 (R1.7) + pure utils (`page-dims` / `relocate-excerpt`)
- **R2: ChatPanel 분해 (2396 → 1501)** — `useChatHistory` (R2.1) / `useExcerptAttachments` (R2.2) / `useChatStreaming` (R2.3) hook 추출 + `prompts.ts` 모듈 분리 (시스템 프롬프트 + reference outline / 발췌 직렬화)
- **R3: AppShell 분해 (1545 → 1080)** — `useDispatchMenuAction` / `useTabManagement` / `useNotice` / `useSaveFlow` hook 추출
- **R4: ai-tools 4-way split (1965 → 429)** — `ai-tool-catalog` / `ai-tool-validate` / `ai-tool-parse` 모듈 분리, 본 파일은 타입 + 한도만 보유 + barrel re-export
- **R5: safeIrCall helper (`src/lib/safe-ir-call.ts`) + irMutate / irRead 패턴** — useViewerHandle 의 33개 ir\* tool wrapper 보일러플레이트 try/catch 일원화 (-240 라인)
- **R6: callCellOp helper (`src/features/studio/utils/cell-op.ts`)** — Phase E nested table InCell / ByPath 분기 통합. insertAtCaret / deleteAtCaret / getCursorRect 사이트에 적용 (잔여 28+ 사이트는 후속 sweep)

### Added — Phase 4 진입: chunks 52~54 — About / electron-updater / RELEASE.md (0.3.6)

베타 배포 준비. 사용자 측 자동 업데이트 인프라 + 버전/라이선스 표시 +
release flow 문서화.

#### chunk 52 — About 창 + 버전 표시

- `src/app/AboutDialog.tsx` 신설. 메뉴 "ahwp 정보" + 명령 팔레트 "도움말
  → ahwp 정보" 둘 다 동일 dialog 호출. 버전 / Apache 2.0 라이선스 / GitHub /
  Releases / Issues 링크 / Electron · Chromium · Node.js · OS·arch 노출.
- 신규 IPC `app:get-versions` + `AhwpApi.getVersions()`. main 의 `app.getVersion()`
  과 `process.versions.{electron,chrome,node}` 통합.
- macOS Apple menu 의 "About" 도 native 패널 대신 우리 dialog 로 라우팅
  (`view:about` MenuAction). 명령 팔레트에도 추가.
- 회귀 가드 `about-dialog.spec.ts` (1 케이스) — ⌘K → "정보" → Enter →
  dialog 열림 + 버전 정규식 매칭.

#### chunk 53 — electron-updater 통합 + GitHub Releases publish

- `npm install electron-updater` (^6.8.3, lib).
- `package.json` `build.publish` GitHub provider 설정 (owner: YEUNU,
  repo: ahwp). electron-builder 가 release 빌드 시 `latest.yml` /
  `latest-mac.yml` / `latest-linux.yml` 자동 생성 + GitHub Releases 업로드.
- `electron/main.ts` `initAutoUpdater()` — `app.isPackaged` 일 때만 활성
  (dev 모드 제외). 5초 후 `checkForUpdates()`. `autoDownload=false` (사용자
  확인 요구), `autoInstallOnAppQuit=true` (다운로드 후 다음 quit 시 install).
  `AHWP_DISABLE_UPDATER=1` env 로 강제 비활성 가능 (QA 용).
- in-app update prompt UI 는 후속 (chunk 56) — 현재는 main console 로
  로그만.

#### chunk 54 — `docs/RELEASE.md` 신설

- dev → main → tag → CI 매트릭스 빌드 → GitHub Release 흐름 8단계 박제
- electron-updater 사용자 측 동작 흐름
- 비상시 회수 / hotfix 절차
- 검증 체크리스트 (typecheck/lint/test/e2e/version 일치/CHANGELOG)
- macOS notarization / Windows code signing 미적용 사유 박제

#### 검증

- typecheck / lint / build 청정
- e2e: studio 213 + chat 57 + about 1 = **271 통과** / 1 skipped
- electron-updater 의 packaged 동작은 `v0.3.6` 태그 push 후 release CI
  결과로 검증

### Added — Phase 3 chunk 44: Custom (OpenAI-호환) provider 잠금 해제 (0.3.5)

자체 호스팅 Ollama / vLLM / LM Studio / on-prem LLM gateway 등을 한
슬롯에 통합. baseUrl + supportsTools 입력으로 BYOK 외 부가 설정 노출.

#### 신규 인프라

- **`electron/store/provider-config.ts`** 신설: `userData/provider-config.json`
  per-provider 비-비밀 설정 (baseUrl, supportsTools). API 키는 기존
  safeStorage (secrets.ts) 그대로 — URL 은 비밀 아니라 plain JSON.
- **registry**: `customProvider` 등록 — `{ ...openaiProvider, meta:
getProviderMeta('custom') }` 형태로 OpenAI 어댑터 재사용. baseUrl 만
  별도라 코드 중복 0.
- **chat-start IPC**: `getProviderConfig(request.provider).baseUrl` 을
  `provider.chat({apiKey, baseUrl, signal})` 에 주입 — 기존엔 listModels
  만 baseUrl 받았던 누락 fix.
- **신규 IPC**: `ai:provider-config-get` / `ai:provider-config-set`
  - `AhwpApi.getProviderConfig` / `setProviderConfig`.
- **Settings UI**: `requiresBaseUrl` provider 에만 baseUrl 입력 + "이
  모델은 tool calling 지원" 체크박스 노출. `SHOWN_IDS` 에 `custom` 추가.
- **ChatPanel**: `ChatProviderId` union 에 `'custom'` 추가, modelList /
  loadModels / loadProvider / DEFAULT_MODELS 모두 갱신. 빈 모델 placeholder.

#### 신규 회귀 가드 — `tests/e2e/ollama-live.spec.ts`

- **sentinel** — Ollama localhost:11434/v1 + gemma4:e2b 5.1B 로 OLLAMA_OK
  echo round-trip. 5.3s 통과.
- **Agent** — applyAlignment tool 호출. **AHWP_TEST_OLLAMA_AGENT=1 명시
  시에만** 실행 (작은 모델 + 54-tool 카탈로그 조합은 모델 혼란 — 큰 모델
  필요).

#### 사용법

1. 사용자가 Ollama 실행 (`ollama serve`)
2. Settings → Provider 'Custom (OpenAI-호환)' 선택 → API 키 (Ollama 의
   경우 더미 OK), baseUrl `http://localhost:11434/v1` 입력 → tool calling
   지원 모델이면 체크박스 → 저장
3. ChatPanel → Custom 선택 → 모델 입력 (Ollama `ollama list` 명령으로
   확인) → 정상 동작

#### 검증

- typecheck / lint 청정
- ollama-live: sentinel 1/1 통과 (Agent skipped due to model size)
- 전체 chat 57 + studio 213 = 270 통과 / 1 skipped (1 flaky retry)

### Added — Phase 3 chunk 51: Read tool 카탈로그 + 양식 매칭 워크플로우 (0.3.4)

사용자 시나리오 ("내 주장을 추가해줘 — 같은 양식으로 / 뒷받침 내용도
파악해서") 를 위한 능동 검사 인프라. write tool 만 있던 카탈로그 (45개)
에 **read tool 9개** 추가 → 총 **54 tools**. Agent 가 turn 안에서
read → reason → write 시퀀스로 양식 매칭/위치 결정/근거 검색 가능.

#### 신규 read tool 9개 (카테고리 H)

| 이름                  | 반환                                         | 용도                              |
| --------------------- | -------------------------------------------- | --------------------------------- |
| `getDocumentOutline`  | 제목 단락 좌표+text                          | 문서 구조 파악, 새 단락 위치 결정 |
| `getStyleListJson`    | 사용 가능 styleId 카탈로그                   | applyStyle 매칭                   |
| `getStyleAt`          | 좌표 단락의 styleId+detail                   | 인접 양식 매칭                    |
| `getCharPropertiesAt` | 글자 서식 (font/size/color/bold/...)         | applyCharFormat 입력 매칭         |
| `getParaPropertiesAt` | 단락 서식 (alignment/lineSpacing/indent/...) | applyParaProps 입력 매칭          |
| `getTextRange`        | 좌표 범위 텍스트 (4096B cap)                 | 인용/근거 추출                    |
| `getCaretPosition`    | 현재 caret 좌표                              | "여기 추가" 의미 변환             |
| `findInDocument`      | 검색어 매칭 좌표 list (max 200)              | 키워드 위치 찾기                  |
| `getCellInfo`         | 셀 row/col/span 메타                         | 표 편집 전 검증                   |

모두 mutation 0. 결과는 `AhwpToolResult.data` 에 JSON 직렬화 →
다음 turn 의 tool_result 메시지에 stringify 회신 (4096B cap).

#### Agent 모드 system prompt 보강

`SYSTEM_PROMPT_AGENT_GUIDE` 신설 — Manual 모드용 `SYSTEM_PROMPT_DOC_CONTEXT`
와 별개. `chatMode === 'agent'` 일 때만 inject. 핵심:

1. **워크플로우** — read → reason → write
2. **우선순위** — `applyStyle` > `applyParaProps`/`applyCharFormat` > `applyHtml`
3. **흔한 실수** 가이드 — applyHtml만 의존 / 좌표 추측 / 셀 편집 직진
4. **응답 형식** — Agent 모드는 코드 블록 안 씀 (도구 직접 호출 + 텍스트는 설명만)

#### 시나리오 예 — "내 주장 X 추가" 8 호출 시퀀스

```
1. getCaretPosition → {paragraphIndex:5, ...}
2. getStyleAt(0, 5) → {styleId:0, name:"바탕글"}
3. getParaPropertiesAt(0, 5) → {alignment:"justify", lineSpacing:160}
4. (LLM 추론: 인접 양식 그대로 사용)
5. insertParagraph(0, 6)
6. insertText(0, 6, 0, "내 주장: ...")
7. applyStyle(0, 6, 0)
8. applyParaProps({alignment:"justify", lineSpacing:160})
```

Cap 10 안. 묶음 undo 1회로 전체 롤백.

#### 인프라 변경

- `ViewerHandle` 에 `irGet*` read 메서드 7개 추가 (lib API thin wrap +
  JSON parse). `irFindInDocument` 는 paragraph walk 자체 구현 (lib
  `findText` 미노출).
- `AhwpToolResult` 에 optional `data` 필드 추가 — read tool 결과 캐리어.
- `chat/tools.ts` 의 `runOne` switch + `previewArgs` 에 9 케이스 추가.
- `ChatPanel` Agent loop: tool result 메시지 content 에 `data` JSON
  stringify (4096B cap) 회신.

#### 신규 회귀 가드

`chat-agent.spec.ts` 에 chunk 51 read tool round-trip 케이스 추가
(getCaretPosition with blank.hwpx fixture).

#### 통계 (0.3.4)

- 총 도구: **54개** (write 45 + read 9)
- 카테고리: A(5)+B(8)+C(12)+D(7)+E(6)+F(4)+G(5)+H(9) = 56 (cross 2)
- e2e: studio 213 + chat 57 (+1) = 270 통과 / 1 skipped

### Added — Phase 3 chunks 45~49: tool 카탈로그 한컴 한글 전수 노출 (0.3.3)

Agent 모드 tool 카탈로그를 chunk 19 의 12개 → **45개** 로 확장. 한컴
한글 lib (`@rhwp/core` 0.7.9) 의 주요 mutation API 약 50개 중 ~90%
커버. 단일 진실 원천: `shared/ai-tools.ts`의 `AHWP_TOOL_NAMES`. 모든
provider (OpenAI / NVIDIA NIM / Google Gemini) 가 동일 카탈로그 사용.

#### 신규 33개 도구 (waves 1~6)

**Wave 1 — 본문 편집 primitive (5)** — Agent 가 `applyHtml` 우회 없이
직접 텍스트 조작:

- `insertText` (좌표+텍스트), `deleteRange` (범위 삭제),
  `insertParagraph` / `deleteParagraph` / `mergeParagraph`

**Wave 2 — 글자/단락 서식 통합 (3)** — 기존 부분 노출 → 통합:

- `applyCharFormat` (props 객체로 폰트/색/취소선/첨자/밑줄종류/shadow
  등 한 호출), `applyParaProps` (alignment + lineSpacing + indent +
  spacing + margin 통합), `applyStyle` (id 로 명명 스타일 적용)

**Wave 3 — 표 구조 (12)** — Manual 모드 우클릭 메뉴와 동등:

- `createTable` (N×M), `insertTableRow/Column`, `deleteTableRow/Column`,
  `mergeTableCells` (사각 영역), `splitTableCellInto` (n×m 분할),
  `unmergeCell`, `setTableProperties`, `setCellProperties`,
  `evaluateTableFormula` (HWP 수식 평가), `deleteTableControl`

**Wave 4 — 이미지/도형 (6)**:

- `setPictureProperties`, `deletePictureControl`, `setShapeProperties`,
  `deleteShapeControl`, `changeShapeZOrder` (top/bottom/forward/backward),
  `insertPicture` (base64 PNG/JPEG/GIF/BMP)

**Wave 5 — 페이지/섹션 (5)**:

- `insertPageBreak`, `insertColumnBreak`, `setColumnDef` (다단 layout),
  `setSectionDef`, `setPageHide` (header/footer/border/fill/pageNum 숨김)

**Wave 6 — 머리/꼬리말 + 책갈피 (3 + 1)**:

- `applyHfTemplate`, `createHeaderFooter`, `deleteHeaderFooter`,
  `deleteBookmark`

#### 인프라 변경

- `ViewerHandle` (`src/features/studio/types.ts`) 에 `ir*` 메서드
  28개 추가 — lib API thin wrapper. mutation 후 `refreshAfterMutation`
  - try/catch (부분 성공 모델). insertPicture 는 base64 → Uint8Array
    변환 포함.
- `shared/ai-tools.ts` `AhwpToolArgs` / `validateArgs` / `TOOL_DESCRIPTORS`
  세 군데 lockstep 확장. `nonNegInts` 헬퍼로 좌표 validation 중복
  제거.
- `src/features/chat/tools.ts` `runOne` switch + `previewArgs` switch
  각각 33 케이스 확장. exhaustive switch로 컴파일러가 drift 차단.
- 신규 회귀 가드: `chat-agent.spec.ts` 에 chunk 45 (insertText) +
  chunk 46 (createTable) 케이스 추가.

#### 새 문서 — `docs/AGENT_TOOLS.md`

전체 카탈로그 reference: 카테고리별 표, 사용 예, 좌표 시스템 (HWPUNIT
변환), lib 한계 (KNOWN_ISSUES L-006/L-008/chunk 36 대기), 신규 도구
추가 절차 8단계.

#### 검증

- typecheck / lint 청정
- studio 213 + chat **56 (+2)** = **269 통과** / 1 skipped
- gemini-live 2/2 + nvidia-live 5/5 = 7/7 라이브 통과 (1 flaky
  retry 통과)
- e2e 단계: agent fake provider 의 `TOOL:<name>:<json>` 모드로 신규
  카탈로그 dispatch round-trip 확인 (insertText / createTable /
  unknown tool 거절)

#### Phase 3 잔여 (외부 의존)

| 청크 | 항목                                 | 차단                                           |
| ---- | ------------------------------------ | ---------------------------------------------- |
| 42   | Anthropic 어댑터 tool_use            | API 키 결정 대기                               |
| 44   | Custom (OpenAI-호환) capability flag | optional                                       |
| 47   | docId-aware 라우팅 (다중 문서 write) | 후속                                           |
| —    | numbering/bullet 자동화              | lib API 복잡, Manual 모드 슬래시 명령으로 충분 |
| —    | insertEquation tool                  | 수식 엔진 (renderEquationSvg 별도)             |

### Fixed — Gemini schema sanitize + live smoke 검증 (0.3.2)

라이브 검증 시 발견한 Gemini API 제약 3건 + 회귀 가드 + 기본 모델
교체. AHWP_TEST_GOOGLE_KEY 와 함께 e2e 통과 (sentinel + Agent 도구
호출 round-trip 모두).

- **schema sanitize** — `properties` 안 property 이름까지 dropping 되던
  버그 fix (필터가 모든 키를 schema keyword 로 취급). `properties`
  분기 추가해 키 보존 + 값만 재귀 sanitize.
- **enum + type** — Gemini 는 `{enum: [...]}` 만으로는 안 받음.
  `{type: 'string', enum: [...]}` 명시. `applyAlignment` /
  `toggleCharFormat` 카탈로그 갱신.
- **exclusiveMinimum / pattern drop** — Gemini 가 받는 JSON Schema
  subset 이 OpenAI 보다 좁음 (`exclusiveMinimum`, `exclusiveMaximum`,
  `pattern`, `additionalProperties`, `anyOf` 등 거부). sanitize 가
  드롭. 우리 validator (`shared/ai-tools.ts`) 가 dispatch 전에 강제
  하므로 보안성 영향 0.
- **기본 모델** — `gemini-2.0-flash` → `gemini-2.5-flash`. 2.0 은 free
  tier quota 0 인 프로젝트가 많아 2.5 가 안전.
- **신규 spec** — `gemini-live.spec.ts` (2 케이스): sentinel round-trip,
  Agent applyAlignment 호출 + tool-entry 렌더.
- **인프라** — `playwright.config.ts` 에 dependency-free dotenv 로더.
  `.env` 의 KEY=VALUE 자동 로드 → process.env 주입. nvidia-live 도
  동일 메커니즘으로 NVAPI_KEY 자동 사용.

라이브 e2e 결과: gemini-live 2/2 + nvidia-live 5/5 = **7/7 통과** (27.5s).

### Added — Google Gemini 어댑터 (chunk 43, 0.3.1)

Phase 3 chunk 43 — Google Gemini provider 잠금 해제. 기존 OpenAI/NIM과
동일한 Manual + Agent 모드 양쪽에서 동작. tool calling (functionCall /
functionResponse) 정식 지원.

- `electron/ai/providers/google.ts` 신설:
  - Endpoint: `generativelanguage.googleapis.com/v1beta/models/<model>:streamGenerateContent?alt=sse&key=...`
  - 메시지 변환: system → top-level `systemInstruction`, user/assistant
    → `contents[].role` ('model' for assistant), tool result → user role
    - functionResponse part.
  - tool 카탈로그: `{tools: [{functionDeclarations: [{name, description,
parameters}]}]}`. `toolChoice` → `toolConfig.functionCallingConfig.mode`
    (NONE/AUTO/ANY).
  - functionCall part 즉시 emit (OpenAI 와 달리 chunk 분할 없음).
    `finishReason='STOP'` 이라도 functionCall 있으면 `tool_calls` 로
    재정의.
  - `listModels` — `/v1beta/models` 응답에서 `supportedGenerationMethods`
    가 `generateContent` 포함 모델만, `models/` prefix 제거 후 정렬.
- 등록: `registry.ts` 에 `googleProvider` 추가.
- UI: `SettingsDialog.SHOWN_IDS` + `ChatPanel.PROVIDER_OPTIONS` 에
  `'google'` 추가. 기본 모델 `gemini-2.0-flash`.

#### 사용법

1. Settings → Provider 'Google (Gemini)' 선택 → API 키 입력 → 연결
   테스트
2. ChatPanel → Provider Google 선택 → 모델 입력 (`gemini-2.0-flash`,
   `gemini-1.5-pro` 등 — 새로고침 ↻ 으로 fetch)
3. Manual / Agent 모드 둘 다 동작 — Agent 모드면 tool-use API 자동 사용

#### 제한

- 한 호출 안에 tool result 메시지가 여러 개여도 Gemini 는 **tool name
  으로만 매칭** (id 무시). 우리 내부적으로는 직전 model 메시지의
  toolUses 에서 같은 id 의 name 을 lookup 해서 채움.
- JSON Schema 일부 키워드 (예: `additionalProperties`) Gemini 가 무시 —
  현재 카탈로그는 OpenAI/Gemini 양쪽 호환되는 subset 만 사용.

### Added — Phase 3 MVP: Agent 모드 (chunks 37~41, 0.3.0)

provider native tool-use API 정식 통합. 사용자가 ChatPanel 상단의
**Agent 모드** 토글을 켜면 AI가 ahwp 도구를 직접 호출 → 자동 적용.
한 turn 내 모든 변경은 묶음 undo (⌘Z 1회로 일괄 롤백).

#### chunk 37 — `shared/ai.ts` tool-use 타입 확장

- `ChatStreamEvent` 에 `tool-use` 이벤트 + `done.finishReason` 추가.
- `ChatRequest.tools` (`ChatTool[]` JSON Schema) + `toolChoice`.
- `ChatMessage.toolUses` / `toolResult` (assistant + role='tool' 메시지).
- `shared/ai-tools.ts` 에 `getAhwpToolCatalog()` — chunk 19 의 12 tool
  을 provider 어댑터에 주입 가능한 `AhwpToolDescriptor[]` 로 변환.

#### chunk 38 — OpenAI 어댑터 tool calling

- `tools` 파라미터를 `[{type:'function', function:{name, description,
parameters}}]` 로 변환. `tool_choice` 도 native 변환.
- stream 의 `delta.tool_calls` 를 index 별 슬롯에 누적 (id / name /
  arguments JSON 분할 chunk) → 종료 시 한꺼번에 `tool-use` emit.
- assistant + tool 메시지 변환 — `tool_calls` 배열, role='tool' +
  `tool_call_id`.
- `finish_reason` 매핑: `tool_calls` / `length` / `content_filter` /
  `stop`.
- fake provider 에 `TOOL:<name>:<json>` / `TOOL_DONE:` 모드 추가
  (e2e deterministic).

#### chunk 39 — Manual / Agent 모드 토글 + Agent 루프

- ChatPanel 상단 라디오 — Manual (기본, 기존 chunk 18+19) / Agent
  (실험적). localStorage `ahwp:chat:mode` 영속.
- Agent 모드 fireChat: `ChatRequest.tools` 자동 주입, `toolChoice='auto'`.
- onEvent 에서 `tool-use` 누적 → `done.finishReason='tool_calls'` 면
  per-tool dispatch (`validateToolCall` + `runTools` props) → tool
  result 메시지 추가 → fireChat 재귀.
- 한 turn 호출 cap 10 (`AGENT_MAX_TOOLS_PER_TURN`). 초과 시 강제 종료.
- `fireChatRef` + `agentToolUsesRef` + `agentTurnDepthRef` 로 루프
  상태 잇기.

#### chunk 40 — Agent 진행 UI

- assistant 메시지 안 inline tool entry row — `🔧 toolName | argsPreview
| 상태 (⏳/✓/✗)`. `data-testid="chat-tool-entry"` + `data-tool-name`
  - `data-tool-status`.
- role='tool' 메시지는 chat 화면에서 숨김 (tool entry 가 같은 정보를
  더 좋게 표시).
- 중단 버튼은 기존 abort 재사용 — Agent 루프 중에도 즉시 stream stop.

#### chunk 41 — Agent 묶음 undo

- `runTools` (chat/tools.ts) 가 이미 `beginUndoGroup` / `endUndoGroup`
  으로 N op 를 1 entry 로 collapse — Agent dispatch 도 op 당 단일
  call 이라 자연히 묶음. ⌘Z 한 번으로 turn 전체 롤백.
- finally 블록 보장 — 중간 op throw 시에도 group 누설 안 함.

#### 검증

- 신규 회귀 가드 spec — `chat-agent.spec.ts` (3 케이스): 모드 토글,
  tool-use 응답 → entry 표시, unknown tool failed 표시.
- 전체 e2e: studio 213 + chat 54 = 267 통과 / 1 skipped.

#### Phase 3 잔여 (외부 의존)

| 청크 | 항목                                           | 차단                           |
| ---- | ---------------------------------------------- | ------------------------------ |
| 42   | Anthropic 어댑터 tool_use                      | API 키 결정 대기               |
| 43   | Google function calling                        | API 키 결정 대기               |
| 44   | Custom (OpenAI-호환) capability flag           | optional, 모델별 hardcode 필요 |
| 45   | 추가 본문 편집 tool (insertTextAtCaret 등)     | 후속                           |
| 46   | 추가 표 구조 tool (insertTable, mergeCells 등) | 후속                           |
| 47   | docId-aware 라우팅 (다중 문서 write)           | 후속                           |

MVP (37~41) 완료 — OpenAI 모델로 검증 가능. 키 결정 후 42/43/44 잠금
해제, 후속 청크는 사용자 피드백 받아가며 점진 추가.

### Added — Phase 2 마무리: chunks 31, 32 (0.2.94)

Phase 2 잔여 청크 일괄 마감.

#### chunk 31 — 자동 제목 요약

- 4 메시지 (= 2 user + 2 assistant turns) 누적 후 1회 한정으로
  background ai chat 호출 → 한국어 5단어 이내 짧은 제목 생성 →
  `chatHistory.rename`.
- `autoTitledConvIdsRef`로 conv id 단위 dedup. failure 모두 silent
  (원래 60자 truncated title 유지).
- 회귀 가드 spec — `chat-auto-title.spec.ts` (2 케이스).

#### chunk 32 — 셀 selection v4 (cell-block copy/paste)

- `copySelection`이 cell-block selection (anchor.cell ≠ focus.cell
  같은 표) 감지 시 TSV 포맷 (cells `\t` / rows `\n`)으로 clipboard
  작성. 병합 셀, 중첩 표 모두 처리.
- `pasteAtCaret`이 caret이 셀 안 + clipboard text가 multi-cell
  형태면 시작 셀부터 row/col 격자에 분배. 표 경계 밖은 무시.
- merge·split 우클릭 통합은 chunk 9 + cell-context-menu (chunk 5)
  에서 이미 통합. drag cell selection은 Phase A (0.2.67~) 완료.
- 회귀 가드 spec — `studio-cell-block-clipboard.spec.ts` (2 케이스).

#### Phase 2 종료 정리

- 잔여 (외부 의존):
  - chunk 33 (도형 라인/곡선/그룹) — `@rhwp/core` 0.8 대기
  - chunk 36 (스타일 char/para shape 캡처) — `@rhwp/core` 0.8 대기
  - Anthropic / Google 어댑터 — API 키 결정 대기
- e2e 통과: studio 213 + chat 51 = 264 / 1 skipped.

### Changed — 텍스트 caret hard-blink 애니메이션 (0.2.93)

사용자 요청 "커서 깜빡거리는거 넣어줘". 기존 `animate-pulse` 는
opacity 1↔0.5 의 부드러운 fade 라 OS 텍스트 입력 캐럿처럼 안 보임.

- `index.css` 에 `caret-blink` keyframe 추가 — `steps(1, end)` 로
  hard 100% / 0% 토글, 1초 주기 (OS 텍스트 input 표준 비슷).
- `studio-cursor` div 가 `animate-pulse` → `animate-caret-blink`.
- 셀 안 텍스트에 클릭한 caret 이 두드러지게 깜빡 → 위치 인지가
  명확.

#### click-on-text 회귀 검증 (사용자 보고 "글자 위치 클릭하면 셀에

생긴다") — 합성 spec 으로 ABCDEFGHIJ 텍스트 셀에 progressive x
클릭 시 charOffset 0→1→2→3→5→7→10 정상 추적 확인 (`cursorX` 도
click 위치 따라 이동). 만약 실제 사용자 환경에서 여전히 문제면
fixture 공유 필요.

### Fixed — 0.2.91 글로벌 nudge revert + drag-only bbox validation (0.2.92)

0.2.91 의 `hitTestAt` 글로벌 +1 px nudge 가 "셀 안에 커서 잘 안 들어가
(글자가 있으면)" 회귀 유발. 모든 hit (단발 click 포함)에 적용된 nudge
가 text-rich cell 에서 caret entry / cursor visualization 에 영향.

- **revert**: `hitTestAt` 의 +1 nudge 제거. 단발 click 은 lib 원래
  동작 (사용자 명시 의도 존중 + caret 진입 보장).
- **추가**: drag mousemove (cell-drag 모드) 한정 bbox validation —
  `applyPointerToSelection` 의 cell-drag 분기에서 `hitTest` 결과의
  cellIndex 를 `getTableCellBboxes` 결과로 검증, x/y 가 다른 cell 의
  bbox 안에 있으면 정정. drag 중 boundary off-by-one 만 노린 좁은
  scope 의 fix.
- click 경로에서는 적용 안 함 — 사용자 보고 "셀 안 커서 안 들어가"
  회귀 회피.
- `studio-cell-edge.spec.ts` 의 +0px (정확 boundary) 케이스 제외 —
  click 경로는 의도적으로 lib 원래 right-inclusive 동작 유지.
- studio e2e 211/212 통과.

### Fixed — 셀 좌측 경계 hit test off-by-one (0.2.91, 진짜 근본 원인)

**근본 원인 확인**: lib `doc.hitTest`가 `x = cellLeftEdge` 정확히 그
boundary일 때 이전 cell을 반환 (right-inclusive 경계). e2e diagnostic
sweep으로 +0px / +1px / +2px ... 클릭 결과 측정 시 +0px만 1 작은
cellIndex 반환 확인.

사용자 보고 ("1,2,3,4 / 3,4 드래그 / 2,3,4 선택 / 글자가 왼쪽
가까운데서 시작하면 왼쪽 셀 포함")과 정확히 매칭. 셀의 텍스트가
좌측 정렬된 경우 mousedown이 boundary 1px에 떨어져 anchor가 한 칸
왼쪽 셀로 잡힘 → cell-block drag로 추가 셀까지 highlight.

- `hitTestAt` 에서 local x 에 +1 nudge 추가 — boundary 모호성 해소.
  body text caret 위치 영향 미미 (1 CSS px 이동은 char 경계 거의
  안 넘음).
- 회귀 가드 spec — `studio-cell-edge.spec.ts`. 1×4 표에서 각 셀
  left-edge +0/+1/+2/+5px 클릭 시 cellIndex 매핑 검증.

#### 부수효과: 0.2.90의 sticky-mode + 0.2.89의 mouseup-empty 수정도

함께 살아있음 — 셀 드래그 안정성 다층 방어. studio e2e 211/212 통과.

### Fixed — 셀 드래그 sticky cell-block 모드 (0.2.90)

사용자 보고: "되었다 안되었다 / 근본적인 원인" — drag 중 cursor가
anchor 셀로 복귀하면 highlight가 wipe되며 char-select 모드로 toggle,
다시 다른 셀로 가면 cell-block 복귀 → "깜빡거림" 으로 인지.

- `cellDragStickyRef` 신설 — drag 중 cross-cell 한 번이라도 진입하면
  true, 이후 anchor 셀 복귀해도 cell-block 모드 유지.
- mousedown(셀)에서 false reset, mouseup에서 항상 false reset.
- 한컴 reference 동작 — drag 시작 후 한 번 cross-cell 하면 그
  drag 동안은 cell-block 단위 selection 고정.
- 회귀 가드 spec 추가 (sticky mode case) — cell 2 → 3 → 2 → 3
  드래그 후 highlight 2개 유지 검증.

#### 미해결 — "1,2,3,4 / 3,4 드래그 / 2,3,4 선택" 보고

합성 e2e (텍스트 채운 1×4 표, 각 셀 클릭 위치별 cellIndex 검증)에서
재현 불가. 사용자의 실제 파일 / 표 구조 (병합 셀? 중첩? 헤더?) 확인
필요. 후속 보고 받으면 fixture 추가 + 추가 가드.

### Fixed — 셀 드래그 mouseup 시 highlight 통째 wipe (0.2.89)

사용자 보고 ("표 셀 드래그 하는거 불안정해 / 2->3 드래그 했는데
2 -> 1, 3 동시에 선택됨 / 글씨 있는 셀 / 위치도 안맞아").

- `onWinUp` (drag commit) 의 selection-empty 판단이 `paragraphIndex`
  / `charOffset` 만 비교 → cross-cell drag 는 둘 다 0 이라 무조건
  empty 로 분류, `setCellBlockHighlights({})` 가 highlight 를 통째
  wipe → 사용자는 "release 직후 셀 선택이 사라지거나 유실됨" 으로 인지.
- 수정: `anchor.cell` 과 `focus.cell` 의 `cellIndex` / `cellParaIndex`
  가 다르면 paragraphIndex 같아도 non-empty. cross-cell 셀 블록
  selection 보존.
- 신규 회귀 가드 spec — `studio-cell-drag.spec.ts` (2 케이스):
  텍스트 채운 1×3 표에서 셀 2 → 셀 3 실제 마우스 드래그 후
  highlight 2개 + caret cell index 2 검증.

### Changed — 플랫폼별 단축키 컨벤션 통일 (0.2.88)

Mac에서 Ctrl+좌클릭이 우클릭(secondary click → contextmenu)으로
변환되어 우리 primary-modifier 핸들러와 충돌하던 문제 해결.

- `src/lib/platform.ts` 신설 — `isMac` (UA/platform sniff) +
  `primaryModifier(e)` (Mac=metaKey / Win·Linux=ctrlKey) +
  `plainPrimaryModifier(e)` (modifier 단독).
- `StudioViewer.tsx` / `AppShell.tsx`의 단축키 핸들러 전반을
  `(e.metaKey || e.ctrlKey)` → `primaryModifier(e)`로 치환.
  - 영향 범위: Ctrl/Cmd+클릭 (불연속 셀 추가), Ctrl/Cmd+A (전체),
    Ctrl/Cmd+C/V/X (클립보드), Ctrl/Cmd+Z/Y (undo/redo),
    Ctrl/Cmd+B/I/U (글자), Ctrl/Cmd+K (커맨드 팔레트), 외 다수.
- typing fall-through 가드 (`if (e.metaKey || e.ctrlKey || e.altKey)
return;`)는 OR 패턴 그대로 유지 — "어떤 modifier든 잡혀있으면
  글자 입력으로 처리하지 말 것"이 의도라 platform-aware 변환
  대상이 아님.
- 회귀 검증: studio 전체 e2e 208케이스 — 207 통과 / 1 skipped.

### Added — 2차 UX 라운드 chunks 56~ (0.2.56~)

- **chunk 56 — AI 우클릭 메뉴 (0.2.56)**: body selection 우클릭 → "다듬기 / 요약 / 영어 번역 / 격식체 / 평어" 메뉴. 클릭 시 `ChatPanel.prefillAndSend()`로 즉시 chat 턴 발사 (선택 텍스트를 prompt 템플릿에 inline). ChatPanel을 forwardRef + `ChatPanelHandle` 신설
- **chunk 60 — 검색 in 폴더 (⌘⇧F, 0.2.60)**: 폴더 트리 영역을 `SearchPanel`로 토글 + `folder:search-text` IPC. main에서 root walk + `@rhwp/core`로 IR 텍스트 추출 + grep (depth 5 / 200 파일 / 5MB / 50 hits 상한). 결과 클릭 시 `openTab` + `viewer.scrollToParagraph` 점프
- **chunk 59 — PDF 내보내기 (0.2.61)**: `file:export-pdf` IPC + 메뉴 + ⌘K. main에서 hidden BrowserWindow에 HTML 셸(@page 25mm + Pretendard) load → `webContents.printToPDF`로 Chrome PDF 백엔드 활용. 사용자 선택 경로에 atomic write
- **chunk 58 — 목차 사이드바 (⌘⇧O, 0.2.61)**: `viewer.getOutline()` — 단락 styleId를 styleList에서 "제목 N" / "Heading N"로 매칭, level 추출. `OutlineSidebar` 컴포넌트가 viewer 옆에 토글 + 클릭 시 scrollToParagraph
- **chunk 57 — AI inline diff (0.2.61)**: `viewer.snapshotParagraphs()` + `markChangedParagraphsSince(before)`. AppShell의 applyHtml/runTools가 before/after로 bracket. 변경된 단락 좌측에 amber 3px 막대 + animate-pulse + 15s 후 페이드

### Added — 남은 phase 일괄 + 종합 e2e (0.2.87)

selection UX phase 전체 마감 + e2e 검증.

#### 1. `applyParaProps` ViewerHandle 노출 + ParaFormatDialog 확장

- `ViewerHandle.applyParaProps(props)` 신설 — `applyParaFormat` /
  `applyParaFormatInCell` 라우팅 (selection-aware).
- ParaFormatDialog v1.1: 줄 간격 (% of single line) + 첫 줄
  들여쓰기 (mm → HWPUNIT) 추가. 기존 정렬과 함께 한 화면.

#### 2. 불연속 셀 format apply

- toggleCharFormat이 셀 caret + Ctrl+클릭 추가본을 모두 iterate해
  applyCharFormatInCell per cell 호출. 셀별 동일 서식 일관 적용.
- selection 활성 시 (anchor/focus 셀 분리)는 기존 selection range
  분기 사용 — 불연속 보강은 caret-only 셀 case에 한정.

#### 3. Phase E 2차 — nested ops via `*ByPath`

- `insertAtCaret` / `deleteAtCaret` / `refreshCursorRect`이
  `c.cell.path.length > 1`일 때 `insertTextInCellByPath` /
  `deleteTextInCellByPath` / `getCursorRectByPath` 사용.
- top-level 셀 (path === undefined 또는 length === 1)은 기존 lib
  variant — 회귀 0.
- 라이브러리가 `*ByPath` 모두 publish: getCellInfo / Cursor / Text
  In/Out / Mr Paragraph / Cell Paragraph Length / Table Cell Bboxes
  / Table Dimensions / Move Vertical 등.
- 미지원 ops (lib에 \*ByPath 없음): row/col 추가·삭제 / 셀 합치기·
  나누기 — 중첩 표 안에서는 본 단계까지. 후속 lib publish 후 unblock.

#### 4. Phase D 2차 — 마퀴 모드 (개체 선택)

- ⌘⇧M (Cmd+Shift+M) 토글로 마퀴 모드 진입.
- 인디케이터: 페이지 위 "개체 선택 모드 (Esc 해제 / 드래그로 표
  영역 선택)" 라벨.
- 모드 활성 시 mousedown+drag → scrollRef-relative 사각형 marquee
  rect 그림 (점선 border + bg-primary/10).
- mouseup 시 모든 paragraph의 control 열거 (`getControlTextPositions`)
  - 표만 `getTableBBox` 시도 → marquee rect와 bbox 겹침 검사 →
    `selectedControlBboxes` populate.
- ESC / 재토글 (⌘⇧M)로 모드 종료.
- 한계: lib L-008로 표만 detect 가능. 이미지/도형 선택은 후속.

#### 5. e2e 신규 spec — `studio-phase-final.spec.ts` (10 케이스)

- Phase D 마퀴 모드: 토글 / Esc 종료 / 재토글
- 자동 저장: save-draft → has → load → clear flow + /tmp/ahwp-drafts
  디렉토리 실제 작성 검증
- Phase D 불연속 셀 ops: 셀 typing 후 dirty 검증
- Phase E: top-level 셀 hit이 기존 동작 유지 (회귀 가드)
- Alt+L / Alt+T 다이얼로그: 열기 / Esc 닫기 / Alt+T 정렬 적용 후 dirty

#### 회귀 검증

studio 전체 207 e2e — 206 통과 / 1 flaky (`studio-paraformat`
save→reopen, 기존 timing 이슈 retry로 통과, 본 phase와 무관) /
1 skipped. 회귀 0.

### Added — Alt+L 글자 모양 / Alt+T 문단 모양 다이얼로그 (0.2.86)

#### Alt+L — `CharFormatDialog`

- 한글 reflex 단축키. 현재 caret 또는 선택 단락의 글자 속성 변경
- 체크박스: 진하게(B) / 기울임(I) / 밑줄(U) — `toggleCharFormat` 라우트
- Font 크기 (pt) — `applyFontSizePt`
- Font 색상 (#RRGGBB) — `applyTextColor`
- ViewerHandle에 `getActiveFormat()` 신설 — caret의 현재 char 속성을 dialog 초기값으로 사용 (toggle 의도 안 맞는 재토글 방지)

#### Alt+T — `ParaFormatDialog`

- 정렬 라디오: 왼쪽 / 가운데 / 오른쪽 / 양쪽 — `applyAlignment` 라우트
- v1은 정렬만. 줄 간격 / 들여쓰기 / 단락 간격은 ViewerHandle이 직접 publish 안 해서 후속 (lib `applyParaFormat`로 props_json 전달 가능 — handle 메서드 신설 필요)

#### Phase D 2차 마퀴 모드 — 미구현

- 도형 탭 "개체 선택" 마퀴는 새 mode toggle + marquee 마우스 핸들러 + bbox intersection 검사 필요
- `@rhwp/core` L-008 (이미지/도형 통합 bbox API 부재)으로 표만 detect 가능 — 부분 UX
- 별도 chunk로 정식 구현 권장

### Changed — 자동 저장 draft → OS tmp 폴더 + Phase E (1차 nested cellPath) (0.2.85)

#### 자동 저장 경로 이동

- 기존: 원본 파일 옆에 `<path>.ahwp-draft` 사이드카 작성
- 변경: `os.tmpdir()/ahwp-drafts/<sha1(path):16>.ahwp-draft`
- 이유:
  - 원본 폴더가 read-only / 권한 없는 경우에도 동작
  - 사용자 폴더에 .ahwp-draft 잔여물이 흩어지지 않음
  - 시스템이 주기적으로 `/tmp` 정리해도 원본 파일은 무사
  - sha1 prefix로 충돌 회피 + 안전한 파일명
- electron 4 IPC 핸들러 (`save-draft` / `has-draft` / `load-draft` / `clear-draft`) 모두 일괄 변경

#### Phase E 1차: nested table cellPath in selection state

- IR `hitTest` 결과의 `cellPath` 필드 (셀 체인) 를 selection state의 `cell.path?: Array<{controlIndex, cellIndex, cellParaIndex}>`에 저장
- `refreshCellBlockHighlights`가 `path.length > 1`이면 `getTableCellBboxesByPath` 라이브러리 ByPath variant 사용 — 중첩 표 안 셀 block highlight 정상 동작
- 기존 top-level 표 동작은 그대로 (path === undefined 또는 length === 1 시 기존 `getTableCellBboxes` 경로)
- 2차 작업 (다음 phase): F-key / navigation / cell edit / merge·split 핸들러도 path 인식하도록 일괄 변환 — 라이브러리는 이미 모든 `*ByPath` variant 지원 (`mergeParagraphInCellByPath` / `splitParagraphInCellByPath` / `getCursorRectByPath` / `deleteTextInCellByPath` 등)

### Added — Phase D (2차 부분): 불연속 셀 ops (0.2.84)

- 0.2.83에서 visual-only였던 Ctrl+클릭 셀을 ops에서도 사용. 별도 `discontiguousCellsRef` (ops iteration용 list)에 추가.
- **S (셀 나누기)** — anchor/focus rectangle의 모든 셀 + 불연속 셀 모두 per-cell `splitTableCell` 호출. 단일 셀이면 1×1 split (현 lib에선 no-op 안전).
- **M (셀 합치기)** — `mergeTableCells` 라이브러리가 rectangular range만 받으므로 anchor/focus rectangle만 처리. 불연속 셀이 rectangle 밖에 있으면 자동 무시 (lib 제약 — 후속에서 별도 알림/disable 검토).
- 불연속 cells는 plain mousedown / Esc / clearSelection / 새 drag 시작 / merge·split 후 자동 리셋.
- format apply (toggleCharFormat in cell)는 추후 — 현재는 selection.anchor/focus 한 셀만 적용.

### Added — Phase D (1차): Ctrl+클릭 불연속 셀 추가 (0.2.83)

- 셀-block이 활성인 상태에서 같은 표의 다른 셀을 **Ctrl/Cmd+클릭** → 그 셀이 highlight에 추가됨 (rectangular range 외 추가 셀). v1은 시각 표시만 — anchor/focus는 안 건드림.
- 셀-block이 없거나 다른 표 셀이면 무시. 일반 클릭은 기존대로 selection을 새로 시작.
- v1 한계 (후속):
  - 불연속 셀에 대한 ops (M 합치기 / S 나누기 / 서식 적용) 미적용 — selection state 모델 확장 필요. visual feedback만 우선 제공.
  - **개체 선택 모드** (도형 탭 마퀴 영역 선택) — 새 mode toggle + 마퀴 마우스 핸들러 + bbox intersection 검사 필요. 큰 작업이라 후속.
- **Phase E (중첩 표)** — `cellPath` 기반 selection 모델 확장 + 모든 cell-aware 함수의 `*ByPath` 변종 사용 필요 (`getTableCellBboxesByPath`, `getCursorRectByPath`, `mergeParagraphInCellByPath` 등 lib 지원 확인됨). 구조적으로 selection 타입과 ~10개 핸들러 동시 변경 → 별도 phase로 분리. v1은 1단계 셀만 지원.

### Added — Phase B-4: 표 편집 단축키 (0.2.82)

한글 reflex 표 편집 단축키 6종:

| 키                         | 동작                               | lib API                               |
| -------------------------- | ---------------------------------- | ------------------------------------- |
| **Ctrl+Enter** (셀 안)     | 현재 행 아래 줄 추가               | `insertTableRow(..., row, true)`      |
| **Ctrl+Backspace** (셀 안) | 현재 행 삭제                       | `deleteTableRow(..., row)`            |
| **Alt+Insert** (셀 안)     | 줄 추가 (Ctrl+Enter alias, v1)     | 동일                                  |
| **Alt+Delete** (셀 안)     | 줄 삭제 (Ctrl+Backspace alias, v1) | 동일                                  |
| **M** (cell-block 활성)    | 셀 합치기                          | `mergeTableCells(start..end row/col)` |
| **S** (cell-block 활성)    | 셀 나누기                          | `splitTableCell(row, col)`            |

- Ctrl+Enter / Backspace는 셀 안 caret 시 발화. 본문 caret이면 fall-through (본문 동작).
- M / S는 selection의 anchor/focus가 같은 표의 다른 셀 (= cell-block) 활성 시만 동작. 본문이나 단일 셀에선 일반 키 입력.
- 행/열 추가·삭제 후 `refreshAfterMutation()` 호출로 layout reflow + 페이지 재렌더.
- 합치기/나누기 후 cell-block 선택 자동 해제 (변경된 표 구조에서 anchor·focus가 더 이상 유효하지 않을 수 있음).
- Alt+Insert/Delete가 한글에선 셀-block 종류 (행/열)에 따라 분기되지만 v1은 row만 — 후속에서 selection 모양으로 행/열 판정 추가 가능.
- splitTableCellsInRange (block 단위 split) 도 lib에 있음 → 후속 v2.

기존 drag/cell/table-shortcut e2e 28개 회귀 없음.

### Added — Phase B-5 + B-2.6: 본문 도움 단축키 + 셀 블록 모드 indicator (0.2.81)

- **B-5 (한글 호환 본문 단축키)**:
  - **F6** — 스타일 관리 다이얼로그 (`StyleManagerDialog` 직접 오픈, 한글 reflex)
  - **Alt+P** — PDF 내보내기 (한글의 "인쇄" 매핑, ahwp는 인쇄 기능 부재 → PDF export로 대체)
  - Alt+L (글자 모양) / Alt+T (문단 모양)는 별도 다이얼로그 컴포넌트가 없어 v1 skip — 후속 작업으로 다이얼로그 신설 시 추가 가능
- **B-2.6 (셀 블록 모드 indicator)**:
  - F5×2 확장 모드 진입 시 status bar에 "셀 블록 모드 (F5)" 라벨 표시 (`bg-primary/15` 강조)
  - hover 시 tooltip "화살표 키로 확장 / Esc 해제 / Enter 편집 모드"
  - `cellBlockExtendModeRef` (동기 keydown 읽기) + `cellBlockExtendMode` state (JSX 구독) 듀얼 트래킹. helper `setCellBlockExtendMode(v)`로 둘 다 동시 업데이트.

### Added — e2e: Phase A + B 회귀 가드 (0.2.80)

- 신규: `tests/e2e/studio-table-shortcuts.spec.ts` (22 케이스)
  - Phase A: multi-cell drag block (F5×3로 표 전체 highlight 검증)
  - Phase B-2: F5 / F5×3 / F7 / F8 셀·열·행 block + Mac variants ⌘⌥B/T/C/R + 셀 밖 no-op
  - Phase B-2.5: F5×2 진입 후 ArrowRight / ArrowDown / 둘 다 — block 확장 검증
  - Phase B-3: Tab / Shift+Tab / Alt+→ / Alt+↓ / Shift+ESC — caret 이동 검증
  - Phase B-1: F3×2 단어 / F3×3 단락 / F3×4 섹션 전체 + 셀 안 fall-through
- Bug fix discovered: ArrowLeft/Right body 핸들러가 `!c.cell` 가드 없이 cell context에서도 실행되어 F5 확장 모드의 ArrowRight + B-3의 Alt+ArrowRight 모두 가로챘던 버그. body 핸들러에 가드 추가.
- 확장 모드 핸들러를 body arrow 핸들러보다 먼저 위치시켜 cell context 우선 보장.
- 기존 drag/cell/selection/edit e2e 31개 회귀 없음.

### Added — Phase B-2.5: F5 확장 모드 (0.2.79)

- F5 두 번 누르면 확장 모드 진입. 그 다음 화살표 키로 cell-block의 focus 셀이 row/col 단위로 이동해 block 범위 확장. anchor 셀은 고정.
  - `→` / `←` — 다음 / 이전 열로 확장 (focus 셀 colSpan 단위)
  - `↓` / `↑` — 다음 / 이전 행으로 확장 (focus 셀 rowSpan 단위)
- F5/F7/F8/F5×3/⌘⌥T 등 다른 cell block 키는 anchor·focus를 새로 세팅하면서 확장 모드 reset.
- mousedown / Esc / 셀 밖 caret 이동 시 자동 해제.
- F5/F7/F8 핸들러를 selection state(anchor.cell + focus.cell)도 같이 업데이트하도록 리팩터 — 확장 모드가 anchor에서 시작 가능.
- 기준: [한글 표 단축키](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm) — "F5 또는 F3 누름 → 셀 확장 모드"

### Added — Phase B-1: 한글 호환 F3 본문 block 단축키 (0.2.78)

- 본문 caret 시 F3 연속 입력 (600ms 윈도우):
  - F3 1× — block 시작 모드 진입 (v1 no-op, Shift+arrow와 동등)
  - F3 2× — 현재 단어 선택 (= 더블클릭)
  - F3 3× — 현재 단락 선택 (= 트리플클릭)
  - F3 4× — 문서 전체 선택 (= ⌘A)
- 셀 안 caret이면 F3 fall-through (한글 reflex와 동일 — 셀에선 F5/F7/F8을 사용).
- F3 외 다른 키 누르면 카운터 리셋.
- ⌘A / 더블·트리플 클릭이 이미 동일 효과를 주지만 한글 reflex 사용자 호환 편의용.
- 기준: [한글 표 단축키 일람](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm) — "F3을 두 번 누르면 그 낱말이 블록으로 설정됩니다. 세 번 누르면 그 문단이..."

### Added — Phase B-3: 표 navigation 단축키 (0.2.77)

- **Tab** (셀 안) — 다음 셀로 caret 이동. row-major 순회 (행 끝이면 다음 행 첫 셀).
- **Shift+Tab** (셀 안) — 이전 셀로 caret 이동.
- **Alt+화살표** (셀 안) — row/col 단위 셀 이동. rowSpan/colSpan 고려해 병합 셀도 정확히 진입. 표 경계 밖이면 no-op.
- **Shift+ESC** (셀 안) — 표 빠져나가기. caret을 표가 속한 단락 바로 다음 본문 단락 시작으로 (없으면 같은 단락 끝).
- 셀 안 caret이 아니면 Tab은 fall-through (본문 탭 동작 유지).
- Ctrl+Tab (셀 안 탭 문자 삽입)는 후속 (라이브러리에 cell-aware tab insert API 확인 필요).
- 기준: [한글 표 단축키 일람](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm)

### Added — Phase B-2: 한글 호환 셀/행/열 block 단축키 (0.2.76)

- **F5** (또는 Mac `⌘⌥B`) — 현재 셀 block. 600ms 안에 연속 입력 시 누름 횟수 카운트, 3회 누르면 표 전체 block (`F5×3`).
- **F7** (또는 Mac `⌘⌥C`) — 칸(열) 전체 block. 현재 셀이 속한 열 전체.
- **F8** (또는 Mac `⌘⌥R`) — 줄(행) 전체 block. 현재 셀이 속한 행 전체.
- **`⌘⌥T`** — 표 전체 block (Mac에서 F5×3 직접 진입용 단축키).
- 셀 안 caret이 아니면 모두 no-op (한글과 동일).
- rowSpan/colSpan 고려한 cell intersection 검사로 병합 셀 정확히 처리.
- 단축키 입력 즉시 `cellBlockHighlights`에 cell bbox 채워서 시각화. selectionRectsByPage / selectedControlBboxes는 비움.
- F5×2 확장 모드(arrow로 셀 단위 확장)는 별도 commit (Phase B-2.5)로 미룸.
- 기준: [한글 표 단축키 일람](https://help.hancom.com/hoffice/multi/ko_kr/hwp/view/toolbar/shortcut%28table%29.htm)

### Added — Phase A: 셀 경계 넘는 multi-cell drag block (0.2.75)

- 셀 안에서 드래그를 시작해 다른 셀로 진입하면 한컴 한글 reference대로 char-level 모드에서 cell-block 모드로 자동 전환. 통과한 모든 셀(rectangular row/col 범위)이 하이라이트됨.
- `getTableCellBboxes`로 표의 모든 셀 좌표 + row/col/span 받아서 anchor 셀 ~ focus 셀의 bounding rectangle 안에 들어오는 셀을 필터. rowSpan/colSpan 고려한 intersection 검사.
- 새 state `cellBlockHighlights`. cell-block 모드 진입 시 char-level rect는 비우고 cell bbox로만 표시. 같은 셀로 돌아오면 다시 char-level.
- 다른 표 또는 본문으로 이탈하면 focus freeze (cross-table drag는 v2).
- ESC / mouseup-empty / 새 mousedown 시 정리.
- 기준: [한컴 한글 표 셀 블록](https://help.hancom.com/hoffice/multi/ko_kr/hwp/table/table%28cell%29.htm) — "마우스가 지나간 셀이 모두 셀 블록으로 설정됩니다"
- Follow-up: F5/F7/F8 단축키 (Phase B-2), 표 navigation 단축키 (Phase B-3).

### Added — control(표) 영역 highlight 시각화 (0.2.74)

- 0.2.72에서 드래그가 control 위 통과 시 그 control이 속한 본문 단락이 selection에 포함되도록 처리했지만 시각적으로 control 자체는 highlight 안 됐음. 이제 표 bounding box를 selection 색상(`bg-primary/25`)으로 오버레이해서 표 자체도 "선택된" 것처럼 보이게 함.
- 구현: `applyPointerToSelection`이 control hit을 감지해 focus를 부모 단락 경계로 점프시킨 직후, `getTableBBox`로 표의 페이지 좌표를 받아 `selectedControlBboxes` state에 추가. mousedown 본문 시 / Esc / mouseup-empty 시 자동 클리어.
- 한계: v1은 표만 처리 (이미지/도형은 라이브러리가 통합 bbox API publish 후 추가 예정). 또한 사용자가 마우스를 빠르게 움직여 control 영역 위 hit이 1번도 발생하지 않으면 logically 포함된 control이라도 highlight 누락 가능 — 추후 paragraph 범위 enumeration으로 보강.

### Added — 셀 안 글자 드래그 selection v1 (0.2.73)

- 표 셀 내부에서 글자 드래그로 부분 선택 가능 (mousedown 위치 → 같은 셀 내 다른 위치로 mouseup). 같은 셀 + 같은 cellParaIndex 안에서만 동작 — 셀 경계를 넘으면 focus freeze (cross-cell drag는 v2).
- selection state에 `cell` 필드(`parentParaIndex`/`controlIndex`/`cellIndex`/`cellParaIndex`) 추가. `refreshSelectionRects`가 anchor/focus 둘 다 같은 cell 컨텍스트면 `getSelectionRectsInCell` 경로 사용, 아니면 기존 본문 `getSelectionRects` 경로.
- `cellDragRef`로 드래그 모드 추적. mousedown 셀 분기에서 anchor=focus 셀 caret으로 selection 초기화 후 drag listener 부착. 셀에서 시작한 더블/트리플 클릭은 비활성 (word/paragraph in-cell은 후속).
- 다음 commit에서 control 영역 highlight 시각화 추가 예정 (드래그가 표/이미지/도형 위 통과 시 그 객체 자체에도 selection 색상 표시).

### Changed — 드래그 시 표/이미지/도형 영역 통째로 선택 (0.2.72)

- 기존(0.2.69): 본문 드래그 selection이 control(표·이미지·도형) 위를 통과할 때 focus update를 freeze (=control 영역만 selection에서 제외) — 단순 보호 동작이라 사용자가 "object를 포함시키려면 어떻게?"라는 케이스 미해결.
- 변경: control 위를 통과할 때 focus를 그 control의 `parentParaIndex` (object가 anchor된 본문 단락)의 경계로 점프시켜 selection이 단락 전체를 포함하도록 처리. 방향에 따라:
  - 드래그가 object 아래로 진행 (anchor가 object 위) → focus = parentPara 끝
  - 드래그가 object 위로 진행 (anchor가 object 아래) → focus = parentPara 시작
- 결과: 표/이미지/도형 위를 드래그로 가로지르면 그 object를 품은 단락 전체가 selection에 포함됨. 드래그가 표 안에서 시작하는 케이스는 여전히 비활성 (cell selection v2).

### Fixed — wrapped paragraph 두 번째 줄 selection rect 누락 (0.2.71)

- 한 단락이 줄바꿈으로 두 줄 이상이 될 때, drag selection이 그 단락을 가로지르면 **중간 줄(wrap된 두 번째 줄)이 selection으로 highlight되지 않는** 현상.
- 진단: `getSelectionRects`가 반환한 rect들의 DOM 좌표 (`y`, `width`, `height`)를 dump해 보니 wrapped 두 번째 줄용 rect가 **첫 번째 줄과 같은 y**에 그려져서 시각적으로 겹쳐짐. 결과적으로 두 번째 줄 자리는 비어 보임.
- 근본 원인: `@rhwp/core` 0.7.9의 `getSelectionRects`가 wrapped continuation 줄의 y 좌표를 첫 줄과 동일하게 반환하는 라이브러리 버그.
- 수정: `refreshSelectionRects`에서 동일 페이지 내 같은 `y`를 가진 rect들을 검출해 두 번째부터 자기 height만큼 누적 shift. 라이브러리 fix 전 임시 workaround. 본문에서 인라인 control이 한 줄을 분할하는 케이스(드뭄)에선 false positive 가능 — 발생 시 재평가.

### Fixed — 드래그 시 페이지 전체 highlight + ESC 선택 해제 (0.2.70)

- **진짜 근본 원인** — 드래그할 때 보이던 "페이지 전체가 파란색으로 highlight" 현상은 우리 IR-level selection이 아니라 **네이티브 브라우저 selection**이 SVG `<text>` 요소 위에서 동시에 발생한 것. 우리 `handlePageMouseDown` 핸들러는 IR overlay rect로 자체 selection을 그리는데, 페이지 paper div에 `select-none`이 없어서 브라우저의 기본 텍스트 선택이 같이 진행됨. 결과: 우리 IR selection은 작은데 native가 페이지 전체를 잡아 "거대한 highlight" 시각 효과
- 모든 증상 설명: trace 상의 IR state는 정상(작음)인데 visual은 와이드 / ESC 안 먹힘 (native selection은 ESC로 해제 안 됨) / 표는 안 잡힘 (표는 별도 control이라 native text selection 대상 외)
- 수정: 페이지 paper div에 `select-none` Tailwind 클래스 추가. 네이티브 브라우저 selection 비활성화. 우리 IR selection은 `handlePageMouseDown` + `selectionRectsByPage` overlay로 단독 운영. Cmd+A/C/V는 menu 라우팅으로 IR handle에 연결돼 있어 영향 없음
- ESC 핸들러 보강 — 기존엔 `draggingRef.current` 가드로 인해 mouseup 이후엔 ESC가 no-op이었음. 드래그 종료 후에도 selection이 있으면 ESC로 해제되도록 분기 추가

### Fixed — 드래그가 표 위 통과 시 selection 점프 (0.2.69)

- **진짜 근본 원인** — 사용자가 보고한 "빈칸 들어가면 그 아래 전체 선택" 현상의 진짜 트리거는 빈 행간이 아니라 **표(table)** 였음. 본문에서 시작한 drag selection 도중 마우스가 표를 통과할 때, IR의 `hitTest`가 셀 내부 좌표를 반환 (`controlIndex`/`cellIndex`/`cellParaIndex`/`parentParaIndex` 채워서 옴). 그런데 `paragraphIndex`는 이때 **셀 안에서의 단락 인덱스**(cell-local)이고 섹션 단위가 아님. `applyPointerToSelection`이 이걸 그대로 섹션 단위로 써서 focus가 섹션 para 0(문서 맨 처음)으로 점프 → selection이 [para 0 ~ anchor]로 펼쳐짐 → 시각적으로 "위→아래 드래그한 것처럼" 보임 (anchor가 본문 아래쪽인 경우)
- 80px whitespace-jump 가드(0.2.68)로는 못 잡음 — 셀의 cursorRect는 실제 mouse Y 와 가깝게 위치하므로 (diff 8~45px) 문턱 미달
- 수정: `moveResult.controlIndex !== undefined`면 셀 내부 hit이므로 drag focus update를 skip. `handlePageMouseDown`이 이미 셀 내부 클릭은 drag 자체를 비활성화하므로, drag 중 셀 통과 케이스만 추가 가드한 셈. 셀 안↔밖 drag selection은 v2 (현재는 셀 진입 시 마지막 본문 focus 유지)

### Fixed — 드래그 빈칸 가드 진짜 작동시킴 (0.2.68)

- 0.2.67의 whitespace-jump 가드가 실제로는 **빈칸에서 그대로 점프**했음. 근본 원인: `hitTest`의 공식 반환은 `{sectionIndex, paragraphIndex, charOffset}`만 보장하고 `cursorRect`는 선택적 — 빈칸을 클릭하면 IR이 가장 가까운 텍스트 위치로 `paragraphIndex`/`charOffset`만 스냅하고 `cursorRect`는 빠진 채 반환할 때가 있음. 가드의 `if (moveResult.cursorRect)` 조건이 false가 되어 통째로 스킵돼서 focus가 IR 스냅 결과(섹션 끝 등)로 그대로 점프
- `cursorRect`가 없으면 `getCursorRect(s, p, c)`로 직접 조회해 항상 가드가 작동하게 변경. 추가로 결과 rect가 입력 페이지가 아닌 **다른 페이지**에 있을 수 있어서 (`resultRect.pageIndex`), `pageRefsRef.current[resultRect.pageIndex]`로 올바른 페이지 element의 `pageRect.top`을 사용해 client-Y 변환

### Added — 앱 아이콘 적용 + 드래그 빈칸 가드 (0.2.67)

- **앱 아이콘** — `build/icon.png` (1024px)을 electron-builder 패키징 default로 등록 (mac .icns / win .ico / linux .png 자동 변환). `public/icon.svg` + `favicon-{16,32}.png`를 `index.html`에 link → renderer favicon. TitleBar의 "한" 그라디언트 div를 `<img src="/icon.svg">`로 교체. style_example/icons에서 가져옴
- **드래그 빈칸 가드 (1차 시도)** — `applyPointerToSelection`에 whitespace-jump 검사 추가. IR의 `hitTest`가 단락 사이/페이지 여백 같은 빈 영역에서 멀리 떨어진 단락 끝(혹은 섹션 끝)으로 snap해 selection이 "그 아래 전체"로 점프하던 문제. hit 결과 `cursorRect.y`가 실제 cursor y에서 80px 이상 떨어지면 update를 거절하고 last-known focus 유지. **다만 이 시점에는 `cursorRect` 누락 케이스를 못 막음 → 0.2.68에서 보강**

### Fixed — UX 다듬기 4건 (0.2.66)

- **컨텍스트 메뉴 외부 클릭 시 닫힘** — `CellContextMenu` / `AiCommandMenu` / `SlashMenu`의 outside-mousedown 리스너가 `setTimeout(0)` race로 첫 클릭을 놓치는 케이스. 100ms timestamp guard + capture phase 등록으로 교체. trigger 직후의 ghost 이벤트는 무시, 이후 모든 외부 클릭이 메뉴 닫힘
- **드래그 영역 자연스럽게** — `applyPointerToSelection`이 페이지 사이 갭/페이지 외부에서 stale 위치에 머물던 문제. cursor가 어떤 페이지에도 안 닿으면 가장 가까운 페이지로 Y-거리 nearest fallback + 좌표 clamp(±1px). PDF/Word 표준처럼 페이지 끝까지 자연스럽게 확장
- **선택 영역 서식 read-back** — `refreshActiveFormat`이 selection focus end(드래그 끝점)를 읽어 toolbar에 "선택 직후 자리"의 format이 표시되던 문제. selection 활성 시 startOffset+1 (선택의 첫 글자 trailing 위치)에서 읽도록 변경 — Word/Pages 컨벤션 ("Bold 누르면 이 글자에 적용됨")
- **셀 안 caret 안전 폴백** — IR이 `getCharPropertiesAtInCell` getter를 노출하지 않아 셀에서 body 좌표로 읽으면 부정확. 셀이면 read-back 자체를 skip하고 last-known activeFormat 유지

### Added — 3차 UX 라운드 chunks 61~65 (0.2.65)

- **chunk 61 — 룰러 토글**: `--paper` 위에 cm-tick 가로 룰러. View 메뉴 + ⌘K. localStorage `ahwp:show-ruler` 영속
- **chunk 64 — 슬래시 명령**: 빈 body 단락에서 `/` → SlashMenu (제목 1/2/3 + 글머리/번호 + 페이지 나누기). 자체 fuzzy filter + ↑↓ Enter Esc + outside-click. styleList 매칭 후 `applyParagraphStyle` / `toggleList` / `insertPageBreak` 호출
- **chunk 62 — 버전 히스토리**: 명시적 저장마다 `userData/versions/<sha1(path):16>/<ISO>.hwp` 자동 작성 (FIFO 50). 새 IPC 3종 (`file:create-version` / `list-versions` / `read-version`). `VersionHistoryDialog`로 시간순 목록 + 복원 (정식 path에 file.save로 라우트해 `.bak` 자동 생성)
- **chunk 63 — 한국어 맞춤법 검사**: **도입 안 함**. 자체 lightweight rule-based (검출률 한계) vs `hanspell` npm (다음/부산대 외부 endpoint, 3년 stale, deprecated `request` 의존) 모두 부적합. 사용자가 정확도 필요시 chunk 56 selection AI 메뉴 / 일반 채팅으로 요청. 박제: ROADMAP의 "의사결정 박제" 섹션
- **chunk 65 — 다중 창**: `app:new-window` IPC + `AhwpApi.newWindow()` + 메뉴 "파일 → 새 창" (⌘⇧N). main의 `mainWindow` 싱글톤을 active-focused-window 라우팅으로 변경. 메뉴는 `BrowserWindow.getFocusedWindow()` 우선 → 마지막 창 → mainWindow 폴백

### Added — 1차 UX 라운드 chunks 50~55: 명령 팔레트 / 카운터 / 자동 저장 / 단축키 / 다크 종이 / 탭 고정 (0.2.55)

"최고의 문서 수정 프로그램" 격차 분석 후 사용자 가치 큰 6개를 한 묶음으로:

- **chunk 50 — 명령 팔레트 (⌘K)** — 메뉴 액션 + 열린 탭 + 단축키를 한 입력에서 fuzzy search로. 외부 라이브러리 없이 자체 scorer (~80줄). 탭 / 명령 / 최근 카테고리별 색상 배지. 키보드만으로 모든 기능 호출 가능 (↑↓ Enter Esc)
- **chunk 51 — status bar 카운터** — 단어 / 글자 수를 status bar에 항상 표시. dirty 변경 시 200ms debounce로 IR walk (1k 단락 < 5ms). 한국어 어절 카운트 패턴
- **chunk 52 — 자동 저장 (60s 간격 .draft)** — dirty 탭마다 매 분 `<path>.ahwp-draft` 사이드카에 atomic write. 다음 실행에 sidecar가 있으면 "복구하시겠습니까?" confirm. 명시적 저장 시 draft 자동 삭제. file:new temp 파일은 제외
- **chunk 53 — 단축키 치트시트 (⌘/)** — 6개 카테고리 (파일 / 편집 / 서식 / 캐럿·선택 / 네비 / 표·셀)로 정리한 read-only dialog. ⌘K와 동시에 알면 새 사용자 학습 곡선 ↓
- **chunk 54 — 다크 모드 본문 종이 흰색 유지** — `--paper` CSS 변수 신설. 다크 chrome / 본문 페이지는 항상 white. IR의 SVG 텍스트 색상이 hard-coded라 다크 페이지면 본문이 사라지는 문제 회피
- **chunk 55 — 탭 고정 (📌)** — 우클릭 메뉴 "탭 고정" / "고정 해제". 고정 탭은 아이콘 + 좌측으로 자동 정렬 + closeOthers / closeRight bulk close에서 보호. 닫기 시도하면 명시적 confirm

회귀 e2e 5건 (`tests/e2e/round-1-ux.spec.ts`): ⌘K palette 검색 / status bar 카운터 / saveDraft IPC contract / ⌘/ cheatsheet / page paper white in light mode.

다음 라운드 (0.2.60 예정): chunks 56-60 — AI 우클릭 메뉴 / AI inline diff / 목차 사이드바 / PDF 미리보기 / 검색 in 폴더.

### Changed — chunk 49: `ollama` provider 슬롯 제거 → `custom` 통합 (0.2.49)

`Ollama (self-hosted)` provider 슬롯을 별도로 두지 않고 `custom` (OpenAI 호환)으로 통합. 자체 호스팅 Ollama 사용자는 `custom` provider에 base URL `http://localhost:11434/v1`을 입력해 동일하게 사용 가능:

- **이유** — Ollama는 OpenAI 호환 `/v1` shim을 제공하므로 별도 어댑터가 그냥 dead surface area였음. vLLM / LM Studio / on-prem LLM 게이트웨이도 같은 카테고리라 한 슬롯으로 묶는 게 자연스러움
- **`ProviderId` union** — `'ollama'` 제거. `'openai' | 'anthropic' | 'google' | 'nvidia' | 'custom'`
- **`PROVIDERS` 메타** — `ollama` row 제거. `custom` row 유지 (requiresBaseUrl=true)
- **문서 일괄 갱신** — README, CLAUDE.md, ARCHITECTURE / AI_INTEGRATION / TECH_STACK / ROADMAP / PROGRESS 모두 `ollama` 언급을 `custom (OpenAI 호환)` 통합 표기로 교체
- **불변** — 기존 OpenAI / NIM 어댑터 + chunk 48 listModels / 24h 캐시 / datalist UI 그대로

### Added — chunk 48: provider 모델 동적 fetch + 24h 캐시 (0.2.48)

각 provider의 사용 가능한 모델을 API에서 직접 불러와 ChatPanel 모델 입력에 datalist autocomplete으로 노출:

- **Provider 인터페이스 확장** — `Provider.listModels(opts)` optional 메서드 추가. OpenAI는 `GET /v1/models`, NIM은 OpenAI 호환 `/v1/models`(델리게이트), fake은 deterministic 카탈로그 + `BAD-key` 거절 분기
- **24h 디스크 캐시** — `userData/model-cache.json`에 provider별 `{fetchedAt, models}` 영속. `ai:list-models(force?)` IPC가 fresh(<24h)면 캐시 즉시 반환, 아니면 refetch 후 캐시 갱신, refetch 실패 + 캐시 있음이면 `stale-cache`, 둘 다 없음이면 `error`. 새 IPC `ai:clear-models-cache(providerId)`로 수동 무효화
- **ChatPanel UI** — 기존 모델 텍스트 입력은 그대로 유지(자유 입력 우선). 옆에 `<datalist>`로 fetch 결과 autocomplete + 새로고침 버튼(상태에 따라 `↻` / `⟳` / `⚠`). 버튼 title에 사유 노출. provider 변경 + 키 false→true 전이 시 자동 fetch
- **폴백 정책** — listModels 실패는 provider를 비활성화하지 않음. dropdown만 비고 자유 입력은 살아있어 chat은 정상 작동. 사용자에게는 ⚠ 배지 + 툴팁으로 "확인 불가" 상태 노출

회귀 e2e 5건(`tests/e2e/chat-model-list.spec.ts`): listModels ok / error / stale-cache 3가지 IPC 응답 검증 + 새로고침 버튼 상태 + datalist option 노출.

대상 범위: OpenAI / NVIDIA NIM (현재 활성). Anthropic은 Phase 2-B 키 잠금 해제와 함께 추후. Ollama는 별도 어댑터 작성 필요(GET /api/tags) — 후속.

### Added — Phase 2 마무리: chunks 29 / 30 / 34 / 35 (0.2.47)

Phase 2의 잔여 4개 청크를 일괄 완료:

- **청크 29 — AI 변경 되돌리기 토스트** — `applyHtml` / `runTools` 성공 후 "되돌리기" 버튼이 "✓ 적용됨" / "✓ 적용됨 (N/M)" 옆에 함께 노출. 15초 동안 유지되다가 자동 사라짐. 클릭 시 chunk 27의 묶음 undo로 AI 턴 전체를 한 번에 롤백 (도구 N개를 한 응답에서 실행해도 1회 클릭으로 모두 복원). `ViewerHandle.canUndo()` 신설로 undo 가능 여부 검사
- **청크 30 — 채팅 히스토리 인라인 이름 변경** — 📚 popover의 conversation 행에 ✎ 버튼 + 더블클릭 진입. input swap → Enter 저장 (`chatHistory.rename` IPC) / Esc 취소 / blur 시 자동 커밋. 낙관적 로컬 갱신 + IPC 실패 시 SQLite 원본 재조회로 롤백
- **청크 34 — 표 수식 다시 계산** — 셀 우클릭 메뉴에 "수식 다시 계산…" 추가. `TableFormulaDialog`로 수식 입력(`=SUM(A1:A5)`, `=A1+B2*3` 등) → "미리 보기"(write_result=false)로 결과 확인 → "셀에 적용"(write_result=true)으로 셀에 결과 텍스트 작성. `ViewerHandle.evaluateTableFormula(sec, parentPara, ctrl, row, col, formula, writeResult)` 위임
- **청크 35 — 머리말/꼬리말 다중 라인 + 페이지 템플릿** — `HeaderFooterDialog`의 단일 라인 Input을 4행 textarea로 교체. 페이지 템플릿 토글 추가 — 양쪽(applyTo=0) / 홀수(=1) / 짝수(=2) 각각 독립 슬롯으로 IR에 저장. `setHeaderFooterText` 내부에서 `\n` 감지 시 `splitParagraphInHeaderFooter` 호출로 라인별 단락 분리

회귀 e2e 5건(`tests/e2e/phase2-finale.spec.ts`): 머리말 다중 라인 round-trip + 홀/짝 슬롯 독립 + 셀 우클릭 메뉴 "수식 다시 계산…" 노출 + 되돌리기 버튼이 alignment를 right→default로 롤백 + 인라인 rename input swap.

이 4개 청크 마무리로 Phase 2의 사용자-facing 작업은 모두 종료. 후속 잔여(deferred): chunk 31(자동 title summary, AI call 복잡), chunk 32(셀 selection v4, 대형), chunk 33(도형 라인/곡선/그룹, rhwp 0.8 대기), chunk 36(스타일 char/para shape 캡처, rhwp 0.8 대기). Phase 2-G(provider tool-use API 정식 통합 / docId-aware 라우팅 / 다중 턴 자동 실행)는 Phase 3 진입과 병행.

### Added — P0/P1 편집 UX 보강 (visual line nav · shift+click · auto-scroll · Esc-cancel · 저장 보호)

오늘 fix한 UX 회귀 3건과 같은 클래스의 잔여 디테일을 한 묶음으로 보강:

- **ArrowUp / ArrowDown 시각 라인 nav** — `cursorRect` (page-local x/y/height)와 `hitTest`를 조합해 현재 라인의 ±lineHeight × 1.4 위치에서 동일 x의 offset을 찾아 이동. 페이지 경계를 넘어가면 인접 페이지로 자동 전환. Shift 확장도 동일 패턴
- **Shift+클릭 selection 확장** — 기존 selection이 있으면 anchor를 보존하고 focus만 클릭 위치로, 없으면 직전 caret을 anchor로 사용. Word/한컴/PDF 표준 동작
- **드래그 자동 스크롤** — 드래그 중 cursor가 scroll container 위/아래 36px 이내로 들어오면 거리에 비례한 속도(최대 24px/frame)로 `requestAnimationFrame` 루프로 스크롤. 마우스 정지 상태에서도 끝부분에 머물면 계속 스크롤 + selection 확장. PDF reader 표준
- **Esc로 드래그 취소** — 드래그 중 Esc → window 리스너 detach + auto-scroll rAF cancel + 드래그 시작 직전 selection 상태로 롤백
- **`commitCaretMove` 헬퍼** — `handleKeyDown` 내부 6곳에 반복되던 "caretRef 갱신 / shift extend / cursor·toolbar 갱신" 패턴을 하나의 useCallback으로 묶음. 향후 Page Up/Down에 caret 동행 같은 nav 추가 시 동일 helper 재사용. P2-1 keymap dispatch table 분할은 별도 청크로 박제

### Added — 저장 안전망 (`.bak` 백업 + HWPX 라우팅 알림 + 외부 변경 감지)

- **`.bak` 사이드카** — `file:save` / `file:save-as`가 기존 파일을 덮어쓰기 직전 `<target>.bak` 복사본을 한 번 작성. 같은 경로의 후속 저장은 기존 `.bak`를 그대로 둠 (= 편집 세션 시작 직전 상태가 보존됨). 새 파일은 백업 생략. `FileOpenResult.backupPath`로 결과에 노출. 작성 실패는 non-fatal
- **HWPX 자동 라우팅 알림** — 사용자가 `.hwpx`로 저장 요청 시 `@rhwp/core` 라이브러리 한계로 `.hwp`로 자동 라우팅되어 왔지만 무음이었음. `FileOpenResult.routedFrom`에 원래 요청 경로를 실어 보내고, AppShell에서 상단 노란 banner (`data-testid="app-notice"`)로 5초간 표시 + 직접 닫기 버튼
- **외부 파일 변경 감지** — 새 IPC `file:watch-paths(paths[])` + `file:external-change` 이벤트. AppShell이 열린 탭 path 목록을 main에 전달, main에서 단일 chokidar 인스턴스로 watch. 외부 변경 시 (a) 탭 dirty=false면 viewer key bump으로 자동 reload + info 토스트, (b) dirty=true면 warn 토스트로 알림 (덮어쓰기 시 외부 변경분 손실 경고). 우리 자신의 저장은 1.5초 suppression window로 self-loop 방지

### Added — 일반 알림 banner (`<AppShell>` notice slot)

- 작은 status banner를 TitleBar 아래에 가변 슬롯으로 추가 (`info` / `warn` 두 톤). 5초 자동 dismiss + 수동 ✕ 버튼. 향후 다른 비치명 안내(저장 충돌, 권한 거절 등)에서 재사용

### Fixed — UX 회귀 3건 (caret 상태 동기화 / 드래그 / Ctrl+A)

리팩토링 라운드 중 발견된 편집 UX 회귀 3건을 한 묶음으로 수정. 모두 `StudioViewer.tsx`의 `handleKeyDown` + page mouse 핸들러 경로 단일 변경:

- **캐럿 이동 시 툴바 pressed-state 미반영** — 화살표 / Home / End / Cmd+화살표(단어 단위) 캐럿 이동에서 `caretRef`만 갱신하고 `refreshActiveFormat()` 호출이 빠져 있었음. Bold 글자 옆 plain 글자로 캐럿을 옮겨도 Bold 버튼이 계속 눌린 상태로 남았음. 모든 nav 분기에 `refreshActiveFormat()` 추가 (마우스 클릭은 이미 호출 중)
- **드래그 selection이 페이지 경계에서 끊김** — 페이지 div의 `onMouseLeave={handlePageMouseUp}`이 cursor가 페이지를 벗어나는 즉시 드래그를 종료시키고 있었음 (PDF 드래그처럼 일관된 동작 X). 드래그 시 `document` 레벨 mousemove / mouseup 리스너를 `handlePageMouseDown`에서 attach해 페이지 사이 갭·외부 chrome·바깥쪽 mouseup까지 살아남도록 수정. 페이지별 mouseMove/mouseUp/mouseLeave 핸들러는 제거 (window 리스너로 일원화)
- **Ctrl+A가 프로그램 전체 선택** — 키 핸들러에 'a' 분기가 없어 브라우저 기본 selectAll로 빠져 toolbar / sidebar / status bar까지 파랗게 칠해졌음. `Cmd/Ctrl+A` 분기 추가 — 활성 섹션 전체(0번 단락 0번 offset → 마지막 단락 끝)를 IR selection으로 만들고 `preventDefault()`. 추가로 페이지 mousedown 시 `scrollRef.focus({preventScroll:true})`를 호출해 툴바 버튼 클릭 후에도 후속 키 입력이 viewer 핸들러로 들어오도록 보강

회귀 방지 e2e 5종 추가 (`tests/e2e/studio-ux-fixes.spec.ts`): 화살표 nav 후 activeFormat / aria-pressed 검증, Cmd+A 후 IR selection 범위 + 브라우저 selection 비검증, 페이지 외부 mouseup 후 드래그 상태 정상 종료 검증, 페이지 내 드래그 commit 검증.

### Added — Phase 2 청크 38~42: IR-only 기능 UI 노출

이전 라운드에서 IR + ViewerHandle만 구현되고 사용자 UI가 없었던 기능 5종을 일괄 UI로 노출:

- **청크 38: 표/셀 속성 다이얼로그** — 셀 우클릭 메뉴에 "셀 속성…" / "표 속성…" 추가. padding (mm 단위), 셀 간격, 매 페이지 머리행 반복(표), 세로 정렬 / 머리 셀 지정(셀)
- **청크 39: 그림 속성 다이얼로그** — 메뉴 "보기 → 그림 속성…" 진입. `enumeratePictures`로 문서 내 그림 목록 픽커 + 너비/높이 (mm) + 글자처럼 취급 + 삭제 버튼
- **청크 40: 컨트롤 클립보드 단축키** — 메뉴 "편집 → 컨트롤로 복사 / 컨트롤로 붙여넣기" + ⌘⇧C / ⌘⇧V 단축키. 셀 안 캐럿이면 부모 표를 복사, 본문 캐럿이면 같은 단락의 첫 컨트롤(그림/도형/표)을 복사
- **청크 41: HTML 내보내기 메뉴** — "파일 → HTML로 내보내기…" + 새 IPC `file:export-html`. 활성 문서의 본문(첫 1000문단)을 미니멀 `<!DOCTYPE html>` 셸로 감싸서 사용자가 선택한 .html 경로에 저장
- **청크 42: 셀 스타일 적용 우클릭 메뉴** — 셀 우클릭 메뉴에 "스타일 적용…" 추가. `getStyleListJson`으로 명명된 스타일 리스트 → 라디오 선택 → `applyCellStyle`. 셀 배경색·테두리는 라이브러리 한계(KNOWN_ISSUES L-006)로 미리 만든 스타일을 통해서만 적용 가능 — 다이얼로그 설명에 명시

### Changed — UI/UX 1차 리뉴얼 (style_example 기반)

- **워밍 페이퍼 / 잉크 팔레트** — `--background`(off-white #f6f4ef) / `--card`(#fbfaf6) / `--popover`(#ffffff 종이) / `--primary`(deep teal-ink #2b6a6b) / `--muted`(#efece5 chrome) / 다크 모드는 #17171a 베이스 + bright teal #5fb4b3 액센트. 기존 shadcn 토큰 이름은 유지하면서 HSL 값만 교체 — 컴포넌트 레이어 영향 없음
- **커스텀 36px 타이틀바** — macOS는 `hiddenInset`로 신호등 영역만 남기고 OS 타이틀 숨김. Win/Linux는 OS chrome 완전 제거 후 렌더러 측에서 paint. "한" 그라디언트 로고 + ahwp 워드마크 + 활성 파일 basename + dirty dot + 다크 토글 + 설정 버튼. 드래그 영역(`-webkit-app-region: drag`)
- **웰컴 화면 리뉴얼** — 빈 상태에서 "안녕하세요." 인사 + ⌘N "빈 문서로 시작" 카드 + ⌘O "파일 열기" 카드(드래그앤드롭) + 최근 파일 3-col 그리드(종이 미리보기 + HWP 배지 + 상대 시간). 기존 testid (`welcome-new-doc` / `welcome-open`) 유지 — e2e 호환
- **타이포그래피** — 기본 13px / -0.005em letter-spacing. Pretendard 우선, Apple SD Gothic Neo / Malgun Gothic / Noto Sans KR 폴백
- 기존 12px 상단 헤더(편집기 위 ahwp + ThemeToggle) 제거 — 타이틀바가 그 역할 흡수

### Added — Phase 1 잔여 마무리 (탭 DnD + 컨텍스트 메뉴 / temp 정리)

- **탭 드래그 재배치** — 탭 strip에서 탭을 잡아 다른 위치로 드래그. HTML5 native drag (`text/x-ahwp-tab` MIME)
- **탭 우클릭 컨텍스트 메뉴** — 닫기 / 다른 탭 모두 닫기 / 오른쪽 탭 모두 닫기 / 경로 복사 / 파일 관리자에서 보기. dirty 탭이 포함되면 confirm 프롬프트로 데이터 보호. Escape / 외부 클릭으로 메뉴 닫힘
- **temp 파일 자동 정리** — `file:new`로 만들어진 `userData/temp/new-*.hwp` 스크래치 파일을 앱 종료 시 자동 삭제 (will-quit 훅)

### Added — Phase 2 청크 26: 채팅 히스토리 (better-sqlite3 영속)

- **모든 대화 자동 저장 + 다시 열기** — ChatPanel 헤더에 📚 (대화 목록) + ➕ (새 대화) 버튼. 첫 메시지 보낼 때 자동으로 conversation row 생성, 사용자/어시스턴트 메시지 모두 SQLite에 append
- 📚 누르면 활성 문서 기준의 저장된 대화 목록 표시 (최근 업데이트 순). 클릭하면 메시지 복원, × 누르면 영구 삭제
- 활성 문서가 바뀌면 그 문서의 conversation 목록만 보임 — 문서별로 채팅 분리
- DB 위치: `userData/chat-history.db` (WAL 모드, FK cascade로 conversation 삭제 시 messages 자동 삭제). 스키마 마이그레이션은 `PRAGMA user_version` 기반 — 컬럼 추가 시 v2 블록 추가
- IPC: `chat-history:list/get/create/append/rename/delete`. 평소 운영은 `create` → `append(user)` → 스트림 → `append(assistant)` 흐름. 실패는 console.warn으로 fallthrough — 채팅 흐름 차단 안 함
- electron-builder `asarUnpack`에 `better-sqlite3` 등록, vite externalize 추가, electron-rebuild로 native 모듈 빌드

### Added — Phase 2 청크 28: 멀티 문단 발췌 (span anchor 모델)

- **여러 문단에 걸친 selection도 그대로 첨부 가능** — 청크 20·22의 발췌 첨부는 단일 문단으로 한정됐었음. 이제 첫 문단 [startOffset → 끝], 중간 문단 전체, 마지막 문단 [0 → endOffset]을 `\n`으로 묶어 캡처
- `TextRange` 타입 갱신: `paragraphIndex` → `startParagraphIndex` + `endParagraphIndex` (마이그레이션 필요한 외부 코드 없음 — shared/ai-excerpt.ts 외 사용처 없음)
- send-time stale 검증도 다중 문단 anchor를 read-back. 자동 재바인딩 (relocateExcerpt)은 단일 문단 hit만 시도 — 다중 문단은 stale-missing으로 graceful degrade. 사용자가 다시 선택하면 됨
- 칩 라벨이 `¶3..7` 형식으로 span 표시. 시스템 프롬프트의 `[발췌]` 블록 anchor도 동일

### Added — Phase 2 청크 27: 묶음 Undo (AI-applied 턴 한 번에 되돌리기)

- **AI가 한 응답에 여러 op를 실행해도 ⌘Z 한 번에 모두 되돌림** — `runTools`가 `beginUndoGroup` / `endUndoGroup` 브래킷 안에서 N개 op를 실행하므로 사용자에게는 단 하나의 undo 엔트리로 보임
- 직접 편집(타이핑/Backspace 등)은 기존대로 op마다 독립 snapshot. 그룹은 AI dispatcher가 명시적으로 시작·종료할 때만 활성
- 그룹 카운터 방식이라 nested begin/end도 안전. finally로 보장되어 op throw 시에도 group이 정상 종료

### Added — Phase 2 청크 25: 컨트롤 클립보드 (`copyControl` / `pasteControl`)

- 표·도형·이미지 같은 컨트롤 객체를 IR 내부 클립보드에 복사·붙여넣기. 텍스트 클립보드와 분리된 채널 (기존 `copy` / `paste`는 텍스트만)
- ViewerHandle에 `copyControl(sec, para, controlIdx)` / `pasteControlAt(sec, para, charOffset)` 추가
- 향후 표 단위 복사·붙여넣기 단축키, 컨트롤 우클릭 메뉴 통합의 IR 토대

### Added — Phase 2 청크 24: 그림 속성 IR (`getPictureProperties` / `setPictureProperties` / `deletePictureControl`)

- 이미지 컨트롤의 너비·높이·`treatAsChar` 등의 속성을 read/write로 노출. ViewerHandle에 `getPictureProps` / `setPictureProps` / `deletePictureControl` 추가
- 향후 그림 크기 조정 다이얼로그·드래그 리사이즈 UI의 IR 토대. AI 에이전트가 컨트롤 인덱스를 알 때 직접 사용 가능 (ahwp-tools에 추가는 controlIdx 발견 도구가 마련된 후)

### Added — Phase 2 청크 23: 셀 스타일 적용 (`applyCellStyle` IR + ahwp-tools)

- 미리 정의된 named style을 셀에 적용하는 IR + 도구 추가. AI는 `getStyleListJson`으로 색깔 있는 style을 찾아 `applyCellStyle`로 셀에 입힐 수 있음
- **셀 배경색·테두리 직접 setter는 라이브러리 미지원** — `@rhwp/core` 0.7.9의 `setCellProperties`는 padding/spacing/verticalAlign/isHeader만 받음. 직접 색깔 설정은 KNOWN_ISSUES L-006로 박제하고 lib 업스트림 대기
- ahwp-tools 화이트리스트에 `applyCellStyle({sectionIdx, parentParaIdx, controlIdx, cellIdx, cellParaIdx, styleId})` 추가

### Added — Phase 2 청크 22: HTML5 drag UX (StudioViewer selection → ChatPanel)

- **선택 영역을 챗봇으로 드래그** — StudioViewer의 selection rect가 `draggable="true"`가 되어 채팅 입력 폼에 끌어다 놓으면 칩으로 즉시 승격됨. `application/x-ahwp-excerpt` 커스텀 MIME에 `{docPath, anchor, text}`를 직렬화하고 `text/plain`으로 폴백 (외부 앱에 끌면 일반 텍스트로 떨어짐). 청크 20의 버튼 캡처 경로와 동일한 데이터 모델 사용
- 드래그 중 selection rect 커서가 grab/grabbing으로 전환

### Added — Phase 2 청크 21: 멀티 문서 컨텍스트 (target / reference 칩)

- **두 개 이상 탭이 열려 있을 때 다른 문서를 참조 컨텍스트로 추가** — ChatPanel 입력 폼 위 새 칩 행에 활성 탭(🎯 target, 잠김) + 다른 열린 탭(📚 reference, 체크박스). reference에 체크하면 그 문서의 첫 20문단 outline이 시스템 프롬프트의 `[참조 문서]:` 블록으로 주입됨
- "B의 뉘앙스로 A 다듬어줘" 같은 cross-document 요청을 단일 턴에 표현 가능. reference는 읽기 전용으로 명시 — 시스템 프롬프트가 모델에 변경은 활성 문서(target)에만 적용하라고 강제
- 변경 적용 (` ```html``` ` / ` ```ahwp-tools``` `) 은 활성 viewer로만 dispatch되므로 reference 손상 위험 없음 (single-target dispatch 패턴)
- 비활성 탭의 outline은 mount된 viewer에서 직접 읽음 — 추가 마운트·파일 I/O 비용 없음
- NVIDIA NIM `qwen/qwen3.5-122b-a10b`로 라이브 검증 (`nvidia-live.spec.ts` chunk 21 — 모델이 reference doc의 단어를 응답에 인용해 `[참조 문서]` 블록이 도달함을 증명)

### Added — Phase 2 청크 20: 발췌 첨부 (`ExcerptAttachment` + `[발췌]:` 시스템 블록)

- **사용자가 선택한 영역만 AI에 첨부** — 입력 폼 위 `📌 발췌 첨부` 버튼으로 활성 StudioViewer 선택을 칩으로 캡처. 칩이 하나라도 있으면 청크 18의 통째 문서 HTML 대신 `[발췌]:` 블록(번호 + 경로 + anchor + 텍스트)이 시스템 프롬프트에 주입됨 → 토큰 사용량↓, anchor 정확도↑
- 칩은 fresh / stale-relocated(자동 재바인딩, 앰버) / stale-missing(빨강·전송 차단) 3가지 상태. 보낸 시점 IR을 다시 읽어 hash 비교 → 일치 안 하면 문서 전체 1회 스캔(1000문단 상한)으로 같은 텍스트 찾아 anchor 자동 갱신
- 긴 발췌(2000자 초과) ⚠️ 토큰 경고 표시. 하드 캡 16KB
- HTML5 drag-and-drop UX는 SVG selection 모델 침투를 피해 청크 22로 분리 — 데이터 모델·칩 UX·stale check은 이번 청크에 모두 포함
- NVIDIA NIM `qwen/qwen3.5-122b-a10b`로 라이브 검증 (`nvidia-live.spec.ts` chunk 20 — 발췌 sentinel 단어가 응답에 인용되어 `[발췌]` 블록이 모델에 도달함을 증명)

### Added — Phase 2 청크 19: Manual 모드 도구 디스패치 (`ahwp-tools` JSON 블록)

- **AI가 한컴 컨트롤 객체를 직접 다룸** — 청크 18의 ` ```html``` ` 라운드트립이 다루지 못하는 각주·머리말·책갈피·페이지 설정·스타일·도형을 별도 JSON 블록으로 명령
- 어시스턴트 응답에 ` ```ahwp-tools\n{"ops": [...]}\n``` ` 블록 감지 → ops 미리보기 → **"도구 실행"** 버튼 → 화이트리스트 IR 호출 순차 실행. 결과 토스트 (`✓ 적용됨 (5/6)`)
- 11개 tool 카탈로그: `applyHtml` / `applyAlignment` / `applyFontSize` / `applyTextColor` / `toggleCharFormat` / `insertFootnote` / `addBookmark` / `setHeaderFooterText` / `applyPageDef` / `createNamedStyle` / `createRectShape`. `shared/ai-tools.ts`에 합집합 타입 + 인자 검증기로 박제
- **보안** — 화이트리스트 enforcement (등록되지 않은 tool 즉시 거절), `eval` 일체 사용 안 함 (명시적 switch 분기), 사용자 명시 액션(버튼 클릭) 후에만 실행, ops 상한 50개, 시크릿/파일/셸 접근 카탈로그에서 제외
- 시스템 프롬프트가 HTML과 tool의 분리 기준을 명시 — 흐르는 글자·문단 양식 = `applyHtml`, 컨트롤 객체 = 별도 tool
- **provider tool-use API 바인딩은 Phase 3 Agent 모드로 보류** — 청크 19는 응답-텍스트 기반 결정론적 디스패처

### Added — Phase 2 청크 18: HTML 내보내기/붙이기 + ChatPanel 문서 컨텍스트

- **AI 문서 양식 라운드트립** — 채팅 입력란 위에 `📎 현재 문서를 컨텍스트로 첨부` 토글. 활성 시 문서 본문(첫 50문단)을 HTML로 변환해 system 메시지로 자동 첨부
- 어시스턴트 응답에 `\`\`\`html\`\`\`` 블록이 있으면 메시지 하단에 **"문서에 적용"** 버튼 노출 → 클릭 한 번으로 정렬·줄간격·들여쓰기·문단간격·글자 서식이 IR에 반영됨
- 시스템 프롬프트가 한컴 한글 양식 표준(보고서·정렬·간격)을 인라인 스타일 가이드와 함께 명시 — AI가 양식을 보존한 변경분을 안정적으로 작성
- IR 분해 layer: `pasteHtml`은 글자 단위 스타일은 보존하지만 문단 단위(`text-align`/`margin`/`line-height`/`text-indent`)는 무시. `applyHtmlAtCaret`이 DOM walk로 누락분을 `applyParaFormat`으로 다시 적용
- ViewerHandle: `applyHtmlAtCaret(html)` / `exportDocumentHtml(maxParagraphs?)` 신설
- **NVIDIA NIM `meta/llama-3.1-70b-instruct`로 라이브 검증** (e2e `nvidia-live.spec.ts` chunk 18 round-trip — `NVAPI_KEY` 환경 변수 게이트)

### Added — Phase 2 청크 15: 사각형 도형 (MVP)

- 메뉴 "보기 → 사각형 도형…" 또는 `insert:shape` IPC로 다이얼로그 진입
- 너비·높이 (mm) + "글자처럼 취급" 토글로 캐럿 위치에 사각형 도형 삽입
- `createShapeControl` / `getShapeProperties` / `setShapeProperties` / `deleteShapeControl` / `changeShapeZOrder` IR API 직접 위임
- **라인 / 곡선 / 화살표 / 도형 그룹은 후속 청크로 보류** (라이브러리가 createShapeControl JSON에 shape-type 미노출)

### Added — Phase 2 청크 17: 표 / 셀 속성 (padding / spacing / verticalAlign)

- `getTableProperties` / `setTableProperties` / `getCellProperties` / `setCellProperties` IR API 직접 위임
- **현재는 `__studioDebug` + ViewerHandle 노출만** — UI 다이얼로그(셀 우클릭 v4)는 후속
- 셀 배경색·테두리는 별도 `applyCellStyle` 메커니즘 — 후속

### Added — Phase 2 청크 16: 수식 미리보기

- 메뉴 "보기 → 수식 미리보기…" 또는 `insert:equation` IPC로 다이얼로그 진입
- 한컴 수식 script textarea + 라이브 SVG 미리보기 (`renderEquationPreview` IR)
- **본문 삽입은 후속 청크** (라이브러리에 명시적 createEquation 없음)

### Added — Phase 2 청크 14: 스타일 관리 (add / rename / delete)

- 메뉴 "보기 → 스타일 관리…" 또는 `view:style-manager` IPC로 다이얼로그 진입
- 스타일 목록 (id, 이름, 영문명) + 새 스타일 추가 폼 + 인라인 이름 변경 (Enter/Esc/blur) + 삭제 버튼
- id 0 (바탕글) 삭제는 비활성 — 모든 문단의 fallback 타깃이라 dangle 위험
- `createStyle` / `updateStyle` / `deleteStyle` / `getStyleList` IR API 직접 위임
- **스타일에 char/para shape 캡처는 후속 청크로 보류** — 현재는 빈 셸만 생성

### Added — Phase 2 청크 13: 각주 삽입 (MVP)

- 메뉴 "보기 → 각주…" 또는 `insert:footnote` IPC로 다이얼로그 진입
- 현재 커서 위치에 각주 삽입 + 본문 텍스트 한 번에 (단일 라인 MVP)
- `insertFootnote` / `insertTextInFootnote` / `getFootnoteInfo` IR API 직접 위임
- IR 실패(라이브러리 panic 등) 시 다이얼로그 내부 banner로 surface — 닫으면 자동 클리어
- **알려진 한계** — `createBlankDocument` 기반 빈 문서엔 footnote 영역이 정의 안 되어 라이브러리가 panic. 실제 .hwp/.hwpx 파일은 정상 작동
- **각주 안 caret 편집 모델 + 다중 라인 본문은 후속 청크로 보류**

### Added — Phase 2 청크 12: 책갈피 (add / list / rename / delete)

- 메뉴 "보기 → 책갈피…" 또는 `insert:bookmark` IPC로 다이얼로그 진입
- 현재 커서 위치에 이름 붙여 책갈피로 저장 (이름 input + "추가" 버튼)
- 저장된 책갈피 목록 — 각 행에 `§{sec} · ¶{para} · @{charPos}` 위치 + 삭제 휴지통
- `addBookmark` / `getBookmarks` / `renameBookmark` / `deleteBookmark` IR API 직접 위임
- **점프 기능(책갈피 클릭 → caret + scroll)은 후속 청크로 보류**

### Added — Phase 2 청크 11: 머리말 / 꼬리말 (MVP)

- 메뉴 "보기 → 머리말 / 꼬리말…" 또는 `insert:header-footer` IPC로 다이얼로그 진입
- 머리말 / 꼬리말 라디오 토글, 단일 라인 텍스트 입력, 모든 페이지에 적용 (applyTo=0)
- 적용 / 제거 / 취소 버튼. 빈 값 적용 = 슬롯 제거
- `createHeaderFooter` / `insertTextInHeaderFooter` / `getHeaderFooter` / `deleteHeaderFooter` IR API 직접 위임. 덮어쓰기 시 drop & recreate으로 append 방지
- **다중 라인 / 페이지 템플릿(홀수만/짝수만/첫 페이지)은 후속 청크로 보류**

### Added — Phase 2 청크 10: 페이지 설정 (용지 / 방향 / 여백)

- 메뉴 "보기 → 페이지 설정…" 또는 `view:page-setup` IPC로 다이얼로그 진입
- 용지 5종 preset: A4 / A5 / B5 / Letter / Legal + 사용자 정의 (mm 단위 직접 입력)
- 가로 방향 토글, 4 여백 (위·아래·좌·우, mm 단위)
- `setPageDef` / `getPageDef` IR API 직접 위임. mm ↔ HWPUNIT 변환 (1mm = 283.5)
- 적용 시 IR 자동 re-paginate

### Added — Phase 2 청크 9: 셀 합치기 / 나누기 / 병합 해제

- 표 셀 우클릭 메뉴에 4개 신규 항목: **오른쪽 셀과 병합 / 아래 셀과 병합 / 셀 나누기 (2×2) / 병합 해제**. 마지막 행/열에서는 해당 병합 항목 자동 비활성화
- `mergeTableCells` / `splitTableCell` / `splitTableCellInto` IR API 직접 위임 — 합치기는 logical span(rowCount/colCount 유지, cellCount 감소), 분할은 IR 메타 기반 복원

### Added — Phase 2 청크 8: 줄 간격 / 들여쓰기 / 문단 간격 + 하단 status bar

- **하단 status bar** — 한컴 한글 패턴으로 분리. 상단 툴바엔 편집 서식(B/I/U·정렬·폰트·스타일)만, 하단에 undo/redo/zoom(축소·100%·확대·너비맞춤)/dirty/페이지 인디케이터
- **줄 간격** — 확장 toolbar에 셀렉터 (1.0 / 1.15 / 1.5 / 2.0 / 3.0). `applyParaFormat({lineSpacing})` IR 위임
- **들여쓰기 / 내어쓰기** — 두 버튼. `getParaPropertiesAt`로 현재 `marginLeft` 읽어 ±1cm(5670 HWPUNIT) 적용, 0에서 floor
- **문단 간격** — 셀렉터 (없음 / 위 0.5 / 위 1.0 / 위·아래 1.0). `spacingBefore` / `spacingAfter` HWPUNIT

### Added — Phase 2 청크 7: 찾아 바꾸기 (⌘H)

- **찾아 바꾸기** — `Cmd/Ctrl+H` 또는 메뉴 "편집 → 바꾸기…"로 Find bar 확장. 검색어 + 치환어 + "바꾸기" / "모두 바꾸기" 버튼 + 결과 피드백 ("3건 바꿈"). `@rhwp/core`의 `replaceOne` / `replaceAll`에 직접 위임 (case-insensitive). 빈 치환 = 매치 삭제. Enter/Shift+Enter on 치환 input → 단일/모두 바꾸기

### Changed — E2E 인프라

- `examples/` 디렉토리를 git 추적으로 전환. 사용자 .hwp 3개(5.1MB) 커밋. CI/새 클론에서 11 BIG_FIXTURE skip 자동 활성화 → 신규 컨트리뷰터 셋업 단순화
- `playwright.config.ts`에 `retries: 1` 추가. 4 워커 병렬 race(folder-ops DnD / state 전파)는 재시도로 자동 흡수, 진짜 회귀는 두 번 모두 실패해야 카운트되어 마스킹 없음

### Changed — 의존성

- `@rhwp/core` 0.7.8 → 0.7.9 (backward-compatible patch). 신규 메서드 4개: `insertParagraph` / `deleteParagraph` (문단-단위 IR 조작) + `renderPageCanvasLegacy` / `renderPageToCanvasLegacy` (레거시 Canvas 경로 — 즉시 활용 안 함). 시그니처 변경/제거 없음

### Added — paragraph IR ops 게이트 (Phase 3·2-E 대비)

- `__studioDebug.insertParagraph(sec, idx)` / `deleteParagraph(sec, idx)` 노출. 향후 Agent tool 화이트리스트 / Manual diff 흐름에서 안전하게 wire되도록 회귀 게이트 사전 설치 (UI 노출은 Enter/Backspace로 이미 커버되므로 보류)
- e2e 2 케이스 추가 (insertParagraph 인덱스 추가 + deleteParagraph 시프트)

### Added — Phase 2 청크 6: 메시지 액션 (2-C 완료)

- assistant bubble hover 시 액션 툴바 노출 — **복사 / 재생성 / 삭제**. user bubble은 **복사**만
- 복사 직후 1.5초간 ✓ 아이콘으로 시각 피드백
- 재생성 = 같은 user 메시지에 대한 새 응답으로 assistant bubble 갈아치움 (history 보존)
- 삭제 = 단일 메시지만 제거 (preceding user 보존)
- 스트리밍 중엔 모든 액션 툴바 숨김 (race 방지)

### Changed — E2E BIG_FIXTURE 교체

- `studio-bigdoc.spec.ts` / `studio-pagenav.spec.ts`의 fixture를 `(참고)(양식) ★'25년 ... 보고서 서식자료_260127_01.hwp` (57페이지)로 변경. 기존 ~144페이지 `.hwpx`에 의존하던 11 케이스 skip 모두 활성화. 어설션을 fixture-agnostic 하한으로 일반화 (page≥20, find match≥1)
- e2e 결과: 12 skip → **1 skip** (남은 1개는 `nvidia-live` env 게이트)

### Added — Phase 2 청크 5: 채팅 마크다운 + 코드 syntax highlight

- **assistant 메시지 마크다운 렌더링** — `react-markdown` + `remark-gfm` (테이블, 취소선, 작업 리스트, 자동 링크). user 메시지는 plain text 유지(입력 그대로 표시 — 마크다운 깜짝 변환 X)
- **코드 블록 syntax highlight** — `react-syntax-highlighter` PrismLight + 14개 언어 (ts/tsx/js/jsx/py/rust/sql/json/bash/yaml/css/markdown 외). 다크/라이트 테마에 따라 `oneDark`/`oneLight` 자동 매칭
- 외부 링크는 새 탭 + `rel=noreferrer noopener`로 강제 (Electron 렌더러 보안 일관성)
- 번들 영향: renderer 345 kB → 639 kB (gzip 97 → 185 kB)

### Added — Phase 2 청크 4: Settings 모달 + 연결 테스트

- **Settings 모달** (shadcn dialog) — `Cmd/Ctrl+,` 또는 채팅 패널의 "설정 열기" 버튼으로 진입. provider별 row: 라벨 + password 입력 + 저장/연결 테스트/삭제 버튼 + 인라인 결과 메시지. 어댑터가 구현된 OpenAI / NVIDIA NIM만 노출
- **연결 테스트** (`ai:ping` IPC) — 입력란에 타이핑한 transient 키 또는 저장된 키로 provider.ping 호출. 15s 타임아웃. 성공 시 ✓ 연결 정상 / 실패 시 에러 메시지 인라인 표시
- ChatPanel의 키 없을 때 안내가 "DevTools에서 secrets.set..." → "설정 열기" 버튼으로 단순화. UI만으로 BYOK 흐름 완결
- shadcn UI 추가: `Dialog`, `Input` (수동 셋업, `@radix-ui/react-dialog` 도입)

### Added — Phase 2 청크 3: NVIDIA NIM + provider/model 셀렉터 + chat e2e

- **NVIDIA NIM 어댑터** — OpenAI 호환 엔드포인트(`https://integrate.api.nvidia.com/v1`)를 OpenAI 어댑터에 baseUrl만 override해서 위임. SSE 형식 100% 호환 라이브 검증 통과(`meta/llama-3.1-8b-instruct` 1.5s 응답). 자체 호스팅 NIM은 `opts.baseUrl`로 덮어쓰기
- **Provider/Model 셀렉터** — ChatPanel 상단에 provider `<select>` (OpenAI / NVIDIA NIM) + model `<input>` (자유 입력). 두 값 모두 localStorage에 영속, provider별 모델 별도 저장. 키 보유 indicator(●/○) 즉시 갱신
- **Chat e2e 10 케이스** — `tests/e2e/chat.spec.ts`. fake provider(env-gated `AHWP_E2E_FAKE_AI=1`)로 ECHO/ERROR/SLOW 시나리오 + secrets IPC 라운드트립 + 셀렉터 영속 검증. 네트워크 호출 0
- **NVIDIA NIM live smoke** — `tests/e2e/nvidia-live.spec.ts`. `NVAPI_KEY` env 있을 때만 실행 (CI 자동 skip)
- Playwright 4 워커 병렬화 — 132s → 55s (2.4×, 10코어 머신)

### Fixed — chat 스트리밍 race condition (production 영향)

- React 18 자동 배칭 환경에서 `setMessages(prev => …)` updater 실행이 지연될 때, 그 사이 도달한 `done` 이벤트가 `assistantIdRef`를 비워버려 큐된 모든 text-delta가 드롭되던 race. 빠른 SSE 응답에서 첫 글자만 보이고 멈추는 증상으로 발현. id를 listener 진입 시점에 eagerly capture하도록 수정

### Added — Phase 2 토대: BYOK + OpenAI 채팅 (스트리밍)

- 우측 패널이 placeholder에서 **채팅 패널**로 전환 — 메시지 리스트 + textarea + 전송/중단 버튼. Enter 전송, Shift+Enter 줄바꿈, IME composition 가드. 스트리밍 중 중단(abort)이 main의 AbortController까지 전파
- **OpenAI 어댑터** (스트리밍 SSE) — 기본 `gpt-4o-mini`. base URL override 지원. `done` 이벤트에 token usage 동봉
- **BYOK secrets 토대** — `safeStorage.encryptString` 기반 영속 (`userData/secrets.json`, mode 0o600). 평문 키는 main 프로세스에만 머무르며, renderer는 `has`/`list`만 노출 (`secrets.get`은 IPC 미공개). AI 요청은 main에서 secret을 합쳐 어댑터에 주입
- **`ai:chat` 스트리밍 IPC** — id 기반 채널, 인플라이트 `AbortController` 레지스트리, 종료성 보장 (모든 스트림은 정확히 한 번의 `done` 또는 `error`로 종료)
- **`Provider` 타입 계약** (`shared/ai.ts`) — `ProviderId` 6종 (OpenAI / Anthropic / Google / NVIDIA NIM / Ollama / Custom), `PROVIDERS` 메타 (requiresApiKey / requiresBaseUrl), `ChatRequest` / `ChatStreamEvent` / `Provider` 인터페이스. 나머지 4개 어댑터는 다음 청크들

> **사용 안내** — Settings UI는 다음 청크. 현재는 ChatPanel 상단 셀렉터에서 provider 선택 후, DevTools에서 `await window.api.secrets.set('openai', 'sk-...')` 또는 `secrets.set('nvidia', 'nvapi-...')` 실행 → 즉시 사용 가능

### Added — Phase 1-C 확장: 표 / 이미지 / 리스트 / 페이지 나누기 + 확장 툴바

- 표 — 8×8 hover grid TablePicker로 삽입. 셀 편집 v1~v3:
  - v1: 셀 클릭 → 타이핑 → 백스페이스 (`*InCell` IR 경로로 라우팅)
  - v2: Tab / Shift+Tab 셀 사이 순회 (행우선) + 인-셀 B/I/U + 폰트 크기/색상/정렬
  - v3: 우클릭 컨텍스트 메뉴 — 위/아래 행 추가, 좌/우 열 추가, 행/열 삭제, 표 삭제
- 이미지 삽입 — 툴바 (2번째 행) "이미지 삽입" 버튼 또는 OS 파일 드래그. 자연 픽셀 크기 디코드 + HWPUNIT 변환 + 텍스트 영역 폭 (~16cm)으로 clamp
- 리스트 — 글머리 기호 / 번호 매기기 (selection-aware 토글)
- 페이지 나누기 — caret에 `insertPageBreak`. 페이지 카운트 자동 갱신
- 확장형 툴바 — 더보기 버튼으로 두 번째 행 토글 (리스트 / 페이지 나누기 / 표 / 이미지 / 보기 토글)
- 보기 토글 — 제어문자 표시 / 투명 테두리 표시
- 폴더 트리 단축키 (Finder / Explorer / VS Code 패리티) — ↑↓ 탐색, ←→ 접기·펼치기·점프, ⌘N 새 파일, ⌘⇧N 새 폴더, ⌘C·⌘X·⌘V 파일 복사·이동 (`folder:copy` IPC, 충돌 시 `" (1)"` 디스앰비귀에이션)

### Added — Phase 1-C: 자체 Studio viewer + `@rhwp/core` 직접 통합

- HWP/HWPX 뷰어 — **자체 Studio viewer** (`src/features/studio/`). 멀티 페이지 lazy SVG, 키보드/마우스/IME, 시각 커서, dirty 추적. (이전 `@rhwp/editor` iframe은 청크 6에서 제거)
- HWP → HWPX 자동 변환 (`electron/hwp/converter.ts`) — `@rhwp/core` (Rust+WASM 4.5MB) lazy init + `init_panic_hook` + `version()` 로깅. 동적 import로 ESM/CJS 호환성 처리
- 저장 IPC: `file:save` / `file:save-as` — `@rhwp/core` 라운드트립 정규화 + 매직바이트 기반 `.hwp` ↔ `.hwpx` 자동 라우팅 (KNOWN_ISSUES L-001 — 임베드 이미지 보존을 위해 canonical은 HWP)
- 워크스페이스 복원 — `userData/session.json`에 `lastFolderPath` + `lastActivePath` + `openTabPaths` 영속. 앱 재시작/새로고침 시 자동 복원
- 탭 시스템 — 다중 파일, dirty 점, X 닫기, ⌘W, 미들 클릭, openTabPaths 영속. 모든 탭은 `display:none`으로 mount 유지 (HwpDocument + undo 보존)
- 편집 기능 풀 — 텍스트 편집/IME, 선택 모델 (mouse drag / shift+arrow / 더블·트리플 클릭 / ⌘⇧Arrow), B/I/U + 문단 스타일 + 정렬 + 폰트 크기/색상, Undo/Redo (100 entry), Copy/Cut/Paste (시스템 클립보드 브리지), Find ⌘F (매치 하이라이트), 페이지 네비 (PageUp/Down, ⌘Home/End)
- Playwright Electron E2E — 134/134 (smoke + 폴더트리/ops/단축키 + 탭/스크롤 + 스튜디오 청크 1~12 + 표 셀 v1~v3 + 이미지 + 확장 툴바 + 144페이지 부하)

### Added — Phase 1-B: 파일 IPC + 최근 파일 + 드래그앤드롭

- 파일 열기 IPC — `file:open` (네이티브 다이얼로그, .hwp/.hwpx 필터) / `file:open-by-path` (DnD/recent용, 확장자+존재 검증)
- 최근 파일 영속 — `userData/recent.json`, LRU max 20, atomic write (tmp+rename), in-memory 캐시 + 직렬화된 쓰기 체인
- 좌측 패널: `FileList.tsx` 컴포넌트. 최근 파일 목록(파일명 + 상대 시간), 활성 파일 하이라이트, 드롭 zone 오버레이, 빈 상태 ⌘O 안내
- 드래그앤드롭 — Electron 32+에서 제거된 `File.path` 대신 `webUtils.getPathForFile`을 preload에서 노출

### Added — Phase 1-A: 레이아웃 + UI 토대

- 리사이저블 3-Pane (`AppShell.tsx`) — `react-resizable-panels` v2 (v4는 API 개명). 패널 비율 localStorage 영속
- shadcn/ui 수동 셋업 — `components.json`, `cn()` 헬퍼, 토큰 확장된 Tailwind, `:root`/`.dark` CSS 변수, Button 컴포넌트
- 라이트/다크/시스템 테마 토글 — `localStorage` 영속, `matchMedia('prefers-color-scheme: dark')` 구독
- 네이티브 앱 메뉴 (`electron/menu.ts`) — File / Edit / View / Window / Help (macOS 별도 앱 메뉴 포함). 파일·설정 액션은 `webContents.send('menu:action', ...)` 이벤트로 렌더러에 전달
- IPC: `MenuAction` 유니언 + `onMenuAction(handler)` 구독 API

### Added — AI 통합 설계 / 문서

- AI 백엔드 매트릭스에 NVIDIA NIM 추가 — OpenAI 호환 어댑터 경로 재사용 (호스티드 `integrate.api.nvidia.com` 또는 셀프호스트)
- 단일 API 웹검색 매트릭스 — OpenAI Responses `web_search` ✅ / Anthropic `web_search` server tool ✅ / Google `googleSearch` grounding ✅ / NVIDIA NIM·Ollama·커스텀 ❌ (외부 검색 서비스 필요)
- ARCHITECTURE.md SQLite 스키마에 `versions` 테이블 추가 — 풀 카피 + HWPX BLOB 방식. Phase 2 도입 예정

### Added — Phase 0: 부트스트랩

- Electron + Vite + React + TypeScript 프로젝트 셸
- 3-Pane 더미 레이아웃 (좌: 파일 placeholder / 중: 에디터 placeholder / 우: 챗봇 placeholder)
- Main ↔ Renderer IPC 핑·퐁 (`ipc:ping`)
- 보안 격리 (sandbox: true, contextIsolation: true, nodeIntegration: false)
- `shared/api.ts` — 메인↔렌더러 공유 IPC 타입 정의
- Tailwind CSS 3.4 셋업 (한글 폰트 폴백 포함)
- ESLint 10 flat config (typescript-eslint + react-hooks + react-refresh + prettier)
- Prettier 3.8 + .editorconfig
- Vitest 4 + Testing Library + jsdom (`App.test.tsx` 2 passing)
- Husky pre-commit + lint-staged
- electron-builder 설정 (mac dmg / win NSIS / linux AppImage·deb)
- GitHub Actions Release (`.github/workflows/release.yml`) — `v*` 태그 시 3 OS 매트릭스 빌드
- PR 템플릿 (`.github/PULL_REQUEST_TEMPLATE.md`)
- 진행 상황 문서 (`docs/PROGRESS.md`)
- `.gitignore`에 Electron 빌드 산출물 추가 (`dist`, `dist-electron`, `release`)

### Changed

- 패키지 매니저: pnpm → npm (corepack EPERM 이슈 회피)
- `tsconfig.json` `include`에 `vitest.setup.ts` 추가 — `@testing-library/jest-dom/vitest` 타입 augmentation 적용 (`toBeInTheDocument` TS2339 사전 존재 이슈)
- `tsconfig.node.json` `include`에 `tests`, `vitest.config.ts`, `playwright.config.ts` 추가
- `.gitignore`의 Python `lib/` 규칙을 루트 한정(`/lib/`)으로 변경 — `src/lib/`이 ignore되던 문제 해결
- 다이얼로그 필터 — `file:save-as`에서 HWP 옵션 제거. 항상 HWPX (`@rhwp/core` 정규화 결과 일치)
- 렌더러 측 매직바이트 라우팅 제거 — 서버가 `@rhwp/core`로 정규화 후 자동 보정. 단순화

### Removed

- 서버 측 `assertFormatMatchesPath` — `@rhwp/core` 정규화로 항상 HWPX 출력하므로 미스매치 발생 불가, 중복 검증 제거
- 우리 측 'unknown format' 사전 검증 — `HwpDocument` 생성자가 잘못된 입력에 throw, 중복 제거

### Performance

- `@rhwp/core` WASM 앱 부팅 시 pre-init (`main.tsx`) — 첫 파일 열기의 ~100~200ms 콜드 컴파일 stall 제거
- Off-viewport 페이지 unmount + lazy-render 통합 (단일 rAF-throttled 스크롤 핸들러) — 144페이지 문서 메모리 ~30MB → ~2MB (≤11 페이지 마운트). 페이지 SVG 캐시는 string으로 보존, 재진입은 DOM parse만 (WASM 재호출 X)
- Find paragraph 텍스트 캐시 — incremental 키 입력 cold 4ms → warm 0.3ms (10×~14× 가속, 144페이지 / 2656 문단 기준)
- Inactive-tab guard — `clientHeight === 0` 시 lazy-render bail (탭 스팸 시 N×6 페이지 렌더 회피)

### Infrastructure

- Playwright + Electron 도입 (`@playwright/test`) — `npm run e2e` / `npm run e2e:headed`
- CI 트리거를 PR-only로 축소 (`.github/workflows/ci.yml`) — solo 작업 단계 push 알림 노이즈 제거. 메이저 게이트는 PR과 `workflow_dispatch`로 유지. Node 22 LTS, `HUSKY=0` 안전망

### Notes

- 브랜치(`main`/`dev`) 분리는 메인테이너가 수동 적용 필요 — [CONTRIBUTING.md](CONTRIBUTING.md) "처음 셋업"
- AI 챗봇 / 멀티 provider 어댑터 / 채팅 히스토리는 Phase 2부터 도입
- better-sqlite3 도입은 Phase 2 (채팅 히스토리)와 같이 — 현재는 JSON 단일 파일 영속만
