# 기술 스택 결정

각 선택의 **이유**와 **대안 검토 결과**를 함께 적었습니다. 추후 의사결정을 뒤집을 때 참고.

## 셸 / 패키징

| 항목          | 선택                         | 이유                                                                                                                       |
| ------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 데스크탑 셸   | **Electron** (latest stable) | 사용자가 명시. Mac/Win/Linux 동시 지원. Chromium 기반이라 `@rhwp/editor`(Vite/TS) 임베드가 자연스러움                      |
| 패키징·배포   | **electron-builder**         | 자동 업데이트(`electron-updater`), 코드 사이닝, 다년간 표준. electron-forge보다 멀티 OS 빌드 매트릭스가 명확               |
| 패키지 매니저 | **npm**                      | Node 기본 포함, 추가 설치 불필요. single package 구조라 pnpm 워크스페이스 이점 미미. (corepack 권한 이슈로 pnpm 대신 채택) |

## 렌더러

| 항목       | 선택                                                           | 이유                                                                                                                                               |
| ---------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 프레임워크 | **React 18**                                                   | rhwp-studio와 호환, AI/챗 UI 라이브러리 풍부                                                                                                       |
| 빌드       | **Vite**                                                       | rhwp-studio와 동일 toolchain, HMR 빠름                                                                                                             |
| 언어       | **TypeScript (strict)**                                        | 메인↔렌더러 IPC 타입 공유                                                                                                                          |
| UI         | **shadcn/ui + Tailwind CSS**                                   | 소스 복사 방식이라 커스터마이징 자유, radix 접근성 우수, 번들 가벼움. Ant Design은 룩 무겁고 한국어 폰트 이슈, Mantine은 좋지만 디자인 자유도 낮음 |
| 라우팅     | **react-router** (memory router)                               | 데스크탑 앱이라 hash/memory router로 충분                                                                                                          |
| 상태       | **Zustand**                                                    | 보일러플레이트 적고 IPC 결과 캐싱에 충분. Redux Toolkit은 과함                                                                                     |
| 비동기     | **TanStack Query**                                             | IPC 결과 캐시·재검증, 채팅 스트리밍과 분리해 정적 데이터 관리                                                                                      |
| diff 뷰어  | **react-diff-viewer-continued** 또는 monaco-editor의 diff 모드 | Manual 모드에서 변경사항 시각화                                                                                                                    |
| 폼         | **react-hook-form + zod**                                      | 설정 패널, API 키 입력                                                                                                                             |

## HWP 코어

| 항목      | 선택                           | 이유                                                         |
| --------- | ------------------------------ | ------------------------------------------------------------ |
| 메인 통합 | **`@rhwp/editor`** iframe/내장 | 사용자 결정: 하이브리드. 빠른 MVP. 에디터 영역 통째로 마운트 |
| 보조 통합 | **`@rhwp/core`**               | 변환·렌더·tool API. 사이드바·툴바 자체 구현 시 호출          |
| 통신      | postMessage / 직접 import      | rhwp 패키지 노출 API 형태에 따라 선택 (Phase 1 R&D)          |

## 저장소

| 항목           | 선택                           | 이유                                                           |
| -------------- | ------------------------------ | -------------------------------------------------------------- |
| 채팅·메시지 DB | **better-sqlite3**             | 동기 API라 Electron Main에서 단순. 파일별 히스토리·검색에 적합 |
| 설정           | **electron-store**             | JSON 파일 기반, 마이그레이션 헬퍼 내장                         |
| 비밀(키)       | **electron `safeStorage`**     | OS 키체인 위임. 별도 라이브러리 불필요                         |
| 문서 임시 파일 | **`app.getPath('temp')` 하위** | HWP→HWPX 변환 결과 보관. 종료 시 정리                          |

## AI 통합

| 항목            | 선택                           | 이유                                                                                                                                                               |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 키 관리         | **BYOK only**                  | 사용자 결정. 서버 인프라 0                                                                                                                                         |
| 공급자 추상화   | **자체 `Provider` 인터페이스** | OpenAI SDK가 사실상 표준에 가깝지만 Anthropic·Google는 별도 SDK가 더 깔끔. Ollama·커스텀은 OpenAI 호환 라우트로 통일                                               |
| OpenAI          | **`openai` 공식 SDK**          | tool use 안정성 검증됨. `web_search` 내장 tool 단일 API 지원                                                                                                       |
| Anthropic       | **`@anthropic-ai/sdk`**        | 긴 문서 편집 강점. `web_search` server tool 단일 API 지원                                                                                                          |
| Google          | **`@google/genai`**            | Gemini 2.x 지원. `googleSearch` grounding 단일 API 지원                                                                                                            |
| NVIDIA NIM      | **`fetch`로 직접 호출**        | OpenAI 호환(`/v1/chat/completions`)으로 Ollama·커스텀과 동일 어댑터 경로. 호스티드(`integrate.api.nvidia.com`) 또는 셀프호스트. 추론 전용 — 단일 API 웹검색 미지원 |
| Ollama / 커스텀 | **`fetch`로 직접 호출**        | OpenAI 호환 endpoint(`/v1/chat/completions`)로 통일. base URL만 다름. 단일 API 웹검색 미지원                                                                       |
| 스트리밍        | **SSE / chunked**              | 모든 SDK가 지원. Main → Renderer로 IPC 이벤트 중계                                                                                                                 |

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

- **Tauri**: Rust 기반에 번들 가벼움이 매력적이나 `@rhwp/editor`(npm 패키지)와의 통합 비용·React 생태계 활용도 측면에서 Electron이 우위. 다국어·알림 등 OS 통합도 Electron 쪽이 더 검증됨
- **Next.js**: 데스크탑 앱에 SSR 불필요. Vite로 충분
- **Redux Toolkit**: Zustand로 상태 규모 충분
- **자체 프록시 서버**: BYOK로 결정. 트래픽·과금 부담 회피
- **i18next**: MVP는 한국어 only. 추후 도입 시 컴포넌트 텍스트만 추출하면 되도록 inline string은 한 곳에 모음
