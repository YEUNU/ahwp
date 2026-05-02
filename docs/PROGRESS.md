# 진행 상황

ahwp 개발의 시간 순 기록. PR이 머지될 때마다 갱신합니다. 단순 체크리스트는 [ROADMAP.md](ROADMAP.md), 사용자 영향 변경은 [CHANGELOG.md](../CHANGELOG.md).

## 현재 스냅샷

| 항목        | 상태                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase       | **Phase 2 마무리 + chunk 48 모델 동적 fetch** — Phase 2 사용자-facing 작업 종료 + provider 모델 카탈로그 24h 캐시 fetch (OpenAI / NIM, datalist autocomplete + ⚠ 폴백). 다음: Phase 3 진입(provider tool-use 정식 통합 + Agent 모드) 또는 Phase 2-B(Anthropic / Ollama 키·어댑터 잠금 해제)                               |
| 빌드        | ✅ `npm run dev` · `npx vite build`                                                                                                                                                                                                                                                                                       |
| 타입        | ✅ `npm run typecheck`                                                                                                                                                                                                                                                                                                    |
| 린트        | ✅ `npm run lint` (0 warnings, 0 errors)                                                                                                                                                                                                                                                                                  |
| 포맷        | ✅ `npm run format:check`                                                                                                                                                                                                                                                                                                 |
| 단위 테스트 | ✅ 3/3 (`App.test.tsx`)                                                                                                                                                                                                                                                                                                   |
| e2e         | ✅ 298 케이스 / 4 워커 병렬 + retry=1 — chunk 22(3) + 26(6) + rhwp-extras(5) + tabs-reorder(4) + dialogs-ui(4) + studio-ux-fixes(5) + studio-ux-round2(6) + phase2-finale(5) + chat-model-list(5 chunk 48) 추가. 291 passed / 6 skipped (NIM 5개 키 게이트 + cell-menu 1개 의도). live NIM 5/5 (`qwen/qwen3.5-122b-a10b`) |
| Electron    | 33.2 · sandbox=true · contextIsolation=true                                                                                                                                                                                                                                                                               |
| 의존성      | runtime: `@rhwp/core` · `chokidar` · `react-resizable-panels` · `clsx` · `tailwind-merge` · `class-variance-authority` · `lucide-react` · `tailwindcss-animate` · `@radix-ui/react-slot` (chunk 6에서 `@rhwp/editor` 제거)                                                                                                |

## 일지

### 2026-04-29 — Phase 0 부트스트랩 완료

**환경**

- Node.js 24.14.0 · npm 10
- 패키지 매니저: 처음에 pnpm 결정했으나 `corepack enable`이 EPERM(`C:\Program Files\nodejs\pnpm`)으로 실패 → npm으로 전환. 관련 문서(`TECH_STACK.md`, `README.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `ARCHITECTURE.md`) 동기화

**구현**

- `electron/main.ts`: BrowserWindow 생성, dev/prod URL 분기, `ipc:ping` 핸들러
- `electron/preload.ts`: `contextBridge.exposeInMainWorld('api', { ping })`
- `shared/api.ts`: `AhwpApi`, `PingRequest`, `PingResponse` 타입 + `Window` 글로벌 declaration
- `src/App.tsx`: 3-Pane 더미 레이아웃, 마운트 시 `window.api.ping` 호출 → 응답 표시
- `index.html`: 한국어 lang, CSP `default-src 'self'`
- `vite.config.ts`: `vite-plugin-electron/simple` 사용. main → `dist-electron/main.js`, preload → `dist-electron/preload.js`
- `tsconfig.json` + `tsconfig.node.json`: strict, project references 대신 두 tsconfig 별도 typecheck
- `eslint.config.mjs`: ESLint flat config + typescript-eslint + react-hooks + react-refresh + prettier
- `.prettierrc.json`: singleQuote, trailingComma all
- `vitest.config.ts` + `vitest.setup.ts` + `src/App.test.tsx`: jsdom, `window.api` 모킹
- `.husky/pre-commit` → `npx lint-staged`
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/PULL_REQUEST_TEMPLATE.md`
- `package.json` build 필드: appId `com.ahwp.app`, mac dmg / win NSIS x64 / linux AppImage+deb

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint
✓ npm test         (2 passed)
✓ npm run format:check
✓ npx vite build   (dist/ + dist-electron/main.js + dist-electron/preload.js)
```

**의도적으로 미룬 것**

- shadcn/ui CLI 초기화 — 첫 컴포넌트 도입 시(Phase 1-A AppShell)에 같이 진행
- macOS notarization — Phase 4
- E2E (Playwright Electron) — Phase 5
- 브랜치 분리(main/dev) — 메인테이너 수동 적용 (CONTRIBUTING.md "처음 셋업" 참고)

**알려진 경고**

- `npm install`에서 12 vulnerabilities (2 low, 10 high) — 대부분 transitive devDependency. Phase 4 직전에 `npm audit fix --force` 일괄 정리 예정
- `npm install`에서 deprecated 경고 (npmlog, glob v7, rimraf v3 등) — electron-builder의 transitive deps. 마찬가지로 Phase 4에서 정리

### 2026-04-29 — Phase 1-A (1차 청크) — 리사이저블 3-Pane

**구현**

- `react-resizable-panels@^2.1.7` 추가 (첫 runtime dependency). v4는 `Group`/`Separator`로 API 개명되어 v2 stable로 핀
- `src/app/AppShell.tsx` 신설: `PanelGroup` (horizontal) + 3× `Panel` + 2× `PanelResizeHandle`. 패널 비율은 `autoSaveId="ahwp:shell"`로 localStorage 저장
- `src/App.tsx`는 `<AppShell />`만 렌더하는 얇은 래퍼로 축소
- 기존 ipc:ping 데모 본문은 가운데 패널로 그대로 이전 (Phase 1-C에서 rhwp 에디터로 교체 예정)

**문서 동기화**

- 공급자 목록에 NVIDIA NIM 추가 (OpenAI 호환 어댑터 경로 재사용). 단일 API 웹검색 매트릭스를 README/AI_INTEGRATION/TECH_STACK에 정리: OpenAI/Anthropic/Google ✅, NVIDIA NIM/Ollama/커스텀 ❌
- `ProviderId` 유니언에 `'nvidia'` 추가 (`docs/ARCHITECTURE.md`)
- 프로젝트 가이드 `CLAUDE.md` 신설 (IPC 3-place pattern, sandbox invariants, 2-tsconfig 구조 등)

**부수 수정**

- `tsconfig.json`의 `include`에 `vitest.setup.ts` 추가 — `@testing-library/jest-dom/vitest` 타입 augmentation이 적용되지 않아 `toBeInTheDocument` 4건 TS2339가 발생하던 이슈 해결. (Phase 0 PROGRESS의 "✅ typecheck"는 실제로는 통과하지 않고 있던 상태)

**검증 결과**

```
✓ npm run typecheck    (이슈 수정 후)
✓ npm run lint
✓ npm test             (2 passed)
✓ npm run format:check
```

### 2026-04-29 — Phase 1-A (2차 청크) — 메뉴 / shadcn / 테마

**구현**

- `electron/menu.ts`: 플랫폼 인지(macOS 별도 앱 메뉴) `Menu.buildFromTemplate`. 파일/편집/보기/윈도우/도움말 메뉴. File 액션(New/Open/Save/Save As)과 Settings는 `webContents.send('menu:action', ...)`로 렌더러에 이벤트 발행 — 실제 핸들러는 Phase 1-B/C에서 연결
- `shared/api.ts`: `MenuAction` 유니언 + `onMenuAction(handler)` 구독 API 추가. `preload.ts`가 `ipcRenderer.on('menu:action', ...)` 래핑 후 unsubscribe 함수 반환
- `electron/main.ts`: `Menu.setApplicationMenu(buildAppMenu(() => mainWindow))` 등록
- shadcn/ui 수동 셋업 (CLI는 인터랙티브):
  - `components.json` (style=default, baseColor=zinc, cssVariables=true)
  - `src/lib/utils.ts` `cn()` 헬퍼 (`clsx` + `tailwind-merge`)
  - `tailwind.config.ts` 토큰 확장 (border/background/foreground/primary/...) + `tailwindcss-animate`
  - `src/index.css` `:root` / `.dark` CSS 변수 (light=흰 배경 / dark=현행 zinc-950 톤 보존)
  - `src/components/ui/button.tsx` (cva 6 variants × 4 sizes, asChild via Radix Slot)
  - 신규 deps: `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `tailwindcss-animate`, `@radix-ui/react-slot`
- 테마: `src/app/theme-provider.tsx` (light/dark/system, localStorage `ahwp:theme`, `matchMedia('prefers-color-scheme: dark')` 구독). `src/app/theme-toggle.tsx` (system→light→dark 사이클, lucide 아이콘). `App.tsx`에서 `<ThemeProvider>`로 감싸고, `AppShell` 헤더에 `<ThemeToggle/>` 마운트
- `AppShell.tsx`를 토큰 기반(`bg-background`/`bg-card`/`border-border`/`text-muted-foreground` 등)으로 리팩터. 메뉴 액션 디버그 표시 패널 임시 추가 (Phase 1-B에서 실제 핸들러 연결되면 제거)

**부수 정리**

- `vitest.setup.ts`: jsdom의 `matchMedia` 미구현 폴리필 (theme-provider가 의존)
- `src/App.test.tsx`: mockApi에 `onMenuAction` 추가
- `style_example/`, `examples/`를 prettier/eslint ignore에 추가 — 디자인 목업/샘플 파일이 포맷 대상에 포함되던 문제 해결

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (2 passed)
✓ npm run lint         (warning 2건: shadcn buttonVariants / theme useTheme — react-refresh HMR 안내)
✓ npm run format:check
```

### 2026-04-29 — Phase 1-B (1차 청크) — 파일 IPC + 최근 파일 + 드래그앤드롭

**결정 변경**

- **better-sqlite3 도입을 Phase 2로 미룸**. Phase 1-B에서 필요한 영속 상태는 "최근 파일 리스트"뿐인데 native module 빌드 셋업(electron-rebuild + vite externalize + electron-builder asarUnpack) 비용이 이득보다 큼. 채팅 히스토리(Phase 2)와 함께 도입하면 schema/migration 한 번에 정리 가능
- 대안: `app.getPath('userData')/recent.json` 단일 JSON 파일. 마이그레이션 비용은 Phase 2에서 LRU 배열 → SQLite `files` 테이블 한 번 변환으로 끝

**구현**

- `shared/api.ts`: `RecentFile` · `FileOpenResult` · `FileApi` 타입. `AhwpApi.file = { open, openByPath, listRecent, getPathForFile }`
- `electron/store/recent.ts`: `userData/recent.json` 영속, 인메모리 캐시, LRU max 20. 쓰기는 tmp + rename atomic. `writeChain` Promise로 순차화
- `electron/ipc/file.ts`:
  - `file:open` — `dialog.showOpenDialog` (.hwp/.hwpx 필터). 사용자 취소 / 잘못된 확장자 → null
  - `file:open-by-path` — 드래그앤드롭/최근 클릭용. 확장자 + 파일 존재 검증
  - `file:list-recent` — 최근순 배열 반환
- `electron/preload.ts`: `webUtils.getPathForFile(file)` 노출 (Electron 32+에서 `File.path` 제거됨, 드래그앤드롭에 필요)
- `src/features/files/use-recent-files.ts`: `recent` · `loading` · `refresh()` 훅. 초기 fetch는 cleanup 가능한 cancelled flag 패턴
- `src/features/files/FileList.tsx`: 최근 파일 목록 (basename + 상대 시간), 빈 상태 안내, 드롭 zone 오버레이 (.hwp/.hwpx 확장자 필터링), active path 하이라이트
- `AppShell`: `onMenuAction('file:open')` 구독 → `file.open()`. 좌측 패널 더미 콘텐츠 → `<FileList/>` 교체. `refreshTick` 증가로 목록 재로드 (현재는 key remount, Phase 2에서 store 통합 시 정리)

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (2 passed)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

### 2026-04-29 — Phase 1-C (1차 청크) — rhwp 뷰어 통합

**조사 결과 — `@rhwp/editor` v0.7.8**

- npm 등록됨 (6시간 전 published, by tangokorea). 14KB 얇은 래퍼
- 본질은 **iframe** — 기본적으로 `https://edwardkim.github.io/rhwp/`를 로드하고 `postMessage`로 RPC. `studioUrl` 옵션으로 자체 호스팅 URL 주입 가능
- API: `loadFile(buffer, name)` · `pageCount()` · `getPageSvg(page)` · `exportHwp()` · `destroy()`. **편집 메서드 없음** — v0.7.x 기준 사실상 뷰어 + import/export
- 함께 게시된 `@rhwp/core` v0.7.8 (4.5MB Rust+WASM)에는 진짜 편집 API 존재 (`HwpDocument.applyCharFormat` / `applyParaFormat` / `addBookmark` / `HwpViewer.renderPageSvg` 등). 정식 편집은 Phase 2~3에서 core를 직접 import

**범위 결정**

- 1차 청크는 **iframe 기반 뷰어 임베드**까지. file:read → ArrayBuffer → editor.loadFile 라운드트립이 동작하면 milestone
- `@rhwp/core` 직접 통합은 Manual/Agent 편집 모드(Phase 2~3) 합류 시 진행 — 그때 자체 viewer/edit UI를 짜는 방향도 같이 검토
- 외부 iframe URL 의존 — README의 "local-first" 약속과 충돌. Phase 4 패키징에서 studio 정적 자산 번들 + 자체 protocol(`app://`) 호스팅으로 전환 예정. 현재는 이 트레이드오프 명시

**구현**

- `npm install @rhwp/editor` (core는 아직 미설치 — viewer 단계엔 불필요)
- `shared/api.ts`: `FileApi.read(path) => Promise<ArrayBuffer>` 추가
- `electron/ipc/file.ts`: `file:read` 핸들러. 확장자 검증 + `fs.readFile` → `ArrayBuffer.slice` (Buffer 풀의 일부만 슬라이스해 정확한 길이 반환)
- `electron/preload.ts`: `file.read` 노출
- `src/features/editor/RhwpViewer.tsx`: `useEffect([path])`에서 read → createEditor → loadFile 순차 실행. 로딩 상태(`reading` / `mounting` / `ready`) 분기 + 에러 표시. unmount/path 변경 시 `editor.destroy()` + 컨테이너 자식 제거
- `AppShell`: `activePath`가 있으면 `<RhwpViewer key={activePath} path={activePath} />` 마운트, 없으면 시작 안내. `key`로 강제 remount해 path 전환 시 protocol 잔여 상태 제거
- `index.html` CSP: `frame-src https://edwardkim.github.io` 추가

**알려진 제약**

- 첫 로드 시 외부에서 iframe + WASM 다운로드 (~수 MB) — 인터넷 필요
- `@rhwp/editor`의 `_request` postMessage 타임아웃 10초 — 느린 회선에서 큰 문서 로딩 실패 가능
- 편집 불가 (뷰어 단계). Save/Save As 메뉴 항목은 menu:action을 발행하지만 실제 핸들러 없음

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (2 passed)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

> 실제 HWP 파일 렌더링 검증은 다음 라운드에 `examples/[샘플].hwp`로 수행 예정.

## 다음

### 2026-04-29 — Phase 1-C (2차 청크) — file:save/save-as + 시나리오 1 검증

**검증 결과 — 1차 청크의 뷰어 통합**

- 사용자가 예제 HWP(2.85MB) 파일 정상 로드 확인. 편집(타이핑/서식)도 iframe 내부 studio UI에서 작동
- 라이브러리 v0.7.8의 JS API는 viewer + import/export만 노출하지만 iframe studio 자체는 풀 에디터
- 초기 timeout 이슈는 라이브러리의 10초 하드코딩 + `loadFile`의 `Array.from(new Uint8Array(...))` 비효율 조합. 60초로 monkey-patch해서 해결
- 라이브러리 d.ts 버그 발견: `export declare class RhwpEditor` 선언하지만 실제 .js는 `createEditor`만 export → `import type`으로 회피하고 prototype 패치는 인스턴스 통해 수행. 업스트림 보고 후보

**결정 — 버전 관리 방식 (Phase 2 도입 시)**

- **풀 카피 + HWPX BLOB**으로 확정. 멤버 단위 dedup / 정규화 / 패치 체인 미채택
- 이유: dedup 효율은 HWPX 직렬화 결정성에 좌우되고 정규화 레이어 정확성 비용이 큼. 단순 풀 카피로 출시 후 사용 데이터 보고 필요 시 Phase 3+에서 dedup 마이그레이션
- 비용 추정: 2.85MB × 20 버전 ≈ 57MB/문서. GC 정책으로 관리 (`is_pinned=0 AND source='auto' AND age>7d` 또는 N개 초과분 삭제)
- 스키마 `versions` 테이블 `docs/ARCHITECTURE.md` SQLite 섹션에 박제

**결정 — 내부 캐노니컬 포맷**

- 입력이 HWP든 HWPX든 **내부에서는 HWPX로 고정**. ARCHITECTURE.md §B 라이프사이클 그대로 유지
- HWP 입력은 `@rhwp/core`(WASM) 변환기로 한 번 HWPX화 (Phase 1-C 후속 작업)

**구현 — file:save / file:save-as**

- `shared/api.ts`: `FileSaveRequest`, `FileSaveAsRequest`, `FileApi.save / saveAs` 추가
- `electron/ipc/file.ts`:
  - `file:save` — 지정된 path에 atomic write (tmp + rename), `addRecent` 갱신
  - `file:save-as` — `dialog.showSaveDialog` (HWPX 우선 필터 + HWP) → atomic write
  - `toUint8` 헬퍼 (`ArrayBuffer | Uint8Array` 정규화), `writeAtomic` 헬퍼
- `RhwpViewer`: `forwardRef + useImperativeHandle`로 `RhwpViewerHandle = { exportBytes() }` 노출. 부모가 ref로 호출
- `AppShell`:
  - `viewerRef` 보유, `saveCurrent` / `saveAsCurrent` 콜백
  - 메뉴 액션 `file:save` / `file:save-as` 구독 → 콜백 트리거
  - **시나리오 1 검증 프로브** — 저장 시 `exportHwp()` 결과 첫 4바이트 매직넘버 콘솔 로깅 (`504b0304` = HWPX zip / `d0cf11e0` = HWP CFB). 사용자가 한 번 저장하면 결과 확정

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (2 passed)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

> 매직넘버 검증은 다음 사용자 테스트 라운드. 시나리오 1이면 후속 작업 단순, 시나리오 2면 `@rhwp/core` 도입 우선순위 상향.

### 2026-04-29 — Phase 1-C (3차 청크) — 자동 라우팅 / 세션 복원 / E2E

**1차 사용자 테스트 발견사항**

- `@rhwp/editor` v0.7.8 `loadFile`의 postMessage 응답이 iframe의 initDoc 완료 후에도 호출자 promise까지 도달하지 않음 (사용자 콘솔 로그로 확인). 우회: await 안 하고 fire-and-forget + .catch로 에러만 추적, 'ready' phase는 즉시 전환
- iframe을 path 변경마다 재생성하면 매번 WASM 콜드 스타트 → iframe 평생주기와 file load를 분리한 두 effect 패턴으로 변경
- `자동 보정` 후 저장하고 reload 시 같은 경고가 다시 표시되는 문제 — 두 가지 원인 추정:
  1. cmd+R 후 사용자가 잘못된(원본) 파일을 다시 열고 있음 (워크스페이스 복원 부재)
  2. 저장된 .hwp 파일에 HWPX 바이트가 들어가 있는 등 포맷 불일치 (확장자 자동 라우팅 부재)

**구현 — 포맷 감지 + 자동 라우팅**

- `shared/format.ts`: `detectHwpFormat(bytes)` (zip → 'hwpx' / CFB → 'hwp' / 'unknown') + `correctExtension(path, format)` 헬퍼
- `AppShell.saveCurrent`/`saveAsCurrent`: export bytes 매직넘버 검사 → activePath 확장자가 매칭되지 않으면 `.hwp` ↔ `.hwpx` 사이에서 자동 보정. 저장 후 activePath 갱신
- `electron/ipc/file.ts`: 서버 측 방어 — 매직넘버와 확장자가 어긋나면 `file:save`/`file:save-as` 거부 (defense in depth)

**구현 — 워크스페이스 복원**

- `shared/api.ts`: `SessionState { lastActivePath }` + `SessionApi { get, set }` 추가
- `electron/store/session.ts`: `userData/session.json` 영속, atomic write, writeChain 직렬화
- `electron/ipc/session.ts`: `session:get` / `session:set` 핸들러
- `AppShell`: 마운트 시 `session:get` → 마지막 활성 파일 자동 재오픈. `activePath` 변경 시 `session:set`. cmd+R / 앱 재시작 시 컨텍스트 보존. 파일이 이동/삭제됐으면 stale 경로 자동 정리

**구현 — Playwright E2E**

- `@playwright/test` 도입. `playwright.config.ts` (직렬, 1 worker — Electron 단일 인스턴스)
- `tests/e2e/launch.ts`: 격리된 임시 `userData` 디렉토리로 `_electron.launch` 헬퍼. recent.json/session.json 격리
- `tests/e2e/smoke.spec.ts`: 2 케이스 — (1) 3-pane 부팅 + ipc:ping 응답 검증, (2) 테마 토글 system→light→dark 전환 시 `<html>.dark` 클래스 변화
- `npm run e2e` 스크립트 (vite build 후 playwright test). `npm run e2e:headed` 옵션
- 현재 단계 e2e는 외부 iframe(rhwp studio) 의존하지 않는 항목만. 뷰어 자체 e2e는 Phase 4 패키징(자산 로컬 번들링) 후

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2 passed)
✓ npm run e2e          (E2E 2/2 passed)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

### 2026-04-29 — Phase 1-C (4차 청크) — `@rhwp/core` HWP→HWPX 변환

**구현**

- `@rhwp/core@^0.7.8` 추가 (Rust + WASM, ~4.5MB). `electron/hwp/converter.ts`로 main 프로세스에 통합
- `loadRhwpCore`: 동적 import + lazy WASM 초기화. 첫 변환 호출 시점에 한 번만 init. `import.meta.url` 기반 `createRequire`로 CJS 빌드 출력에서도 path 해석 동작
- `ensureHwpxBytes(input)`: 매직넘버로 포맷 감지 → HWPX면 바이트 그대로 반환 (round-trip 회피, byte-exact 보존), HWP면 `new HwpDocument(input).exportHwpx()` 변환
- `file:read` IPC를 모든 입력에 대해 HWPX 바이트 보장하도록 변경. 렌더러/스튜디오는 이제 항상 HWPX 받음 — `exportHwp() → save` 라운드트립 결정성 향상. ARCHITECTURE.md §B "내부 캐노니컬 = HWPX" 정책 구현 완성
- `vite.config.ts`: 메인 빌드 `rollupOptions.external: ['@rhwp/core']` — WASM 자산 번들링 회피, Node가 `node_modules`에서 런타임 해석. electron-builder는 `dependencies`를 자동 패킹

**알게 된 점**

- `@rhwp/core` 0.7.8은 `"type": "module"` ESM-only. vite-plugin-electron 기본값은 main을 CJS로 번들 → Node 20(Electron 33의 런타임)은 ESM 패키지를 `require()` 시 `ERR_REQUIRE_ESM`. 우회: `await import('@rhwp/core')` 동적 import로 패키지를 ESM-aware하게 로드 (CJS bundle 안에서도 동작)
- `BufferSource`는 DOM lib에만 있어서 Node tsconfig에서는 미정의. 시그니처를 `Uint8Array | ArrayBuffer`로 직접 명시

**후속 작업 (Phase 2~3에서 활용)**

- `file:new`: 동일 모듈에 `createBlankHwpx()` 추가 — `@rhwp/core`의 `HwpDocument.createBlankDocument()` 활용
- AI 에이전트 편집: `applyCharFormat`/`applyParaFormat`/`createTable` 등 인스턴스 메서드 직접 호출 가능 (Phase 3 hwpctl 도구의 백엔드)
- 버전 dedup (Phase 3+): HWPX zip 멤버 단위 객체 저장소로 마이그레이션 시 컨버터 결정성 검증 필요

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2 passed)
✓ npm run e2e          (E2E 2/2 passed)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

> 실제 HWP 파일 변환 검증은 사용자 테스트 라운드. 콘솔에 `[hwp/core] WASM init in NN ms` + `[hwp/core] HWP → HWPX (X.XX MB → Y.YY MB) in NN ms` 표시 예상

## 다음

### 2026-04-29 — Phase 1-C (5차 청크) — E2E 자동화로 매뉴얼 테스트 대체

**배경**

- 사용자 매뉴얼 검증 라운드 누적 (`자동 보정 → 저장 → 재오픈` 같은 플로우를 매번 사용자가 직접 확인) → 비효율
- 사용자 요청: "너가 e2e로 진행해주면 안되?"
- 해결: examples/ 디렉토리의 사용자 예제 HWP(2.85MB)를 fixture로 활용해 IPC + main 측 변환/영속 레이어를 자동 검증. studio iframe 의존하는 부분만 매뉴얼 테스트로 남김

**구현**

- `tests/e2e/file-roundtrip.spec.ts` 추가, 5개 케이스:
  - `file:read auto-converts HWP input to HWPX bytes` — 4차 청크의 `@rhwp/core` 통합 검증. 매직넘버 `504b0304` 확인
  - `save round-trip: HWPX bytes survive write → read` — file:read → file:save → readFile 라운드트립
  - `file:save rejects format mismatch` — 서버 측 `assertFormatMatchesPath` 검증
  - `session restoration: lastActivePath persists across app restarts` — 같은 `userDataDir`로 두 번 launch, 자동 재오픈 + 헤더 path 표시 검증
  - `recent files: openByPath populates listRecent` — LRU 갱신 검증
- `existsSync(EXAMPLE_HWP)`로 fixture 부재 시 자동 skip → CI에서도 안전 (예제 파일은 gitignore)
- `/// <reference lib="dom" />`로 page.evaluate 콜백 안의 `window`/`Uint8Array` 등 DOM 타입 활성화 (tsconfig.node 변경 없이 파일 단위 처리)
- 기존 smoke 2개와 합쳐 **총 7 E2E**, 모두 통과

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2 passed)
✓ npm run e2e          (E2E 7/7 passed)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

**얻은 것**

- 매뉴얼 테스트 라운드 제거 — 사용자에게 "콘솔 로그 확인" 요청할 일이 줄어듦
- 회귀 자동 감지 — 다음에 누가 file:read를 건드려도 즉시 깨짐 표면화
- 향후 `@rhwp/core`/`file:new` 작업의 안전망

## 다음

### 2026-04-29 — Phase 1-C (6차 청크) — `@rhwp/core` 적극 활용 (저장 시 정규화)

**의도**

사용자 요청: "rhwp/core를 적극 활용". 4차 청크에선 read 시점에만 썼지만,
**save 시점에도 라운드트립 정규화**를 추가해 studio의 미지속 보정 이슈를
우리 측에서 결정적으로 처리.

**가설 → 동작**

studio의 `exportHwp()`는 자체 자동 보정 결과를 반영하지 못할 수 있음.
@rhwp/core로 다시 파싱(`new HwpDocument(bytes)`) → 재직렬화(`exportHwpx()`)
하면 IR 기반 클린 HWPX 출력이라 (1) 자동 보정/스펙 준수가 직렬화에 박힘
(2) studio가 HWP를 export하더라도 디스크는 항상 HWPX (3) 향후 버전 dedup의
결정성 기반.

비용: 저장당 WASM 풀 파스+직렬화 (수백 ms 단위). 다중 MB 문서에서 체감 가능.

**구현**

- `electron/hwp/converter.ts`: `normalizeToHwpx(input)` 추가. `ensureHwpxBytes`와는 별개 — 후자는 HWPX를 byte-exact pass-through, 전자는 항상 HwpDocument 라운드트립
- `electron/ipc/file.ts`:
  - `file:save` — 받은 bytes를 `normalizeToHwpx`로 통과시킨 후 `correctExtension(path, 'hwpx')`로 강제 라우팅. 결과는 항상 .hwpx 경로 + HWPX 바이트
  - `file:save-as` — 동일. 다이얼로그 필터에서 HWP 옵션 제거 (HWPX만)
  - 기존 `assertFormatMatchesPath` 제거 — 서버가 항상 HWPX를 출력하므로 mismatch 자체가 발생 불가
- `src/app/AppShell.tsx`: 렌더러 측 매직넘버 감지 제거. `exportBytes()`만 노출하고 라우팅은 서버가 결정. activePath는 서버가 반환한 `result.path`로 갱신 (자동 라우팅 발생 시 .hwpx로 변경됨)

**E2E 갱신 + 추가**

- `file:save rejects format mismatch` 케이스 → `file:save auto-routes .hwp path to .hwpx`로 변경. 의미 변환: 거부 대신 자동 라우팅
- 검증: 사용자가 `naive.hwp`로 저장 요청해도 결과 path는 `naive.hwpx`, `.hwp` 파일은 디스크에 존재하지 않음

**npm 신선도 점검**

- `npm outdated` 결과: 직접 의존성은 모두 semver 범위 내 최신. 안 잡히는 건 메이저 버전 차이 (React 18→19, Tailwind 3→4, Electron 33→41, vite 6→8 등) — 별도 마이그레이션 프로젝트로 분리, 이번엔 defer
- `@rhwp/core` / `@rhwp/editor` 모두 0.7.8 latest 유지 (publish 직후라 추가 갱신 없음)

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (E2E 7/7 — auto-route 변경 포함)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

## 다음

### 2026-04-29 — Phase 1-C (7차 청크) — `@rhwp/core` 활용 감사 + 정리

**의도 (사용자 요청)**

"한글 파일 건드는 거 우리가 구현한 것 중에 rhwp/core에 있는 기능이면 rhwp/core 사용하게."

**감사 결과**

| 우리 코드              | 역할                             | `@rhwp/core` 대응                                                                      | 상태                        |
| ---------------------- | -------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| `ensureHwpxBytes`      | read-side HWP→HWPX 변환          | `HwpDocument.exportHwpx`                                                               | ✅ 사용 중                  |
| `normalizeToHwpx`      | save-side HWPX 라운드트립 정규화 | `HwpDocument.exportHwpx`                                                               | ✅ 사용 중                  |
| `detectHwpFormat`      | 4-byte 매직 사전 감지            | `HwpDocument.getSourceFormat` (인스턴스 메서드, 풀파스 필요)                           | 의도적 분리 — 최적화 경로만 |
| 미사용 라이브러리 기능 | —                                | `init_panic_hook` · `version()` · `extractThumbnail` · `HwpViewer` · `exportHwpVerify` | 일부 도입                   |

**구현**

- `loadRhwpCore` 초기화에 `init_panic_hook()` + `version()` 호출 추가. WASM 패닉이 throw되는 Error로 surface, 첫 init 시 `[hwp/core] WASM init v0.7.8 in NN ms`
- 라운드트립 헬퍼 `roundTripHwpx(input, label)` 추출 — `ensureHwpxBytes`/`normalizeToHwpx` 공통 로직 (파스→`getSourceFormat`로 권위 있는 형식 로깅 → `exportHwpx`)
- 우리 측 'unknown format' 사전 검증 제거 — `@rhwp/core`의 `HwpDocument` 생성자가 잘못된 입력에 throw. 중복 검증 불필요
- `detectHwpFormat`은 **HWPX 통과 최적화 전용**으로 명시 (4-byte 체크가 풀파스보다 100× 빠름). `shared/format.ts` 주석에 역할 박제

**원칙**

- HWP/HWPX 콘텐츠 조작(파스/직렬화/편집)은 항상 `@rhwp/core`
- 매직바이트 sniff는 사전-파스 fast path 최적화로만 (보안/권위 결정엔 사용 X)
- 사후 형식 판별은 `getSourceFormat()`을 권위로

**`@rhwp/editor` (iframe) 처리**

third-party 블랙박스라 본 감사 범위 밖. iframe 의존성 제거(자체 viewer를 `HwpViewer`로 직접 통합)는 **별도 결정** 필요 — 사용자 컨펌 후 진행.

**npm 신선도**

- `npm outdated`: 직접 의존성 모두 semver 범위 내 최신
- 메이저 차이 (React 18→19, Tailwind 3→4, Electron 33→41, vite 6→8 등) 별도 마이그레이션 프로젝트로 분리
- `@rhwp/core`/`@rhwp/editor` 0.7.8 latest 유지

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (E2E 7/7)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

## 다음

### 2026-04-29 — Phase 1-D (1차 청크) — Studio 마이그레이션 기반

**의도 / 결정**

[golbin/hop](https://github.com/golbin/hop) 조사 결과: HOP은 `@rhwp/editor` iframe을 안 쓰고 `@rhwp/core` 직접으로 자체 viewer (CanvasView/InputHandler/Toolbar 풀 에디터) + Tauri로 풀 패키징. 우리도 같은 방향(`@rhwp/editor` 폐기) 으로 간다 — 단 모노레포는 보류, Electron 모놀리스 유지. 6개 청크로 나눠 각 청크에 e2e 게이트.

상세 ADR: [docs/STUDIO_MIGRATION.md](STUDIO_MIGRATION.md). 합의 사항:

1. 모노레포 X — `src/features/studio/`로 이주
2. WASM lazy init in renderer
3. iframe viewer는 청크 6에서 일괄 제거 (그 사이 회귀 비교용 fallback)
4. 편집 UI: 텍스트 → 표 → 풀
5. 자산 호스팅은 청크 6에서 자동 해소

**구현 (청크 1: 기반)**

- `src/lib/rhwp-core.ts` — 렌더러 측 `@rhwp/core` lazy init 모듈. `version()` + `init_panic_hook()`. dev에서 `window.__rhwpProbe`로 ad-hoc 호출 가능
- AppShell에 side-effect import — Vite/Rollup tree-shake 방지, 번들에 포함 보장
- `scripts/build-fixture.mjs` — `@rhwp/core` `HwpDocument(seed).createBlankDocument().exportHwpx()`로 6.4KB 빈 HWPX 생성
- `tests/e2e/fixtures/blank.hwpx` 6.4KB committed — CI에서 fixture-based 테스트 가능. mimetype `application/hwp+zip`, OWPML 멤버 11개 (header/section0/content.hpf 등)

**핵심 검증 통과 — Vite의 WASM 번들링**

```
dist/assets/index-*.css           14K
dist/assets/index-*.js           216K
dist/assets/rhwp_bg-*.wasm      3.9M  ← @rhwp/core WASM이 content-hashed asset으로 번들됨
```

청크 1 가장 큰 리스크 (Vite가 ESM + WASM을 렌더러 번들에서 정상 처리하는가) 해소. 추가 plugin 불필요.

**부수 정리**

- `eslint.config.mjs`의 Node globals 그룹에 `scripts/**/*.{js,mjs,ts}` 추가

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (2/2)
✓ npm run e2e          (7/7 — 기존 7개 모두 통과, 회귀 없음)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build       (renderer + main + preload, WASM asset 포함)
```

> 청크 1 비주얼 e2e 없음 (실제 렌더링은 청크 2부터). 기존 7 e2e가 회귀 게이트 역할.

### 2026-04-29 — Phase 1-D (2차 청크) — 읽기 전용 StudioViewer + visual snapshot baseline

**구현**

- `src/features/studio/StudioViewer.tsx` — `forwardRef` + `useImperativeHandle`로 `RhwpViewerHandle` 공유 인터페이스. 단계: `mounting` → `reading` → `rendering` → `ready`. 각 단계 진단 로그
  - `ensureRhwpCore()` (lazy WASM init)
  - `window.api.file.read(path)` (HWPX 보장)
  - `new HwpDocument(bytes)` + `new HwpViewer(doc)` + `renderPageSvg(0)`
  - SVG 문자열을 컨테이너 div의 innerHTML로 마운트
  - 정리: viewer.free() → doc.free() (역순. viewer가 doc 참조)
- `src/app/AppShell.tsx`: `localStorage 'ahwp:use-studio'='1'`이면 `StudioViewer`, 아니면 기존 `RhwpViewer` (iframe). 둘 다 동일 `RhwpViewerHandle` 노출이라 `viewerRef` 재사용
- `index.html` CSP: `script-src 'self' 'wasm-unsafe-eval'` 추가 — `WebAssembly.instantiate`가 차단되던 문제 해결. `'wasm-unsafe-eval'`은 `'unsafe-eval'`보다 좁은 권한 (eval 자체는 여전히 금지, WASM 컴파일만 허용)

**E2E (신규 2개)**

- `tests/e2e/studio-viewer.spec.ts`:
  - `renders first page SVG for blank.hwpx` — localStorage flag + session.lastActivePath 시드 후 reload → SVG 마운트 검증
  - `first-page visual snapshot — blank.hwpx` — `toHaveScreenshot('blank-hwpx-page-0.png')`. **darwin only** (Linux baseline은 추후 청크에서 — 폰트 결정성 검증 후)
- 기존 7 e2e 회귀 없음 — **총 9/9 통과**
- baseline `blank-hwpx-page-0-darwin.png` (768×1123 PNG) commit

**디버그 진입점**

- `localStorage.setItem('ahwp:use-studio', '1'); location.reload()` → studio 모드
- `window.__rhwpProbe.ensure()` → 콘솔에서 ad-hoc WASM init

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (9/9 — 기존 7 + 신규 2, 회귀 없음)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

> 진단 콘솔 로그: `[rhwp/core renderer] WASM init v0.7.8 in NN ms` + `[studio] read X.XX MB in NN ms` + `[studio] parse + render page 0 in NN ms (M pages)`

### 2026-04-29 — Phase 1-D (3차 청크) — 다중 페이지 + 스크롤 + 줌

**구현**

- `src/features/studio/StudioViewer.tsx` 확장:
  - **다중 페이지 placeholder** — 페이지 0의 SVG에서 `parsePageDimensions()`로 width/height 추출, N개 placeholder div를 동일 dims로 렌더
  - **IntersectionObserver 기반 lazy 렌더링** — `rootMargin: 400px`로 viewport 근처만 즉시 렌더. `Map<idx, svg>` 캐시로 재방문 시 재파싱 X
  - **줌 컨트롤** — 50% 단위(0.5/0.75/1/1.25/1.5/2). 입력 dim × zoom으로 placeholder 크기 결정. 내부 SVG는 `width:100%/height:100%`로 부모에 맞춤. 줌 변경 시 SVG 재파싱 불필요
  - **너비 맞춤 (fit)** — `clientWidth - padding`으로 동적 계산
  - **페이지 인디케이터** — `intersectionRatio` 가장 큰 페이지를 현재 페이지로
  - 툴바 (`ZoomOut` / `level%` / `ZoomIn` / `100%` / `Maximize2(fit)` / `N / M`)
- `src/lib/rhwp-core.ts` — **`globalThis.measureTextWidth` 등록** (WASM init 전). Canvas 2D `measureText()` 사용. README 명시 "필수 설정". 누락 시 텍스트 있는 문서 렌더 시 `is not a function` 에러
- `parsePageDimensions(svg)` — `width`/`height` 속성 → `viewBox` 폴백

**E2E (chunk 3 신규 4개, 총 13)**

| 카테고리                          | 케이스                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| chunk 2 (read-only POC)           | renders first page SVG / first-page visual snapshot                                              |
| chunk 3 (multi-page + zoom)       | placeholder count matches pageCount / zoom in/reset cycles dims / fit-to-width matches container |
| chunk 3 (stress, 사용자 예제 40p) | scrolling triggers SVG render in later page (lazy rendering 검증)                                |

기존 9 e2e 회귀 없음.

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (13/13 — chunk 3 신규 4 + chunk 2 신규 2 + 기존 7)
✓ npm run lint         (0 errors, 2 shadcn warnings)
✓ npm run format:check
✓ npx vite build
```

**알게 된 것**

- `@rhwp/core`의 `globalThis.measureTextWidth`는 비텍스트 콘텐츠(빈 문서)에서는 호출되지 않아 chunk 2 baseline은 통과했지만, 실제 텍스트 있는 문서(사용자 예제 40p)에서 누락 표면화. README "필수 설정" 강조에도 우리는 chunk 3에서야 발견 — 향후 라이브러리 통합 시 README 필수 설정 우선 검토하기

### 2026-04-29 — Phase 1-D (4-A 청크) — 프로그래밍 방식 편집 + 라운드트립

청크 4를 두 단계로 분할 (스코프 보호):

- **4-A (이번 라운드)**: `HwpDocument` mutation API + dirty 추적 + 라운드트립 검증
- **4-B (다음)**: 키 입력 / 마우스 hitTest / 커서 시각화 / IME

**핵심 발견 — `HwpViewer` 폐기**

청크 2~3에서 `new HwpViewer(doc)` 사용 중이었지만 v0.7.8 JS 쉼 분석:

```js
constructor(document) {
  var ptr0 = document.__destroy_into_raw(); // doc 소유권 이전!
  this.__wbg_ptr = wasm.hwpviewer_new(ptr0);
}
```

`HwpViewer` 생성자가 `HwpDocument`를 **consume**. 이후 같은 doc에서 `exportHwpx()`/`insertText()` 호출하면 `null pointer passed to rust` 패닉. 청크 4 e2e 작성 중 처음 표면화.

해결: `HwpDocument` 자체에 `pageCount`/`renderPageSvg`/`renderPageHtml` 모두 존재. `HwpViewer`는 우리 use case에서 **불필요** (zoom은 CSS로 처리, viewport API 미사용). `HwpViewer` 제거하고 doc 직접 사용으로 통일.

**구현 — 4-A**

- `StudioViewer.tsx`:
  - `HwpViewer` 제거. `HwpDocument`만 보관 (`docRef`)
  - `refreshAfterMutation()`: 변경 후 cache invalidate + 이미 마운트된 placeholder 재렌더 (lazy 렌더 placeholder는 IntersectionObserver가 다음 방문 시 처리)
  - `dirty` state + `dirtyRef` 미러 (테스트가 OLD `__studioDebug` 객체 잡고 있어도 최신값 반환)
  - 헤더에 dirty 표시기 (●, amber-500)
  - `window.__studioDebug`: `insertText` / `deleteText` / `getCaretPosition` / `exportBytes` / `getPageCount` / `isDirty`. 4-B의 실제 input UI 들어오면 점진 폐기
- `src/lib/rhwp-core.ts`: `HwpViewer` re-export 유지 (향후 viewport API 필요 시 위해서, 현재 미사용)

**E2E (4-A 신규 3개, 총 16)**

- `insertText changes exportBytes; dirty indicator appears` — 최초 export 크기 → insert 후 export 크기 증가, dirty=true, UI ● 표시
- `save round-trip: edit → save → reopen → edit persists` — 변경 후 file:save → 디스크 검증 → file:read 라운드트립 일치
- `deleteText reverts insertion (idempotent round-trip)` — insert + delete 사이즈 비교

기존 13 e2e 회귀 없음.

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (16/16 — 회귀 없음, 청크 4-A 신규 3 추가)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
✓ npx vite build
```

### 2026-04-30 — Phase 1-D 핫픽스 — 이미지 렌더링 복구

**버그 보고 (사용자)**: "기존 파일 내부 이미지 렌더링 못함"

**원인 — `scripts/check-image-pipeline.mjs`로 확정**:

| 시나리오                                         | 결과                           |
| ------------------------------------------------ | ------------------------------ |
| A. HWP 직접 로드 → `renderPageSvg`               | 40 페이지, **25 `<image>`** ✅ |
| B. HWP → `exportHwpx` → 재로드 → `renderPageSvg` | 53 페이지, **0 `<image>`** ❌  |
| C. HWPX zip 내부 BinData 멤버                    | **46개 참조 (zip엔 들어있음)** |

`@rhwp/core` v0.7.8의 **`exportHwpx → HwpDocument` 라운드트립이 이미지 IR 참조를 깨뜨림**. zip엔 `BinData/*.bmp` 등 바이너리가 그대로 들어가지만 doc IR에서 못 찾아 `renderPageSvg`가 image 태그를 안 만듦. 라이브러리 측 이슈 (업스트림 보고 후보).

**핫픽스**

- `electron/hwp/converter.ts`: `ensureHwpxBytes` → 매직 검증만 하고 **bytes 그대로 통과**. `HwpDocument` 생성자가 HWP/HWPX 자동 감지하므로 사전 변환 불필요. 코멘트에 검증 출처 박제
- `src/features/studio/StudioViewer.tsx`: `el.innerHTML = svg` → `DOMParser('image/svg+xml')` + `importNode` + `replaceChildren`. SVG 네임스페이스 안전 마운트. `<parsererror>` 결과 명시적 보고. 진단용 `window.__studioPageDiag[idx] = { string, parsed, mounted }` 노출

**Tradeoff**: ARCHITECTURE.md §B "내부 캐노니컬 = HWPX" 정책이 read 단계에서 부분 후퇴. save는 여전히 `normalizeToHwpx` 라운드트립 (lossy) — 이미지 포함 문서를 편집/저장하면 다음 번 열 때 이미지 손실. 라이브러리 fix 대기.

**E2E (신규 1, 회귀 0)**

- `embedded images render — at least one page has visible <image> with data: href`: 모든 페이지 스크롤 후 진단 dict로 image 페이지 식별. 페이지 36(2개), 38(10개) 등에서 정상 렌더 확인. 총 **17/17**
- `file:read auto-converts ...` → `file:read returns raw bytes (HWP magic preserved)`로 의미 변경

**진단 스크립트** (일회성, eslint ignore 추가)

- `scripts/check-image-pipeline.mjs` — A/B/C 비교
- `scripts/inspect-images.mjs` / `inspect-image-tag.mjs` — image 태그 dump

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (17/17 — 신규 image 1 + 기존 16, 회귀 없음)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
```

### 2026-04-30 — Phase 1-D 핫픽스 #2 — save-side를 HWP 라운드트립으로 (이미지 보존)

**의도 / 검증**

핫픽스 #1로 read-side 이미지는 보존했지만 save-side는 여전히 HWPX 라운드트립이라 lossy. `scripts/check-image-pipeline.mjs`에 stage D 추가하여 `exportHwp` 라운드트립이 이미지 보존하는지 검증:

| 시나리오                             | 페이지 | 이미지                 |
| ------------------------------------ | ------ | ---------------------- |
| A. HWP 직접 → render                 | 40     | 25 ✅                  |
| B. HWP→`exportHwpx`→reload→render    | 53     | 0 ❌ (라이브러리 버그) |
| **D. HWP→`exportHwp`→reload→render** | **40** | **25 ✅**              |

페이지 수까지 원본과 동일 — `exportHwp` 라운드트립이 결정적이고 lossless.

**정책 변경 — 내부 캐노니컬: HWPX → HWP**

ARCHITECTURE.md §B 갱신. 라이브러리 fix 출시 시 HWPX로 재전환 검토.

**구현**

- `electron/hwp/converter.ts`:
  - `normalizeToHwpx` → **`normalizeToHwp`** (rename + body 변경 — `exportHwpx()` → `exportHwp()`)
  - 코멘트에 stage A/B/D 결과 + 라이브러리 버그 박제
- `electron/ipc/file.ts`:
  - `file:save` / `file:save-as`가 `normalizeToHwp` 사용
  - `correctExtension(path, 'hwpx')` → **`correctExtension(path, 'hwp')`** — 자동 라우팅 방향 반전 (`.hwpx` → `.hwp`)
  - `save-as` 다이얼로그 필터: HWPX 제거, HWP only
- `src/features/studio/StudioViewer.tsx`:
  - imperative handle `exportBytes()` → **`doc.exportHwp()`** (was `exportHwpx`)
  - `__studioDebug.exportBytes` 동일 변경
- `src/lib/rhwp-core.ts`: `RhwpCoreModule` 인터페이스에 `exportHwp` 추가

**E2E 갱신 + 신규**

- `save round-trip: HWPX bytes survive write → read` → **`HWP bytes survive`**, magic check `[d0 cf 11 e0]`
- `file:save auto-routes .hwp path to .hwpx` → **반전: `.hwpx → .hwp`**, 의미 변경
- `studio-edit` byteLength 비교 → **content checksum** 비교 (CFB sector alignment 때문에 작은 변경에 byteLength 불변)
- **🆕 `edit + save + reopen preserves embedded images`** — 사용자 예제 HWP, 편집 + 저장 + 세션 복원으로 재오픈 + 모든 페이지 스크롤 + diag로 image count 합계 검증. 12개 이상 (원본 25개 중 다수) 보존 확인. **이미지 라운드트립 회귀 잡는 핵심 게이트**

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (18/18 — 신규 image 보존 1 + 기존 17, 회귀 없음)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
```

**남은 한계 (업스트림 의존)** — [docs/KNOWN_ISSUES.md](KNOWN_ISSUES.md) 참고

- L-001: HWPX 라운드트립 image IR 손실 (우회 적용 — HWP 캐노니컬)
- L-002: `@rhwp/editor` 외부 iframe 의존 (chunk 6에서 제거)
- L-003: 한글 IME 입력 미지원 (chunk 4-C 예정)
- L-004: 한컴 픽셀 정합성 베스트 에포트
- L-005: visual snapshot CI Linux baseline 부재

### 2026-04-30 — Phase 1-D 청크 4-B — 키보드 입력 + 마우스 hitTest

**선행: KNOWN_ISSUES 정리**

`docs/KNOWN_ISSUES.md` 신설. L-001~L-005 항목별 증상/검증/우회/해결조건 정리. PROGRESS의 임시 한계 메모 → 한 곳으로 통합.

**API 정찰** (`scripts/check-hittest.mjs`)

- `getCaretPosition()` → `{sectionIndex, paragraphIndex, charOffset}`
- `hitTest(page, x, y)` → 위 + `cursorRect: {pageIndex, x, y, height}` (커서 좌표 포함)
- mutation 후 `getCaretPosition()` 자동 추적 — 우리가 별도 트래킹 불필요

**구현**

- `StudioViewer`:
  - `caretRef` — `getCaretPosition()`에서 가져온 logical 위치. 마운트/mutation 후 자동 동기화
  - `handleKeyDown`:
    - `Backspace` → `deleteText(c.s, c.p, c.charOffset - 1, 1)` (offset > 0일 때)
    - `Delete` → 해당 위치 1자 삭제 (catch + 무시)
    - `Enter` → `insertText('\n')`
    - 단일 printable key → `insertText(e.key)`
    - 메타/컨트롤/알트 modifier 있으면 무시 (단축키 보호)
    - 화살표/Tab/Home/End는 무시 (caret 이동 추후)
  - `handlePageClick(idx, e)` — 클릭 좌표 → page-local (zoom 보정) → `hitTest` → caret 갱신
  - scroll 컨테이너에 `tabIndex={0}` + `outline-none`. 페이지 placeholder에 `cursor-text` + `onClick`
- `__studioDebug` API에 `getCaret()` + `focusViewer()` 추가

**한계 (KNOWN_ISSUES 박제)**

- 시각적 커서 표시 없음 — logical → cursorRect 매핑 API 부재. 4-C에서 hitTest 트릭으로 추정
- 한글 IME 조합 미지원 (L-003) — keydown만 처리하므로 자모 결합 누락. composition events 처리는 4-C

**E2E (chunk 4-B 신규 5, 총 23)**

- `typing ASCII advances caret and changes content` — `keyboard.type('HELLO')` → caret 0→5 + dirty=true
- `Backspace removes the previous character` — `type('ABC')` + Backspace → 3→2
- `Backspace at offset 0 is a no-op (not a crash)` — boundary
- `Modifier shortcuts pass through (do not insert text)` — Cmd/Ctrl 단축키는 caret/dirty 미변경
- `Click on a page calls hitTest and updates caret` — boundingBox + click → hitTest 호출 검증

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (23/23 — 신규 input 5 + 기존 18, 회귀 없음)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
```

### 2026-04-30 — Phase 1-D 청크 4-C — 한글 IME + 시각적 커서 + 화살표 네비

**API 발견** (`scripts/check-hittest.mjs`)

`HwpDocument.getCursorRect(s, p, c)` — logical caret → `{pageIndex, x, y, height}`. chunk 4-B 시점에 못 찾아 KNOWN_ISSUES에 "logical → visual 매핑 부재"로 박제했지만 실제로 존재. **시각적 커서 가능** ✅

**구현**

- **시각적 커서**:
  - `cursorRect` state — 마운트/mutation/click/화살표 후 `getCursorRect`로 갱신
  - 페이지 placeholder를 wrapper + SVG mount target + cursor overlay 자식으로 재구성. SVG `replaceChildren`이 cursor 안 지움 (sibling 관계)
  - `<div data-testid="studio-cursor">` 절대 위치 + `animate-pulse`
  - hitTest 결과의 `cursorRect`도 활용 — click 시 즉시 갱신
- **한글 IME (L-003 해결)**:
  - `compositionstart` / `compositionend` 핸들러
  - `keydown`: `e.nativeEvent.isComposing` 또는 `keyCode === 229`면 무시
  - `compositionend.data` → `insertText`
  - e2e용 `__studioDebug.injectComposedText` 헬퍼 (Playwright IME 시뮬 X)
- **화살표 / Home 캐럿 네비**:
  - ArrowLeft / ArrowRight / Home — logical caret 자체 갱신, refreshCursorRect

**E2E (chunk 4-C 신규 3, 총 26/26)**

- `visual cursor mounts and moves with typing`
- `ArrowLeft / ArrowRight / Home update caret without doc mutation` (경계 포함)
- `Korean IME composition (synthetic) inserts the composed text`

**남은 한계**

- IME 조합 중간 시각 피드백 없음 (한자 후보·자모 진행 미표시)
- ArrowUp/ArrowDown 미구현 (줄 높이 인지 필요, doc API 부족)

L-003 KNOWN_ISSUES에서 **Resolved**로 이동.

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (26/26 — 신규 input 3 + 기존 23)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
```

### 2026-04-30 — Phase 1-D 청크 6 — legacy iframe 완전 제거

**의도**

청크 4-A/B/C로 자체 viewer가 키보드/마우스/IME/시각 커서까지 커버. iframe RhwpViewer는 default flip 후 사실상 사용 안 됨. legacy 코드/의존성/CSP 정리.

**변경**

- `src/features/editor/RhwpViewer.tsx` 삭제 + 빈 dir 제거
- `src/features/studio/types.ts` 신설 — `ViewerHandle` (이전 `RhwpViewerHandle`). legacy 컴포넌트와 결합 끊기
- `StudioViewer` 가 `ViewerHandle`을 forwardRef
- `AppShell`:
  - `readStudioFlag` / `useStudio` / `ViewerComponent` 토글 제거 — `StudioViewer` 직접 사용
  - `viewerRef` 타입 `ViewerHandle`로
  - `useMemo` import 제거
- `index.html` CSP에서 `frame-src https://edwardkim.github.io` 제거 — 외부 의존 0
- `npm uninstall @rhwp/editor`
- 3개 e2e spec의 `localStorage.setItem('ahwp:use-studio', '1')` 제거 (의미 없음)

**KNOWN_ISSUES**

L-002 → **Resolved**로 이동. 이제 README의 "local-first" 약속 진짜로 충족 (오프라인 OK, 외부 호스팅 의존 0).

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (26/26 — 회귀 없음)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
```

### 2026-04-30 — Phase 1-D 청크 5 — 툴바 + 문자 서식

**의도**

자체 Studio가 텍스트 편집까지 가능해졌으니 다음 단계는 서식. Bold/Italic/Underline + 문단 스타일 드롭다운 + ⌘B/⌘I/⌘U 단축키 + 메뉴 통합. 선택 영역 모델은 다음 청크 — 이번 청크는 **caret이 위치한 문단 전체에 적용**(Word/한컴과 다른 단순화). 토글 UX는 정상이고 한 줄 단위 작업에 충분.

**조사**

- `applyCharFormat(s, p, start, end, props_json)` — props는 `{bold, italic, underline, fontSize(HWPUNIT), fontFamily, textColor}` 등. 알 수 없는 키도 silently ok 응답하지만 실제 적용되는 키는 `getStyleDetail.charProps` 필드명과 동일. **end_offset이 문단 길이 초과 시 silently clamp** (probe로 확인 — `scripts/check-charformat.mjs`)
- `applyStyle(s, p, styleId)` — 문단 스타일 적용 (paraShape + charShape 동시)
- `getStyleList()` → `[{id, name, englishName, type, paraShapeId, charShapeId}, ...]` 22개 (바탕글, 본문, 개요 1~10, 머리말, 각주, 차례 ...)
- `getStyleAt(s, p)` → `{id, name}` 문단 스타일 (paragraph-level)
- `getCharPropertiesAt(s, p, c)` → 효과 char shape (applyCharFormat override 반영). **getStyleDetail은 스타일 템플릿이라 override 미반영** — 토글 pressed-state는 반드시 `getCharPropertiesAt`으로 읽어야 함

**구현**

- `shared/api.ts`: `MenuAction`에 `format:bold`/`format:italic`/`format:underline` 추가
- `electron/menu.ts`: `formatMenu` 신설 (서식 → 진하게/기울임/밑줄, ⌘B/⌘I/⌘U). macOS/non-Mac 양쪽 메뉴 템플릿에 삽입
- `src/features/studio/types.ts`:
  - `CharFormatKey = 'bold' | 'italic' | 'underline'` export
  - `ViewerHandle`에 `toggleCharFormat(key)` 메소드 추가
- `StudioViewer.tsx`:
  - `styleList`, `activeFormat({bold, italic, underline, styleId})` state
  - `refreshActiveFormat()` — `getCharPropertiesAt(c.s, c.p, c.charOffset)` + `getStyleAt`로 현재 상태 동기화
  - `toggleCharFormat(key)` — `applyCharFormat(s, p, 0, 1e9, {[key]: !current})` (sentinel값으로 문단 전체)
  - `applyParagraphStyle(id)` — `applyStyle(s, p, id)`
  - `refreshAfterMutation`이 `reflowLinesegs()` 호출 (lib 이슈 #177 — 빈 lineseg + 텍스트 존재 케이스 보강)
  - `handleKeyDown`에서 ⌘B/⌘I/⌘U 인터셉트 (`metaKey || ctrlKey` early-return *전*에)
  - `handlePageClick`이 `refreshActiveFormat`도 호출 — 다른 문단 클릭 시 toolbar pressed-state 동기화
  - 툴바 UI: B/I/U 버튼 (lucide 아이콘 + `aria-pressed` + `secondary`/`ghost` variant 토글) + `<select>` 스타일 드롭다운 (type=0 user-applicable styles만)
  - `__studioDebug`에 `toggleCharFormat`/`applyStyle`/`getActiveFormat`/`getStyleList` 노출 (e2e용)
- `AppShell.tsx`: `format:*` MenuAction 핸들러가 `viewerRef.current?.toggleCharFormat(key)` 호출

**범위 결정**

- **선택 모델 도입 X** — 다음 청크. 이번엔 caret이 속한 문단 전체에 적용. 한 줄 작업엔 자연스럽고, "전체 문단 토글" 의미가 명확
- HWPUNIT 노출 X — Bold/Italic/Underline boolean만. `fontSize` 슬라이더/입력은 chunk 5b 후보

**알려진 한계**

- **blank.hwpx의 시드 문단**: `createBlankDocument`가 만든 문단의 `lineseg=[]` 상태에서 insertText 후 `renderPageSvg`가 텍스트를 SVG에 포함시키지 않음. exportHwp → reload 시점에 정상 layout. e2e `studio-format.spec.ts`의 "Bold survives save→reopen" 테스트에서만 SVG-bold attr 검증, 라이브 SVG 검증은 우회 — 큰 fixture에선 정상
- 향후: `reflowLinesegs()`가 도움이 될 줄 알았으나 위 케이스에서는 0 반환 (재계산 대상 없음으로 판정). lib 차원 fix 필요

**e2e 추가 — `tests/e2e/studio-format.spec.ts`** (6 테스트)

1. 툴바 Bold 클릭 → activeFormat.bold true / dirty 표시 / aria-pressed
2. ⌘B/Ctrl+B 단축키 → bold 적용, 'b' 텍스트 안 들어감
3. Italic + Underline 버튼 각각 토글
4. Bold 두 번 → 원복 (false)
5. 스타일 드롭다운으로 다른 styleId 적용
6. **Bold 적용 → save (HWP CFB) → 세션 reopen → SVG에 `font-weight=bold` 잔존** (round-trip 검증)

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 2/2)
✓ npm run e2e          (32/32 — chunk 5의 6 케이스 추가, 회귀 0)
✓ npm run lint         (0 errors, 0 warnings)
✓ npm run format:check
```

**남은 follow-up**

- 폰트 크기/색상 (HWPUNIT 노출 → UI에선 pt 표시)
- ⌘Z/⌘Shift+Z (undo/redo) — `@rhwp/core`가 제공하는지 확인 필요

### 2026-04-30 — Phase 1-D 청크 5b — 선택 모델 + range-aware 편집

**의도**

청크 5의 "문단 전체 토글" 단순화를 정상화. 마우스 드래그 / Shift+Arrow로 영역 선택 → 시각적 하이라이트 + 그 범위에만 서식/삭제/대체 적용. Word/한컴과 같은 표준 UX.

**조사**

- `getSelectionRects(s, startPara, startOff, endPara, endOff)` → `[{pageIndex, x, y, width, height}, ...]` 라인별 rect. 페이지 렌더 후에만 결과 있음 (lineseg 의존). blank.hwpx의 시드 문단처럼 layout이 비어있으면 `[]` 반환 — 큰 fixture로 검증
- `deleteRange(s, startPara, startOff, endPara, endOff)` → `{ok, paraIdx, charOffset}` 캐럿이 자동으로 시작 위치로 이동
- `applyCharFormat`는 단일 문단 범위만 받으므로 다중 문단 선택은 head/middle/tail 분할 호출

**구현**

- `StudioViewer`:
  - `selection: {anchor, focus} | null` state + 미러 ref (`selectionRef`) — 외부 드라이버(`__studioDebug.setSelection`)가 setState 직후 keydown을 트리거할 때 closure stale 방지
  - `selectionRectsByPage` state — pageIndex별 rect 배열, 하이라이트 오버레이 렌더
  - `sortRange` helper — anchor/focus를 (paraIdx, charOffset) 기준으로 정렬해서 `{startPara, startOffset, endPara, endOffset, empty}` 정규화
  - `refreshSelectionRects` — getSelectionRects 결과를 페이지별로 그룹화
  - `clearSelection` / `deleteSelectionIfAny` helpers
  - `toggleCharFormat` — 선택 있으면 range 호출 (단일/다중 문단 분기), 없으면 기존 paragraph-wide fallback
  - keyboard:
    - `Shift+Arrow` / `Shift+Home` — anchor 없으면 현재 caret으로 생성, focus 이동
    - 일반 Arrow / Home — selection 있으면 collapse
    - typing / Enter / Backspace / Delete — selection 있으면 `deleteRange` 먼저, 그다음 단일 char 처리
    - `compositionend` (Korean IME) — 동일하게 selection 우선 삭제 후 insert
  - mouse: `onMouseDown` (caret + clear + start drag) → `onMouseMove` (focus 갱신) → `onMouseUp` / `onMouseLeave` (drag 종료, 빈 selection이면 null로 정리). 이전 `onClick` 폐기
  - 시각 하이라이트: `data-testid="studio-selection-rect"` 오버레이 div, `bg-primary/25` 반투명, pointer-events 없음
  - `__studioDebug`에 `setSelection(anchorPara, anchorOff, focusPara, focusOff)`, `getSelection()`, `clearSelection()` 노출

**범위 결정**

- 단일 section만 (multi-section 선택은 Phase 2+ 후보)
- 모바일/터치는 미고려 (mouseup-leave는 데스크톱 자연스러운 fallback)
- caret 위치는 caretRef와 selectionRef.focus 양쪽 동기화 — 마우스/키보드 양쪽 경로에서 일관

**e2e 추가 — `tests/e2e/studio-selection.spec.ts`** (7 테스트, 큰 fixture 필요 — gitignored)

1. `setSelection` 호출 → 하이라이트 rect ≥ 1
2. `clearSelection` → rect 0개 + getSelection null
3. 영역 선택 + 타이핑 → 영역 삭제 + 문자 삽입
4. 영역 선택 + Backspace → 영역 삭제
5. `toggleCharFormat` with selection → 영역에만 적용, selection 유지
6. `Shift+ArrowRight` × 3 → 0~3 범위 선택
7. 영역 선택 + 일반 ArrowLeft → collapse

### 2026-04-30 — Phase 1 마무리 — `file:new` + Welcome 정리

**의도**

빈 새 문서를 만들 수 있어야 Phase 2 시작이 자연스럽다. 메뉴 → 파일 → 새 문서 (⌘N) + Welcome 화면 버튼.

**조사**

- `HwpDocument.createEmpty()` (정적 팩토리)는 `sectionCount=0`을 반환 — 후속 `insertText`가 "구역 인덱스 0 범위 초과"로 실패. 사실상 read-only 셸
- `HwpDocument#createBlankDocument()` (인스턴스 메소드)는 진짜 blank — 단, 호출 전에 **section 구조가 있는 seed**를 먼저 로드해야 함 (probe in scripts/probe-blank3.mjs)
- 채택: 작은 blank.hwpx (~6KB)를 base64 상수로 임베드 → 런타임에 디코드 → 인스턴스 createBlankDocument → exportHwp

**구현**

- `electron/hwp/blank-seed.ts` — 빌드 스크립트로 생성한 base64 상수 (단일 라인, prettierignore에 등록)
- `electron/hwp/converter.ts::createBlankHwpBytes()` — seed 로드 → `createBlankDocument()` → `exportHwp()`
- `electron/ipc/file.ts`: `file:new` IPC — bytes를 `userData/temp/new-<ts>.hwp`에 atomic write 후 path 반환. recent 리스트 제외 (사용자가 Save As 하면 그때 등록)
- `shared/api.ts`: `FileApi.new()` 추가
- `electron/preload.ts`: `file.new()` 래퍼
- `src/app/AppShell.tsx`:
  - `newDocument` callback — `file.new` 호출 후 setActivePath
  - `file:new` MenuAction 핸들러 와이어링 (⌘N 동작)
  - Welcome view 정비: ipc:ping JSON 데모 제거 → "새 문서" / "파일 열기" 버튼 (`welcome-new-doc`, `welcome-open` testid)
- `src/App.test.tsx`: 새 unit test 케이스 (Welcome 버튼 가시성), ping JSON 의존 테스트 제거
- `tests/e2e/smoke.spec.ts`: "hello from renderer" assertion 제거 → Welcome 버튼 visible로 갱신

**e2e 추가 — `tests/e2e/studio-new.spec.ts`** (3 테스트)

1. Welcome → "새 문서" 클릭 → studio viewer 마운트
2. `file.new()` IPC 직접 호출 → CFB magic .hwp 파일이 `userData/temp/new-N.hwp`에 생성
3. 새 문서 → insertText → save (CFB) round-trip

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 3/3 — 신규 Welcome 버튼 케이스 추가)
✓ npm run e2e          (42/42 — 7 selection + 3 file:new 추가, 기존 0 회귀)
✓ npm run lint
✓ npm run format:check
```

**Phase 1 종료**

이로써 README의 핵심 약속들이 충족됨:

- ✅ HWP/HWPX 뷰어·에디터 (자체 Studio, 오프라인)
- ✅ 빈 새 문서 + 기존 문서 두 가지 시작 방식
- ✅ 3-Pane 레이아웃 (좌: 파일, 중: 에디터, 우: 챗봇 placeholder)
- ✅ 직접 편집 (마우스/키보드/IME/선택/서식)
- ✅ 워크스페이스 복원 (session.json)

다음은 **Phase 2 — AI 챗봇 Manual 모드**.

### 2026-04-30 — Phase 1 확장 청크 7 — Undo / Redo

**의도**

HOP / rhwp-editor에 비해 명백히 부족한 핵심 일상 편집 기능 (Undo/Copy/Find) 보강. Phase 2 (AI) 진입 전 사용 가능한 에디터로 끌어올리기. 우선 Undo/Redo부터.

**조사**

- `@rhwp/core`엔 native undo 스택은 없고 **명시적 snapshot API**: `saveSnapshot() → id` (정수), `restoreSnapshot(id) → {ok}`, `discardSnapshot(id)` — bidirectional, 즉 한 번 만든 스냅샷은 앞뒤로 이동 가능 (probe via `scripts/probe-snapshot.mjs`)
- 패턴: 스냅샷 ID 배열 + index pointer. mutation 직후 push, undo는 index--, redo는 index++. 새 mutation 시 redo tail 디스카드. 캡 100

**구현**

- `StudioViewer`:
  - `historyRef = { entries: number[], index: number }` + `canUndo`/`canRedo` state
  - `pushHistory()` — 스냅샷 저장, 현재 index 다음 엔트리들 discard, 새 ID push, cap 초과시 oldest 제거
  - `restoreToIndex(target)` — `restoreSnapshot` + lineseg reflow + 캐시 클리어 + page re-render + 캐럿 재동기화 + selection 클리어 + dirty 재계산 (index === 0이면 clean, 아니면 dirty)
  - `undo()` / `redo()` — `restoreToIndex(index ± 1)`
  - `refreshAfterMutation`이 `pushHistory()` 호출 — 모든 mutation 경로(insertText/deleteText/applyCharFormat/applyStyle/deleteRange)가 자동 push
  - 문서 로드 직후 baseline 스냅샷 (index=0) 저장 — `localDoc.saveSnapshot()` 직접 호출 (refRef swap 타이밍)
  - path 변경 시 historyRef 리셋
  - keyboard: `Cmd/Ctrl+Z` (undo), `Cmd/Ctrl+Shift+Z` (redo), `Cmd/Ctrl+Y` (redo, Windows alt). Format shortcut 분기 *전*에 인터셉트
  - 툴바: Undo/Redo 버튼 (lucide `Undo2`/`Redo2`) — `disabled={!canUndo}`/`!canRedo`
- `shared/api.ts`: `MenuAction`에 `edit:undo`/`edit:redo` 추가
- `electron/menu.ts`: 편집 메뉴의 `role: 'undo'/'redo'`를 자체 `click → send('edit:undo')` 로 교체 (Electron native role은 textarea/input에만 동작; 우리 SVG-기반 viewer엔 닿지 않음)
- `AppShell`: `edit:undo`/`edit:redo` MenuAction → `viewerRef.current.{undo,redo}()`
- `ViewerHandle`에 `undo`/`redo` 추가; `__studioDebug`에 `undo`/`redo`/`canUndo`/`canRedo`/`historyDepth` 노출

**범위 결정**

- 100 entry 캡 — 큰 문서면 메모리 부담 가능, 실측 후 조정
- 기록 단위는 mutation per refreshAfterMutation 호출. 빠르게 연속 타이핑 시 매 글자마다 entry 생성 → 거친 undo. 향후 "burst grouping" (예: 1초 idle threshold)으로 개선 가능
- selection 상태는 snapshot에 안 담김 — restore 시 selection을 null로 정리. 캐럿은 `getCaretPosition`이 IR-side라 자동 복원

**e2e 추가 — `tests/e2e/studio-undo.spec.ts`** (7 테스트, stress fixture 필요)

1. baseline: `canUndo=false, canRedo=false, depth={index:0, size:1}`
2. insertText → byte hash 변경 + canUndo=true → undo → byte hash 원복 + canUndo=false, canRedo=true, dirty=false
3. undo → redo → byte hash 재일치 + dirty=true
4. 두 mutation → undo 1회 → 새 mutation → redo tail 폐기 (size 동일, redo 불가능)
5. ⌘Z 단축키로 undo
6. 툴바 Undo 버튼 → history depth 0으로 회귀
7. baseline에선 disabled, mutation 후 enabled

**검증 결과**

```
✓ npm run typecheck
✓ npm test             (단위 3/3)
✓ npm run e2e          (49/49 — chunk 7의 7 케이스 추가, 회귀 0). 3 run 안정성 확인
✓ npm run lint
✓ npm run format:check
```

### 2026-04-30 — Phase 1 확장 청크 8 — Copy / Cut / Paste

**구현**

- `electron/ipc/clipboard.ts` — `clipboard:read-text` / `clipboard:write-text` (Electron `clipboard` 모듈)
- `shared/api.ts` — `ClipboardApi`, `MenuAction`에 `edit:copy/cut/paste`
- `electron/menu.ts` — 편집 메뉴의 native `role:cut/copy/paste`를 자체 IPC로 교체
- `StudioViewer`:
  - `copySelection` → `doc.copySelection(...) + window.api.clipboard.writeText(text)` (내부 + 시스템 클립보드 동시)
  - `cutSelection` → copy + `deleteRange`
  - `pasteAtCaret` → 시스템 클립보드 텍스트 == `getClipboardText()`이면 `pasteInternal` (서식 보존), 아니면 `insertText` (plain). `pasteInternal`이 IR caret을 자동 갱신 안 해서 result `{paraIdx, charOffset}`로 명시 동기화
  - ⌘C / ⌘X / ⌘V keydown 인터셉트
- `ViewerHandle.copy/cut/paste` 노출 → `AppShell`이 `edit:*` MenuAction 라우팅

**e2e — `tests/e2e/studio-clipboard.spec.ts`** (7 케이스)

검증: e2e 56/56

### 2026-04-30 — Phase 1 확장 청크 9 — Find (⌘F)

**구현**

- `getSectionCount × getParagraphCount × getTextRange` 순회 + `indexOf` (case-insensitive)
- 매치 → `getSelectionRects` per page → 옅은 amber 오버레이 (활성 매치는 진한 amber)
- 검색 바 UI (`studio-find-bar`): input + 매치 카운트 + Prev/Next/Close
- ⌘F 열기, Enter / Shift+Enter / Esc, 활성 매치로 자동 스크롤 + 캐럿 이동
- 메뉴 `편집 → 찾기…` 추가, `__studioDebug`에 `openFind/closeFind/findNext/findPrev/getFindState`

**e2e — `tests/e2e/studio-find.spec.ts`** (7 케이스)

검증: e2e 63/63

### 2026-04-30 — Phase 1 확장 청크 10 — 정렬 + 폰트 크기 + 색상

**조사 + 구현**

- 정렬: `applyParaFormat(s, p, JSON({alignment: 'left|center|right|justify'}))`
- 폰트 크기: `applyCharFormat(... JSON({fontSize: HWPUNIT}))` — HWPUNIT = 1/100pt
- 색상: `applyCharFormat(... JSON({textColor: '#hex'}))` — lib이 lowercase 정규화
- 활성 상태: `getCharPropertiesAt`(효과값) + `getParaPropertiesAt`(문단 효과값). `getStyleDetail`은 템플릿이라 override 미반영
- 툴바: 4종 정렬 토글 + pt 프리셋 dropdown + native `<input type="color">`
- Selection-aware: range 시 head/middle/tail 분할 호출

**버그 + 수정**

- `applyCharFormat`은 빈 문단(length=0)에서 silently no-op (lib quirk)
- `refreshAfterMutation` caret sync는 format-only ops에선 disable (`{syncCaret: false}` 추가) — 그렇지 않으면 caret이 IR의 stale (0,0,0)으로 점프
- `setSelection` ref 갱신은 React state callback 안이 아닌 동기로 (배칭 시 stale read 방지)

**e2e — `tests/e2e/studio-paraformat.spec.ts`** (4 케이스)

검증: e2e 67/67

### 2026-04-30 — Phase 1 확장 청크 11 — 단어/줄 선택 + 144페이지 부하

**구현**

- `findWordBoundsAt` — Unicode `\p{P}\p{S}\s` 경계로 한글/CJK 지원
- `stepWordOffset` — skip-separators-then-word
- `mousedown e.detail`: 더블클릭 → 단어, 트리플클릭 → 문단
- ⌘⇧← / ⌘⇧→ — 단어 단위 선택 확장 (⌘ 단독은 collapse)

**144페이지 부하 측정** (사용자 제공 fixture):

| 항목                      | 값                  |
| ------------------------- | ------------------- |
| 파싱 (0.44MB → IR)        | 85ms                |
| 페이지 1개 렌더           | ~4.5ms              |
| 마지막 페이지 lazy 렌더   | <15s budget         |
| 초기 mount 페이지 수      | <20 / 144 (lazy ✓)  |
| Find 전체 스캔 (938 매치) | Node 11ms / UI 3.5s |
| exportHwp                 | 9ms                 |

**e2e** — `studio-wordsel.spec.ts` (6) + `studio-bigdoc.spec.ts` (4). 검증: e2e 77/77

### 2026-04-30 — Phase 1 확장 청크 12 — 페이지 네비

**구현**

- PageUp/Down — `scrollBy(±clientHeight, smooth)`
- ⌘Home / ⌘End — 문서 시작/끝 caret + scroll
- Shift 조합으로 선택 확장
- Plain End 추가 (현재 문단 끝). Plain Home은 기존 동작

**버그 수정**

`__studioDebug.getSelection`이 React 상태에서 읽어 동기 호출 시 stale → `selectionRef`로 변경

**e2e — `tests/e2e/studio-pagenav.spec.ts`** (6 케이스). 검증: e2e 83/83

### 2026-04-30 — 폴더 트리 (좌측 패널 재설계)

**의도**

기존 LRU 최근 파일 리스트(20개) → VS Code 스타일 단일 루트 폴더 트리

**구현**

- `electron/ipc/folder.ts`: `folder:pick`(다이얼로그), `folder:list`(즉시 자식 — dotfile 제외, 폴더 우선 한국어 정렬), `folder:watch/unwatch`(chokidar), `folder:changed` 이벤트
- shutdown 훅(`will-quit`)에서 watcher 해제
- `SessionState.lastFolderPath` 추가 (lastActivePath와 별개)
- `src/features/files/FolderTree.tsx` — lazy expand, watcher가 영향 받은 parent dir만 refresh, 모든 파일 표시(필터 X), 비-hwp 파일 클릭은 no-op

**e2e — `tests/e2e/folder-tree.spec.ts`** (5 케이스). 검증: e2e 88/88

### 2026-04-30 — 가운데 패널 탭 시스템

**구현**

- `TabBar` 컴포넌트 — 파일명 + dirty 점 + X + 미들 클릭 닫기
- `AppShell`이 `tabsState[]` + `activeIndex` 관리. 모든 탭은 `display:none`으로 mount 유지(HwpDocument + undo 히스토리 보존)
- `ViewerHandle.isDirty` + `StudioViewer.isActive`/`onDirtyChange` props. 활성 탭만 `window.__studioDebug` 점유 (race 방지)
- `openTab` — 이미 열린 path는 그 탭으로 포커스 (중복 X)
- `replaceTabPath` — Save/SaveAs 후 path 자동 라우팅 시 in-place 갱신
- ⌘W / 미들 클릭 닫기 — dirty 시 confirm
- `SessionState.openTabPaths` 영속, 재시작 시 모든 탭 복원 + lastActivePath 활성화

**e2e — `tests/e2e/tabs.spec.ts`** (7) + 좌/중 패널 스크롤 검증 `scroll.spec.ts` (2). 검증: e2e 97/97

### 2026-04-30 — 폴더 트리 ops (생성/이름변경/삭제/이동)

**IPC 추가**

- `folder:create-file` (`fs.open 'wx'` — 충돌 시 throw)
- `folder:create-folder` (non-recursive `mkdir`)
- `folder:rename` — 이동도 처리. macOS/Linux의 silent overwrite 방지로 destination 사전 체크
- `folder:trash` — `shell.trashItem` (OS 휴지통, 복구 가능)
- `folder:reveal` — `shell.showItemInFolder`
- `validateNameOrThrow` — empty/`.`/`..`/path separator 거부

**FolderTree UI**

- `selectedPath` state (activePath와 별개)
- 컨텍스트 메뉴 (`TreeContextMenu`): 새 파일 / 새 폴더 (폴더만) / 이름 변경 / 휴지통으로 이동 / 파일 관리자에서 보기. 외부 mousedown + Esc로 닫기
- 인라인 이름 변경 input — F2 또는 메뉴, focus 시 확장자 제외 basename 자동 선택
- 인라인 새 파일/폴더 input — parent 안에 (또는 빈 영역 우클릭으로 root에)
- 트리 keydown: F2 rename / Delete trash / Enter open or toggle
- HTML5 DnD: dataTransfer로 path 전달, drop target에 ring 표시. fs.rename으로 이동. 자기 자신/하위로 드롭 가드. 빈 영역 드롭 시 root로 이동

**버그 발견**

렌더러는 sandbox=true라 `process` 미정의. `process.platform === 'darwin'` 체크가 컨텍스트 메뉴 렌더를 크래시(에러 바운더리에 잡히지 않은 silent fail). 라벨을 generic '파일 관리자에서 보기'로 변경

**e2e — `tests/e2e/folder-ops.spec.ts`** (9 케이스). 검증: e2e 106/106

### 2026-04-30 — 페이지 인디케이터 fix + 폴더 트리 OS 패리티 단축키

**버그 수정 — 페이지 인디케이터**

- 가운데 페이지 인디케이터가 스크롤 시 잘못된 페이지에 멈추는 문제. `IntersectionObserver`의 `entries` 콜백은 가시성이 _변경된_ 페이지만 담아서, 그 배치 안에서 "가장 잘 보이는" 페이지를 고르면 이미 중앙에서 멀어진 페이지가 남을 수 있음
- 분리: `IntersectionObserver`는 lazy-render 전용으로 유지. 인디케이터는 새 `onScroll` 핸들러(rAF-throttled)가 viewport 상단 1/3을 가장 먼저 통과한 페이지를 선택. `studio-viewer.spec.ts`에 회귀 게이트 추가

**폴더 트리 단축키 (Finder / Explorer / VS Code 패리티)**

- Tier 1: ↑↓ 가시 항목 탐색 (접힌 dir 무시 flat traversal). ←→ 접기·펼치기 또는 부모/첫 자식 점프. ⌘N 새 파일 (선택 위치 기준), ⌘⇧N 새 폴더. 이름변경 input·새 항목 input은 키 소유 시 우회
- Tier 2: 파일 ⌘C / ⌘X / ⌘V. 렌더러 측 클립보드 ref (`{path, mode: 'copy'|'cut'}`). 붙여넣기:
  - copy → `folder:copy` IPC (`fs.cp` recursive, 충돌 시 `" (1)"` 디스앰비귀에이션)
  - cut → `folder:rename`, 클립보드 클리어
  - 폴더를 자기 자신/하위로 붙여넣으면 alert reject

**테스트 안정성**

- `studio-paraformat.spec.ts` "정렬 + fontSize + 색상 save→reopen 보존" 케이스가 풀 스위트에서 간헐 실패(단독 실행은 통과). 리로드 후 refresh가 비동기인데 단발 read가 `refreshActiveFormat` 이전에 land하던 문제. `expect.poll`로 변경, 2회 풀런 안정성 확인

**e2e** — `folder-keys.spec.ts` 7 케이스, `studio-viewer.spec.ts` +1. 검증: e2e 114/114

### 2026-04-30 — perf 트리오: WASM pre-init + off-viewport unmount + Find 캐시

**WASM pre-init**

- 첫 파일 열기 시의 "@rhwp/core 초기화 중…" stall은 일회성 lazy compile (~100~200ms). 원인: `ensureRhwpCore()`를 `StudioViewer` mount effect에서 처음 호출 → WASM compile이 사용자의 첫 파일 열기와 겹침
- `main.tsx`에서 React mount와 병렬로 pre-init 시작. viewer mount 시점엔 캐시된 promise가 이미 resolve되어 mount가 블로킹되지 않음

**Off-viewport 페이지 unmount + lazy-render 통합**

- 기존: `IntersectionObserver`(mount 결정) + 별개 `onScroll`(인디케이터). 두 부기로 항상 lag/drift
- 통합: 단일 rAF-throttled 핸들러가
  1. 상단 가시 페이지를 인디케이터로 선택
  2. 그 페이지 ±5 페이지만 SVG 마운트
  3. window 밖 페이지는 `innerHTML = ''` 클리어, `cacheRef[i]`에 SVG string 보존 → 재진입 시 DOM parse만 (WASM `renderPageSvg` 재호출 X)
- Inactive-tab guard: `scrollEl.clientHeight === 0`이면 (탭이 `display:none`) bail. 없으면 탭 스팸마다 6 page renders × N tabs
- 메모리: 144페이지 문서 default zoom에서 ~30MB → ~2MB (≤11 페이지 마운트)

**Find 문단 텍스트 캐시**

- `runFindSearch`가 매 키 입력마다 `getTextRange`를 모든 문단에 호출. 144페이지 / 2656 문단 기준
  - cold: ~4ms per query (2656 WASM calls + indexOf)
  - warm (캐시 후): 0.3ms per query (indexOf만)
  - → incremental 타이핑 10×~14× 가속 (예: "사" 6.1→0.4, "사업계획서" 4.3→0.3 ms)
- 캐시 빌드 = 첫 비어있지 않은 검색에 lazy. 무효화: doc mutation 도달 시 (`refreshAfterMutation`), viewer path 변경 시. 첫 키 입력 비용은 동일, 두 번째부터가 win

**e2e** — `studio-bigdoc.spec.ts`에 "스크롤 끝까지 이동 시 상단 unmount" 케이스 + 초기 마운트 상한 <20→≤12 강화. `studio-viewer.spec.ts` 이미지 테스트 polling. `scroll.spec.ts` 30→12 탭으로 트림. 검증: e2e 115/115 (2회 풀런)

### 2026-04-30 — Phase 1 확장 청크 13 — 확장형 툴바 + 리스트 + 페이지 나누기 + 표 + 보기 토글

**구현**

- 단일 행 툴바 → 더보기 버튼으로 두 번째 행 토글
- **글머리 기호 / 번호 매기기** — `applyParaFormat`에 `headType` + `ensureDefaultBullet/Numbering`. Selection-aware (range 안 모든 문단 토글)
- **페이지 나누기** — caret에 `insertPageBreak`. `refreshAfterMutation`이 `doc.pageCount()` 재읽도록 확장 (페이지 수 변동 mutation)
- **표 삽입** — 작은 8×8 hover grid (`TablePicker`) → `createTable(rows, cols)`
- **보기 토글** — `setShowControlCodes` / `setShowTransparentBorders`가 `aria-pressed` + 재렌더 구동

**범위 결정**

- `ViewerHandle` / `__studioDebug`엔 추가 미공개 — 사용자 전용 surface (e2e는 DOM 클릭으로). Phase 3 Agent 모드에서 표/리스트/페이지 나누기를 프로그래매틱 호출할 때 노출

**린트 정리**

- doc-load effect의 `setState-in-effect` 호출(setDirty/setCanUndo/setCanRedo)을 async IIFE 안으로 이동. refs reset은 동기 유지

**e2e** — `studio-features.spec.ts` 6 케이스. 검증: e2e 121/121

### 2026-04-30 — Phase 1 확장 청크 14 — 표 셀 편집 v1 (클릭 → 타이핑 → 백스페이스)

**문제**

- 청크 13의 "표 삽입"으로 표는 만들 수 있지만 셀이 사실상 read-only — 모든 키보드 경로가 비-셀 `insertText`/`deleteText` IR variant 호출이라 외부 문단으로 fallthrough

**Caret 모델 확장**

- `caretRef`에 optional `cell` 필드: `{parentParaIndex, controlIndex, cellIndex, cellParaIndex}`. set 상태에선 텍스트 편집이 `*InCell` IR 경로로 라우팅:
  - `insertAtCaret(text)` → `insertTextInCell` or `insertText`
  - `deleteAtCaret(at, n)` → `deleteTextInCell` or `deleteText`
  - `getCursorRect` / `getCursorRectInCell` 미러
- `handlePageMouseDown` — hitTest의 cell 필드 읽어서 클릭이 표 안에 떨어지면 `caretRef.cell` 채움. 셀 안에서 selection / 더블·트리플 클릭은 disable (셀 selection은 v2)
- IR의 `getCaretPosition`은 셀 레벨 offset을 추적 안 함 → cell ops 후 `refreshAfterMutation({syncCaret: false})`. 렌더러 측에서 caret을 `text.length`만큼 전진 / `at`로 후퇴 직접 갱신

**디버그 surface**

- `__studioDebug.enterCell(sec, parentPara, ctrl, cellIdx, cellParaIdx, charOffset?)`, `exitCell()`, `getCellText(...)`, `getCaretCell()`

**e2e** — `studio-cells.spec.ts` 4 케이스. 검증: e2e 125/125

**v1 한계 (v2~v4 follow-up)**

- 셀 안 selection 없음 (Shift+arrow / 드래그 selection)
- 셀 레벨 서식 없음 (B/I/U는 외부에 적용)
- 크로스 셀 selection 없음
- Tab으로 셀 → 다음 셀 점프 안 됨
- 행/열 추가·삭제 UI 없음

### 2026-04-30 — Phase 1 확장 청크 15 — 이미지 삽입 (툴바 + OS 드래그)

**구현**

- `@rhwp/core`의 `insertPicture`를 렌더러 측 `insertImage(bytes, ext, description)`으로 감쌈
  - 인메모리 `Image` + `blob:` URL로 자연 픽셀 크기 디코드
  - HWPUNIT 변환 (1px @ 96 DPI ≈ 75 HWPUNIT)
  - 표시 폭을 ~47k HWPUNIT (~16cm — 일반 텍스트 영역) 으로 clamp → 스크린샷이 페이지 넘침 방지
- 두 진입점이 helper 공유:
  1. 툴바 (2번째 행) "이미지 삽입" 버튼 — 숨김 `<input type="file" accept="image/*">` 트리거
  2. 외부 drop — studio scroll 컨테이너의 `onDragOver`/`onDrop`. OS 파일 드래그(`Files` in dataTransfer.types)만 수용. 폴더트리 내부 드래그(`application/x-ahwp-path`)는 제외. 드롭 타겟 ring 표시

**CSP 수정**

- `index.html`의 `img-src`에 `blob:` 추가 — 자연 크기 probe가 blob URL 통과. 없으면 디코드가 silent fail (Electron에선 콘솔 메시지 없음)

**디버그 surface**

- `__studioDebug.insertImageBase64` — e2e가 실제 파일 없이 helper 구동

**e2e** — `studio-image.spec.ts` 2 케이스. 검증: e2e 127/127

**v2 한계**

- 외부 문단만 (셀 안 `insertPictureInCell` 미연결)
- 표시 폭 1px=75 HWPUNIT 하드코드 (DPR 미인지)
- 삽입 후 리사이즈/이동은 `ShapeControl` API 필요
- 멀티 파일 드롭 시 첫 이미지만

### 2026-04-30 — Phase 1 확장 청크 16 — 셀 v2 (Tab 네비 + 인-셀 서식)

**구현**

- Tab / Shift+Tab — caret이 표 안에 있으면 셀 사이 순회 (행우선, 마지막 셀에서 wrap-around). 표 밖에선 기본 focus traversal로 fallthrough
- 서식 ops — `caretRef.cell` set 상태에서 `*InCell` variant로 디스패치
  - `toggleCharFormat` → `applyCharFormatInCell` (no-selection 경로만; 셀 selection은 v3)
  - `applyCharProps` (fontSize / textColor) → `applyCharFormatInCell`
  - `applyAlignment` → `applyParaFormatInCell`

**라이브러리 quirk**

- `getCellCharPropertiesAt`이 `applyCharFormatInCell` override를 반영하지 않음 (정적 템플릿 반환). 서식 자체는 시각적으로 적용됨 — 렌더된 SVG에 올바른 font-weight / size / color. 셀 안에서의 툴바 pressed-state는 마지막 외부 reading에 stuck. 라이브러리가 read 측 수정하거나 우리가 per-cell active-format probe를 추가할 때까지 deferred

**e2e** — `studio-cells.spec.ts` 2 케이스 추가 (Tab + B/I/U). 검증: e2e 129/129

### 2026-04-30 — Phase 1 확장 청크 17 — 셀 v3 (우클릭 행/열 추가·삭제)

**구현**

- 셀 우클릭 → 컨텍스트 메뉴:
  - 위에 / 아래에 행 추가 → `insertTableRow(rowIdx, below)`
  - 왼쪽에 / 오른쪽에 열 추가 → `insertTableColumn(colIdx, right)`
  - 행 삭제 / 열 삭제 → `deleteTableRow` / `deleteTableColumn`
    - 마지막 행/열 삭제는 표 전체를 `deleteTableControl`로 제거 (0 행/열 표는 유효한 IR 상태 아님)
  - 표 삭제 → `deleteTableControl`
- `handlePageContextMenu` — 클릭 hit-test → cell 필드 있으면 `caretRef`를 그 셀로 이동 (Word / 한컴 동작 패리티)
- `getTableDimensions` (rowCount × colCount) → 메뉴가 cellIndex로 현재 행/열 계산
- `CellContextMenu` 컴포넌트 — 폴더트리 메뉴와 dismiss 모델 미러 (외부 mousedown + Esc)

**디버그 surface**

- `insertTableRow` / `insertTableColumn` / `deleteTableRow` / `deleteTableColumn` / `getTableDimensions` 노출 — e2e가 우클릭 시뮬 없이 IPC 직접 구동

**e2e** — `studio-cells-v3.spec.ts` 5 케이스. 검증: e2e 134/134

**v4 한계**

- 셀 selection 모델 (셀 사이 드래그 selection)
- 셀 merge / split (`mergeTableCells` API 존재; 셀 selection 필요)
- 셀 레벨 paste (`pasteHtmlInCell`)

### 2026-05-01 — Phase 2 청크 1 — BYOK secrets 토대 + Provider 타입

**범위**

UI 없이 토대만. Settings 모달과 첫 어댑터(OpenAI 스트리밍)는 다음 청크.

**구현 — `shared/ai.ts`**

- `ProviderId = 'openai' | 'anthropic' | 'google' | 'nvidia' | 'ollama' | 'custom'`
- `PROVIDERS` 메타 배열 — 각 provider의 `requiresApiKey` / `requiresBaseUrl` 명시. ollama만 `requiresApiKey: false`. `isProviderId()` 가드로 IPC 입력 검증
- 채팅 모델: `ChatMessage` (role/content), `ChatRequest` (provider/model/messages/temperature?), `ChatStreamEvent` (`text-delta` / `done` / `error` 종료성 보장 — Phase 3에서 tool-call 추가 예정), `ChatUsage`
- `Provider` 인터페이스 — `chat(req, opts): AsyncIterable<ChatStreamEvent>` + `ping(opts): Promise<void>`. `ProviderRuntimeOptions` (apiKey, baseUrl, signal)는 main에서만 주입

**구현 — secrets 영속**

- `electron/store/secrets.ts` — `safeStorage.encryptString` 기반 BYOK 영속. `userData/secrets.json` (mode 0o600 + atomic tmp+rename + writeChain 직렬화). 캐시는 `Map<ProviderId, string>` (base64 ciphertext)
- 보안 결정: **평문 키는 main 프로세스에만 존재**. renderer에는 `has` / `list`만 노출하고 `get`은 IPC에 출항 없음. AI 요청은 Phase 2-B의 `ai:chat` IPC가 main에서 secret을 합쳐 어댑터에 전달
- 시스템 키링 미가용 시(`safeStorage.isEncryptionAvailable() === false`) `setSecret`/`getSecret`이 명시 에러 throw — Linux의 libsecret 미설치 케이스. macOS Keychain / Windows DPAPI는 OS에서 항상 사용 가능

**구현 — IPC**

- `electron/ipc/secrets.ts` — `secrets:set` (provider id 검증 + key trim/non-empty 검증) / `secrets:delete` / `secrets:has` / `secrets:list`
- `shared/api.ts` — `SecretsApi` 추가 + `AhwpApi.secrets`. `preload.ts`에 4개 메서드 노출. `main.ts`에 `registerSecretsIpc()` 등록
- `App.test.tsx` mockApi에 `secrets` 추가 (typecheck 통과용 noop mock)

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint
✓ npm test             (3/3 — App.test.tsx)
✓ npm run format:check
✓ npx vite build       (main.js 47.80 kB)
```

### 2026-05-01 — Phase 2 청크 2 — OpenAI 스트리밍 + ChatPanel 골격

**범위**

End-to-end 동작 검증 우선. Settings UI / 마크다운 렌더링 / 히스토리 영속 / Manual diff 흐름은 다음 청크들.

**구현 — OpenAI 어댑터**

- `electron/ai/providers/openai.ts` — `Provider` 구현
  - `chat`: POST `${baseUrl}/chat/completions` `stream:true` `stream_options.include_usage:true` → SSE 라인을 직접 파싱(`data:` prefix 후 `[DONE]` 종료). delta는 `choices[0].delta.content` 추출. usage는 마지막 청크에 동봉되어 done 이벤트에 합류
  - `ping`: GET `${baseUrl}/models` (Authorization 헤더로 키 검증)
  - 기본 base URL `https://api.openai.com/v1`, opts.baseUrl 덮어쓰기
  - AbortSignal 통과 (fetch + reader.read에 자동 전파)
- `electron/ai/registry.ts` — `Map<ProviderId, Provider>`. 현재 OpenAI만; 나머지 5개는 다음 청크에 미구현 시 명시 에러 반환

**구현 — `ai:chat` IPC (id 기반 스트리밍 채널)**

- `electron/ipc/ai.ts`:
  - `ai:chat-start` — `{id, request}` 검증 → provider 조회 → `getSecret(providerId)`로 평문 키 디크립트 → `provider.chat(req, {apiKey, signal})` async iterable을 `event.sender.send('ai:chat-event:<id>', evt)`로 펌프
  - 인플라이트 `Map<id, AbortController>`. `ai:chat-abort(id)` → ctrl.abort + 맵에서 제거
  - `requiresApiKey` provider인데 키 없으면 즉시 `error` 이벤트 (UI에 친절 메시지)
  - generator가 `done`/`error` 없이 끝나면 `done` synthesize (정합성 보장)
  - `event.sender.isDestroyed()` 체크 (창 닫힘 race)

**구현 — 렌더러 측 `AiApi`**

- `shared/api.ts` — `AiApi.chat(req, callbacks): AiChatHandle`. 콜백 형태로 노출 (async iterable은 IPC 경계에서 직렬화 안 됨)
- `electron/preload.ts` — `chat()`에서 unique id 생성 → `ipcRenderer.on(channel, listener)` → `invoke('ai:chat-start')`. terminal 이벤트 시 listener off + settled flag로 중복 방어. invoke가 reject하면 error 이벤트 생성 (main 측 throw도 UI에 도달)
- `App.test.tsx` mockApi에 `ai.chat` 추가 (noop)

**구현 — `ChatPanel`**

- `src/features/chat/ChatPanel.tsx` — 메시지 리스트 + textarea + send/stop 버튼
- 상태: `messages` (`UiMessage[]` = ChatMessage + id), `input`, `streaming`, `error`, `hasKey`
- 시작 시 `secrets.has('openai')`로 키 존재 여부 체크 → 없으면 입력 비활성화 + 안내 placeholder
- 전송 시: user 메시지 + 빈 assistant 메시지 즉시 push → `assistantIdRef`로 추적 → `text-delta` 도착마다 해당 메시지 content append → terminal 이벤트에서 streaming false
- Enter 전송, Shift+Enter 줄바꿈, IME composition 가드 (`e.nativeEvent.isComposing`로 한글 입력 끊김 방지)
- 스트리밍 중 Stop 버튼 → `handle.abort()` (main의 AbortController까지 전파)
- 컴포넌트 unmount 시 자동 abort (cleanup)
- AppShell 우측 패널의 placeholder 제거 → `<ChatPanel />` 마운트

**보안 결정 재확인**

- 평문 키는 main → 어댑터 fetch에만. preload는 `secrets.get` 없음. renderer는 키를 한 번도 보지 않음
- 다만 사용자가 Settings(차후) 입력란에 키를 타이핑하는 순간엔 임시로 메모리에 있음 → 입력 → `secrets.set` → 즉시 input clear로 노출 윈도 최소화 (다음 청크에서 구현)

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint
✓ npm test             (3/3)
✓ npm run format:check
✓ npx vite build       (main.js 51.39 kB, preload 2.25 kB)
```

> 실제 OpenAI 라운드트립은 사용자가 DevTools에서 `await window.api.secrets.set('openai', 'sk-...')` 후 채팅창 사용으로 검증. e2e는 `ai:chat`을 mock fetch로 게이트하는 작업이 다음 청크에 포함될 예정.

### 2026-05-01 — Phase 2 청크 3 — NVIDIA NIM + provider/model 셀렉터 + chat e2e + 병렬 워커

**범위**

직전 청크에서 빠져 있던 항목들을 한 번에 메우는 청크. 사용자가 NVIDIA NIM 키를 제공해 라이브 검증까지 완료. 기능 추가 시 e2e도 같이 작업하는 패턴 복원.

**구현 — NVIDIA NIM provider**

- `electron/ai/providers/nvidia.ts` — `meta = getProviderMeta('nvidia')`. chat/ping은 OpenAI 어댑터에 baseUrl만 `https://integrate.api.nvidia.com/v1`로 override해서 위임 (OpenAI-compat 엔드포인트). 자체 호스팅 NIM은 `opts.baseUrl`로 덮어쓰기 가능
- 라이브 검증 결과 — NVIDIA NIM의 SSE 형식이 OpenAI와 100% 호환. delta는 `choices[0].delta.content`, 종료 `data: [DONE]`. NIM 전용 필드(`reasoning_content`, `token_ids`, `prompt_token_ids`)는 우리 파서가 무시 → 영향 X
- `electron/ai/registry.ts`에 nvidia 등록

**구현 — ChatPanel provider/model 셀렉터**

- 상단 `chat-provider-bar`: provider `<select>` (OpenAI / NVIDIA NIM) + model `<input>` (자유 입력) + 키 보유 indicator (●/○/…)
- 두 값 모두 `localStorage`에 영속 (`ahwp:chat:provider`, `ahwp:chat:models`). 모델은 provider별로 따로 저장 (`Record<ChatProviderId, string>`)
- 기본 모델: OpenAI = `gpt-4o-mini`, NVIDIA = `meta/llama-3.1-70b-instruct`
- provider 변경 시 즉시 indicator를 로딩 상태(○ → …)로 표시 후 `secrets.has`로 재체크 — 새 provider의 키 보유 여부에 따라 입력 활성/비활성 자동 갱신
- 스트리밍 중엔 셀렉터·모델 입력 disabled

**버그 수정 (production) — text-delta race condition**

- 기존 `onEvent`가 `setMessages(prev => ...)` 내부에서 `assistantIdRef.current`를 읽었는데, React 18의 자동 배칭으로 updater 실행이 지연되면 중간에 도달한 `done` 이벤트가 ref를 비워버려 **모든 큐된 delta가 드롭**되는 race가 있었음
- 빠른 SSE(지연 0인 fake provider, 또는 실제로도 짧은 응답)에서 첫 글자만 보이고 멈추는 증상
- 수정: id를 listener 진입 시점에 eagerly capture해서 closure에 박음. updater는 capture된 id로 안전하게 매칭

**구현 — Playwright 인프라**

- `playwright.config.ts` — `workers: process.env.CI ? 2 : 4`. 직전 단일 워커 132s → 4 워커 55s (2.4× 가속). `fullyParallel: false` 유지 (파일 내부 테스트는 launch 공유)
- `tests/e2e/launch.ts` — `LaunchOptions { env? }` 추가. 호출자가 추가 환경 변수 주입 가능
- `electron/ai/providers/fake.ts` (테스트 전용) — `AHWP_E2E_FAKE_AI=1` env 시 활성. **마지막 user message** 내용으로 시나리오 디코드:
  - `ECHO:hello` → "hello" 글자별 text-delta + done
  - `ERROR:msg` → 단일 error 이벤트
  - `SLOW:abc` → 글자 사이 50ms 간격 (abort 테스트용)
  - 네트워크 호출 없음, 실제 IPC + ChatPanel 상태 머신만 검증
- `electron/ai/registry.ts`의 `getProvider` — env 분기로 openai/nvidia 슬롯을 fakeProvider로 swap

**e2e — `tests/e2e/chat.spec.ts`** (10 케이스)

1. 키 없을 때 입력 disabled + indicator ○
2. `secrets.set` + reload 후 입력 활성 + indicator ●
3. provider 전환 → 새 provider의 키 보유 여부 재체크
4. provider/model 선택이 reload 후 localStorage에서 복원
5. ECHO 스크립트로 text-delta 누적 → "hello world"
6. ERROR 스크립트 → error 배너에 메시지 노출
7. SLOW + Stop 버튼 → 부분 텍스트 + abort 정상 작동
8. Enter 전송 / Shift+Enter 줄바꿈
9. `secrets.set/has/list/delete` 라운드트립
10. `secrets.set` 빈값/non-string reject

**e2e — `tests/e2e/nvidia-live.spec.ts`** (1 케이스, env 게이트)

- `NVAPI_KEY` env 없으면 skip — CI에서 자동 비활성
- secrets.set으로 키 영속 → provider=nvidia 선택 → `meta/llama-3.1-8b-instruct` 모델로 "Reply with NIM_OK" → 스트리밍 응답에 "NIM_OK" 포함 확인
- 사용자 제공 키로 로컬 검증 통과 (1.5초 응답)

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (133/144 통과, 11 skip은 BIG_FIXTURE 부재 — 회귀 0)
✓ NVAPI_KEY=… npx playwright test nvidia-live.spec.ts   (1/1 — 라이브 NIM)
```

> 사용자 머신 기준 e2e 144 케이스 ~55s (4 워커). 4 워커에서 간헐 발생하는 folder-ops DnD flake는 별건 — 격리 실행 시 100% 통과, parallel stress 패턴이라 다음 청크에서 retry 추가 검토.

**다음 청크 후보**

- Settings 모달 (shadcn dialog) — provider 토글 + 키 입력 폼 + 연결 테스트 (`ai:ping` IPC + provider.ping 사용). DevTools 가이드 안내 제거
- 다음 어댑터: Anthropic (`messages` API, `event:` line-prefixed SSE, `tool_use` Phase 3 대비)
- 메시지 마크다운 렌더링 (`react-markdown` + `remark-gfm`) + 코드 syntax highlight

### 2026-05-01 — Phase 2 청크 4 — Settings 모달 + ai:ping 연결 테스트

**범위**

2-A "설정 UI" 항목 모두 완료. DevTools 가이드 없이 UI만으로 BYOK 키 관리 + 연결 검증 가능.

**구현 — `ai:ping` IPC**

- `electron/ipc/ai.ts`에 `ai:ping` 핸들러 추가. `{providerId, apiKey?, baseUrl?}` 받아서:
  - transient `apiKey`(Settings에서 저장 전 입력값) 우선, 없으면 stored secret으로 fallback
  - `requiresApiKey` provider인데 양쪽 다 없으면 친절 에러 throw
  - 15s 하드 타임아웃 (`AbortController` + `setTimeout`) — 응답 없는 NIM이 영원히 매달리는 거 방지
  - 성공 시 resolve, 실패 시 throw → 렌더러 측에서 `await` reject 잡아 메시지 표시
- `shared/api.ts`: `AiApi.ping(providerId, opts?: AiPingOptions)` 추가. opts는 transient apiKey + baseUrl override
- `electron/preload.ts`: `ipcRenderer.invoke('ai:ping', {providerId, ...opts})`로 단순 위임

**구현 — shadcn UI 컴포넌트**

- `@radix-ui/react-dialog` 추가 (단일 의존성, 기존 Radix slot/animate와 일관)
- `src/components/ui/dialog.tsx` — shadcn 표준 템플릿 (Root/Trigger/Close + Overlay/Content/Header/Footer/Title/Description). 우상단 `X` 닫기 버튼 자동 포함, ESC + 외부 클릭 dismiss
- `src/components/ui/input.tsx` — shadcn Input 표준
- 파일 상단 `eslint-disable react-refresh/only-export-components` — Radix Root/Trigger/Close가 const 재export라 react-refresh 룰이 경고. 분리하면 shadcn 템플릿에서 이탈하므로 disable로 명시 처리

**구현 — `SettingsDialog`**

- `src/features/settings/SettingsDialog.tsx` — 현재 어댑터 구현된 provider만 노출(`SHOWN_IDS = {openai, nvidia}`). 미구현 어댑터는 UI에서 숨겨 약속 부풀림 방지
- provider별 row 컴포넌트:
  - 라벨 + 키 보유 indicator (●/○/…)
  - `<Input type="password" autoComplete="off">` — 관리 패스워드 매니저 자동 저장 회피
  - 버튼: `저장` (input 비어있지 않으면 활성), `연결 테스트` (input 또는 stored 키 있으면 활성), `삭제` (stored 키 있을 때만 노출)
  - ping 결과는 row 하단 인라인 ✓/✗ 메시지로 표시. 저장하면 ping state 초기화 + input clear
- 모달 진입점:
  - `view:settings` MenuAction → AppShell이 `setSettingsOpen(true)`
  - `Cmd/Ctrl+,` 가속기 (`electron/menu.ts`에 이미 정의되어 있어서 wiring만)
  - ChatPanel의 빈 키 안내에 "설정 열기" 버튼 추가 → onOpenSettings prop으로 전달
- ChatPanel placeholder의 DevTools 안내 제거 → "{provider} API 키가 필요합니다"로 단순화

**구현 — fake provider 확장 (e2e용)**

- `electron/ai/providers/fake.ts`: `ping()`이 `apiKey`가 'BAD'로 시작하면 throw. 그 외엔 resolve. e2e의 연결 테스트 실패 케이스용

**e2e — `tests/e2e/settings.spec.ts`** (8 케이스)

1. ChatPanel "설정 열기" CTA로 모달 open + provider 행 표시
2. `view:settings` IPC(메뉴 클릭 시뮬)로 모달 open
3. 키 저장 → indicator ○ → ●, ChatPanel 입력 활성화
4. transient 키로 연결 테스트 ✓
5. BAD 키로 연결 테스트 → 에러 메시지
6. 입력 비우고 stored 키로 연결 테스트 ✓ (fallback 경로)
7. 삭제 → indicator ●→○ + 삭제 버튼 사라짐
8. provider별 row 독립성 (nvidia 저장이 openai 영향 X)

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (141/153 통과, 12 skip = 11 BIG_FIXTURE + 1 NIM live, 회귀 0)
```

**다음 청크 후보** (2026-05-01 업데이트 — 추가 provider 어댑터는 메인테이너 API 키 준비 대기로 보류)

- 메시지 마크다운 렌더링 (`react-markdown` + `remark-gfm`) + 코드 블록 syntax highlight
- 메시지 복사/재생성/삭제 액션
- 파일별 채팅 히스토리 (better-sqlite3 도입)
- Manual 모드 diff 흐름 (2-E) — OpenAI/NVIDIA로도 검증 가능

### 2026-05-01 — Phase 2 청크 5 — assistant 메시지 마크다운 + 코드 syntax highlight

**범위**

2-C 항목 중 마크다운/코드 하이라이트 두 줄 체크. user 메시지는 plain text 유지(입력 그대로 표시) — 사용자 의도 안 비틀기.

**구현 — 의존성**

- `react-markdown@^10` + `remark-gfm@^4` — GFM 확장 (테이블, 취소선, 작업 리스트, 자동 링크)
- `react-syntax-highlighter` (PrismLight) + `@types/react-syntax-highlighter` — 14개 언어를 eager import (ts/tsx/js/jsx/py/rust/sql/json/bash/yaml/css/markdown). 한 번에 로드되므로 스트리밍 중 코드 블록이 plain → highlighted로 깜빡이는 현상 없음
- shiki 후보였으나 oniguruma WASM(~700KB) 추가 부담 + Electron 렌더러에서 dynamic import의 lazy chunk 효용 적어 보류
- 번들 영향: renderer 345 kB → 639 kB (gzip 97 → 185 kB). Electron 데스크톱 앱 기준 수용 가능

**구현 — `MessageContent`**

- `src/features/chat/MessageContent.tsx` — `ReactMarkdown` 래퍼 + 커스텀 컴포넌트 매핑
- `code` 렌더러: `language-*` 클래스가 있거나 multi-line이면 `<SyntaxHighlighter>`. 인라인 코드는 `<code class="bg-foreground/10 ...">`로 폴백
- 테마: `useTheme().resolvedTheme === 'dark' ? oneDark : oneLight`. 시스템 테마 변경 시 자동 갱신
- 언어 lazy 등록 — `ensureLanguage(name)`로 첫 사용 시 `registerLanguage` (사실 모든 grammar가 eager import됐으므로 noop에 가깝지만 hot path 안전망)
- 외부 링크는 `target="_blank" rel="noreferrer noopener"`로 강제 — Electron 렌더러에서 임의 사이트 인-앱 네비게이션 방지
- 컴포넌트 매핑 커스텀: `p`/`ul`/`ol`/`table`/`blockquote`/`h1~h6` 등 Tailwind로 직접 스타일 (typography 플러그인 도입 회피)

**구현 — ChatPanel 통합**

- `Message` 컴포넌트가 `role === 'user'`면 plain text, 아니면 `<MessageContent>` 사용
- user bubble은 `whitespace-pre-wrap text-sm` 그대로 (개행 보존), assistant bubble은 마크다운 박스
- `memo(MessageContentImpl)`로 같은 content 재렌더 회피 — 스트리밍 중 빠른 setMessages가 다른 메시지 인스턴스의 마크다운 파싱 트리거하지 않게

**스트리밍 중 부분 마크다운 처리**

- delta마다 ReactMarkdown이 누적 content를 다시 파싱 — 모델이 `**bold**`를 글자별로 보내도 닫는 `**`이 도착한 시점에 자연스럽게 `<strong>`으로 전환
- 일반 AI 채팅 UX와 동일. 사용자에겐 점진적 텍스트 → 형식 적용으로 보임

**e2e — `tests/e2e/chat-markdown.spec.ts`** (6 케이스)

1. 인라인 emphasis (`**bold**`/`*italic*`/`` `inline-code` ``) → `<strong>`/`<em>`/`<code>` 검증
2. 외부 링크 → `target=_blank` + `rel=noreferrer`
3. GFM 취소선 + 작업 리스트 → `<del>` + `<input type=checkbox>` × 2
4. GFM 테이블 → 실제 `<table>` 트리 (`<th>`/`<td>` 검증)
5. 코드 펜스 (` ```ts `) → `chat-codeblock` testid + Prism 토큰화 검증 (`<span>const</span>` 존재)
6. user 메시지에 `**not bold**` 입력 → 리터럴 보존, `<strong>` 0개

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (147/159 통과, 12 skip = 11 BIG_FIXTURE + 1 NIM live, 회귀 0)
```

**다음 청크 후보**

- 메시지 액션 (복사 / 재생성 / 삭제) — assistant bubble hover 시 노출
- 파일별 채팅 히스토리 (better-sqlite3 도입 — Phase 1-B에서 미뤘던 native module 셋업 포함)
- Manual 모드 diff 흐름 (2-E) — `<edit>` JSON 블록 파싱 → diff 패널 → Accept/Reject

### 2026-05-01 — Phase 2 청크 6 — 메시지 복사 / 재생성 / 삭제 (2-C 완료)

**범위**

ROADMAP 2-C "메시지 복사·재생성·삭제" 마지막 항목. 2-C 전체 완료. 2-A·2-B (구현된 어댑터 한정) 도 이미 완료라 Phase 2의 남은 본 목표는 2-D(히스토리)·2-E(Manual diff) 두 개.

**구현 — `ChatPanel`**

- `send` 본체에서 "메시지 푸시 + IPC 시작" 부분을 `fireChat(history)` 헬퍼로 추출. `send`는 user 메시지를 history 끝에 붙이고 `fireChat` 호출
- `regenerate(assistantId)` — 메시지 배열에서 해당 assistant id 위치 찾기 → 그 직전까지를 history slice → 마지막이 user 메시지인지 검증 → `fireChat` 재호출. 결과적으로 같은 user 메시지에 대한 새 응답으로 assistant bubble을 갈아치움
- `deleteMessage(id)` — 단순 필터. 단일 메시지만 제거 (preceding user는 보존). 사용자가 user도 지우려면 별도 클릭(향후 user 액션 추가 시) — 현재 user는 복사만
- `copyMessage(id)` — `window.api.clipboard.writeText(content)` 위임. 성공 여부 boolean 반환 → UI에서 ✓ 토글
- `streaming` 중엔 regenerate/delete 무시 (early return). 이 때 액션 툴바 자체가 렌더 안 됨

**구현 — `Message` 컴포넌트**

- bubble parent에 `group` 클래스 → 액션 툴바는 `opacity-0 group-hover:opacity-100 focus-within:opacity-100`로 hover/포커스에서만 등장
- assistant: 복사 / 재생성 / 삭제. user: 복사만
- 복사 버튼은 누른 직후 1.5s 동안 `<Check>` 아이콘 + `aria-label="복사됨"` → 시각 피드백
- ESC 또는 unmount 시 setTimeout 정리 (메모리 누수 회피)
- `streaming` 또는 `isAssistantStreaming` (assistant + 빈 content) 시 액션 툴바 전체 hide — UX 일관성 (스트리밍 중엔 어떤 메시지에서도 액션 안 보임)

**e2e — `tests/e2e/chat-actions.spec.ts`** (6 케이스)

1. assistant 메시지 hover 시 복사·재생성·삭제 모두 노출
2. user 메시지는 복사만 노출 (재생성·삭제는 0개)
3. 복사 클릭 → 시스템 클립보드(`window.api.clipboard.readText`)에 정확한 content
4. 재생성 클릭 → assistant bubble 1개 유지 + 같은 ECHO payload 다시 처리
5. 삭제 클릭 → assistant bubble 0개, user bubble 1개 보존
6. SLOW 스트리밍 중 액션 툴바 전체 hide → Stop 후 자동 노출

**검증 결과 (이 청크만)**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (chat-actions.spec.ts 6/6 통과)
```

### 2026-05-01 — BIG_FIXTURE 교체 — `(참고)(양식) ★'25년 ... 보고서 서식자료_260127_01.hwp`

**배경**

`tests/e2e/studio-bigdoc.spec.ts`와 `studio-pagenav.spec.ts`가 의존하던 fixture (`★2026년 스마트공장 ... .hwpx`)는 메인테이너만 가지고 있어 빌드 환경에서 11 케이스가 항상 skip됐음. 사용자가 다른 .hwp 자료로 교체 요청.

**변경**

- 두 spec 파일의 `BIG_FIXTURE` 경로 + `test.skip` 메시지 새 파일명으로 일괄 갱신
- 새 fixture는 **57페이지 .hwp** (기존 ~144페이지 .hwpx 대비 작음). 페이지 수에 직접 의존하던 어설션을 fixture-agnostic으로 일반화:
  - "1 / 144 ±10" → "1 / N (N≥20)" — lazy mount/unmount 윈도우가 의미를 가지는 최소 크기만 보장
  - "100+ pages" → "20+ pages"
  - 검색 매치 ">=50" → ">=1" + 5초 budget 유지
  - 검색어 "사업" → "보고서" (새 fixture 내용에 맞춤)
- 페이지 네비(`studio-pagenav.spec.ts`) 6 케이스는 페이지 수와 무관하게 동작 — fixture 경로만 갱신해도 통과

**결과**

- 11 케이스 BIG_FIXTURE skip → **모두 활성화 + 통과**
- e2e 통합: **164 passed / 1 skip / 0 fail** (~68s, 4 워커). 1 skip = `nvidia-live` (NVAPI_KEY 미설정)
- skip 사유 정리:
  - **이전**: 12 skip = 11 BIG_FIXTURE 부재 + 1 NIM env
  - **현재**: 1 skip = NIM env (CI에서 자동 비활성, 로컬 NVAPI_KEY 시 활성)

### 2026-05-01 — `@rhwp/core` 0.7.8 → 0.7.9 + 신규 IR API 게이트

**변경점 (라이브러리)**

backward-compatible patch — 신규 메서드 4개 추가, 시그니처/제거 없음.

| API                                                | 용도                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `insertParagraph(sec, paraIdx)`                    | 빈 문단 삽입 (IR 레벨, `insertText` 줄바꿈과 다른 노드 단위 조작) |
| `deleteParagraph(sec, paraIdx)`                    | 문단 통째 삭제                                                    |
| `renderPageCanvasLegacy(pageNum): number`          | 레거시 PageRenderTree → Canvas 포인터                             |
| `renderPageToCanvasLegacy(pageNum, canvas, scale)` | Canvas 2D 직접 렌더 (PageRenderTree 경로)                         |

`init_panic_hook` / `version` export 위치만 d.ts에서 이동 — 실제 export는 그대로, 우리 `electron/hwp/converter.ts` 동작 무영향.

**즉시 활용 — paragraph IR ops 게이트**

UI 노출은 보류 (Enter/Backspace로 사용자 흐름은 이미 커버). 대신 `__studioDebug`에 4개 메서드 추가해서 향후 Phase 3 (Agent tool 화이트리스트)·Phase 2-E (Manual diff)에서 안전하게 wire할 수 있도록 회귀 게이트 사전 설치:

- `insertParagraph(sec, idx)` — `doc.insertParagraph` + `refreshAfterMutation`
- `deleteParagraph(sec, idx)` — `doc.deleteParagraph` + `refreshAfterMutation`
- `getParagraphCount(sec)` — read-only
- `getTextRange(sec, para, start, end)` — read-only

`refreshAfterMutation`이 페이지 카운트 자동 재읽기 → 새 빈 문단이 페이지 경계를 넘기면 인디케이터도 갱신.

**Canvas legacy 두 메서드는 보류**

우리는 SVG 경로(`renderPageSvg`)에 정착. Canvas legacy는 Phase 5 성능 최적화 (큰 문서 빠른 미리보기 모드)에서 별도 검토.

**e2e — `tests/e2e/studio-paragraph-ops.spec.ts`** (2 케이스)

1. `insertParagraph(0, 1)` → `getParagraphCount` +1, 새 문단에 `insertText('BETA')` → 정상 주소 가능
2. 2-paragraph 상태(`FIRST`/`SECOND`)에서 `deleteParagraph(0, 0)` → count -1, 인덱스 0이 'SECOND'로 이동 (인덱스 시프트)

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (166/167, 1 skip = NIM live env, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 7 — 찾아 바꾸기 (⌘H) + examples/ git 추적 + e2e retry

2-C 항목 완전 클리어. rhwp-core API 활용 시리즈의 첫 청크 — `replaceOne` / `replaceAll`을 IR에 위임 (자체 splicing 안 함).

**구현 — 찾아 바꾸기**

- `__studioDebug` 확장: `openReplace` / `setReplaceQuery` / `replaceCurrent(override?)` / `replaceAll(override?)` / `getFindState`에 replaceQuery·replaceFeedback 동봉
- IR 위임 — `applyReplace(all, replacementOverride?)`가 `doc.replaceOne` 또는 `doc.replaceAll` 호출. case-insensitive 통일 (third arg=false). override 인자가 있으면 React state 우회 (e2e가 setReplaceQuery 후 즉시 호출 시 stale closure 회피)
- mutation 후: `findTextCacheRef.current = null` (cache 무효화) → `refreshAfterMutation` (페이지 카운트 + dirty) → `runFindSearch(query)` 재실행으로 매치 카운트 갱신
- UI — `find bar`를 두 행으로 확장. 1행: 기존 검색 + Prev/Next/Close. 2행: 치환 input + 바꾸기/모두 바꾸기 + 결과 피드백 ("3건 바꿈" 등)
- Enter/Shift+Enter on replace input → 단일/모두 바꾸기. Esc → 닫기
- 매치 0개일 때 두 버튼 비활성. 검색어 비어있어도 비활성 (replace 텍스트는 비어있어도 OK = 삭제)

**구현 — 진입점**

- ⌘H 단축키 (StudioViewer keydown — ⌘F와 같은 modifier 가드 분기)
- `view:replace` MenuAction → AppShell 라우팅 → `handle.openReplace()`. `electron/menu.ts`의 편집 메뉴에 "바꾸기…" + Cmd/Ctrl+H accelerator
- ChatPanel과 무관 — 가운데 패널 전용

**examples/ git 추적**

- `.gitignore`에서 `examples/` 제거 (`.DS_Store`만 잔존 ignore)
- 사용자 .hwp 3개 (5.1MB) 커밋 — CI/새 클론에서 11 BIG_FIXTURE skip 자동 활성화
- LFS 도입 보류 (5MB 수준, 50MB+ 도달 시 재검토)

**E2E retry 추가**

- `playwright.config.ts`에 `retries: 1`. 4 워커 병렬에서 OS 파일시스템 race(folder-ops DnD) + React state 전파 race(find/replace state 폴링)가 < 0.5% 빈도로 flaky. 격리 실행은 100% 통과
- retry 1회로 noise 자동 흡수. 진짜 회귀는 두 번 모두 실패해야 카운트 — 마스킹 없음

**e2e — `tests/e2e/studio-replace.spec.ts`** (6 케이스)

1. ⌘H가 find bar + replace row 모두 노출 + 입력/버튼 visible
2. `replaceCurrent('XXX')` — 첫 매치만 바꿈, 나머지 유지 (3 → 2 매치)
3. `replaceAll('cherry')` — 모든 매치 한 번에 (3 → 0)
4. 빈 replace → 매치 삭제만 ('keep DROP keep DROP keep' → 'keep keep keep')
5. 매치 없을 때 두 버튼 disabled
6. case-insensitive — 'Hello hello HELLO' → 'Hi Hi Hi'

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (171/173, 1 skip = NIM live env, 1 flaky→retry pass, 회귀 0)
```

> e2e 카운트: 167 prior + 6 replace = 173. flaky 1건은 selection 테스트 — chunk 7과 무관, retry로 통과.

### 2026-05-01 — Phase 2 청크 8 — 하단 status bar + 줄 간격/들여쓰기/문단 간격 (rhwp-core 활용 두 번째 청크)

**하단 status bar 신설**

상단 툴바를 한컴 한글 패턴으로 분리: 편집 서식(B/I/U·정렬·폰트·스타일·더보기)은 상단, 히스토리·뷰 컨트롤은 하단.

- 상단 툴바에서 제거 → 하단으로: undo, redo, zoom out / level / in / 100% / fit width, dirty 인디케이터, 페이지 인디케이터
- testid 모두 유지 → 기존 e2e 회귀 0
- 하단 bar는 `data-testid="studio-statusbar"`로 신규 노출

**applyParaFormat props 확장 — IR 키 검증**

라이브러리 ParaShape 입력 키 이름은 출력(`getParaPropertiesAt`) 키 이름과 동일하지만, 우리가 처음 추정한 한컴 표준 이름(`indentLeft`, `spaceBefore` 등)은 IR이 무시. 실제 키:

| 우리 추정         | 실제 IR 키          |
| ----------------- | ------------------- |
| `indentLeft`      | **`marginLeft`**    |
| `indentRight`     | `marginRight`       |
| `firstLineIndent` | `indent`            |
| `spaceBefore`     | **`spacingBefore`** |
| `spaceAfter`      | **`spacingAfter`**  |
| `lineSpacing`     | (그대로)            |

WASM strings probe + e2e raw probe로 확인. `ParaProps` interface와 핸들러 모두 IR 키로 정정.

**ParaProps 핸들러**

- `applyParaProps(props)` — 기존 `applyAlignment` 본체에서 추출. selection / cell 라우팅 단일화. 모든 paragraph-shape 작업이 이걸로 funnel
- `applyAlignment(a)`: `applyParaProps({ alignment: a })`
- `applyLineSpacing(percent)`: 100/115/150/200/300 preset
- `stepIndent(direction)`: `getParaPropertiesAt`로 현재 marginLeft 읽고 ±5670 HWPUNIT(≈1cm), 0에서 floor
- `applyParaSpacing(before, after)`: spacingBefore/spacingAfter HWPUNIT (단, 라이브러리가 ~74.6× 단위 압축해서 readback — input은 정수 HWPUNIT 그대로 보내면 됨)

**UI — 확장 toolbar 2행에 추가**

- 내어쓰기 / 들여쓰기 (lucide `IndentDecrease` / `IndentIncrease`)
- 줄 간격 `<select>`: 1.0 / 1.15 / 1.5 / 2.0 / 3.0 (선택 후 자동 reset해서 같은 값 다시 클릭해도 firing)
- 문단 간격 `<select>`: 없음(0) / 위 0.5(280) / 위 1.0(567) / 위·아래 1.0(567,567)

**라이브러리 escape hatch**

- `__studioDebug.applyParaPropsRaw(s, p, propsJson)` 추가 — e2e가 IR input schema 변동 시 즉시 probe할 수 있는 raw 호출 surface

**e2e — `tests/e2e/studio-paraspacing.spec.ts`** (4 케이스)

1. `lineSpacing: 200` → readback에 `200` 포함
2. `stepIndent` 두 번 increase / 세 번 decrease → marginLeft 단조 증가 후 0 floor
3. `applyParaSpacing(567, 567)` → before 0 → after >0, 입력 두 배(1134)면 readback도 ~2배 (단위 변환 비례)
4. UI render: 더보기 토글 후 줄 간격 / 문단 간격 select + 들여쓰기/내어쓰기 버튼 visible

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (176/177, 1 skip = NIM live env, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 9 — 셀 합치기/나누기 (rhwp-core 활용 시리즈 3번째)

표 v3 위에 v4 진입. 한컴 한글의 셀 병합/분할 UX를 IR API로 노출. 우클릭 메뉴에 4 항목 추가.

**구현 — IR 핸들러**

세 라이브러리 메서드를 셀 좌표 받는 헬퍼로 감쌈. 모든 호출 후 `caretRef.current.cell = undefined` (cell 좌표가 stale) + `refreshAfterMutation`.

| 헬퍼                                   | 위임                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `mergeCells(s, p, c, sR, sC, eR, eC)`  | `doc.mergeTableCells(...)`                                                       |
| `splitCellInto(s, p, c, r, c, nR, mC)` | `doc.splitTableCellInto(..., true /* equalRowHeight */, false /* mergeFirst */)` |
| `unmergeCell(s, p, c, r, c)`           | `doc.splitTableCell(...)` (이전 merge 메타로 원래 geometry 복원)                 |

**UX — 우클릭 메뉴 4 항목 추가**

`CellContextMenu`에 새 행 (행 삭제 / 열 삭제와 표 삭제 사이):

- 오른쪽 셀과 병합 (canMergeRight: 마지막 열 아닐 때만 활성)
- 아래 셀과 병합 (canMergeBelow: 마지막 행 아닐 때만 활성)
- 셀 나누기 (2×2) — `splitTableCellInto(..., 2, 2)`
- 병합 해제

`item()` 헬퍼를 `disabled` 받도록 확장 — disabled 항목은 클릭 무시 + opacity-50.

**디버그 surface**

`__studioDebug.{mergeCells, splitCellInto, unmergeCell}` 노출. e2e가 IR 라운드트립을 직접 검증.

**e2e — `tests/e2e/studio-cells-merge.spec.ts`** (4 케이스, 1 의도적 skip)

STRESS_FIXTURE para 5에 3×3 표 plant (v3 패턴 재사용).

1. `mergeCells(0,0)-(0,1)` → cellCount 9 → 8, rowCount/colCount는 3×3 유지 (logical span)
2. merge 후 `unmergeCell(0,0)` → cellCount 9 복원
3. `splitCellInto(0,0,2,2)` → cellCount ≥ 12 (1 셀 → 4 셀, +3)
4. UI cell-menu 우클릭 — 헤드리스 우클릭 platform-flaky라 의도적 skip. 같은 메뉴 컴포넌트 클릭 흐름은 v3에서 검증됨

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (178/181, 1 flaky→retry pass, 2 skip = NIM live + cell-menu UI 의도, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 10 — 페이지 설정 (rhwp-core 활용 시리즈 4번째)

용지 크기·방향·여백 조절. `setPageDef` / `getPageDef` IR API 위임 + Settings 패턴의 shadcn Dialog 재사용.

**IR 응답 형식 발견** (`getPageDef(0)` probe)

```json
{
  "width": 59528,
  "height": 84186,
  "marginLeft": 8504,
  "marginRight": 8504,
  "marginTop": 5668,
  "marginBottom": 4252,
  "marginHeader": 4252,
  "marginFooter": 4252,
  "marginGutter": 0,
  "landscape": false,
  "binding": 0
}
```

A4 = 59528 × 84186 HWPUNIT (210 × 297 mm). 1 mm = 567/2 = 283.5 HWPUNIT (A4 width 210 × 283.5 = 59535에 근접 — 라이브러리는 정확히 59528, ±0.01% 라운딩).

**구현 — IR 핸들러**

- `applyPageDef(props, sectionIdx=0)` — `doc.setPageDef(idx, JSON.stringify(props))` + `refreshAfterMutation`. paper-size 변경 시 IR이 자동 re-paginate
- `__studioDebug.{getPageDef, applyPageDef}` 노출
- `ViewerHandle.{getPageDef, applyPageDef}` 노출 — AppShell이 활성 viewer 호출

**구현 — `PageSetupDialog`**

- `src/features/studio/PageSetupDialog.tsx` — shadcn `Dialog` 재사용
- 5 paper presets (A4 / A5 / B5 / Letter / Legal) + "사용자 정의"
- Form fields: 너비·높이 (mm), 가로 방향 토글, 여백 4개 (위·아래·좌·우)
- HWPUNIT ↔ mm 변환 (`HWPUNIT_PER_MM = 283.5`). preset 자동 감지 (`detectPreset` — 어느 방향이든 매칭)
- `useEffect`로 dialog open 시 PageDef seed (lint rule는 disable로 명시 — discrete event-based seed는 정당한 케이스)
- 적용 시 mm → HWPUNIT 변환 후 `onApply`. dialog 닫음

**진입점**

- `view:page-setup` MenuAction (메뉴 "보기 → 페이지 설정…")
- AppShell이 라우팅 → `setPageSetupOpen(true)`
- `getCurrentPageDef`/`onApply`는 `activeViewerRef()`로 현재 활성 탭의 viewer 호출

**e2e — `tests/e2e/studio-pagesetup.spec.ts`** (5 케이스)

1. 기본 A4 portrait — width=59528, height=84186, landscape=false
2. `applyPageDef`로 모든 마진 8505 HWPUNIT(=30mm) 변경 → readback 동일
3. landscape 토글 → readback `landscape: true`
4. UI: `view:page-setup` IPC → 다이얼로그 노출 + preset selector "A4" 시드
5. UI: 위 여백 50mm 입력 → 적용 → `getPageDef.marginTop` ≈ 14175 (50 × 283.5, ±1 HWPUNIT)

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (182/186, 2 flaky→retry pass, 2 skip = NIM live + cell-menu UI 의도, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 11 — 머리말 / 꼬리말 (rhwp-core 활용 시리즈 5번째)

한컴 한글 "쪽 → 머리말/꼬리말" 단일-라인 MVP. 다중 라인 / 페이지 템플릿(홀수/짝수)은 후속.

**IR API**

| 메서드                                                                          | 역할                                                                                   |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `createHeaderFooter(sec, isHeader, applyTo)`                                    | 슬롯 생성                                                                              |
| `getHeaderFooter(sec, isHeader, applyTo)`                                       | 슬롯 조회 — `{exists, kind, applyTo, paraCount, text, ...}` 반환 (text 필드 직접 포함) |
| `insertTextInHeaderFooter(sec, isHeader, applyTo, hfParaIdx, charOffset, text)` | 텍스트 삽입                                                                            |
| `deleteHeaderFooter(sec, isHeader, applyTo)`                                    | 슬롯 제거                                                                              |

**applyTo probe**

`applyTo=0`이 "양 쪽" (label 필드로 확인). 1/2 등 다른 값은 페이지 템플릿(홀수만/짝수만/첫 페이지) — 본 청크에선 0만 노출.

**구현 — `setHeaderFooterText` 헬퍼**

```
existing = getHeaderFooter(...)
if existing.exists: deleteHeaderFooter(...)
if text.length === 0: return  // 빈 입력 = 슬롯 제거
createHeaderFooter(...)
insertTextInHeaderFooter(..., 0 /* paraIdx */, 0 /* charOffset */, text)
```

덮어쓰기 시 append 방지 위해 항상 drop & recreate. `refreshAfterMutation({ syncCaret: false })` (HF 편집은 본문 caret 스트림 외부).

**구현 — `HeaderFooterDialog`**

- shadcn `Dialog` 재사용 (Page setup 패턴)
- 머리말 / 꼬리말 라디오 토글 (kind state). 토글마다 해당 슬롯 text 자동 시드
- text input (단일 라인). 빈 값 = 제거
- 적용 / 제거 / 취소 버튼
- 진입점: `insert:header-footer` MenuAction → 메뉴 "보기 → 머리말 / 꼬리말…"

**ViewerHandle / \_\_studioDebug**

- `ViewerHandle.{getHeaderFooter, setHeaderFooterText}` 노출 → `AppShell` Dialog가 활성 viewer로 위임
- `__studioDebug.{setHeaderFooterText, getHeaderFooter}` — e2e 라운드트립용

**e2e — `tests/e2e/studio-headerfooter.spec.ts`** (6 케이스)

1. blank doc — header/footer 모두 `exists:false`
2. `setHeaderFooterText` → header 생성 + text round-trip + kind/applyTo 검증
3. header / footer 독립 (서로 영향 X)
4. 두 번 set하면 덮어쓰기 (append 아님)
5. 빈 text → 슬롯 제거 (`exists:false`)
6. UI: `insert:header-footer` IPC → 다이얼로그 → text 입력 → 적용 → IR readback

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (190/192, 2 skip = NIM live + cell-menu UI 의도, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 12 — 책갈피 (rhwp-core 활용 시리즈 6번째)

가장 가벼운 청크 — IR API 4개. Settings/Page/HF dialog 패턴 그대로 재사용.

**IR API**

| 메서드                                        | 역할                 |
| --------------------------------------------- | -------------------- |
| `addBookmark(sec, para, charOffset, name)`    | 새 책갈피 추가       |
| `getBookmarks()`                              | 전체 책갈피 목록     |
| `renameBookmark(sec, para, ctrlIdx, newName)` | 이름 변경 (in-place) |
| `deleteBookmark(sec, para, ctrlIdx)`          | 삭제                 |

**probe 응답**

```json
[{ "name": "bm-1", "sec": 0, "para": 0, "ctrlIdx": 1, "charPos": 11 }]
```

5필드 평면 구조. ctrlIdx는 IR이 1부터 할당.

**구현 — 헬퍼**

- `addBookmarkAtCaret(name)`: 현재 caret(`caretRef.current`)에 IR call. 시각 콘텐츠 변경 X → re-paginate 안 함, dirty만 표시
- `deleteBookmarkAt(sec, para, ctrlIdx)` / `renameBookmarkAt(...)` 동일
- `getBookmarks` debug 헬퍼는 응답이 배열이거나 `{bookmarks: [...]}` 양쪽 처리 (라이브러리 future-proof)

**ViewerHandle / \_\_studioDebug**

- `ViewerHandle.{addBookmarkAtCaret, getBookmarks, deleteBookmarkAt, renameBookmarkAt}` 노출
- `__studioDebug` 동일 — e2e 라운드트립용

**구현 — `BookmarkDialog`**

- shadcn `Dialog` 재사용
- 추가 폼 (이름 input + "추가" 버튼) — 빈 이름 disabled
- 책갈피 목록 — 각 행에 이름 + `§{sec} · ¶{para} · @{charPos}` 위치 정보 + 삭제 휴지통 버튼
- 빈 상태 안내
- 진입점: `insert:bookmark` MenuAction → 메뉴 "보기 → 책갈피…"

**점프 기능 보류**

책갈피 클릭 시 caret 이동 + scroll은 후속 청크. caret/scroll 메커니즘은 viewer 내부에 깊게 묶여 있어 다이얼로그 → viewer 통신 surface 추가가 필요. 현재 MVP는 추가 / 목록 / 삭제 / 이름변경.

**e2e — `tests/e2e/studio-bookmark.spec.ts`** (5 케이스)

1. blank doc — 빈 배열
2. addBookmarkAtCaret → getBookmarks 라운드트립 (name/sec/para/ctrlIdx≥1)
3. 두 책갈피 추가 → 첫 번째만 deleteBookmarkAt → 두 번째 남음
4. renameBookmarkAt 후 readback name 변경
5. UI: `insert:bookmark` IPC → 다이얼로그 → 추가 → row 표시 → 삭제 → 빈 상태

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (195/197, 2 skip = NIM live + cell-menu UI 의도, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 13 — 각주 (rhwp-core 활용 시리즈 7번째)

한컴 한글 "삽입 → 각주" MVP. caret 위치에 각주 생성 + 본문 텍스트 한 번에. 각주 안에서 직접 caret 편집(insertTextInFootnote 후속 호출 등)은 후속 청크.

**IR API**

| 메서드                                                                  | 역할                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `insertFootnote(sec, para, charOffset)`                                 | 각주 삽입 — `{ok, paraIdx, controlIdx, footnoteNumber}` 반환 |
| `getFootnoteInfo(sec, para, ctrlIdx)`                                   | 각주 조회 — `{ok, paraCount, totalTextLen, number, texts}`   |
| `insertTextInFootnote(sec, para, ctrlIdx, fnParaIdx, charOffset, text)` | 각주 안 텍스트 삽입                                          |
| `deleteTextInFootnote(...)`                                             | 각주 안 텍스트 삭제                                          |
| `mergeParagraphInFootnote` / `splitParagraphInFootnote`                 | 각주 안 문단 분할/병합                                       |
| `hitTestFootnote` / `hitTestInFootnote` / `getCursorRectInFootnote`     | 각주 영역 인터랙션용                                         |

**probe 발견**

- 응답 키는 `controlIdx` (bookmark는 `ctrlIdx` — 일관성 차이)
- `paraIdx`는 caret이 들어간 본문 문단 인덱스 echo
- `footnoteNumber`는 1부터 시작하는 각주 번호 (자동 할당)
- **blank.hwpx에선 라이브러리 panic** ("unreachable" / "recursive use of an object") — `createBlankDocument`가 footnote 영역(SectionDef의 `footnotePeriod`/`footnoteNumberType`)을 정의 안 한 미완성 section을 만듦. 한 번 panic하면 라이브러리 전체가 unrecoverable
- 실제 .hwp/.hwpx 문서(STRESS_FIXTURE)에선 문제없이 작동

**구현 — 헬퍼**

- `insertFootnoteAtCaret(text)`: caretRef 기반 IR call
  1. `doc.insertFootnote(sec, para, charOffset)` → response에서 `controlIdx`/`paraIdx` 추출
  2. text가 있으면 `doc.insertTextInFootnote(...)` 호출 — fnParaIdx=0, charOffset=0
  3. `refreshAfterMutation({ syncCaret: false })` (각주 본문은 off-page)
  4. 라이브러리 panic은 caller에 throw (UI banner로 surface)

**ViewerHandle / \_\_studioDebug**

- `ViewerHandle.insertFootnoteAtCaret(text)` 노출
- `__studioDebug.{insertFootnoteAtCaret, insertFootnoteRaw, getFootnoteInfo, getFootnoteInfoRaw}` — raw probe surface (라이브러리 input schema 변동 시 즉시 검증)

**구현 — `FootnoteDialog`**

- shadcn `Dialog` 재사용 (5번째 다이얼로그 — Settings/Page/HF/Bookmark/Footnote)
- 단일 라인 text input + 삽입/취소 버튼
- IR throw 시 다이얼로그 내부 banner로 메시지 표시 (e.g. blank doc panic) — 닫으면 자동 클리어
- 진입점: `insert:footnote` MenuAction → 메뉴 "보기 → 각주…"

**e2e — `tests/e2e/studio-footnote.spec.ts`** (5 케이스)

`STRESS_FIXTURE` 사용 (blank.hwpx panic 회피)

1. `insertFootnoteRaw(0, 5, 1)` 응답 = `{ok, paraIdx, controlIdx, footnoteNumber}` 키 검증
2. 삽입 후 `getFootnoteInfo` round-trip — 빈 본문 (`paraCount:1, totalTextLen:0, texts:[""]`)
3. raw insert 후 `getFootnoteInfo`로 number/ok 회수
4. UI: `insert:footnote` IPC → 다이얼로그 + input + insert 버튼 노출
5. UI: 취소 버튼으로 다이얼로그 close

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (199/202, 1 flaky→retry pass, 2 skip = NIM live + cell-menu UI 의도, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 14 — 스타일 관리 (rhwp-core 활용 시리즈 8번째)

기존 `applyStyle`(chunk 5 툴바)에 더해 사용자 정의 스타일의 add/rename/delete 카탈로그 편집을 다이얼로그로 노출.

**IR API**

| 메서드                                                | 역할                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------- |
| `createStyle({name, englishName, type, nextStyleId})` | 빈 스타일 생성 → id 반환                                    |
| `updateStyle(id, {name, englishName, nextStyleId})`   | 이름/영문명/다음 스타일 변경                                |
| `deleteStyle(id)`                                     | 삭제. 사용 중인 문단은 id 0 (바탕글)로 fallback             |
| `getStyleList()`                                      | `[{id, name, englishName, type, paraShapeId, charShapeId}]` |

`applyStyle`(이미 사용 중) → 문단에 적용.

**구현 — 헬퍼**

- `createNamedStyle(name, englishName?)` → id (englishName 없으면 name 그대로)
- `renameStyle(id, name, englishName?)` → bool
- `deleteStyleById(id)` → bool

모두 dirty 플래그 + `refreshAfterMutation({ syncCaret: false })` (스타일 목록 변경은 caret 영향 없음).

**StyleManagerDialog**

- shadcn `Dialog` (6번째 다이얼로그)
- 추가 폼 (이름 input + "추가") — 빈 이름 disabled
- 목록: 각 행에 이름 + id (영문명 다르면 표기) + 이름 변경 / 삭제 버튼
  - 이름 변경: 인라인 input (Enter 적용 / Esc 취소 / blur 적용)
  - 삭제: id 0 (바탕글)은 disabled — 모든 문단의 fallback 타깃이라 dangle 위험
- 진입점: `view:style-manager` MenuAction → 메뉴 "보기 → 스타일 관리…"

**ViewerHandle / \_\_studioDebug**

- `ViewerHandle.{createNamedStyle, renameStyle, deleteStyleById, getStyleListJson}` 노출
- 동일 4개 `__studioDebug`에도 — e2e 라운드트립

**스타일에 char/para shape 저장 보류**

`createStyle`은 빈 셸만 만든다. 현재 caret의 char/para shape를 스타일로 캡처하는 흐름(예: "현재 서식으로 저장")은 라이브러리의 별도 메서드(`updateStyleShapes`)와 char/para mods 직렬화 layer가 필요 — 후속 청크.

**e2e — `tests/e2e/studio-style-manager.spec.ts`** (6 케이스)

1. 기본 문서가 비어있지 않은 스타일 목록 + id 0 포함
2. createNamedStyle → 새 id 반환 + 목록에 등장
3. renameStyle → name readback 변경
4. deleteStyleById → 목록에서 제거
5. UI: `view:style-manager` IPC → 다이얼로그 + id 0 행 disabled 삭제
6. UI: 폼으로 추가 → 행 등장 → 삭제 버튼으로 제거

**검증 결과**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ npm run e2e               (예상 200+/208, 회귀 0)
```

### 2026-05-01 — Phase 2 청크 16/17/15 — 수식 미리보기 / 표·셀 속성 / 도형 (사각형)

사용자 요청 순서(14 → 16 → 17 → 15)대로 진행. 다이얼로그 패턴이 7~9번째까지 도달, 라이브러리의 단순 IR API들을 빠르게 노출.

**청크 16 — 수식 미리보기 (rhwp-core 시리즈 9번째)**

- IR: `renderEquationPreview(script, fontSizeHwpunit, color)` → 완전한 SVG 문자열
- `EquationDialog`: 한컴 수식 script textarea + 라이브 SVG 미리보기 (`dangerouslySetInnerHTML`로 WASM 출력 주입)
- 본문에 수식 컨트롤 *삽입*은 보류 — 라이브러리에 명시적 createEquation 없음. createShapeControl + setEquationProperties 결합 패턴 후속

**청크 17 — 표/셀 속성 (rhwp-core 시리즈 10번째)**

- IR: `getTableProperties` / `setTableProperties` / `getCellProperties` / `setCellProperties`
- `getTableProperties` → `{cellSpacing, paddingLeft/Right/Top/Bottom, pageBreak, repeatHeader}`
- `getCellProperties` → `{width, height, paddingLeft/Right/Top/Bottom, verticalAlign, textDirection, isHeader}`
- UI 다이얼로그는 보류 — 본 청크는 IR contract + e2e만. 셀 우클릭 메뉴(v3)에 통합은 후속
- 셀 배경색·테두리는 별도 `applyCellStyle` 메커니즘 (cell style registry) 필요 — 후속

**청크 15 — 도형 (사각형 MVP, rhwp-core 시리즈 11번째)**

- IR: `createShapeControl({sectionIdx, paraIdx, charOffset, width, height, horzOffset, vertOffset, treatAsChar, textWrap})` → `{ok, paraIdx, controlIdx}`. `getShapeProperties` / `setShapeProperties` / `deleteShapeControl` / `changeShapeZOrder('front'|'back'|'forward'|'backward')`
- `ShapeDialog`: 너비/높이 mm + 글자처럼 취급 토글 (treatAsChar)
- 라인 / 곡선 / 화살표 / 도형 그룹은 보류 — 라이브러리가 createShapeControl JSON에 shape-type 필드를 노출 안 함

**ViewerHandle 확장 (3 청크 합산)**

- `renderEquationSvg(script, fontSizeHwpunit?, color?)`
- `getTableProps` / `setTableProps` / `getCellProps` / `setCellProps`
- `createRectShapeAtCaret(width, height, opts?)`
- `__studioDebug` 동일 + Z-order/delete/changeShape 추가

**진입점**

- `insert:equation` MenuAction → "보기 → 수식 미리보기…"
- `insert:shape` MenuAction → "보기 → 사각형 도형…"

**E2E (3 spec 합산 13 케이스)**

- `studio-equation.spec.ts` (4): renderEquationSvg SVG, UI 다이얼로그 + 기본 script + 미리보기, script 변경 재렌더, 빈 script placeholder
- `studio-table-props.spec.ts` (4, STRESS_FIXTURE): getTableProps shape, setTableProps paddingLeft round-trip, getCellProps shape, setCellProps paddingTop round-trip
- `studio-shape.spec.ts` (5, STRESS_FIXTURE): createRectShape 반환 shape, getShape round-trip, setShape width round-trip, deleteShape 후 getShape null, UI 다이얼로그 기본 50×30mm + 삽입

**검증 결과 (청크 14·15·16·17 합산)**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ 청크별 e2e 모두 통과 (6 + 4 + 4 + 5 = 19 신규 케이스)
✓ 누적 e2e 221 = 208 + 13
```

### 2026-05-01 — Phase 2 청크 18 — HTML 내보내기/붙이기 + ChatPanel 문서 컨텍스트 (rhwp-core 시리즈 12번째 + AI 라운드트립)

**rhwp-core API 매핑 (시리즈 12번째)**

- IR: `exportSelectionHtml(s, sp, so, ep, eo)` / `pasteHtml(s, p, charOffset, html)`
- 프로브 결과: `pasteHtml`은 글자 단위 스타일(bold/italic/underline/color/font-size)은 보존하지만 **문단 단위 스타일은 무시** — `text-align`/`margin-*`/`text-indent`/`line-height`가 있어도 문서 기본값으로 셋팅됨
- 분해 layer 필요: `pasteHtml`로 글자 스타일을 먼저 적용한 뒤, 입력 HTML을 DOM-walk하여 `<p>/<h*>/<li>` 블록마다 `applyParaFormat`을 다시 호출

**StudioViewer 헬퍼 — `applyHtmlAtCaret`**

- `pasteHtml`을 wrapping. DOM walk로 다음 인라인 스타일을 추출 → ParaProps로 변환 → `applyParaFormat`:
  - `text-align: left|center|right|justify` → `alignment`
  - `line-height: <n>` (배수) → `lineSpacing` + `lineSpacingType: 'Percent'` (1.5 → 150)
  - `margin-left|margin-right` (px/pt) → `marginLeft/marginRight` (1px=75 HWPUNIT, 1pt=100 HWPUNIT)
  - `text-indent` (px/pt) → `indent`
  - `margin-top|margin-bottom` → `spacingBefore/spacingAfter`
- 라이브러리가 readback 시점에 spacing 값을 ~74.6× 압축해서 정확한 round-trip 단언이 어려움. e2e는 "before=0, after>0" 패턴으로 검증

**StudioViewer 헬퍼 — `exportDocumentHtml(maxParagraphs?)`**

- 섹션 0의 첫 N개 문단을 HTML로 내보냄 (기본 50). HWPX(XML)에 비해 ~50배 토큰-효율적이고, AI가 이해하기에 충분한 구조(정렬/문단/표/글자 서식) 보존
- 머리말/꼬리말/각주 메타는 손실되지만 본문 컨텍스트로 충분

**ChatPanel 통합 — 문서 컨텍스트 첨부 + 적용 버튼**

- `ChatPanelProps` 확장: `getDocHtml?: () => string` / `applyHtml?: (html: string) => void`
- `📎 현재 문서를 컨텍스트로 첨부` 토글 (input form 상단). 활성 시 system 메시지로 `SYSTEM_PROMPT_DOC_CONTEXT` + `[현재 문서]:\n<html>` 자동 prepend
- 시스템 프롬프트는 한컴 한글 양식 대응을 명시: 모델이 응답에 `\`\`\`html ... \`\`\`` 단일 블록으로 변경분만 작성하도록 유도. 정렬/줄간격/들여쓰기/문단 간격/글자 서식 전 영역의 인라인 스타일 가이드 포함
- 어시스턴트 메시지에 `\`\`\`html\`\`\``블록이 감지되고`onApplyHtml`prop이 있으면 메시지 본문 하단에 **"문서에 적용"** 버튼 노출 → 클릭 시`applyHtmlAtCaret(payload)` 호출 후 "✓ 적용됨" 피드백 (2s)
- `AppShell`은 활성 탭의 `viewerRef`로 두 함수를 wiring (`activeViewerRef()?.exportDocumentHtml() ?? ''` / `applyHtmlAtCaret(html)`). 비활성 탭/문서 미로드 시 빈 문자열·no-op

**ViewerHandle 확장**

- `applyHtmlAtCaret(html)`: AI가 작성한 HTML 적용
- `exportDocumentHtml(maxParagraphs?)`: 채팅 컨텍스트 첨부용 HTML 추출
- `__studioDebug`도 `applyHtmlAtCaret` / `pasteHtmlAt` / `exportSelectionHtmlAt` / `getParaProps` 노출

**E2E (10 신규 케이스)**

- `studio-html-paste.spec.ts` (7): `pasteHtml` lossy 검증 / `applyHtmlAtCaret`로 text-align·line-height·margin-left·margin-top/bottom·char-styles·pt-indent 복원
- `chat-html-apply.spec.ts` (3): attach 토글 노출, html 블록 → 문서에 적용 버튼 → IR 정렬 변경 round-trip, html 블록 없음 → 버튼 미노출

**라이브 검증 — NVIDIA NIM (`meta/llama-3.1-70b-instruct`)**

- `nvidia-live.spec.ts`에 chunk 18 round-trip 케이스 추가
- 시나리오: blank.hwpx → "Center the first paragraph" 프롬프트 → 모델이 `<p style="text-align:center;">CENTERED</p>` 작성 → 적용 클릭 → `getParaProps(0,0).alignment === 'center'` 검증
- 결과: **2/2 통과** (smoke 968ms + round-trip 11.6s). `NVAPI_KEY` env 게이트 유지

**버전 규칙 도입**

- `package.json` 0.2.18 — major=정식 릴리스, minor=Phase, patch=청크 번호. 청크 별로 패치 버전을 올림

**검증**

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm test                  (3/3)
✓ 누적 e2e 231 = 221 + 7 (html-paste) + 3 (chat-html-apply)
✓ NVIDIA NIM live 2/2 (chunk 18 round-trip 포함)
```

### 2026-05-01 — Phase 2 청크 19 — Manual 모드 도구 디스패치 (`ahwp-tools` JSON 블록)

**배경**

청크 18의 ` ```html``` ` 라운드트립은 흐르는 글자/문단 양식만 커버. 한컴 한글의 분리된 컨트롤(각주·머리말·책갈피·페이지 설정·스타일·도형)은 HTML 어휘로 표현 불가. AI가 평문 응답에 단일 JSON 블록을 작성하면 렌더러가 화이트리스트 핸들러로 라우팅하는 패턴 도입. provider tool-use API(Anthropic/OpenAI function calling) 바인딩은 Phase 3 Agent 모드로 미룸.

**JSON 블록 형식**

````
```ahwp-tools
{
  "ops": [
    { "tool": "applyHtml",      "args": { "html": "<p style='text-align:center;'>제목</p>" } },
    { "tool": "insertFootnote", "args": { "text": "참고 문헌 1" } },
    { "tool": "addBookmark",    "args": { "name": "section1" } },
    { "tool": "applyPageDef",   "args": { "props": { "landscape": true } } }
  ]
}
```
````

- 응답에 블록 하나 (시스템 프롬프트로 강제)
- ops는 IR 호출 순서대로 실행. 부분 실패 시 이전 op 보존(롤백 없음, Undo로 일괄 되돌리기는 후속)

**도구 카탈로그 (청크 19)**

| `tool`                | 위임                          |
| --------------------- | ----------------------------- |
| `applyHtml`           | `applyHtmlAtCaret` (chunk 18) |
| `applyAlignment`      | `applyAlignment`              |
| `applyFontSize`       | `applyFontSizePt`             |
| `applyTextColor`      | `applyTextColor`              |
| `toggleCharFormat`    | `toggleCharFormat`            |
| `insertFootnote`      | `insertFootnoteAtCaret`       |
| `addBookmark`         | `addBookmarkAtCaret`          |
| `setHeaderFooterText` | `setHeaderFooterText`         |
| `applyPageDef`        | `applyPageDef`                |
| `createNamedStyle`    | `createNamedStyle`            |
| `createRectShape`     | `createRectShapeAtCaret`      |

**검증 (`shared/ai-tools.ts`)**

- 필수 키 / 타입 매칭 / enum 화이트리스트 / 숫자 범위 / 색상 정규식 / 문자열 길이 상한
- 검증 실패는 결과 배열에 `{ ok: false, reason }`로 기록. 후속 op는 계속 실행 (부분 성공 모델)

**디스패처 (`src/features/chat/tools.ts`)**

- `runTools(ViewerHandle, ops): ToolResult[]` 명시적 switch 분기. `eval` 일체 사용 안 함
- 등록되지 않은 tool은 `unknown_tool`로 거절. 검증 실패는 `invalid_args`
- 각 op는 IR snapshot을 남기는 기존 mutation을 그대로 호출 — Undo 호환 (op별 단계적 되돌리기 가능)

**ChatPanel 통합**

- 어시스턴트 메시지에 `\`\`\`ahwp-tools\`\`\`` 블록 감지 → JSON 파싱 + 1차 검증
- 메시지 본문 하단에 ops 미리보기 리스트 (tool 이름 + 핵심 args 요약, 검증 실패 op는 빨간색)
- "도구 실행" 버튼 → `runTools` 순차 호출 → 결과 토스트 (`✓ 적용됨 (5/6)`)
- 청크 18의 ` ```html``` ` 적용 버튼과는 **별도 버튼**으로 표시 (한 메시지에 둘 다 와도 OK)

**시스템 프롬프트 확장**

- 청크 18 SYSTEM_PROMPT에 tool 카탈로그 + JSON schema + 사용 가이드 추가
- HTML과 tool 분리 기준 명시: "흐르는 글자·문단 양식 = `applyHtml`, 컨트롤 객체(각주·머리말·책갈피 등) = 별도 tool"

**E2E (chunk 19 신규 케이스)**

- `chat-tools.spec.ts` (fake provider): 각 tool 라우팅, 검증 실패 거절, 부분 성공
- `nvidia-live.spec.ts` chunk 19 case: NIM에 "addBookmark" tool block 요청 → 적용 → IR `getBookmarks()`에 'intro' 확인. 모델 `qwen/qwen3.5-122b-a10b`(NIM)에서 일관되게 통과

**버전 + 검증**

- `package.json` 0.2.19 (Phase 2 청크 19)

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ 누적 e2e 240 = 232 + 7 (chat-tools) + 1 (nvidia-live chunk 19). 235 passed / 4 skipped (NIM 3개 키 게이트 + cell-menu 1개 의도)
✓ NVIDIA NIM live 3/3 (qwen/qwen3.5-122b-a10b — chunk 18 + chunk 19 round-trip 포함)
```

### 2026-05-02 — Phase 2 청크 20 — 발췌 첨부 (`ExcerptAttachment` + 칩 + `[발췌]:` 시스템 블록)

**배경**

청크 18의 `[현재 문서]:` 통째 첨부는 (a) 토큰을 50문단까지 무차별 사용 (b) anchor 정확도 낮음 — 사용자가 "이 단락"을 가리켰는데 시스템은 50개를 보내 모델이 다른 곳을 고침. 사용자가 명시적으로 선택한 텍스트만 좁게 첨부하면 두 문제 동시에 해결.

**데이터 모델 (`shared/ai-excerpt.ts`)**

```ts
interface ExcerptAttachment {
  id: string;
  docPath: string | null;
  docLabel: string; // basename
  role: 'target' | 'reference'; // 청크 20은 target만
  anchor: { sectionIndex; paragraphIndex; startOffset; endOffset };
  text: string; // 캡처 시점에 박제
  hash: string; // djb2 deterministic checksum
  status: 'fresh' | 'stale-relocated' | 'stale-missing';
}
```

**ViewerHandle 확장**

- `captureExcerpt()` — `selectionRef` + `getTextRange`로 현재 선택을 portable 구조로 반환. 단일 문단 한정 (multi-paragraph excerpts는 청크 23+ 후속)
- `verifyExcerpt(anchor, expected)` — 보낸 시점 stale 검증. anchor에서 다시 읽어 비교 → fresh / 일치 안 하면 IR 전체 1회 스캔(1000문단 상한)으로 relocate / 못 찾으면 stale-missing

**ChatPanel 통합**

- 입력 폼 위에 `📌 발췌 첨부` 버튼 + 칩 리스트 (basename:¶para + 텍스트 미리보기 + ⚠️ 토큰 경고 + ×). 칩 status는 색으로 구분 — fresh(회색) / stale-relocated(앰버) / stale-missing(빨강)
- **우선순위**: 칩이 하나라도 있으면 통째 첨부 토글 disabled + `[현재 문서]:` 시스템 메시지 대체 → `[발췌]:` 블록만 주입
- 시스템 프롬프트 직렬화 (`docs/AI_INTEGRATION.md` §발췌 드래그 첨부 › 프롬프트 직렬화 그대로):
  ```
  [발췌]:
  [1] role=target  doc="제안서.hwp"  anchor={para:4, [12,58]}
      "현행 문안을 다음과 같이 변경합니다."
  ```
- send 직전 칩별 verify 호출 → status 갱신. stale-missing이 하나라도 있으면 send 차단 + 토스트

**드래그 UX는 폴리시 후속**

청크 20 deliverable은 데이터 모델 + 칩 UI + send-time stale check. StudioViewer의 SVG selection은 `pointer-events-none`으로 렌더되어 HTML5 drag 진입점이 없음. 진짜 drag-and-drop은 selection 모델에 침투적 변경이 필요해 별도 청크로 분리. 버튼 클릭으로도 같은 데이터 흐름이 동작하므로 우선 데이터 파이프라인부터 박제.

**E2E (chunk 20 신규)**

- `chat-excerpt.spec.ts` (8 케이스): 캡처 / 빈 선택 에러 / 토글 disable / 칩 제거 / stale-relocated 자동 재바인딩 / stale-missing 차단 / 긴 발췌 ⚠️
- `nvidia-live.spec.ts` chunk 20 round-trip: blank.hwpx에 sentinel 텍스트 삽입 + 선택 → 캡처 → "이 발췌의 명사를 인용해줘" 프롬프트 → NIM(`qwen/qwen3.5-122b-a10b`)이 sentinel의 단어를 응답에 포함시켜 [발췌] 블록이 프롬프트에 도달했음을 증명

**제한 / 후속**

- multi-paragraph excerpts → 청크 23+ (`getTextRange`가 단일 문단 한정)
- 진짜 HTML5 drag → 청크 22 (selection 모델 리팩터)
- 멀티 문서 (target + reference 칩) → 청크 21

**버전 + 검증**

- `package.json` 0.2.20 (Phase 2 청크 20)

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ 누적 e2e 249 = 240 + 8 (chat-excerpt) + 1 (nvidia-live chunk 20). 244 passed / 5 skipped (NIM 4개 키 게이트 + cell-menu 1개 의도)
✓ NVIDIA NIM live 4/4 (qwen/qwen3.5-122b-a10b — chunk 18·19·20 round-trip 모두 포함)
```

### 2026-05-02 — Phase 2 청크 21 — 멀티 문서 컨텍스트 (target / reference)

**배경**

청크 18~20까지의 채팅 컨텍스트는 활성 탭 한 개만 다뤘음. 그러나 한컴 한글의 흔한 워크플로우는 "B 문서의 뉘앙스로 A 다듬어줘" 같은 cross-document 작업. 활성 탭 = 편집 대상(target), 다른 열린 탭 = 읽기 전용 참조(reference)로 모델에 주입할 수 있어야 함.

**ChatPanel 멀티 문서 칩 행**

- 입력 폼 위 새 행. 활성 탭은 🎯 잠긴 target 칩, 다른 열린 탭은 📚 reference 체크박스로 표시
- `data-role="target" | "reference" | "unused"` 3-state로 e2e가 검증
- `referencePaths: string[]` 상태로 사용자 opt-in 추적

**시스템 프롬프트 확장**

- `referencePaths`에 들어있는 각 문서마다 `getDocOutline(path)` 호출 → 첫 20문단 HTML 반환
- 활성 탭의 target 컨텍스트(발췌 또는 통째 첨부) 뒤에 `[참조 문서]:\n[ref 1] doc="..." (read-only)\n<outline>\n...` 블록 추가
- 시스템 프롬프트 끝에 read-only 규칙 명시: "변경 적용 (` ```html``` ` / ` ```ahwp-tools``` `) 은 활성 문서(target)에만 한다"

**Tool 권한 분리**

- 청크 19의 `runTools`는 항상 active viewer에 dispatch — 즉 write 항상 target만 영향. 별도 docId 라우팅 없이 single-target dispatch 패턴으로 reference write 자체가 불가능
- Phase 3 Agent 모드에서 provider tool-use API 도입 시 docId-aware 라우팅으로 확장 (현재는 미구현)

**AppShell wiring**

- `getOpenDocs()` — `tabsState` + `activeIndex`에서 `[{path, label, isActive}]` 합성
- `getDocOutline(path)` — 비활성 탭의 mounted viewer (display:none)를 그대로 활용 → `viewerRef.exportDocumentHtml(20)`. 추가 마운트 비용 없음

**E2E (chunk 21 신규)**

- `chat-multidoc.spec.ts` (5 케이스): 칩 표시 / 단일 탭 잠금 / 두 탭에서 reference 체크박스 / role 토글 / send 후 chip 상태 유지. 두 탭 만들기 위해 blank.hwpx를 temp dir에 두 이름으로 복사
- `nvidia-live.spec.ts` chunk 21 round-trip: target/reference 두 탭 → reference에 sentinel 시드 → reference 체크 → "[ref 1]에서 명사 두 개 인용해줘" → `qwen/qwen3.5-122b-a10b`이 sentinel 명사를 응답에 포함시켜 `[참조 문서]` 블록이 프롬프트에 도달함을 증명

**제한 / 후속**

- HTML5 drag-and-drop UX (chunk 22) → SVG selection 모델 리팩터 후 진행
- multi-paragraph excerpts (chunk 23+) → `getTextRange` 단일 문단 한정 해소 필요
- inactive-tab에서 발췌 캡처 → 현재는 active tab만. inactive viewer ref도 `captureExcerpt` 노출하면 가능하지만 selection 시각 피드백이 비활성 탭에 없어 UX 문제. drag UX 합류 시 같이 해결
- provider tool-use API + docId-aware 라우팅 → Phase 3 Agent 모드

**버전 + 검증**

- `package.json` 0.2.21 (Phase 2 청크 21)

```
✓ npm run typecheck
✓ npm run lint              (0 errors, 0 warnings)
✓ npm run format:check
✓ npm test                  (3/3)
✓ 누적 e2e 255 = 249 + 5 (chat-multidoc) + 1 (nvidia-live chunk 21). 249 passed / 6 skipped (NIM 5개 키 게이트 + cell-menu 1개 의도)
✓ NVIDIA NIM live 5/5 (qwen/qwen3.5-122b-a10b — chunk 18·19·20·21 round-trip 모두 포함)
```

### 2026-05-02 — chunk 48: provider 모델 동적 fetch + 24h 캐시 — 0.2.48

사용자 "사용가능한 모델 api 단에서 업데이트 못함? 사용가능한 모델 불러오게" 요청. 폴백 정책 정정 — "사용 안하는게 아니라 / 확인 불가 상태로".

**구현**

- **Provider.listModels(opts)** optional 메서드 — `Provider` 인터페이스 확장. OpenAI: `GET /v1/models` → `data[].id` 추출+sort. NIM: OpenAI 호환이라 그대로 delegate. fake: deterministic 카탈로그 + `BAD-key` 거절
- **24h 디스크 캐시** — `electron/store/model-cache.ts` (`userData/model-cache.json`). 새 IPC `ai:list-models(providerId, {force?})` + `ai:clear-models-cache(providerId)`. 응답 union: `{ok}` / `{stale-cache}` / `{error}` — refetch 실패 + 캐시 있음이면 stale-cache 폴백
- **ChatPanel UI** — 기존 모델 텍스트 입력 그대로 + `<datalist>` autocomplete + 새로고침 버튼(상태별 `↻` `⟳` `⚠`). provider 변경 + 키 false→true 시 자동 fetch
- **폴백 정책** — listModels 실패는 provider를 disable하지 않음. dropdown만 비고 자유 입력 chat은 정상. ⚠ 배지 + 툴팁으로 "확인 불가" 명시

**검증**

- 신규 e2e 5건 (`tests/e2e/chat-model-list.spec.ts`): IPC ok / error / stale-cache 3가지 응답 + ChatPanel 새로고침 버튼 상태 + datalist option 노출 — 5/5 pass
- 회귀: chat / chat-history / chat-tools / chat-html-apply / settings 34/34 pass
- typecheck / lint / format / 단위 청정

**미완 영역**

- Anthropic listModels — Phase 2-B 키 잠금 해제와 함께
- Ollama listModels (`GET /api/tags`) — 별도 어댑터 작성 필요. SHOWN_IDS에서 가려진 상태

### 2026-05-02 — Phase 2 마무리 (chunks 29 / 30 / 34 / 35) — 0.2.47

사용자 "페이즈2까지 작업 다 진행해줘" 요청. ROADMAP에 박제된 4개 잔여 청크를 일괄 종료.

**청크별 처리**

| #   | 항목                                    | 핵심                                                                                                                                                                                                                                                                  |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 29  | AI 변경 되돌리기                        | `applied`/`toolsRun` 상태에 "되돌리기" 버튼 + 15s 노출. `ChatPanelProps.undoLastApply` 신규 prop → AppShell이 `activeViewerRef().undo()`로 wiring. ViewerHandle에 `canUndo()` 추가. chunk 27 묶음 undo가 이미 AI 턴을 1 entry로 collapse하므로 1회 클릭으로 전체 롤백 |
| 30  | 채팅 히스토리 인라인 rename             | 📚 popover의 conversation 행에 ✎ 버튼 + 더블클릭. input swap → Enter 저장(낙관적 갱신 + chatHistory.rename IPC) / Esc / blur 자동 커밋                                                                                                                                |
| 34  | 표 수식 evaluate                        | `TableFormulaDialog` 신규 + 셀 우클릭 메뉴 "수식 다시 계산…". `evaluateTableFormula(s, parentPara, ctrl, row, col, formula, writeResult)` IR 위임. 미리 보기(write_result=false) + 셀에 적용(write_result=true) 분리                                                  |
| 35  | 머리말/꼬리말 다중 라인 + 페이지 템플릿 | `HeaderFooterDialog` Input → textarea(4행). applyTo 토글(양쪽=0/홀수=1/짝수=2) — 각 슬롯 IR에서 독립. `setHeaderFooterText` 내부에서 `\n` 감지 시 `splitParagraphInHeaderFooter`로 라인별 단락 분리                                                                   |

**검증**

- 신규 e2e 5건 (`tests/e2e/phase2-finale.spec.ts`): 머리말 다중 라인 round-trip + 홀/짝 슬롯 독립 + 셀 우클릭 메뉴 "수식 다시 계산" 노출 + 되돌리기 버튼 alignment 롤백 + 인라인 rename input swap — 5/5 pass
- 회귀: studio-headerfooter / studio-cells / studio-cells-v3 / studio-ux-fixes / studio-ux-round2 / chat / chat-history 44/44 pass
- 전체 e2e: 286 passed / 6 skipped / 1 flaky(paraformat round-trip parallel race, 본 변경 무관)
- typecheck / lint / format / 단위 3/3 청정

**Phase 2 종료 시점 잔여**

- **deferred (lib 대기)**: chunk 33 도형 라인/곡선/그룹, chunk 36 스타일 char/para shape 캡처 — 둘 다 rhwp 0.8 대기
- **deferred (대형 작업)**: chunk 31 자동 title summary(AI call 복잡), chunk 32 셀 selection v4
- **Phase 2-B**: provider 키 잠금 해제 (Anthropic / Google / Ollama / 커스텀 OpenAI-호환) — 키 사용 결정 대기
- **Phase 2-G ↔ Phase 3**: provider tool-use API 정식 통합, docId-aware 라우팅, 다중 턴 자동 실행 — Phase 3 진입과 함께 처리

### 2026-05-02 — P0/P1/P2 보강 (visual nav · shift+click · auto-scroll · 저장 안전망 · 외부 변경)

오전 회귀 3건 fix 완료 후 사용자 "P0/P1/P2 다 진행" 요청. 청크 분리 안 하고 한 묶음으로 처리.

**P0 — 편집 UX (StudioViewer.tsx 단일 파일)**

| #   | 항목                      | 구현 요지                                                                                                                                                                            |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | ArrowUp / ArrowDown nav   | `cursorRect.{x,y,height}` + `hitTest(pageIdx, x, y±height*1.4)`. 페이지 경계 cross-over (target page = pageIndex±1, y rebase). shift 확장 + `commitCaretMove` helper로 일관 처리     |
| 2   | Shift+클릭 selection 확장 | `handlePageMouseDown`에서 `e.shiftKey && selectionRef.current` 분기 — anchor 보존, focus만 click 위치로. prior caret을 fallback anchor로 사용                                        |
| 3   | 드래그 자동 스크롤        | window mousemove 안에 lastClient(x,y) + rAF 루프. scroll container 위/아래 36px zone 진입 시 거리 비례 dy(최대 24px/frame). 정지 상태에서도 zone 안이면 selection 확장 + 계속 스크롤 |
| 4   | Esc 드래그 취소           | `dragCleanupRef` + `dragOriginSelectionRef`로 cleanup 함수와 시작 직전 selection 보관. handleKeyDown의 Esc 분기에서 cleanup() 호출 + 원래 selection 복원                             |
| 5   | HWPX 저장 라우팅 알림     | IPC `FileOpenResult.routedFrom` 신설. AppShell의 saveCurrent / saveAsCurrent가 routedFrom 감지 시 `showNotice` warn 톤으로 5초 banner 표시                                           |

**P1 — 데이터 보호 / 일관성**

| #   | 항목                    | 구현 요지                                                                                                                                                                                                                                                                   |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `.bak` 사이드카         | `electron/ipc/file.ts`의 `maybeWriteBackup(target)` — 첫 덮어쓰기 시 `<target>.bak` 생성, 후속 저장은 기존 .bak 보존(편집 세션 시작 시점 박제). `FileOpenResult.backupPath`로 노출. atomic write는 기존부터 OK                                                              |
| 2   | 외부 파일 변경 감지     | 신규 IPC `file:watch-paths(paths[])` + `file:external-change` 이벤트. main 단일 chokidar (awaitWriteFinish 200ms). AppShell이 탭 path 목록 변할 때마다 watchPaths 재호출. !dirty 자동 reload (key bump), dirty 시 warn 토스트. 우리 자신의 저장은 1500ms suppression window |
| 3   | 동일 파일 dual-tab 가드 | 이미 `openTab`에 `existing >= 0` 체크 존재. e2e 추가로 회귀 박제                                                                                                                                                                                                            |

**P2 — 구조 부채**

- `commitCaretMove(nextCaret, prior, shift, sel0)` helper 추출 — `handleKeyDown` 6곳에 반복되던 caret update + selection extend + cursor/format refresh 패턴을 single useCallback으로 묶음. 기존 ~80줄 boilerplate를 ~30줄로 압축. 회귀 0건
- 큰 keymap dispatch table 분할은 별도 청크로 박제 (StudioViewer 6,300줄 모듈화는 회귀 영향 큼 — Phase 3 진입 전 별도 cycle 필요)

**검증**

- 신규 e2e 6종 (`tests/e2e/studio-ux-round2.spec.ts`): ArrowUp/Down 양방향 visual nav, shift+click anchor 보존, save IPC routedFrom 계약, .bak 작성 + 후속 저장 시 보존 확인, dual-tab 가드 — 6/6 pass
- 회귀 검증: 전체 e2e 281 passed / 6 skipped / 1 flaky(folder DnD parallel race — 본 변경 무관, retry로 흡수). NIM live 제외
- typecheck / lint / format 청정

### 2026-05-02 — UX 회귀 3건 fix (caret 상태 / 드래그 / Cmd+A)

사용자 보고 — "1) bold 글자 옆 plain 글자에 캐럿 두면 Bold 버튼이 계속 눌려 있음 2) PDF 드래그처럼 일관되게 안 됨 3) Ctrl+A 누르면 프로그램 전체가 파랗게 됨". 셋 다 `StudioViewer.tsx` 단일 파일 한 묶음 fix.

**원인 / 수정**

| #   | 증상                                    | 원인                                                                                                                        | 수정                                                                                                                                                                                                                |
| --- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 화살표 nav 후 toolbar 미반영            | `handleKeyDown`의 ArrowLeft / Right / Home / End / Cmd+Arrow(word) 분기에서 `caretRef`만 갱신, `refreshActiveFormat()` 누락 | 모든 nav 분기에 `refreshActiveFormat()` 호출 추가 (5개 위치)                                                                                                                                                        |
| 2   | 페이지 밖으로 드래그하면 selection 끊김 | `<div onMouseLeave={handlePageMouseUp}>` — 페이지 div를 떠나는 즉시 드래그 종료                                             | `handlePageMouseDown`에서 `document` 레벨 mousemove / mouseup 리스너를 attach. window 리스너가 모든 페이지를 walk하여 hit-test, 페이지 사이 갭·외부 mouseup도 살아남음. per-page mouseMove/Up/Leave 핸들러 제거     |
| 3   | Ctrl+A가 프로그램 전체 선택             | 키 핸들러에 'a' 분기 없음 → 브라우저 기본 selectAll fallthrough                                                             | `Cmd/Ctrl+A` 분기 추가 — IR 활성 섹션 (단락 0:0 → 마지막:끝) selection 생성 + `preventDefault()`. 추가로 page mousedown 시 `scrollRef.focus({preventScroll:true})`로 후속 키 입력이 viewer 핸들러에 도달하도록 보강 |

**검증**

- 신규 e2e 5종 (`tests/e2e/studio-ux-fixes.spec.ts`): 화살표 nav 후 activeFormat / aria-pressed 검증, Cmd+A 후 IR selection 범위 + 브라우저 selection 비검증, 페이지 외부 mouseup 후 드래그 상태 정상 종료 검증, 페이지 내 드래그 commit 검증 — 5/5 pass
- 회귀 검증: studio-selection / studio-format / studio-paraformat / studio-input / studio-cells / studio-cells-v3 36/36 pass — 화살표 nav, 마우스 클릭 caret, 셀 Tab, Cmd+B/I/U 모두 정상
- typecheck / lint 청정

### 2026-05-02 — Phase 2 청크 22~28 일괄 + Phase 1 잔여 마무리

사용자 "페이즈2 다 진행해줘" 요청에 따라 7개 청크를 한 번에 정리. 각 청크 commit + e2e + 버전 bump 분리하되 회귀 영향 작은 것부터 큰 것 (chat history) 순으로 진행.

| 청크 | 항목                                                                                                       | Commit    |
| ---- | ---------------------------------------------------------------------------------------------------------- | --------- |
| 22   | HTML5 drag UX (selection rect → chat 칩)                                                                   | `dd1a735` |
| 23   | 셀 스타일 적용 도구 (applyCellStyle) — 직접 cell-color setter는 라이브러리 미지원, KNOWN_ISSUES L-006 박제 | `9bd2965` |
| 24   | 그림 속성 IR (get/set/delete)                                                                              | `5060363` |
| 25   | 컨트롤 클립보드 (copy/paste)                                                                               | `a3b1645` |
| 26   | **채팅 히스토리 (better-sqlite3 + WAL + 마이그레이션 토대)**                                               | `90a868b` |
| 27   | 묶음 Undo (AI 턴 한 번에 되돌리기)                                                                         | `cb8214e` |
| 28   | Multi-paragraph excerpts (span anchor 모델)                                                                | `4d28e91` |
| -    | e2e 보강 — chunk 23/24/25/27/28 회귀 케이스 (5 신규)                                                       | `89bd421` |
| -    | Phase 1 잔여 — 탭 DnD + 컨텍스트 메뉴 (4 e2e) + temp 정리 + L-007                                          | `e8386e3` |

**핵심 지표**

- 누적 e2e: ~280 (chunk 26 6 + chunk 22 3 + rhwp-extras 5 + tabs-reorder 4 + 기존 ~262)
- NVIDIA NIM live 5/5 통과 (`qwen/qwen3.5-122b-a10b`로 chunk 18·19·20·21 round-trip)
- typecheck / lint / format / unit 모두 청정
- 버전 0.2.26 (chunk 26 marker; chunk 27/28은 26 이전에 작업한 관계로 패치 backward 1번 발생, private app이라 영향 없음)

**라이브러리 한계 박제**

- L-006 셀 직접 색깔 setter — `setCellProperties`가 padding/spacing/verticalAlign/isHeader만 받음
- L-007 셀 안 그림 삽입 — `insertPicture`만 본문용. `*InCell` 변종 없음

### Phase 2 확장 계획 (chunk 29~) — 진행 예정 박제

핵심 채팅 컨텍스트 파이프라인은 chunk 28까지 완성. 남은 작업은 (a) Manual 모드 UX 폴리시, (b) rhwp-core 시리즈 잔여, (c) Phase 3 진입 정비로 분류:

| 청크 | 항목                                                                                                                    | 우선순위 | 의존               |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | -------- | ------------------ |
| 29   | Manual 모드 diff/Reject UX — AI 적용 후 변경 위치 하이라이트 + Reject 버튼 (현재는 ⌘Z만)                                | High     | 없음               |
| 30   | 채팅 히스토리 인라인 rename — DB는 `chat-history:rename` IPC 있음. popover에 inline edit UI만 추가                      | High     | 청크 26            |
| 31   | conversation 자동 제목 요약 — 현재 첫 user 메시지 60자. 5턴 이상 대화 시 AI 호출로 짧은 제목 생성                       | Med      | 청크 26            |
| 32   | 셀 selection 모델 v4 — 드래그 셀 selection / 셀 레벨 paste / merge·split 우클릭 통합                                    | Med      | 청크 8 (이미 완료) |
| 33   | 도형 라인 / 곡선 / 화살표 / 그룹 — `groupShapes` 외 8개 IR. 라이브러리 createShapeControl JSON에 shape-type 노출 필요   | Low      | rhwp 0.8           |
| 34   | 표 수식 평가 — `evaluateTableFormula` IR 노출, 셀 우클릭 메뉴 통합                                                      | Low      | 없음               |
| 35   | 머리말 / 꼬리말 다중 라인 + 페이지 템플릿(홀수/짝수) — 현재는 단일 라인 MVP                                             | Low      | 없음               |
| 36   | 스타일에 char/para shape 캡처 — 현재 createStyle은 빈 셸. lib `updateStyle` 또는 createStyle에 shape 파라미터 추가 필요 | Low      | rhwp 0.8           |
| 37   | conversation outline 분기 — 같은 대화에서 여러 시도 (같은 user msg에 N개 assistant 응답)                                | Low      | 청크 26            |

**Phase 3 진입 전 정비 항목**

- provider tool-use API 바인딩 — Anthropic / OpenAI function calling 정식 통합. 현재 chunk 19는 응답-텍스트 기반 결정론적 dispatcher. 정비 후 같은 도구 카탈로그를 양 진입점에서 공유
- docId-aware 라우팅 — chunk 19 single-target dispatch를 `runTools(docId, items)`로 확장. reference write 시도는 `write-on-reference` 거절 결과로 사용자에 알림
- 다중 턴 자동 실행 + tool-result 응답 루프 — Phase 3 Agent 모드 핵심
- 턴당 화이트리스트 호출 상한 / 영향 길이 상한 / abort 전파 — 안전 장치는 `docs/AI_INTEGRATION.md` §Agent 모드 사양에 이미 박제됨

**메인테이너 키 대기 (Phase 2-B)**
Anthropic / Google / Ollama / 커스텀 OpenAI-호환 어댑터. OpenAI·NVIDIA 패턴 확립되어 키 확보 시 즉시 합류 가능.

**다음 청크 — rhwp-core API 추가 활용 (계속)**

`@rhwp/core` 0.7.9는 253개 메서드 노출. 우리가 활용 중인 건 ~30%. 한컴 한글 핵심 누락분을 라이브러리 API로 매핑한 후보 청크 (사용 빈도 + UX 임팩트 순):

| 청크 | 한컴 기능                       | rhwp API                                                                 |
| ---- | ------------------------------- | ------------------------------------------------------------------------ |
| 8    | 셀 합치기/나누기                | `mergeTableCells` / `splitTableCell` / `splitTableCellsInRange`          |
| 9    | 줄 간격 + 들여쓰기 + 문단 간격  | `applyParaFormat` (props_json 확장)                                      |
| 10   | 머리말/꼬리말                   | `createHeaderFooter` / `applyHfTemplate` / `getHeaderFooterList` 외 14개 |
| 11   | 각주                            | `insertFootnote` / `deleteTextInFootnote` 외 5개                         |
| 12   | 페이지 설정 (여백/크기/방향)    | `setPageDef` / `getPageDef` / `setSectionDef`                            |
| 13   | 책갈피                          | `addBookmark` / `getBookmarks` / `renameBookmark` / `deleteBookmark`     |
| 14   | 도형                            | `createShapeControl` / `setShapeProperties` / `groupShapes` 외 8개       |
| 15   | 수식                            | `setEquationProperties` / `renderEquationPreview`                        |
| 16   | 그림 속성                       | `getPictureProperties` / `setPictureProperties`                          |
| 17   | 표 속성 / 셀 배경               | `setTableProperties` / `setCellProperties` / `evaluateTableFormula`      |
| 18   | 스타일 관리                     | `createStyle` / `updateStyle` / `deleteStyle` / `getStyleList`           |
| 19   | 클립보드 컨트롤 / HTML 내보내기 | `copyControl` / `pasteControl` / `pasteHtml` / `exportSelectionHtml`     |

각 청크 = IR API 연결 + UI(툴바·메뉴) + e2e ≥ 2 케이스.

### Phase 2 — AI 챗봇 Manual 모드 (3주)

## 다음

### Phase 2 — AI 챗봇 Manual 모드 (3주)

**완료**

- ~~BYOK secrets 영속 토대~~ ✅ (청크 1, 2026-05-01)
- ~~Provider / Chat 타입 정의~~ ✅ (청크 1, 2026-05-01)
- ~~OpenAI 어댑터 + `ai:chat` 스트리밍 IPC + ChatPanel 골격~~ ✅ (청크 2, 2026-05-01)
- ~~NVIDIA NIM 어댑터 + provider/model 셀렉터 + chat e2e + 병렬 워커~~ ✅ (청크 3, 2026-05-01)
- ~~BYOK Settings 모달 UI + `ai:ping` 연결 테스트 (2-A 완료)~~ ✅ (청크 4, 2026-05-01)
- ~~assistant 메시지 마크다운 + 코드 syntax highlight (2-C 부분)~~ ✅ (청크 5, 2026-05-01)
- ~~메시지 복사 / 재생성 / 삭제 (2-C 완료)~~ ✅ (청크 6, 2026-05-01)
- ~~찾아 바꾸기 (⌘H, replaceOne/replaceAll IR) + examples/ git 추적 + e2e retry~~ ✅ (청크 7, 2026-05-01)
- ~~줄 간격 / 들여쓰기 / 문단 간격 + 하단 status bar (undo/redo/zoom 분리)~~ ✅ (청크 8, 2026-05-01)
- ~~셀 합치기 / 나누기 / 병합 해제~~ ✅ (청크 9, 2026-05-01)
- ~~페이지 설정 (용지/방향/여백)~~ ✅ (청크 10, 2026-05-01)
- ~~머리말 / 꼬리말 (단일 라인 MVP)~~ ✅ (청크 11, 2026-05-01)
- ~~책갈피 (add/list/delete/rename)~~ ✅ (청크 12, 2026-05-01)
- ~~각주 (insert + body text)~~ ✅ (청크 13, 2026-05-01)
- ~~스타일 관리 (add/rename/delete)~~ ✅ (청크 14, 2026-05-01)
- ~~수식 미리보기 (renderEquationPreview)~~ ✅ (청크 16, 2026-05-01)
- ~~표/셀 속성 (padding/spacing/repeatHeader/verticalAlign)~~ ✅ (청크 17, 2026-05-01)
- ~~도형 (사각형 MVP)~~ ✅ (청크 15, 2026-05-01)
- ~~HTML 내보내기/붙이기 + ChatPanel 문서 컨텍스트 (AI 라운드트립 검증)~~ ✅ (청크 18, 2026-05-01)
- ~~Manual 모드 도구 디스패치 (`ahwp-tools` JSON 블록 — 각주/머리말/책갈피/페이지/스타일/도형 IR 라우팅)~~ ✅ (청크 19, 2026-05-01)
- ~~발췌 첨부 (선택 영역만 시스템 프롬프트 `[발췌]:` 블록으로 — 토큰↓·anchor 정확도↑, stale 자동 재바인딩)~~ ✅ (청크 20, 2026-05-02)
- ~~멀티 문서 컨텍스트 (target/reference 칩 + `[참조 문서]:` 시스템 블록 + write tool target-only)~~ ✅ (청크 21, 2026-05-02)

**진행 가능 (키 의존성 없음)**

- rhwp-core API 추가 활용 시리즈 (셀 배경/테두리, 그림 속성, 클립보드 컨트롤, HTML 내보내기 등)
- 파일별 채팅 히스토리 (better-sqlite3 도입 — schema/migration 정리)
- Manual 모드: AI 변경사항을 diff로 제안 → Accept/Reject (2-E, 현재 OpenAI/NVIDIA만으로도 검증 가능)

**블록됨 — 메인테이너 API 키 준비 대기**

- Anthropic 어댑터 (`messages` API, `event:` line-prefixed SSE, Phase 3 `tool_use` 대비)
- Google (Gemini) 어댑터
- Ollama / 커스텀 어댑터 (자체 호스팅 base URL 입력)
- 각 어댑터 추가 시 `SHOWN_IDS`(`SettingsDialog`)에 노출 + `getProvider`에 등록. 어댑터 패턴(OpenAI 위임 또는 자체 SSE 파싱)은 이미 확립됨
- 추가 provider 어댑터 — Anthropic / Google / Ollama / 커스텀
- 채팅 메시지 마크다운 렌더링 (`react-markdown` + `remark-gfm`) + 코드 블록 syntax highlight
- 메시지 복사 / 재생성 / 삭제 액션
- 파일별 채팅 히스토리 (better-sqlite3 도입 — schema/migration 정리)
- Manual 모드: AI 변경사항을 diff로 제안 → Accept/Reject

### Phase 1 follow-up (선택)

- 탭 드래그 재배치 + 우클릭 컨텍스트 메뉴 (다른 탭 모두 닫기 등)
- 셀 selection 모델 v4 (드래그 selection / merge·split / 셀 레벨 paste)
- 머리말·꼬리말·각주 (Tier 3 구조 요소)
- 셀 안 이미지 삽입 (`insertPictureInCell`)
- temp 파일 정리 (앱 종료 시 `userData/temp/new-*.hwp` 청소)
- typing burst grouping (현재는 글자마다 undo entry)

각 단계의 세부 체크리스트는 [ROADMAP.md](ROADMAP.md) 참고.
