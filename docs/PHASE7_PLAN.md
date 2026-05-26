# Phase 7 — rhwp-studio iframe 임베드 + AI 전용 패널화

## 의도

현재 ahwp 는 `@rhwp/core` (WASM 저수준) 위에 직접 에디터 UI 를 구현해
StudioViewer + 8 hook + 표 / 페이지 / 도형 / 수식 다이얼로그 등 ~5000
라인을 보유한다. 한컴 호환 에디터 UI 자체는 `rhwp-studio` 가 이미 완성도
높게 제공하므로, ahwp 는 **AI 자동 작성 + Electron shell** 로 좁히고
에디터는 임베드된 rhwp-studio 가 담당하는 구조로 전환한다.

- ahwp 가 유지하는 영역
  - Electron shell (file I/O / 폴더 트리 / 탭 / Settings / secrets / chokidar)
  - AI Chat 패널 + 자동 작성 도구 + provider 어댑터
- rhwp-studio 가 담당하는 영역
  - 에디터 UI (메뉴 / 도구 상자 / 서식 / 표 편집 / 페이지 / 도형 / 수식 / Find&Replace / 단축키)
  - WASM IR 보유 + 모든 IR 변형

## 통신 — postMessage bridge

upstream `rhwp-studio/src/main.ts:758` 에 이미 뼈대 존재:

```
요청: { type: 'rhwp-request',  id, method, params }
응답: { type: 'rhwp-response', id, result?, error? }
이벤트: { type: 'rhwp-event',  name, data }   ← Phase A2 에서 추가
```

현재 노출 method (7): `ready` / `loadFile` / `pageCount` / `getPageSvg`
/ `exportHwp` / `exportHwpx` / `exportHwpVerify`. AI tools 가 필요로
하는 ~50 method 는 Phase A2 에서 추가.

## 폴더 구조

```
ahwp/
├─ vendor/
│  └─ rhwp/                  # git submodule → edwardkim/rhwp (branch: ahwp-bridge)
│     ├─ pkg/                # @rhwp/core artifacts (gitignored; npm run vendor:rhwp:setup 로 채움)
│     └─ rhwp-studio/
│        ├─ src/main.ts      # postMessage switch — 우리 patch 의 핵심 위치
│        └─ dist/            # vite build 산출물 (gitignored)
├─ scripts/setup-rhwp-studio.mjs
└─ src/features/studio/      # 점진 폐기 대상 (Phase E)
```

## Phase 분할

### Phase A — bridge 인프라

- [x] **A1** — submodule + 빌드 파이프라인 (이 청크)
  - `vendor/rhwp` 를 edwardkim/rhwp 의 submodule 로 추가
  - `ahwp-bridge` 브랜치 생성 (patch 작업용)
  - `npm run vendor:rhwp:setup` — `@rhwp/core` artifacts 를 `vendor/rhwp/pkg/` 로 복사
  - `npm run vendor:rhwp:build` — setup + rhwp-studio vite build
  - 빌드 통과 검증 ✅
- [x] **A2** — bridge method 확장 (1차 + 후속)
  - 1차: 6 convenience case (`getSectionCount` / `getParagraphCount` / `getTextRange` / `searchAllText` / `insertText` / `getCaretPosition`) — 외부 통합 docs 와 PoC 호환을 위한 named case.
  - 후속: **generic `wasm` dispatcher case** — `{ method:'wasm', params:{ fn, args } }` 로 WasmBridge ~230 method + getter 전체를 enumeration 없이 노출. `dispose`/`free` 는 명시적 차단. method enumeration 비용 0.
  - vite build 에 `--base=./` (file:// + Electron resources 호환).
  - 회귀 PoC `tests/e2e/rhwp-bridge-poc.spec.ts` — chromium + 내부 http server. 12 단계 시퀀스: ready → loadFile → 6 method (named) → 4 generic dispatcher case (method / getter / blocked / non-existent) → 명백한 unknown method. 2/2 통과 ✅
  - 잔여 (Phase B 와 함께 처리 예정): `rhwp-event` channel — `caret-changed` / `selection-changed` / `doc-mutated`. Phase D 의 Diff Viewer / Plan mode 가 의존하지만 핵심 tool 호출은 polling 으로도 충분하므로 Phase B 와 묶어서.

### Phase B — ahwp 측 bridge client

- [x] `shared/rhwp-bridge.ts` — wire 프로토콜 타입 (RhwpRequest / RhwpResponse / RhwpEvent / RhwpWasmParams / RhwpLoadResult / RhwpCaretPosition / RhwpSearchHit).
- [x] `src/lib/rhwp-bridge.ts` — `RhwpBridge` 클래스. id req-res tracking + timeout + event listener registry + destroy lifecycle. `invoke` / `invokeWasm` / `loadFile` / `ready` / `on` / `destroy`. `crypto.randomUUID` 우선 + fallback id generator.
- [x] `src/lib/rhwp-bridge.test.ts` — vitest 12 cases (mock contentWindow): invoke 라운드트립 / invokeWasm 래핑 / 동시 호출 / 에러 / 타임아웃 / 이벤트 sub-unsub / 핸들러 throw isolation / 다른 출처 메시지 무시 / destroy cleanup / loadFile 바이트 변환. 12/12 통과 ✅
- [x] `tests/e2e/rhwp-bridge-client.spec.ts` — Playwright + chromium. 정적 서버가 parent.html + studio dist 를 동일 origin 에 호스팅, parent 안 inline TestBridge (RhwpBridge 와 동일 wire 프로토콜) 가 iframe 의 rhwp-studio 와 round-trip. ready / loadFile / invokeWasm method+getter / 에러 / 동시 호출. 1/1 통과 ✅

### Phase C — iframe 임베드 + 호스팅

- [x] `ahwp-studio://` 커스텀 protocol 등록 (`electron/rhwp-studio-protocol.ts`). standard / secure / supportFetchAPI / corsEnabled / stream privilege. path traversal 가드.
- [x] dev 경로: `vendor/rhwp/rhwp-studio/dist`. prod 경로: `process.resourcesPath/rhwp-studio`. `app.isPackaged` 로 자동 분기.
- [x] electron-builder `extraResources` — `vendor/rhwp/rhwp-studio/dist` → `Resources/rhwp-studio/`.
- [x] `npm run build` / `build:dir` / `build:all` 가 `vendor:rhwp:build` 를 자동 선행.
- [x] CSP `frame-src 'self' ahwp-studio:` + `connect-src ahwp-studio:` 추가 (`index.html`).
- [x] `src/features/rhwp-studio/RhwpEditor.tsx` — forwardRef + iframe + 자동 bridge 생성/destroy + ready/onError 콜백. `RhwpEditorHandle` 로 bridge/iframe 노출. `eslint-disable-next-line react-hooks/exhaustive-deps` 로 src 상수 lifecycle 보장.
- [x] Electron e2e `tests/e2e/rhwp-studio-electron.spec.ts` — 실제 Electron 띄우고 page.evaluate 로 iframe 마운트 → protocol 응답 / CSP allow / ready+wasm 라운드트립 / 404 / path-traversal 차단 3 케이스. 3/3 통과 ✅

### Phase D — AI tool 재배선

- [x] **D1** — 인프라 (bridge 노출 + 실제 Electron 안에서 verify)
  - `src/features/rhwp-studio/debug-surface.ts` — `window.__rhwpDebug.mount/unmount/getBridge` 노출. createRoot + RhwpEditor portal mount. mount() 는 ready resolve 까지 await 한 bridge 를 반환.
  - `src/main.tsx` 의 top-level 에서 `installRhwpDebugSurface()` — Phase D 후반 / E 에서 viewer 자체 교체 전, dev / e2e / 콘솔 디버깅 용도.
  - e2e `tests/e2e/rhwp-studio-debug-mount.spec.ts` — 실제 ahwp Electron 띄우고 React lifecycle 거쳐 RhwpEditor mount → bridge.ready / invokeWasm / unmount → bridge null. 2/2 통과 ✅
- [~] **D2** — 55 AI tools 의 `viewerHandle.irX(...)` → `bridge` 경유 (사실상 D2a/D2b/... 여러 sub-chunk).
  - [x] **D2a** — `BridgeIrHelper` 클래스 (12 메서드: getSectionCount / getParagraphCount / getParagraphLength / getCaretPosition / getTextRange (composite) / getTextInCell / searchAllText / insertText / deleteText / insertTextInCell). useViewerHandle 의 composite 로직 (cross-para getTextRange) 그대로 옮김. JSON `{"ok":...}` 응답 파싱 isOk(). unit 12/12 (mock bridge) + e2e 2/2 (실제 iframe, insertText/deleteText round-trip). tools.ts 는 아직 viewerHandle 직접 사용 — D2b 에서 wiring.
  - [x] **D2b** — `runTools(viewer, items, helper?)` / `runOne(viewer, call, helper?)` 시그너처에 `helper: BridgeIrHelper | null` 추가. helper 가 non-null 이면 `insertText` / `insertTextInCell` case 가 helper.getTextRange / helper.insertText / helper.getTextInCell / helper.insertTextInCell 로 라우팅 (before / write / after diff 모두). null 이면 기존 viewer.irX 그대로. AppShell 의 기존 호출 (`runTools(v, items)`) 은 helper 누락 — 그대로 fallback. tools.test.ts 에 4 신규 case (helper 라우팅 / viewer fallback / cell 라우팅 / guard 우선) 추가. unit 15/15.
  - [x] **D2c-1** — helper +7 (deleteRange / mergeParagraph / applyCharFormat / applyStyle / getCharPropertiesAt / getParaPropertiesAt / getStyleAt composite). tools.ts 7 case helper-route. unit 20/20.
  - [x] **D2c-2** — helper.invokeOk/invokeRead 범용 라우터 + ~20 case 일괄 helper-route (paragraph / table / shape / page / header-footer / equation / footnote / read 그룹). submodule main.ts 의 generic dispatcher 가 wasm.doc fallback — insertParagraph/deleteParagraph 같은 raw HwpDocument 메서드도 호출 가능.
- [x] **D3** — `RhwpEditorHandle.exportHwp / exportHwpx / loadBytes` — AppShell 의 file:save / file:open 흐름이 bridge 경유로 동작 가능. e2e — fixture 로드 → insertText → exportHwp → reload → sentinel 검색 round-trip 1/1 통과.
- [x] **D4** — `rhwp-event` 채널 + caret-changed emission (rhwp-studio main.ts 의 250ms polling). RhwpBridge.on 이미 wire 완료. e2e — load + insertText 후 listener 호출 횟수 ≥1 + payload shape (sectionIndex/paragraphIndex/charOffset) 확인 1/1 통과.
- [x] **D5** — AI 회귀 sanity. helper-param 추가 후 offline chat fake-AI specs (`chat-actions` / `chat-history` / `chat-prefetch`) 16/16 통과.

### Phase E — 자체 Studio 제거

- [x] **E1** — AppShell.runTools 호출이 `__rhwpDebug.getBridge()` 가 non-null 이면 자동으로 BridgeIrHelper 를 만들어 3번째 인자로 전달. dual-mode — bridge 없으면 기존 viewer 경로.
- [~] **E2** — rhwp-mode flag + AppShell 통합 (a/b/c 완료, d 부분 = StudioViewer 폐기 미진행).
  - [x] **E2a** — localStorage `ahwp:use-rhwp-editor` flag. true 일 때 활성 탭의 StudioViewer 자리에 RhwpEditor 마운트, onReady 콜백이 file:read → bridge.loadFile 자동 fire. e2e — iframe 마운트 + src=ahwp-studio:// 확인 + 회귀 (flag absent) 1+1 통과.
  - [x] **E2b** — AppShell 이 `rhwpHandlesRef = Map<tabKey, RhwpEditorHandle>` 로 탭별 핸들 추적. runTools 라우팅 우선순위: (1) useRhwpEditor + active tab handle bridge, (2) `__rhwpDebug.getBridge()`, (3) viewer.irX fallback.
  - [x] **E2c** — useSaveFlow 에 optional `exportOverride` 추가. useRhwpEditor 모드면 `handle.exportHwp()` (bridge.invoke('exportHwp')) 가 viewer.exportBytes() 대체. file:save / saveAs / autosave 모두 동일 경로.
  - [ ] **E2d** — `src/features/studio/` 폐기 (StudioViewer + 8 hook + 모든 dialog / utility ~5000 라인). 의존 import 정리. 관련 e2e ~30 spec 정리. **별도 세션 권장** — UI 검증 충분히 누적된 다음.
- [ ] **E3** — CLAUDE.md / ARCHITECTURE.md / KNOWN_ISSUES.md 갱신 + CHANGELOG + 메이저 version bump (0.4.x → 0.5.0). E2d 와 같이.

## 리스크

- **upstream divergence**: rhwp-studio 가 active 개발 중 (현 0.7.12, 매주 푸시). 우리 fork branch (`ahwp-bridge`) 가 patch 만 가볍게 유지하지 않으면 sync 비용 폭증. Bridge 코드는 단일 파일 (`main.ts`) 변경에 집중.
- **WASM 빌드 분리**: Rust 소스 수정이 필요하면 Docker + wasm-pack 필요. Phase A 는 IR 미수정 — 추후 IR 도 손대야 한다면 `@rhwp/core` upstream 에 PR 우선.
- **file:// origin 제약**: chrome iframe in file:// 의 `wasm-unsafe-eval` / fetch / origin policy 확인 필요. Phase C 핵심 검증 항목.
- **AI tools 동기 호출 가정**: 현재 dispatcher 는 `docRef.current.X(...)` 동기. bridge 는 Promise. 그룹 undo / Diff snapshot 같은 batched 동작 재설계 필요.

## 다음 작업 (E2 / E3) — 별도 세션 권장

본 phase 의 인프라 (A1~D5 + E1) 는 0.4.30 으로 완료. 다음은 본 UI 통합
및 자체 코드 제거 — 작업량이 크고 회귀 위험도 높아 별도 세션 권장.

### E2 — StudioViewer 폐기 (큰 단일 작업)

1. `__rhwpDebug.mount()` auto-fire (또는 `AppShell` 이 RhwpEditor 를 직접 마운트). bridge 가 항상 존재 → 모든 AI tools 자동으로 bridge 경유.
2. AppShell 이 탭 별로 StudioViewer 대신 RhwpEditor 렌더. file:save / file:open 흐름 `RhwpEditorHandle.exportHwp/loadBytes` 경유.
3. `viewer.X` (non-ir composite — applyAlignment / setHeaderFooterText / applyHtmlAtCaret 등 ~20 메서드) 의 ahwp 측 처리:
   - Phase D2c-2 까지 viewer-only 로 남긴 case 들. rhwp-studio 가 자체 UI 로 같은 동작을 제공하므로 ahwp 측 helper 삭제 → 해당 tool 케이스는 `applyHtml` 같은 도구별 매핑 재설계 필요.
4. `src/features/studio/` 폐기 — StudioViewer + 8 hook + 모든 dialog / utility (~5000 라인). 의존 import 정리.
5. 관련 e2e ~30 spec 정리:
   - `__studioDebug.*` 의존 spec → 대부분 삭제 (rhwp-studio 가 자체 UI 검증). 일부는 `__rhwpDebug` + bridge 호출로 재작성.
   - studio-find / studio-edit / studio-shape / studio-table / studio-format / studio-footnote / studio-image / studio-wordsel / studio-paraformat / studio-clipboard / studio-pagenav / studio-undo / studio-selection / 기타.

### E3 — 0.5.0 major release

- CLAUDE.md / ARCHITECTURE.md / KNOWN_ISSUES.md 갱신.
- README 의 "풀 편집기 능력" 섹션 → "rhwp-studio 임베드" 로 재구성.
- CHANGELOG 의 0.5.0 marker.
- main 머지 + tag v0.5.0 + push.

### 다른 결정 대기 항목

- **submodule push** — local `ahwp-bridge` 브랜치의 patch (`c475d590`, `9faf04c6`, `ed79708c`, `a8924b9a`) 가 user GitHub fork 에 푸시되어야 다른 환경 / CI 에서 submodule init 가능. user 가 `gh repo fork edwardkim/rhwp` 후 `cd vendor/rhwp && git remote set-url origin <fork> && git push -u origin ahwp-bridge`.
- **release.yml CI** — main push 시 fire 하도록 갱신 완료 (0.4.29 청크). 다음 main push 시 자동 빌드.
