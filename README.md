# ahwp

> AI로 한글(HWP/HWPX) 문서를 보고 편집하는 데스크탑 앱

[edwardkim/rhwp](https://github.com/edwardkim/rhwp)의 한글 파일 파서·렌더러 위에 Electron + React로 만든 크로스플랫폼(Mac/Windows/Linux) 앱. OpenAI·Anthropic·Google·NVIDIA NIM·자체 호스팅 OpenAI 호환 엔드포인트(Ollama·vLLM·LM Studio 등 `custom`으로 통합)와 연결해 챗봇과 대화하거나 AI에게 문서 수정을 직접 맡길 수 있습니다.

## 핵심 기능

- **HWP/HWPX 뷰어·에디터** — `@rhwp/core`를 직접 사용한 자체 viewer(Studio)로 한글 문서를 보고 수정 (오프라인 동작, 외부 iframe 의존 없음)
- **두 가지 시작 방식**
  - **빈 새 문서**: 0부터 작성. "보고서 양식 만들어줘"처럼 AI에게 처음부터 맡기거나, 사용자가 직접 작성하면서 부분적으로 AI 도움 받기
  - **기존 문서**: `.hwp/.hwpx` 파일을 열어 편집. AI에게 단락 다듬기·표 정리·문체 변경 등 부분 수정 요청
- **3-Pane 작업 환경**
  - 왼쪽: VS Code 스타일 폴더 트리 — 단일 루트, lazy expand, 외부 변경 자동 반영(chokidar), 우클릭 컨텍스트 메뉴(생성/이름변경/휴지통/탐색기 표시), F2/Delete 단축키, 드래그로 이동
  - 가운데: 다중 탭 에디터 — 파일별 탭(dirty 점, X 닫기, ⌘W), 모든 탭이 mount 유지(전환 시 편집/실행 취소 히스토리 보존), 세션 복원
  - 오른쪽: AI 챗봇 (Phase 2)
- **풀 편집 기능** — 텍스트 입력(IME 포함) · 마우스 드래그/Shift+Arrow/더블·트리플 클릭 선택 · Bold/Italic/Underline + 문단 스타일 + ⌘B/⌘I/⌘U · 정렬 4종 + 폰트 크기 + 색상 picker · Undo/Redo (⌘Z/⌘⇧Z, 100 entry) · Copy/Cut/Paste (⌘C/⌘X/⌘V, 시스템 클립보드) · Find (⌘F) · 페이지 네비 (PageUp/Down, ⌘Home/End)
- **멀티 AI 백엔드** — OpenAI · Anthropic · Google · NVIDIA NIM · `custom` (OpenAI 호환 엔드포인트 — 자체 호스팅 Ollama / vLLM / LM Studio / on-prem 게이트웨이 모두 같은 슬롯)
- **세 가지 편집 경로**
  - **직접 편집**: 위의 풀 편집 기능을 자체 Studio viewer로 실행
  - **챗봇 Manual**: AI가 변경을 diff로 제안 → 사용자가 Accept/Reject
  - **챗봇 Agent**: AI가 hwpctl tool을 호출해 자동 수정 (한 turn = 묶음 undo로 복구)
- **파일별 채팅 히스토리** — 문서마다 독립된 대화 컨텍스트 유지
- **로컬 우선** — API 키는 OS keychain(`safeStorage`)에 암호화 저장. 서버 인프라 없음(BYOK)
- **HWP / HWPX** — `@rhwp/core` (Rust+WASM) 직접 사용. 저장은 HWP/CFB로 통일 (HWPX 라운드트립 이미지 손실 회피, KNOWN_ISSUES L-001)
- **한컴 매뉴얼 명칭 hover 툴팁 + 플랫폼별 단축키** — 모든 툴바·다이얼로그 진입점에 한글 워드프로세서 공식 명칭 + 한 줄 설명 + 단축키(macOS `⌘`/`⌥`/`⇧`/`⌃` 심볼, Win/Linux `Ctrl+`/`Alt+`/`Shift+` 텍스트 자동 분기). 30+ 항목 매핑.
- **한·영 i18n** — `i18next` + `react-i18next`. localStorage `ahwp:locale` 영속, 첫 실행 시 `navigator.language` 감지. WelcomePane / TitleBar / ThemeToggle 등 사용자-노출 string 마이그레이션

## 빠른 시작

> **Phase 1 + Phase 2 + Phase 3 + 1차 UX 라운드 완료** (chunks 1~95, 0.3.30) — 풀 편집 + AI 챗봇 (Manual / Agent) + 한컴 매뉴얼 명칭 hover 툴팁 + 한·영 i18n + Diff Viewer + 다중 문서 라우팅 + 자동 업데이트 + Crash Reporter 까지 동작. 자세한 진행 상황은 [docs/PROGRESS.md](docs/PROGRESS.md).

```bash
# 의존성 설치
npm install

# 개발 모드 실행
npm run dev

# 단위 테스트 (vitest)
npm test

# E2E 테스트 (Playwright + Electron)
npm run e2e

# 프로덕션 빌드 (현재 OS용)
npm run build

# 전 플랫폼 빌드 (CI에서)
npm run build:all
```

### AI 키 설정

앱 실행 후 **Settings → AI Providers**에서 사용할 백엔드의 API 키를 입력합니다. 키는 `safeStorage`로 암호화되어 OS 자격증명 저장소에 보관됩니다.

| Provider             | 필요 정보                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| OpenAI               | `OPENAI_API_KEY`                                                                                                            |
| Anthropic            | `ANTHROPIC_API_KEY`                                                                                                         |
| Google               | `GOOGLE_API_KEY`                                                                                                            |
| NVIDIA NIM           | `NVIDIA_API_KEY` (호스티드: `https://integrate.api.nvidia.com/v1`) 또는 셀프호스트 NIM Base URL                             |
| 커스텀 (OpenAI 호환) | Base URL + 키. 자체 호스팅 Ollama (`http://localhost:11434/v1`) · vLLM · LM Studio · on-prem 게이트웨이 모두 한 슬롯에 통합 |

### 웹검색 지원

각 provider가 **단일 API 호출**만으로 웹검색까지 수행할 수 있는지(외부 검색 서비스나 별도 RAG 파이프라인 없이):

| Provider             | 단일 API 웹검색 | 비고                                                                                                     |
| -------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| OpenAI               | ✅              | Responses API의 `web_search` 내장 tool                                                                   |
| Anthropic            | ✅              | Messages API의 `web_search` server tool                                                                  |
| Google               | ✅              | `googleSearch` grounding tool (Gemini 2.x)                                                               |
| NVIDIA NIM           | ❌              | 추론 전용. 검색은 NeMo Retriever 등 별도 서비스 필요                                                     |
| 커스텀 (OpenAI 호환) | ❌ (기본)       | Ollama / vLLM 같은 로컬 추론은 미지원. 엔드포인트가 검색 도구를 별도로 제공하면 사용자 설정에서 override |

## 기술 스택 요약

| 계층     | 선택                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| 셸       | Electron 41 + electron-builder                                                                  |
| 렌더러   | React 19 + Vite 8 + TypeScript 6                                                                |
| UI       | shadcn/ui + Tailwind CSS 4 (CSS-first `@import 'tailwindcss'`) + tw-animate-css                 |
| i18n     | `i18next` + `react-i18next` (한·영, localStorage 영속)                                          |
| 상태     | React hooks (per-feature) + 명시적 ref 핸들 (StudioViewer)                                      |
| HWP 코어 | `@rhwp/core` 0.7.x 직접 사용 (Rust+WASM, 자체 Studio viewer/editor)                             |
| 저장소   | better-sqlite3 (chat history), `safeStorage` 암호화 (API 키), JSON (session/recent/model-cache) |
| AI SDK   | `openai` · `@anthropic-ai/sdk` · `@google/genai` · 직접 fetch (`custom` OpenAI 호환 엔드포인트) |

상세 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TECH_STACK.md](docs/TECH_STACK.md) 참고.

## 개발 로드맵

- **Phase 0** ✅ 부트스트랩 (Electron + Vite + Tailwind 기본 셸)
- **Phase 1** ✅ 3-Pane 레이아웃 + 자체 Studio viewer + 풀 편집 + 폴더 트리 + 탭 시스템
- **Phase 2** ✅ AI 챗봇 (Manual 모드, BYOK, 파일별 히스토리, 발췌 첨부, 멀티 문서 컨텍스트)
- **Phase 3** ✅ Agent 모드 (54 tools — write 45 + read 9, docId-aware 라우팅, 묶음 undo, Diff Viewer)
- **Phase 4** ✅ 패키징·자동 업데이트 (electron-builder mac/win/linux + electron-updater + GitHub Releases)
- **Phase 5** 진행 중 — 안정화: Crash Reporter / 접근성 / USER_GUIDE / 성능 측정 인프라 / 한·영 i18n / 한컴 매뉴얼 매핑 완료. 베타 피드백 채널 / macOS notarization / Windows 코드 사이닝 미정

전체 체크리스트는 [docs/ROADMAP.md](docs/ROADMAP.md) 참고.

## 디렉토리 구조

현재 구조 (chunks 1~95 기준).

```
ahwp/
├── electron/              메인 프로세스 (Node)
│   ├── main.ts            엔트리, BrowserWindow 생성, IPC 등록, 자동 업데이트, Crash Reporter
│   ├── preload.ts         contextBridge로 window.api 노출
│   ├── menu.ts            네이티브 앱 메뉴 (File / Edit / Format / View / Window / Help)
│   ├── crash-reporter.ts  3-layer (native minidump + main uncaught + renderer logError → userData/error.log)
│   ├── ipc/
│   │   ├── file.ts        file:new/open/read/save/save-as/list-recent + .bak 사이드카 + 버전 스냅샷
│   │   ├── folder.ts      folder:pick/list/watch/create/rename/trash/reveal (chokidar 외부 변경 감지)
│   │   ├── clipboard.ts   clipboard:read-text/write-text + control clipboard
│   │   ├── session.ts     session:get/set (lastFolderPath / lastActivePath / openTabPaths)
│   │   ├── secrets.ts     secrets:set/has/delete/list (renderer 에 plaintext get 미노출)
│   │   ├── ai.ts          ai:chat-start/abort + provider streaming (id-based 채널)
│   │   └── chat-history.ts   better-sqlite3 — 파일별 대화·메시지·턴
│   ├── ai/
│   │   ├── providers/     openai / anthropic / gemini / nvidia / custom / fake (env-gated)
│   │   └── registry.ts    Provider 인터페이스 + 어댑터 등록
│   ├── hwp/
│   │   ├── converter.ts   @rhwp/core 래퍼 — HWP↔HWPX 변환 + 라운드트립 정규화
│   │   └── blank-seed.ts  base64 임베드 blank.hwpx (file:new 용)
│   └── store/             recent.json / session.json / secrets.json (encrypted) / model-cache.json / chat-history.db
├── src/                   렌더러 (React 19)
│   ├── App.tsx · main.tsx
│   ├── app/               AppShell · TitleBar · WelcomePane · ThemeProvider · ThemeToggle · AboutDialog
│   ├── features/
│   │   ├── files/         FolderTree
│   │   ├── studio/        StudioViewer (편집/선택/서식/Find/Undo/Diff/표/이미지) + PaperPage + TabBar + 12+ Dialog
│   │   ├── chat/          ChatPanel (Manual/Agent + 발췌 + 멀티 문서 + Diff Viewer + 히스토리) + 9 hooks
│   │   ├── settings/      SettingsDialog (4탭 — 일반/AI/단축키/정보)
│   │   └── cmdk/          CommandPalette (⌘K) + ShortcutsDialog (⌘/)
│   ├── components/ui/     shadcn/ui (Button · Dialog · Input)
│   └── lib/
│       ├── i18n/          locales/{ko,en}.ts + setup (i18next + react-i18next)
│       ├── hancom-tooltips.ts   30+ 한컴 매뉴얼 명칭 매핑 + 플랫폼별 단축키 표기
│       ├── rhwp-core.ts   WASM lazy init + measureTextWidth 콜백
│       └── utils.ts       cn() 헬퍼
├── shared/
│   ├── api.ts             IPC 계약 (AhwpApi 와 FileApi/FolderApi/ChatHistoryApi/AiApi/SecretsApi/...)
│   ├── ai.ts · ai-tools.ts   Provider 인터페이스 + AHWP_TOOL_NAMES 단일 진실 원천 (write 45 + read 9)
│   ├── rhwp-types.ts      narrow type (RhwpPageDef 등 — 21개 narrow type)
│   └── format.ts          HWP/HWPX 매직바이트 sniff + 확장자 보정
├── tests/e2e/             Playwright + Electron — 70+ spec 파일, 397+ 통과 케이스
├── docs/                  ARCHITECTURE / AI_INTEGRATION / AGENT_TOOLS / KNOWN_ISSUES / PHASE3_PLAN / RELEASE / USER_GUIDE / ROADMAP / PROGRESS
└── examples/              사용자 제공 HWP fixture (perf 측정용 — git tracked)
```

## 브랜치

- `main` — 배포용. 릴리스 태그가 찍히는 브랜치. 직접 push 금지
- `dev` — 개발 통합. 모든 feature/fix PR 타겟
- 작업 브랜치는 `feat/*`, `fix/*`, `chore/*` 형태로 `dev`에서 분기

자세한 워크플로우는 [CONTRIBUTING.md](CONTRIBUTING.md) 참고.

## 라이선스

[Apache License 2.0](LICENSE).

`@rhwp/*`는 별도 라이선스를 따릅니다 — 해당 패키지의 라이선스를 참고하세요.

## 감사의 말

- [edwardkim/rhwp](https://github.com/edwardkim/rhwp) — HWP/HWPX 파서·에디터 코어 제공
- shadcn/ui · Electron · React 커뮤니티
