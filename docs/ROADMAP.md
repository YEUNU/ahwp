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

## Phase 1 — 3-Pane 레이아웃 + rhwp 통합 (진행 중)

목표: 사용자가 `.hwp/.hwpx` 파일을 열어 가운데 패널에서 보고 편집할 수 있다.

### 1-A. 레이아웃 ✅ 완료

- [x] `AppShell.tsx`: 3-Pane (좌·중·우) 리사이저블 (`react-resizable-panels` v2 — v4는 API 개명되어 v2로 핀)
- [x] shadcn/ui 수동 셋업 (`components.json`, `cn()`, 토큰 확장된 Tailwind, `:root`/`.dark` CSS 변수, Button)
- [x] 다크/라이트 테마 토글 (Tailwind `dark:` + system 감지, localStorage 영속)
- [x] 네이티브 메뉴바 (`electron/menu.ts` — File / Edit / View / Window / Help, macOS 별도 앱 메뉴)

### 1-B. 파일 리스트 (좌측) ✅ 핵심 완료

- [x] 최근 파일 영속 — **`userData/recent.json`** LRU max 20 (better-sqlite3는 Phase 2와 같이 도입)
- [x] 드래그 앤 드롭으로 파일 추가 (`webUtils.getPathForFile`)
- [x] 빈 상태 안내 (⌘O 키캡 + 드롭 안내)
- [ ] 파일 우클릭: Reveal in Finder/Explorer, Remove from list (낮은 우선순위)

### 1-C. 에디터 (중앙) — 진행 중

- [x] ~~`@rhwp/editor` 임베드 방식~~ → **자체 Studio viewer로 전환** (chunk 6 — STUDIO_MIGRATION.md). `@rhwp/core` 직접 사용
- [x] `StudioViewer.tsx` (`src/features/studio/`) — 멀티 페이지 lazy SVG, 키보드/마우스/IME, dirty 추적, 시각 커서. `forwardRef`+`useImperativeHandle`로 `exportBytes` 노출
- [x] **워크스페이스 복원** — `userData/session.json`에 `lastActivePath`. 앱 재시작 시 자동 재오픈
- [x] 파일 열기 IPC: `file:open` (다이얼로그) / `file:open-by-path` (DnD/recent) / `file:list-recent` / `file:read`
- [x] HWP → HWPX 변환기 (`electron/hwp/converter.ts`) — `@rhwp/core` 동적 import + WASM lazy init + `init_panic_hook`/`version()` 로깅
- [x] Save (Cmd+S) / Save As (Cmd+Shift+S) IPC — `@rhwp/core` 라운드트립 정규화 + 항상 `.hwpx` 자동 라우팅 (확장자 어긋나면 보정)
- [ ] **새 문서 생성** (`file:new`) — `createBlankDocument`은 인스턴스 메서드라 빈 시드 HWPX 필요. 옵션 검토 중
- [ ] **시작 화면 (Welcome view)** — `activePath=null` 상태 디자인 (현재는 ipc:ping 데모)
- [ ] dirty 상태 추적 + 저장 안 된 채 닫기 시 확인 (라이브러리에 변경 이벤트 미노출 — exportHwp 해시 비교 방식 검토 중)
- [ ] 여러 문서 동시 열기 (단일 활성 + 좌측 리스트 전환은 동작, 탭은 미정)
- [ ] studio 자산 로컬 번들링 (Phase 4와 같이)

### 1-D. 우측 패널 자리만 잡기 ✅ 완료

- [x] 빈 챗봇 패널 (탭 컴포넌트는 Phase 2에서 메시지 UI와 같이)

검증: 실제 `.hwp` 파일 열기/편집/저장 라운드트립 + 워크스페이스 복원 — Playwright E2E 7/7 통과 (사용자 예제 2.85MB HWP fixture 활용).

---

## Phase 2 — AI 챗봇 Manual 모드 (3주)

목표: 사용자가 채팅창에서 AI에게 질문하고, AI는 변경사항을 diff로 제안하며, Accept/Reject가 가능하다. **파일 자동 수정은 안 됨**.

### 2-A. 설정 UI

- [ ] Settings 모달 (shadcn dialog)
- [ ] Provider 활성화 토글 + 키 입력 폼
- [ ] `safeStorage`로 키 암호화 저장 (`electron/store/secrets.ts`)
- [ ] Active provider / model 선택 드롭다운
- [ ] 연결 테스트 버튼 (provider별 ping)

### 2-B. Provider 어댑터

- [ ] `Provider` 인터페이스 정의 (`shared/ai.ts`)
- [ ] OpenAI 어댑터 (스트리밍)
- [ ] Anthropic 어댑터
- [ ] Google 어댑터
- [ ] Ollama / OpenAI 호환 어댑터 (base URL 입력)

### 2-C. 채팅 UI

- [ ] 채팅 탭: 메시지 리스트 + 입력 박스 + 스트리밍 토큰 표시
- [ ] 메시지 마크다운 렌더링 (`react-markdown` + `remark-gfm`)
- [ ] 코드 블록 syntax highlight (`shiki` 또는 `react-syntax-highlighter`)
- [ ] 메시지 복사·재생성·삭제

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
- [ ] E2E 확장 — file:open dialog 모킹, save-as, studio 렌더링 (자산 로컬 번들링 후), 다국어 입력 등
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
