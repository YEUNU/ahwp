# 개발 로드맵

각 Phase는 그 자체로 동작 가능한 단계. 다음 Phase로 넘어가기 전에 체크리스트가 모두 끝나야 합니다.

대략적 일정은 1인 풀타임 기준 추정치이며, 실제로는 Phase 2~3에서 변동 가능성 높음.

---

## Phase 0 — 부트스트랩 ✅ 완료 (2026-04-29)

목표: `npm run dev`로 빈 Electron 윈도우가 뜨고, React가 마운트되며, 메인↔렌더러 IPC 핑이 동작한다.

- [x] `package.json` 초기화 (single package)
- [x] Electron + electron-builder 설치
- [x] Vite + React + TypeScript 설정 (renderer는 `src/`, main은 `electron/`)
- [x] `electron/main.ts`: BrowserWindow 생성, dev/prod 분기
- [x] `electron/preload.ts`: `contextBridge`로 `window.api` 노출
- [x] Tailwind CSS 셋업 (한글 폰트 폴백 포함)
- [ ] ~~shadcn/ui CLI 초기화~~ → Phase 1-A에서 첫 컴포넌트 도입 시 같이 진행
- [x] ESLint + Prettier + tsconfig (strict)
- [x] Vitest 셋업 + dummy 테스트 1개 (App.test.tsx 2/2 passing)
- [x] `ipc:ping` 핸들러 + 렌더러 호출 검증
- [ ] **브랜치 셋업**: `main`(배포)·`dev`(개발) 분리, branch protection — 메인테이너 수동 적용 ([CONTRIBUTING.md](../CONTRIBUTING.md) "처음 셋업")
- [x] GitHub Actions: `dev` 타겟 PR에서 lint + typecheck + test + format:check (`.github/workflows/ci.yml`)
- [x] GitHub Actions: `main`에 `v*` 태그 push 시 매트릭스 빌드·릴리스 (`.github/workflows/release.yml`)
- [x] CONTRIBUTING.md 채택 + Husky 훅 + lint-staged
- [x] `.gitignore`에 Electron 빌드 산출물(`dist/`, `dist-electron/`, `release/`) 추가

검증 (2026-04-29):

- `npx vite build` 성공 (`dist/index.html`, `dist-electron/main.js`, `dist-electron/preload.js`)
- `npm run typecheck` / `npm run lint` / `npm test` (2/2) / `npm run format:check` 통과
- 진행 일지: [docs/PROGRESS.md](PROGRESS.md)

---

## Phase 1 — 3-Pane 레이아웃 + rhwp 통합 ✅ 완료 (2026-04-30)

목표: 사용자가 `.hwp/.hwpx` 파일을 열어 가운데 패널에서 보고 편집할 수 있다.

### 1-A. 레이아웃 ✅ 완료

- [x] `AppShell.tsx`: 3-Pane (좌·중·우) 리사이저블 (`react-resizable-panels` v2 — v4는 API 개명되어 v2로 핀)
- [x] shadcn/ui 수동 셋업 (`components.json`, `cn()`, 토큰 확장된 Tailwind, `:root`/`.dark` CSS 변수, Button)
- [x] 다크/라이트 테마 토글 (Tailwind `dark:` + system 감지, localStorage 영속)
- [x] 네이티브 메뉴바 (`electron/menu.ts` — File / Edit / Format / View / Window / Help, macOS 별도 앱 메뉴)

### 1-B. 파일 리스트 (좌측) ✅ 완료 — VS Code 스타일 폴더 트리

- [x] 단일 루트 폴더 트리 (`FolderTree.tsx`) — lazy expand, 모든 파일 표시 (필터 X)
- [x] chokidar watcher — 외부 변경 자동 반영
- [x] 워크스페이스 영속 — `lastFolderPath` session.json 자동 복원
- [x] 드래그앤드롭으로 파일/폴더 이동 (`fs.rename` via `folder:rename` IPC)
- [x] 컨텍스트 메뉴 — 새 파일 / 새 폴더 / 이름 변경 / 휴지통 / 파일 관리자에서 보기
- [x] 인라인 이름 변경 (F2) + 새 항목 input
- [x] 단축키 (OS 탐색기 패리티): ↑↓ 탐색, ←→ 접기·펼치기·부모/첫자식 점프, F2 rename, Delete trash, Enter open/toggle, ⌘N/⌘⇧N 새 파일·폴더, ⌘C·⌘X·⌘V 파일 복사·이동 (`folder:copy` IPC)
- [x] 좌/중 패널 모두 스크롤 동작 (regression e2e gate)

### 1-C. 에디터 (중앙) ✅ 완료 — 자체 Studio + 탭

- [x] ~~`@rhwp/editor` 임베드 방식~~ → **자체 Studio viewer**. `@rhwp/core` 직접 사용
- [x] `StudioViewer.tsx` (`src/features/studio/`) — 멀티 페이지 lazy SVG, 키보드/마우스/IME, 시각 커서, dirty 추적
- [x] 워크스페이스 복원 — `userData/session.json` (`lastFolderPath` + `lastActivePath` + `openTabPaths`)
- [x] 파일 IPC: `file:new` / `file:open` / `file:open-by-path` / `file:read` / `file:save` / `file:save-as`
- [x] HWP / HWPX 변환기 (`electron/hwp/converter.ts`) — `@rhwp/core` 동적 import + WASM lazy init
- [x] Save / Save As — `@rhwp/core` 라운드트립 정규화 + `.hwp` 자동 라우팅 (KNOWN_ISSUES L-001)
- [x] 새 문서 생성 (`file:new`) — base64 임베드 blank seed + `createBlankDocument` → 임시 파일
- [x] 시작 화면 — "새 문서" / "파일 열기" 버튼
- [x] **탭 시스템** — 다중 파일, dirty 점, X 닫기, ⌘W, 미들 클릭, openTabPaths 영속
- [x] **편집 기능 풀**:
  - [x] 텍스트 편집 (insert/delete/IME)
  - [x] 선택 모델 (mouse drag / shift+arrow / 더블·트리플 클릭 / ⌘⇧Arrow)
  - [x] Bold/Italic/Underline + 문단 스타일 + ⌘B/⌘I/⌘U
  - [x] 정렬 (좌/우/중/양쪽) + 폰트 크기 + 색상
  - [x] Undo/Redo (⌘Z/⌘⇧Z, 100 entry cap)
  - [x] Copy/Cut/Paste (⌘C/⌘X/⌘V) — 내부 + 시스템 클립보드
  - [x] Find (⌘F) — 매치 하이라이트 + Next/Prev
  - [x] 찾아 바꾸기 (⌘H) — `replaceOne` / `replaceAll` IR API 위임. 단일/모두 바꾸기, 빈 값=삭제, case-insensitive, 매치 없을 때 버튼 비활성
  - [x] 줄 간격 / 들여쓰기 / 문단 간격 (`applyParaFormat` props 확장 — `lineSpacing`, `marginLeft`, `spacingBefore`/`spacingAfter`). 확장 툴바에 선택 셀렉터 + 들여쓰기/내어쓰기 버튼
  - [x] **하단 status bar** — undo/redo/zoom (out/level/in/100%/fit) + dirty + 페이지 인디케이터를 상단에서 분리. 한컴 한글 status bar 패턴
  - [x] 페이지 네비 (PageUp/Down, ⌘Home/End)
  - [x] 리스트 (글머리 / 번호) + 페이지 나누기
  - [x] 표 삽입 (TablePicker 8×8) + 셀 편집 (클릭→타이핑, Tab 네비, 인-셀 서식, 우클릭 행/열 추가·삭제, 셀 합치기·나누기·병합 해제)
  - [x] 페이지 설정 (용지 크기 / 방향 / 여백) — `setPageDef` IR 위임. PageSetupDialog (A4/A5/B5/Letter/Legal preset + 사용자 정의 mm)
  - [x] 머리말 / 꼬리말 (단일 라인 MVP) — `createHeaderFooter` / `getHeaderFooter` / `insertTextInHeaderFooter` / `deleteHeaderFooter` IR 위임. HeaderFooterDialog (header/footer 토글 + 단일 라인 + applyTo=0 양쪽). 다중 라인 / 페이지 템플릿(홀수/짝수)은 후속
  - [x] 책갈피 — `addBookmark` / `getBookmarks` / `renameBookmark` / `deleteBookmark` IR 위임. BookmarkDialog (caret에 추가 + 목록 + 삭제). 책갈피로 점프(caret + scroll)는 후속
  - [x] 각주 — `insertFootnote` / `insertTextInFootnote` / `getFootnoteInfo` IR 위임. FootnoteDialog (각주 본문 텍스트 input + caret에 삽입). 각주 안 caret 편집 모델은 후속. blank.hwpx에선 라이브러리 panic (footnote 영역 미정의 — 실제 .hwp 문서에선 정상 작동)
  - [x] 스타일 관리 — `createStyle` / `updateStyle` / `deleteStyle` / `getStyleList` IR 위임. StyleManagerDialog (목록 + 추가 + 인라인 이름 변경 + 삭제). char/para shape 모드는 후속 (현재는 이름만 받는 빈 셸 생성)
  - [x] 수식 미리보기 — `renderEquationPreview` IR. EquationDialog (한컴 수식 script input + 라이브 SVG 미리보기). 본문에 수식 컨트롤 *삽입*은 후속 (라이브러리에 명시적 createEquation 메서드 없음)
  - [x] 이미지 삽입 (툴바 + OS 드래그)
  - [x] 확장형 툴바 (더보기 행) + 보기 토글 (제어문자 / 투명 테두리)
- [x] 144페이지 부하 측정 e2e gate
- [x] **성능 최적화**:
  - [x] `@rhwp/core` WASM 앱 부팅 시 pre-init (첫 파일 열기 stall 제거)
  - [x] Off-viewport 페이지 unmount + lazy-render 통합 (메모리 ~30MB → ~2MB)
  - [x] Find paragraph 텍스트 캐시 (incremental 키 입력 10× 가속)
  - [x] Inactive-tab guard (탭 스팸 시 N×6 페이지 렌더 회피)

### 1-D. 우측 패널 자리만 잡기 ✅ 완료

- [x] 빈 챗봇 패널 (탭 컴포넌트는 Phase 2에서 메시지 UI와 같이)

검증: e2e 134/134 (smoke + 폴더트리/ops + 폴더 키보드 단축키 + 탭/스크롤 + 스튜디오 청크 1~12 + 표 셀 v1~v3 + 이미지 삽입 + 확장 툴바 + 144페이지 부하).

---

## Phase 2 — AI 챗봇 Manual 모드 (3주)

목표: 사용자가 채팅창에서 AI에게 질문하고, AI는 변경사항을 diff로 제안하며, Accept/Reject가 가능하다. **파일 자동 수정은 안 됨**.

### 2-A. 설정 UI ✅ 완료

- [x] Settings 모달 (shadcn dialog) — `view:settings` MenuAction (`Cmd/Ctrl+,`) + ChatPanel 빈 키 안내의 "설정 열기" 버튼으로 진입
- [x] Provider 활성화 토글 + 키 입력 폼 (provider별 row: 라벨 + password input + 저장/테스트/삭제)
- [x] `safeStorage`로 키 암호화 저장 (`electron/store/secrets.ts` + `secrets:set/delete/has/list` IPC). 평문 키는 main에 머무름 — renderer는 `has`/`list`만 노출
- [x] Active provider / model 선택 드롭다운 (ChatPanel 상단 — provider `<select>` + model `<input>`, localStorage 영속)
- [x] 연결 테스트 버튼 (provider별 ping) — `ai:ping` IPC. transient 키(저장 전 입력값) 또는 stored 키 모두 지원, 15s 타임아웃

### 2-B. Provider 어댑터

- [x] `Provider` 인터페이스 정의 (`shared/ai.ts`) — `ProviderId` / `PROVIDERS` 메타 / `ChatRequest` / `ChatStreamEvent` / `ProviderRuntimeOptions`
- [x] OpenAI 어댑터 (스트리밍 SSE 파싱 + ping) — `electron/ai/providers/openai.ts`. 기본 base URL `api.openai.com/v1`, 사용자 base URL override 지원
- [x] `ai:chat` 스트리밍 IPC — id 기반 채널, 인플라이트 abort 지원 (`electron/ipc/ai.ts`)
- [x] NVIDIA NIM 어댑터 (`electron/ai/providers/nvidia.ts`) — OpenAI 어댑터에 `https://integrate.api.nvidia.com/v1` baseUrl 위임. SSE 100% 호환 라이브 검증 통과 (1.5s 응답)

> **블록됨** — 아래 어댑터들은 메인테이너의 API 키/계정 준비를 기다리는 중. 코드 자체는 OpenAI/NVIDIA 패턴을 이미 확립해두었으므로 키만 확보되면 빠르게 진행 가능. 그 전까지는 `SHOWN_IDS`(SettingsDialog)에서 숨김 + `getProvider`에서 null 반환 유지.

- [ ] Anthropic 어댑터 — 키 준비 대기 (`messages` API, `event:` line-prefixed SSE, Phase 3 `tool_use` 대비)
- [ ] Google (Gemini) 어댑터 — 키 준비 대기
- [ ] Ollama / 커스텀 어댑터 — 키 준비 대기 (자체 호스팅 base URL 입력)

### 2-C. 채팅 UI

- [x] 채팅 패널 골격 — 메시지 리스트 + textarea + 스트리밍 토큰 표시 + abort 버튼 (`src/features/chat/ChatPanel.tsx`). Enter 전송, Shift+Enter 줄바꿈, IME composition 가드
- [x] 메시지 마크다운 렌더링 (`react-markdown` + `remark-gfm`) — assistant 메시지만, user는 plain text 유지
- [x] 코드 블록 syntax highlight (`react-syntax-highlighter` PrismLight + 14 언어 — ts/tsx/js/jsx/py/rust/sql/json/bash/yaml/css/markdown). 다크/라이트 테마 자동 매칭
- [x] 메시지 복사·재생성·삭제 — bubble hover 시 액션 툴바 노출. assistant=복사·재생성·삭제, user=복사. 스트리밍 중엔 숨김
- [x] Provider/Model 선택 드롭다운 (ChatPanel 상단 — provider `<select>` + model `<input>`)

### 2-D. 히스토리

- [ ] 파일별 conversations / messages SQLite 스키마 적용
- [ ] 히스토리 탭: 대화 목록 (제목, 마지막 메시지, 시각)
- [ ] 대화 클릭 → Chat 탭으로 로드
- [ ] 새 대화 시작 / 대화 이름 변경 / 삭제

### 2-E. Manual 편집 흐름

- [ ] 시스템 프롬프트 작성 (현재 문서 컨텍스트 주입)
- [ ] AI 응답에서 `<edit>` JSON 블록 파싱
- [ ] 변경 위치를 에디터에서 하이라이트 + diff 패널 표시
- [ ] Accept → `ai:apply-diff` IPC → 에디터 갱신
- [ ] Reject → 변경사항 폐기

검증: 실제 문서를 열고 "이 단락 요약해서 다시 써줘" 같은 작업이 정상 동작.

---

## Phase 3 — Agent 모드 (Tool Use) (3~4주)

목표: 사용자가 Agent 모드를 켜면, AI가 hwpctl 도구를 직접 호출해 문서를 자동 수정한다. 모든 변경은 묶음 undo 가능.

- [ ] hwpctl 호환 액션을 tool schema로 노출 (insertText, deleteRange, applyParagraphStyle, insertTable, ...)
- [ ] tool 화이트리스트 정의 (위험한 액션 제외)
- [ ] OpenAI tool use 스트리밍 처리
- [ ] Anthropic tool use 처리
- [ ] Google function calling 처리
- [ ] Ollama: 모델 능력에 따라 분기 (`tools` 지원 모델만 Agent 활성)
- [ ] tool 실행 결과 → 다시 모델에 피드백 → 다음 tool 또는 종료
- [ ] 변경 그룹 undo (한 turn = 한 묶음)
- [ ] Agent 진행 상황 UI (단계별 표시)
- [ ] 사용자가 중간에 "중단" 버튼 → 진행중 tool stream 취소

검증: "이 표의 합계 행을 추가하고 모든 셀을 가운데 정렬해줘" 한 줄로 처리.

---

## Phase 4 — 패키징·배포 (1~2주)

- [x] `electron-builder` 설정 (mac dmg / win NSIS / linux AppImage·deb — Phase 0에 미리 셋업)
- [x] CI 매트릭스 빌드: `main`에 `v*` 태그 push 시 자동 트리거 (`.github/workflows/release.yml`, mac/win/linux)
- [ ] 앱 아이콘 (macOS .icns, Windows .ico, Linux .png) 디자인
- [ ] **rhwp studio 자산 로컬 번들링** — `https://edwardkim.github.io/rhwp/` iframe 의존 제거 → `app://` 자체 호스팅. CSP의 `frame-src` 외부 origin 항목도 제거
- [ ] macOS notarization 결정 (개인 개발자 계정 → entitlements / 미서명 배포 옵션)
- [ ] Windows 코드 사이닝 (옵션)
- [ ] `electron-updater` + GitHub Releases 연동
- [ ] 릴리스 흐름 문서화: `dev` → (필요시 `release/*`) → `main` 머지 → 태그 → 배포
- [ ] About 창에 버전·라이선스 표시
- [ ] 메이저 버전 일괄 업그레이드 (React 19, Tailwind 4, Electron 41, vite 8, TS 6 등 별도 마이그레이션)

검증: 새 OS에서 설치 → 자동 업데이트 시뮬레이션.

---

## Phase 5 — 안정화·베타 (지속)

- [ ] Crash reporter (Sentry 또는 자체)
- [x] E2E 인프라 (Playwright Electron, Phase 1-C에 앞당겨 도입) — 7개 케이스 통과
- [x] E2E 확장 — studio 청크 1~12 + 표/이미지/폴더 ops/탭 (134/134 케이스)
- [ ] E2E 추가 — file:open dialog 모킹, save-as 다이얼로그, 다국어 입력, 표 셀 selection v4
- [ ] 접근성 점검 (radix 기본 + 키보드 탐색)
- [ ] 사용자 가이드 문서 (`docs/USER_GUIDE.md`)
- [ ] 베타 사용자 피드백 채널 (GitHub Discussions)
- [ ] 성능: 큰 .hwpx 파일(50p 이상) 로드 시 측정·개선
- [ ] 다국어 도입 (한·영) — Phase 5에서 검토

---

## Backlog (Phase 미정)

- 음성 입력 → 챗봇
- 한글 문서 비교 (두 파일 diff)
- 템플릿 라이브러리 (계약서·보고서 등)
- AI 사용량·비용 대시보드 (provider 응답 메타데이터 활용)
- 협업 (실시간 공동 편집은 범위 밖, 파일 공유 정도)
- 플러그인 시스템

---

## 트래킹

각 Phase 진입 시 GitHub Project 보드 또는 issue 라벨(`phase-1`, `phase-2`...)로 관리. 한 Phase가 끝나면 데모 영상 + CHANGELOG 갱신.
