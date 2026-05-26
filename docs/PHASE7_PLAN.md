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

- [ ] `RhwpBridge` 클래스 — request id tracking + Promise resolve + event listener registry
- [ ] iframe lifecycle (load / ready ping / destroy)
- [ ] 타입 정의 — `shared/rhwp-bridge.ts` 에 method 시그니처 typed wrapping

### Phase C — iframe 임베드 + 호스팅

- [ ] vite build 산출물을 ahwp electron resources 에 동봉 (electron-builder `extraResources`)
- [ ] dev 모드 — `vendor/rhwp/rhwp-studio/dist/index.html` 을 `file://` 로 로드
- [ ] prod 모드 — `process.resourcesPath/rhwp-studio/index.html` 로드
- [ ] CSP `frame-src` 재허용 (chunk 6 정책 역행)
- [ ] React `<RhwpEditor>` 컴포넌트 — bridge instance 보유 + iframe 마운트

### Phase D — AI tool 재배선

- [ ] `electron/ai/tools/` 내 55 tools 의 `doc.X(...)` 호출 전부 `bridge.invoke('X', params)` 로 치환 (renderer 측 IPC ↔ main ↔ iframe 경로)
- [ ] file open/save IPC 가 `editor.loadFile` / `editor.exportHwp` 경유하도록 재구성
- [ ] Diff Viewer / Plan mode / 그룹 undo — bridge event 위에 재구현
- [ ] AI 회귀 e2e 통과 확인

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
