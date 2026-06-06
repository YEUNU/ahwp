# 기술 스택 결정

각 선택의 **이유**와 **대안 검토 결과**를 함께 적었습니다. 추후 의사결정을 뒤집을 때 참고.

## 셸 / 패키징

| 항목          | 선택                         | 이유                                                                                                                       |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 데스크탑 셸   | **Electron** (latest stable) | 사용자가 명시. Mac/Win/Linux 동시 지원. Chromium 기반이라 `@rhwp/core`(Rust+WASM) WebAssembly 실행이 자연스러움            |
| 패키징·배포   | **electron-builder**         | 자동 업데이트(`electron-updater`), 코드 사이닝, 다년간 표준. electron-forge보다 멀티 OS 빌드 매트릭스가 명확               |
| 패키지 매니저 | **npm**                      | Node 기본 포함, 추가 설치 불필요. single package 구조라 pnpm 워크스페이스 이점 미미. (corepack 권한 이슈로 pnpm 대신 채택) |

## 렌더러

| 항목       | 선택                                                          | 이유                                                                                                                                               |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프레임워크 | **React 19**                                                  | rhwp-studio와 호환, AI/챗 UI 라이브러리 풍부                                                                                                       |
| 빌드       | **Vite**                                                      | rhwp-studio와 동일 toolchain, HMR 빠름                                                                                                             |
| 언어       | **TypeScript (strict)**                                       | 메인↔렌더러 IPC 타입 공유                                                                                                                          |
| UI         | **shadcn/ui + Tailwind CSS**                                  | 소스 복사 방식이라 커스터마이징 자유, radix 접근성 우수, 번들 가벼움. Ant Design은 룩 무겁고 한국어 폰트 이슈, Mantine은 좋지만 디자인 자유도 낮음 |
| 라우팅     | _(미채택)_ — react-router 검토했으나 단일 화면이라 불필요     | 데스크탑 앱이라 hash/memory router로 충분하나, 탭/패널이 한 화면에 고정이라 라우터 자체를 안 씀                                                    |
| 상태       | _(미채택)_ — Zustand 등 무도입, React state + IPC 직접        | 상태 규모가 작아 별도 전역 스토어 불필요. 보일러플레이트 회피                                                                                      |
| 비동기     | _(미채택)_ — TanStack Query 무도입, IPC `invoke` 직접 호출    | IPC 결과 캐시 레이어가 필요할 만큼 호출이 많지 않음. 채팅 스트리밍은 per-request 이벤트 채널로 직접 처리                                           |
| diff 뷰어  | **자체 `DiffCard`** (`src/features/chat`)                     | react-diff-viewer / monaco 검토했으나 미채택. AI 편집 변경사항을 직접 만든 카드 UI로 시각화                                                        |
| 폼         | _(미채택)_ — react-hook-form + zod 무도입, 제어 컴포넌트 직접 | 설정 패널·API 키 입력이 소수라 폼 라이브러리 없이 제어 컴포넌트로 충분                                                                             |

## HWP 코어

| 항목     | 선택                                                                                                   | 이유                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 코어     | **`@rhwp/core`** (직접 사용)                                                                           | Rust+WASM. HwpDocument로 IR 직접 조작. 라이브러리 v0.7.x 활발 개발 중                                                                                                                                     |
| Viewer   | **vendored rhwp-studio iframe** (`src/features/rhwp-studio/RhwpEditor.tsx`, `ahwp-studio://` protocol) | v0.5.0에서 자체 self-mounted `StudioViewer` 폐기 → vendored `rhwp-studio` 편집기 라이브러리를 iframe으로 임베드. 모든 편집 UI(메뉴/툴바/서식/표/도형 등)를 iframe이 제공, IR 호출은 `BridgeIrHelper` 경유 |
| 캐노니컬 | **HWP (CFB)**                                                                                          | `@rhwp/core` v0.7.14 HWPX 라운드트립이 이미지 IR 깨뜨림 (KNOWN_ISSUES L-001). 라이브러리 fix 시 HWPX로 복귀                                                                                               |

## 저장소

| 항목           | 선택                                                                                          | 이유                                                                                |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 채팅·메시지 DB | **better-sqlite3**                                                                            | 동기 API라 Electron Main에서 단순. 파일별 히스토리·검색에 적합                      |
| 설정           | **자체 JSON 파일** (`electron/store/*` — `fs` + `app.getPath('userData')`, atomic tmp→rename) | electron-store 미채택. session/provider-config 등을 직접 JSON으로 읽고 atomic write |
| 비밀(키)       | **electron `safeStorage`**                                                                    | OS 키체인 위임. 별도 라이브러리 불필요                                              |
| 문서 임시 파일 | **`app.getPath('temp')` 하위**                                                                | HWP→HWPX 변환 결과 보관. 종료 시 정리                                               |

## AI 통합

| 항목                 | 선택                              | 이유                                                                                                                                                                                                       |
| -------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 키 관리              | **BYOK only**                     | 사용자 결정. 서버 인프라 0                                                                                                                                                                                 |
| 공급자 추상화        | **자체 `Provider` 인터페이스**    | 모든 어댑터가 SDK 없이 `fetch` 직접 호출(REST)로 통일. `custom` (OpenAI 호환) 슬롯이 자체 호스팅 / on-prem / 사내 게이트웨이를 한 경로로 통일                                                              |
| OpenAI               | **`fetch` 직접 호출 (REST)**      | `openai` SDK 미사용. tool use 안정성 검증됨                                                                                                                                                                |
| Anthropic            | **scaffold only — 어댑터 미구현** | `@anthropic-ai/sdk` 미사용. `ProviderId` union에는 있으나 어댑터가 없어 `ai:chat-start`가 "not implemented yet" 반환. 키 결정 대기                                                                         |
| Google               | **`fetch` 직접 호출 (REST)**      | `@google/genai` SDK 미사용. Gemini 2.x 지원                                                                                                                                                                |
| ~~NVIDIA NIM~~       | **0.6.18 제거**                   | vision 부재로 form-fill 시각 검증 workflow와 비호환. 셀프호스트 NIM은 `custom` 슬롯으로 흡수. `ProviderId` union에서도 제거                                                                                |
| 커스텀 (OpenAI 호환) | **`fetch` 직접 호출 (REST)**      | OpenAI 호환 endpoint(`/v1/chat/completions`)로 통일. base URL만 다름. 자체 호스팅 Ollama (`http://localhost:11434/v1`) / vLLM / LM Studio / on-prem 게이트웨이 모두 한 슬롯에 통합. 단일 API 웹검색 미지원 |
| 스트리밍             | **SSE / chunked**                 | 모든 SDK가 지원. Main → Renderer로 IPC 이벤트 중계                                                                                                                                                         |

## 도구·품질

| 항목          | 선택                            | 이유                                        |
| ------------- | ------------------------------- | ------------------------------------------- |
| Lint          | **ESLint + @typescript-eslint** | 표준                                        |
| Formatter     | **Prettier**                    | 표준                                        |
| 테스트 (단위) | **Vitest**                      | Vite 친화                                   |
| 테스트 (E2E)  | **Playwright (Electron 모드)**  | 공식 Electron 지원                          |
| 커밋 훅       | **Husky + lint-staged**         | 사전 검사 자동화                            |
| CI            | **GitHub Actions**              | 매트릭스(mac/win/linux) 빌드, 릴리스 자동화 |

## 채택하지 않은 것 (이유 메모)

- **Tauri**: Rust 기반에 번들 가벼움이 매력적이나 React 생태계 활용도·multi-platform 패키징 검증성 측면에서 Electron이 우위. 다국어·알림 등 OS 통합도 Electron 쪽이 더 검증됨. (HOP은 Tauri 채택 — 비교 검토는 STUDIO_MIGRATION.md 참고)
- **Next.js**: 데스크탑 앱에 SSR 불필요. Vite로 충분
- **Redux Toolkit / Zustand**: 별도 전역 스토어 없이 React state + IPC 로 상태 규모 충분
- **자체 프록시 서버**: BYOK로 결정. 트래픽·과금 부담 회피

> **나중에 채택한 것**: **i18next** — chunk 89 에서 도입 (ko/en, `react-i18next`, `src/lib/i18n` 에서 init). MVP 한국어-only 였으나 영어 locale 추가됨.
