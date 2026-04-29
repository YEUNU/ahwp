# ahwp

> AI로 한글(HWP/HWPX) 문서를 보고 편집하는 데스크탑 앱

[edwardkim/rhwp](https://github.com/edwardkim/rhwp)의 한글 파일 파서·렌더러 위에 Electron + React로 만든 크로스플랫폼(Mac/Windows/Linux) 앱. OpenAI·Anthropic·Google·Ollama·자체 호스팅 LLM과 연결해 챗봇과 대화하거나 AI에게 문서 수정을 직접 맡길 수 있습니다.

## 핵심 기능

- **HWP/HWPX 뷰어·에디터** — `@rhwp/core`를 직접 사용한 자체 viewer(Studio)로 한글 문서를 보고 수정 (오프라인 동작, 외부 iframe 의존 없음)
- **두 가지 시작 방식**
  - **빈 새 문서**: 0부터 작성. "보고서 양식 만들어줘"처럼 AI에게 처음부터 맡기거나, 사용자가 직접 작성하면서 부분적으로 AI 도움 받기
  - **기존 문서**: `.hwp/.hwpx` 파일을 열어 편집. AI에게 단락 다듬기·표 정리·문체 변경 등 부분 수정 요청
- **3-Pane 작업 환경**
  - 왼쪽: 작업 중인 한글 파일 리스트
  - 가운데: 현재 열린 한글 문서(편집 가능)
  - 오른쪽: AI 챗봇 (히스토리 / 채팅 2단 탭)
- **멀티 AI 백엔드** — OpenAI · Anthropic · Google · NVIDIA NIM · Ollama · 사용자 지정 OpenAI 호환 엔드포인트
- **세 가지 편집 경로**
  - **직접 편집**: AI 없이 rhwp 에디터로 마우스·키보드 직접 편집 (풀-피처 에디터)
  - **챗봇 Manual**: AI가 변경을 diff로 제안 → 사용자가 Accept/Reject
  - **챗봇 Agent**: AI가 hwpctl tool을 호출해 자동 수정 (한 turn = 묶음 undo로 복구)
- **파일별 채팅 히스토리** — 문서마다 독립된 대화 컨텍스트 유지
- **로컬 우선** — API 키는 OS keychain(`safeStorage`)에 암호화 저장. 서버 인프라 없음(BYOK)
- **HWP → HWPX 자동 변환** — 구형 .hwp 입력 시 HWPX로 정규화해 일관된 편집/AI 처리

## 빠른 시작

> 현재 **Phase 1-C 진행 중**. 리사이저블 3-Pane 레이아웃, 다크/라이트 테마, 네이티브 메뉴, 파일 열기/저장 + 워크스페이스 복원, `@rhwp/core` 라운드트립 정규화 동작. AI 챗봇은 Phase 2부터. 자세한 진행 상황은 [docs/PROGRESS.md](docs/PROGRESS.md).

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

| Provider   | 필요 정보                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------- |
| OpenAI     | `OPENAI_API_KEY`                                                                                |
| Anthropic  | `ANTHROPIC_API_KEY`                                                                             |
| Google     | `GOOGLE_API_KEY`                                                                                |
| NVIDIA NIM | `NVIDIA_API_KEY` (호스티드: `https://integrate.api.nvidia.com/v1`) 또는 셀프호스트 NIM Base URL |
| Ollama     | Base URL (기본 `http://localhost:11434`)                                                        |
| 커스텀     | OpenAI 호환 endpoint URL + 키                                                                   |

### 웹검색 지원

각 provider가 **단일 API 호출**만으로 웹검색까지 수행할 수 있는지(외부 검색 서비스나 별도 RAG 파이프라인 없이):

| Provider   | 단일 API 웹검색 | 비고                                                 |
| ---------- | --------------- | ---------------------------------------------------- |
| OpenAI     | ✅              | Responses API의 `web_search` 내장 tool               |
| Anthropic  | ✅              | Messages API의 `web_search` server tool              |
| Google     | ✅              | `googleSearch` grounding tool (Gemini 2.x)           |
| NVIDIA NIM | ❌              | 추론 전용. 검색은 NeMo Retriever 등 별도 서비스 필요 |
| Ollama     | ❌              | 로컬 추론 전용                                       |
| 커스텀     | ❌ (기본)       | 엔드포인트 구현에 따라 다름 — 사용자 책임            |

## 기술 스택 요약

| 계층     | 선택                                                                          |
| -------- | ----------------------------------------------------------------------------- |
| 셸       | Electron + electron-builder                                                   |
| 렌더러   | React 18 + Vite + TypeScript                                                  |
| UI       | shadcn/ui + Tailwind CSS                                                      |
| 상태     | Zustand                                                                       |
| HWP 코어 | `@rhwp/core` 직접 사용 (Rust+WASM, 자체 Studio viewer/editor)                 |
| 저장소   | better-sqlite3 (히스토리), electron-store (설정)                              |
| AI SDK   | `openai` · `@anthropic-ai/sdk` · `@google/genai` · 직접 fetch (Ollama·커스텀) |

상세 설계는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/TECH_STACK.md](docs/TECH_STACK.md) 참고.

## 개발 로드맵

- **Phase 0** 부트스트랩 (Electron + Vite + Tailwind 기본 셸)
- **Phase 1** 3-Pane 레이아웃 + rhwp 임베드 + 파일 열기/저장
- **Phase 2** AI 챗봇 (Manual 모드, BYOK, 파일별 히스토리)
- **Phase 3** Agent 모드 (hwpctl tool use)
- **Phase 4** 패키징·자동 업데이트
- **Phase 5** 안정화 + 베타 배포

전체 체크리스트는 [docs/ROADMAP.md](docs/ROADMAP.md) 참고.

## 디렉토리 구조

현재 구조 (Phase 1-C 기준). Phase 2+에서 `electron/ai/`, `src/features/chat/`, `electron/store/db.ts` 등이 추가됩니다.

```
ahwp/
├── electron/              메인 프로세스 (Node)
│   ├── main.ts            엔트리, BrowserWindow 생성, IPC 등록
│   ├── preload.ts         contextBridge로 window.api 노출
│   ├── menu.ts            네이티브 앱 메뉴 (File / Edit / View / Window / Help)
│   ├── ipc/
│   │   ├── file.ts        file:open / open-by-path / read / save / save-as / list-recent
│   │   └── session.ts     session:get / set
│   ├── hwp/
│   │   └── converter.ts   @rhwp/core 래퍼 — HWP→HWPX 변환 + 라운드트립 정규화
│   └── store/
│       ├── recent.ts      userData/recent.json — LRU max 20
│       └── session.ts     userData/session.json — lastActivePath
├── src/                   렌더러 (React)
│   ├── App.tsx
│   ├── main.tsx
│   ├── app/
│   │   ├── AppShell.tsx   3-Pane 레이아웃, 메뉴 액션 핸들링
│   │   ├── theme-provider.tsx   light/dark/system, prefers-color-scheme 구독
│   │   └── theme-toggle.tsx
│   ├── features/
│   │   ├── files/         FileList + use-recent-files 훅 (드래그앤드롭 zone)
│   │   └── studio/        StudioViewer (@rhwp/core 직접 — 멀티 페이지 lazy SVG, 키보드/마우스/IME, dirty 추적)
│   ├── components/ui/     shadcn/ui (Button, ...)
│   └── lib/utils.ts       cn() 헬퍼
├── shared/
│   ├── api.ts             IPC 계약 (AhwpApi, FileApi, SessionApi, MenuAction, ...)
│   └── format.ts          HWP/HWPX 매직바이트 sniff + 확장자 보정
├── tests/e2e/             Playwright + Electron (smoke + file round-trip + session)
├── docs/                  ARCHITECTURE / AI_INTEGRATION / TECH_STACK / ROADMAP / PROGRESS
├── examples/              사용자 supplied HWP fixtures (gitignore)
└── style_example/         초기 디자인 목업 (gitignore — 빌드 무관)
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
