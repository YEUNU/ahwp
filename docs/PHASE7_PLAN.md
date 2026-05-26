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
- [ ] **D2** — 55 AI tools 의 `viewerHandle.irX(...)` 호출 전부 `bridge.invokeWasm(...)` 로 치환. tools.ts (`src/features/chat/tools.ts`) 가 가장 큰 작업. ir 메서드 1:1 매핑 + async 전환.
- [ ] **D3** — file open/save IPC 가 `bridge.loadFile` / `bridge.invokeWasm('exportHwp')` 경유하도록 재구성. ahwp 측 in-process `@rhwp/core` 인스턴스 단계적 폐기.
- [ ] **D4** — Diff Viewer / Plan mode / 그룹 undo — bridge event (caret/selection/doc-mutated) 위에 재구현. Phase A2 후속의 event channel 추가 필요.
- [ ] **D5** — AI 회귀 e2e 통과 확인 (기존 chat / agent / form-fill spec 들이 새 경로로 통과).

### Phase E — 자체 Studio 제거

- [ ] `src/features/studio/` 폐기 — StudioViewer + 8 hook + 모든 dialog / utility (~5000 라인)
- [ ] 관련 e2e 정리 (find / edit / shape / table / format / footnote / image / wordsel / paraformat / clipboard / pagenav / undo / etc. — 다수)
- [ ] CLAUDE.md / ARCHITECTURE.md / KNOWN_ISSUES.md 갱신
- [ ] CHANGELOG + 메이저 version bump (0.4.x → 0.5.0)

## 리스크

- **upstream divergence**: rhwp-studio 가 active 개발 중 (현 0.7.12, 매주 푸시). 우리 fork branch (`ahwp-bridge`) 가 patch 만 가볍게 유지하지 않으면 sync 비용 폭증. Bridge 코드는 단일 파일 (`main.ts`) 변경에 집중.
- **WASM 빌드 분리**: Rust 소스 수정이 필요하면 Docker + wasm-pack 필요. Phase A 는 IR 미수정 — 추후 IR 도 손대야 한다면 `@rhwp/core` upstream 에 PR 우선.
- **file:// origin 제약**: chrome iframe in file:// 의 `wasm-unsafe-eval` / fetch / origin policy 확인 필요. Phase C 핵심 검증 항목.
- **AI tools 동기 호출 가정**: 현재 dispatcher 는 `docRef.current.X(...)` 동기. bridge 는 Promise. 그룹 undo / Diff snapshot 같은 batched 동작 재설계 필요.

## 다음 청크

Phase A2 — `vendor/rhwp/rhwp-studio/src/main.ts` 의 postMessage switch
확장. 우선순위 method 6 개 (`getSectionCount`, `getParagraphCount`,
`getTextRange`, `searchAllText`, `insertText`, `getCaretPosition`) 만
먼저 추가하고 끝-단 PoC (ahwp 의 임시 dev page 가 iframe 으로 rhwp-studio
띄우고 bridge 호출 → 응답 표시) 까지 통과 시키면 Phase A2 종료.
