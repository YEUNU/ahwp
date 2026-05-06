# Phase 6 — rhwp-studio view 계층 정합 (Canvas + Layered Overlay)

이 문서는 Phase 6 진입 청사진. 청크 단위 + 의사결정·블로커·inventory 결과를 박제. 시간 순 일지는 PROGRESS.md (Phase 6 시작 시점부터).

## 목표

`StudioViewer` 의 페이지 렌더 path 를 **`renderPageSvg` (SVG 단일 평면)** 에서 **`renderPageToCanvasFiltered` (Canvas + 3-tier DOM overlay)** 로 전환. rhwp 라이브러리의 **메인테이너 reference 구현** (`rhwp-studio/src/view/`) 과 view 계층 아키텍처를 정합.

검증 시나리오:

> 워터마크가 들어간 공문서를 열면 워터마크가 본문 뒤로 자연스럽게 깔리고, 글 앞 도장 그림이 셀렉션 위로 떠 있으며, 본문 텍스트는 정상 hit-test/편집 가능.

→ 이 시나리오는 현재 SVG 경로에서도 **시각적으로는** 동작하지만, layer 별 토글·인쇄 미리보기·편집 모드 디밍 등 **layer-aware UI 가능성** 이 차단되어 있음. Phase 6 의 본질은 그 가능성을 여는 것.

## 동기 — 왜 지금

ahwp 의 핵심 가치는 **rhwp 기반 인공지능을 활용한 자동 글쓰기**. 라이브러리의 fidelity 가 곧 제품 가치의 천장. 따라서 라이브러리 reference 구현 정합이 ROI 가 가장 높은 결정.

타이밍 근거:

- chunk 1~2 (2026-04-29) **SVG 선택 시점에는 layer-aware Canvas API 가 lib 에 존재하지 않았음**. `renderPageToCanvasFiltered` (Task #516 Stage 5.2) 는 0.7.10 (2026-05-05) 에 추가
- 0.7.10 업그레이드 (2026-05-06, commit `6626978`) 로 새 API 가 사용 가능해짐
- rhwp-studio 가 새 API 의 정공법 사용 패턴 (`rhwp-studio/src/view/page-renderer.ts`) 을 reference 로 공개

즉 chunk 2 의 SVG 선택은 정합한 결정이었고, lib 진화에 따른 자연스러운 follow.

## 현재 상태 (Phase 5 진행 중, 0.3.40 시점)

### SVG 의존 inventory (2026-05-06 확정)

전수 grep + 코드 추적 결과, 진짜 SVG 의존은 **4 지점** 만 남아 있음:

| 위치                            | 현재 SVG 의존                                                                                | Canvas 전환 후                                                                                                                        |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `StudioViewer.tsx:917, 949-984` | `renderPageSvg` 결과 mount + `<text>` 자식 `<title>` 삽입 (L-004 narrow-column tooltip 우회) | `renderPageToCanvasFiltered(idx, c, scale, "flow")` + `getPageLayerTree` 의 text op bbox 기반 transparent `<div title="...">` overlay |
| `StudioViewer.tsx:970-984`      | `parsed.querySelectorAll('image').length` (diagnostic)                                       | `getPageLayerTree` 의 image op count 또는 삭제                                                                                        |
| `utils/page-dims.ts:16`         | `<svg width="X" height="Y">` regex parse                                                     | `doc.getPageInfo(idx)` JSON 의 `width`/`height` (HU → CSS px 변환)                                                                    |
| `useDebugSurface.ts:1251`       | `el?.querySelector('svg')`                                                                   | `el?.querySelector('canvas')` 일대일 교체                                                                                             |

### 이미 lib API 위에 올라간 영역 (Canvas 전환 시 변경 0)

| 영역                               | 사용 API                                                                                                                   |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **caret · click hit-test**         | `doc.hitTest(page, x, y)` — `StudioViewer.tsx:3550-3568` `hitTestAt`, `usePageMouseHandlers.ts` mousedown/drag/shift-click |
| **비주얼 라인 nav** (ArrowUp/Down) | `getCursorRect` + `hitTest` — `useKeyboardShortcuts.ts:398-426`                                                            |
| **selection rect 시각화**          | `getSelectionRects` 결과를 **SVG 가 아니라 DOM `<div>` overlay** 로 paint — `PaperPage.tsx:219-249`. 이미 SVG-decoupled    |
| **표 control hit + bbox**          | `getTableBBox` + 경계 보정                                                                                                 |
| **셀 내부 caret**                  | `getCursorRectInCell` / `getCursorRectByPath`                                                                              |
| **머리말·꼬리말·각주 hit**         | `hitTestHeaderFooter` / `hitTestFootnote` / `hitTestInFootnote` / `hitTestInHeaderFooter`                                  |
| **AI tool 좌표 입력**              | 모두 IR 좌표 (sec/para/charOffset) — 픽셀 좌표 의존 0건                                                                    |
| **`getBoundingClientRect` 25건**   | client → page-local 좌표 변환용 (renderer-agnostic) — page DOM 이 SVG 든 Canvas 든 동일 동작                               |

이 inventory 가 Phase 6 의 작업량을 chunks 100~120 (이전 추정) 에서 **chunks 100~108 (8-9 chunks)** 로 줄여줌.

## 의사결정 박제

### D-1. Dual-render 게이트 vs 직접 갈아치우기

**결정**: dual-render. chunks 6.3~6.7 동안 SVG 와 Canvas 양 경로를 feature flag (`localStorage.ahwp:render-mode='canvas'|'svg'`, 기본 `'svg'`) 로 공존. 6.7 cleanup chunk 에서 SVG 경로 제거.

**이유**:

- SVG 경로는 chunks 1~99 동안 검증된 reference. 회귀 비교 가능
- Canvas 전환 중 한 chunk 의 회귀가 전체 사용자 플로우를 깨지 않게 격리
- Visual snapshot e2e baseline 을 mode-별로 분리해 점진 검증 가능

**비용**: 6.3~6.6 동안 두 codepath 가 공존. 양쪽 다 e2e 통과해야 함. cleanup 까지 약 5 chunks 의 일시 중복.

### D-2. WasmBridge 추상 도입 범위

**결정**: renderer 측만 도입 (`src/lib/rhwp-core.ts` 확장). main 프로세스 (`electron/hwp/converter.ts`) 는 단일 호출 지점이라 그대로.

**이유**:

- renderer 의 `doc.*` 직접 호출이 `StudioViewer.tsx` (4943줄) + 5+ hook 파일에 분산
- Phase 6 가 이 호출 표면을 광범위하게 흔들기 때문에 추상이 있으면 변경 격리 가능
- main 측은 `await import('@rhwp/core')` + `exportHwp` 한두 개라 추상 이득 적음

**구현**: `src/lib/rhwp-core/wasm-bridge.ts` 신설. `Document` (래퍼 클래스) 가 `HwpDocument` 인스턴스를 hold + 메서드 위임. 모든 hook 이 `bridge.hitTest(...)` 식으로 호출. lib 시그니처 변경 시 한 군데만 수정.

### D-3. e2e 전략

**결정**: dual-mode 게이트로 분리. 기존 ~303 케이스는 SVG mode 로 계속 통과. Canvas mode 전용 시각 회귀 게이트는 fixture 별 screenshot baseline 별도.

**이유**:

- 기존 e2e 의 압도적 다수가 `__studioDebug` IR 호출 + DOM-text assertion 으로, **renderer 무관**. Canvas 전환 후에도 그대로 통과
- DOM-selector 의존 e2e (예: `el?.querySelector('svg')` 류) 는 inventory 에서 식별. 그 케이스만 dual-mode 분기 또는 selector 추상화
- Visual snapshot e2e (현재 1건) 는 mode 별 baseline 분리

**잔존 작업**: chunk 6.6 에서 selector-DOM 의존 e2e 전수 검토 + 필요 시 dual-mode 분기.

### D-4. AI tool 영향 — IR 좌표만 쓰므로 어댑터 불필요

**결정**: 별도 어댑터 X. 현재 55개 tool 모두 IR 좌표 (sec/para/charOffset, controlIdx 등) 만 입출력. Canvas 전환 시 영향 0.

**검증**: `shared/ai-tool-catalog.ts` 의 모든 tool input schema 가 픽셀 좌표를 받지 않음을 확인 (`pixel`, `clientX`, `boundingRect` 류 키 0건).

**예외 식별 시**: 해당 tool 만 chunk 6.5 에서 좌표 변환 layer 추가.

### D-5. canvas-pool 도입

**결정**: rhwp-studio `canvas-pool.ts` 패턴 차용. 페이지 mount/unmount 시 Canvas 재사용 (DOM Canvas element 풀링).

**이유**:

- 현재 SVG 는 `el.replaceChildren(adopted)` 으로 DOM swap — GC 가 알아서 처리
- Canvas 는 `getContext('2d')` 가 비용 높고 contexts 가 element 별로 unique. 매 페이지 mount 마다 새 Canvas 면 viewport 스크롤 시 메모리·GC 압박
- pool 사이즈 = `VIEWPORT_BUFFER_PAGES × 2 + 1` (현재 11) 정도면 충분

**복잡도**: rhwp-studio 의 `canvas-pool.ts` 가 작은 파일 (~150줄 추정). 거의 그대로 포팅.

### D-6. coordinate-system.ts 도입

**결정**: rhwp-studio `coordinate-system.ts` 패턴 차용. 페이지/CSS/Canvas/DOM 4-좌표계 변환 유틸을 한 군데로.

**이유**:

- 현재 좌표 변환이 `usePageMouseHandlers.ts` 등에 인라인 분산 (예: `(clientX - rect.left) / zoom`). DPR 비고려
- Canvas 전환 시 `scale = zoom × DPR` 정합 필수. 변환 로직 중복은 회귀 위험
- 단일 모듈로 모으면 테스트 가능 + 변경 격리

## 청크 분할 (실행 순서)

### chunk 100 — Phase 6.0: WasmBridge 추상

**산출물**:

- `src/lib/rhwp-core/wasm-bridge.ts` — `Document` 래퍼 + `Viewer` 래퍼 (현재 `HwpDocument`/`HwpViewer` 인스턴스 hold)
- `StudioViewer.tsx` 의 `docRef.current` 타입 → `Document` 래퍼로
- 모든 hook 의 `doc.X(...)` → `bridge.X(...)` 일괄 치환 (sed-grade 변경)

**검증**: 기존 e2e 전부 회귀 0. typecheck clean. 동작 변화 0건.

**작업량**: 1 chunk (4-6시간 추정)

### chunk 101 — Phase 6.1: coordinate-system.ts

**산출물**:

- `src/lib/rhwp-core/coordinate-system.ts` — `clientToPage`, `pageToClient`, `pageToCanvas`, `canvasToPage`, `pageInfoToDimensions` 등 변환 함수
- `usePageMouseHandlers.ts` 의 인라인 좌표 변환 → 함수 호출로 교체
- DPR 처리 추가 (현재 zoom 만, DPR 무시 → `scale = zoom × DPR` 으로)

**검증**: 기존 hit-test e2e 전부 통과. DPR=2 환경에서 좌표 정합 검증 추가.

**작업량**: 1 chunk

### chunk 102 — Phase 6.2: canvas-pool + dual-mode 인프라

**산출물**:

- `src/lib/rhwp-core/canvas-pool.ts` (rhwp-studio 포팅)
- `localStorage.ahwp:render-mode` flag 인프라
- `PaperPage.tsx` 가 mode 에 따라 SVG `<div>` 또는 Canvas element 선택 mount

**검증**: mode='svg' 기본 동작 회귀 0. mode='canvas' 시 빈 Canvas 마운트만 성공 (아직 그림 안 그림).

**작업량**: 1 chunk

### chunk 103 — Phase 6.3: Canvas 본문 렌더 (overlay 없이)

**산출물**:

- mode='canvas' 시 `bridge.renderPageToCanvasFiltered(idx, canvas, scale, 'flow')` 호출
- `utils/page-dims.ts` Canvas mode 분기 → `getPageInfo` 사용
- L-004 tooltip 우회 대체: `getPageLayerTree` 의 text op bbox 로 transparent `<div title="...">` overlay
- `useDebugSurface.ts` SVG selector → mode 별 분기
- 비동기 이미지 재렌더 스케줄러 (rhwp-studio `scheduleReRender` 패턴)

**검증**: mode='canvas' 로 fixture 전부 시각 렌더 통과 (단, 워터마크/도장은 아직 안 보임 — flow layer 만이라). visual snapshot baseline 신규 (mode='canvas' 분기).

**작업량**: 2 chunks (작업 단위 큼)

### chunk 104 — Phase 6.4: behind/front overlay

**산출물**:

- `getPageLayerTree` 파서 (rhwp-studio `collectOverlayImages` 패턴 거의 그대로)
- `PaperPage.tsx` 에 behind/front overlay `<div><img>` sibling 삽입 (z-index 0 / 2)
- 효과 CSS 매핑 (grayScale / blackWhite / brightness / contrast)
- 워터마크 `mix-blend-mode: multiply`

**검증**: 워터마크 + 도장 fixture 시각 회귀 통과. 텍스트 hit-test 영향 0 (overlay 가 `pointer-events: none`).

**작업량**: 1 chunk

### chunk 105 — Phase 6.5: find / changed-paragraph 하이라이트 mode 정합

**산출물**:

- find 매치 하이라이트 — 현재 SVG-내 `<rect>` 인지 DOM overlay 인지 chunk 진입 시 확인 후 결정. DOM overlay 면 변경 0
- changed-paragraph stripe (`PaperPage.tsx:206-218`) 는 이미 DOM overlay → 변경 0
- selection rect (`PaperPage.tsx:219-249`) 는 이미 DOM overlay → 변경 0

**검증**: find/replace e2e 전부 통과. AI 변경 stripe 시각 정합.

**작업량**: 1 chunk (find 경로 확인 결과에 따라 0.5~1.5 chunk)

### chunk 106 — Phase 6.6: e2e 점검 + selector-DOM 의존 정리

**산출물**:

- `tests/e2e/*.spec.ts` 전수 grep: `querySelector('svg')`, `text` element 의존, `<image>` count 검사 등 SVG-specific selector 식별
- 식별된 케이스를 (a) `__studioDebug` IR 호출 기반으로 재작성 또는 (b) mode-agnostic selector 로 추상화

**검증**: dual-mode 양쪽에서 ~303 e2e 통과.

**작업량**: 1 chunk

### chunk 107 — Phase 6.7: SVG 경로 제거 + cleanup

**산출물**:

- `localStorage.ahwp:render-mode` flag 제거
- mode='svg' 분기 코드 일괄 삭제
- `renderPageSvg` 호출 0건 (`grep` 검증)
- 진단 코드 (`__studioPageDiag` 등) 정리
- L-004 우회 코드 (`<text><title>` 삽입) 삭제

**검증**: typecheck / lint / e2e / visual snapshot 전부 통과. CHANGELOG entry.

**작업량**: 1 chunk

**총 8-9 chunks**, 약 1.5~2주 규모.

## 잔존 미지수 / 리스크

### R-1. find 매치 하이라이트 시각화 경로

`StudioViewer.tsx` 의 find 매치 하이라이트가 SVG-내 `<rect>` 인지 DOM overlay 인지 inventory 시점 미확인. chunk 105 진입 첫 작업으로 확인. SVG 내장이면 DOM overlay 로 마이그레이션 (선례: selection rect 가 이미 그렇게 함).

### R-2. 비동기 이미지 디코딩 race

`<img src="data:...base64,...">` 가 첫 paint 때 미디코딩되어 빈 box 로 보일 수 있음. rhwp-studio 가 200ms / 600ms 두 번 재렌더로 우회. ahwp 도 동일 패턴 사용. 단 첫 페이지 가시성 지연 (ms 단위) 가 사용자 체감에 미치는 영향은 chunk 6.3 시각 검증 시 측정.

### R-3. DPR 변경 시점 처리

DPI 변경 (고DPI 모니터로 창 이동) 시 Canvas 재렌더 트리거. `window.matchMedia('(resolution: ...)')` 또는 `devicePixelRatio` 변경 감지 hook 필요. chunk 6.1 의 coordinate-system 에서 같이 처리.

### R-4. canvas-pool LRU 정책

페이지 수가 viewport buffer 보다 많을 때 (e.g. 100 페이지 문서, buffer 11) pool 크기 한정 + LRU 추출. rhwp-studio 의 정책 그대로 차용 가능한지 chunk 6.2 진입 시 확인.

### R-5. 인쇄 미리보기 (Backlog)

Phase 6 의 layer-aware 인프라가 열어주는 가장 큰 follow-up. behind/front 토글 + 모노크롬 모드 등. **Phase 6 범위 X**, 별도 chunk 또는 Phase 7 후보.

## 비-목표 (Phase 6 가 안 다루는 것)

- **인쇄 미리보기 / PDF export** — 인프라는 깔리지만 UI 별도
- **편집 모드 디밍 / layer 토글 UI** — 인프라 위 후속 작업
- **L-008 (이미지·도형 통합 bbox) 완전 해결** — 라이브러리 의존. `getPageLayerTree` 가 floating image 한정으로 좌표 제공 → 부분 우회 가능하지만, 도형/수식/표 외 control 의 통합 bbox 는 lib 의 `getControlBBox` 추가 필요
- **L-001 (HWPX 라운드트립 BinData)** — 라이브러리 의존. HWP-canonical 우회 유지
- **WASM 메인 프로세스 측 정합** — `electron/hwp/converter.ts` 는 그대로
- **mobile / web 타겟** — Electron 전용 가정 유지

## 검증 게이트 (Phase 6 완료 조건)

1. `localStorage.ahwp:render-mode` flag 제거 후 `grep renderPageSvg src/ tests/` → 0건
2. typecheck / lint / format / unit / e2e 전부 통과 (~303 케이스)
3. 워터마크 + 도장 fixture 시각 회귀 게이트 (`tests/e2e/studio-overlay-layers.spec.ts` 신규) 통과
4. `examples/` 의 기존 fixture 전부 mode='canvas' 로 시각 렌더 통과
5. DPR=1 / DPR=2 환경 좌표 정합 e2e 통과
6. README.md / ARCHITECTURE.md / TECH_STACK.md "Studio viewer" 섹션 갱신 (SVG → Canvas + 3-tier overlay)
7. KNOWN_ISSUES L-004 항목 closed (Canvas + getPageLayerTree overlay 로 해결)

## 후속 — Phase 6 가 열어주는 것

- **layer 토글 UI** — "워터마크 숨기기", "도장 흐리게" 등
- **인쇄 미리보기** — 본문 layer 만 또는 모노크롬 변환
- **편집 모드 디밍** — `BehindText` overlay 를 0.5 opacity 로
- **그림 이동·리사이즈 핸들** — `getPageLayerTree` 의 image bbox 위에 DOM 핸들. L-008 의 floating image 부분 해결
- **AI 자동 글쓰기 fidelity 향상** — 라이브러리 reference 정합 → 라이브러리 업그레이드 회귀 추적 비용 절반 이하

## 트래킹

Phase 6 시작 시 `docs/PROGRESS.md` 에 Phase 6 일지 추가. 청크별 디테일은 commit body + `git log`. 본 plan 문서는 chunks 100~107 진행 중 갱신 (의사결정 변경 시 박제).
