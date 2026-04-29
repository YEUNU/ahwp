# Changelog

이 파일은 ahwp의 사용자 영향 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), 버전은 [Semantic Versioning](https://semver.org/lang/ko/) 을 따릅니다.

## [Unreleased]

### Added — Phase 1-C: rhwp 뷰어 통합 + `@rhwp/core` 라운드트립

- HWP/HWPX 뷰어 — `@rhwp/editor` v0.7.8 iframe 기반 임베드. 파일 열기/편집/페이지 표시 동작
- HWP → HWPX 자동 변환 (`electron/hwp/converter.ts`) — `@rhwp/core` (Rust+WASM 4.5MB) lazy init + `init_panic_hook` + `version()` 로깅. 동적 import로 ESM/CJS 호환성 처리
- 저장 IPC: `file:save` / `file:save-as` — `@rhwp/core` 라운드트립 정규화 후 항상 `.hwpx`로 저장 (확장자 어긋난 경로는 자동 보정). studio의 자동 보정이 export에 미반영되는 이슈를 우리 측에서 IR 기반 재직렬화로 해결
- 워크스페이스 복원 — `userData/session.json`에 마지막 활성 파일 경로 영속. 앱 재시작/새로고침 시 자동 재오픈
- 매직바이트 형식 감지 (`shared/format.ts`) — fast path 최적화 전용. 권위 판별은 `HwpDocument.getSourceFormat()`
- Playwright Electron E2E 인프라 — 격리된 임시 `userData` 디렉토리 + 사용자 예제 HWP fixture 활용. 7개 케이스 통과 (HWP→HWPX 변환, save 라운드트립, 자동 라우팅, 세션 복원, recent 갱신, 부팅, 테마 토글)

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

### Infrastructure

- Playwright + Electron 도입 (`@playwright/test`) — `npm run e2e` / `npm run e2e:headed`
- CI 트리거를 PR-only로 축소 (`.github/workflows/ci.yml`) — solo 작업 단계 push 알림 노이즈 제거. 메이저 게이트는 PR과 `workflow_dispatch`로 유지. Node 22 LTS, `HUSKY=0` 안전망

### Notes

- 브랜치(`main`/`dev`) 분리는 메인테이너가 수동 적용 필요 — [CONTRIBUTING.md](CONTRIBUTING.md) "처음 셋업"
- `@rhwp/editor` v0.7.8 iframe은 외부 호스팅(`edwardkim.github.io/rhwp`) 의존 — Phase 4에서 자산 로컬 번들링으로 전환 예정. 현재는 첫 로드에 인터넷 필요
- AI 챗봇 / 멀티 provider 어댑터 / 채팅 히스토리는 Phase 2부터 도입
- better-sqlite3 도입은 Phase 2 (채팅 히스토리)와 같이 — 현재는 JSON 단일 파일 영속만
