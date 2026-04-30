# 진행 상황

ahwp 개발의 시간 순 기록. PR이 머지될 때마다 갱신합니다. 단순 체크리스트는 [ROADMAP.md](ROADMAP.md), 사용자 영향 변경은 [CHANGELOG.md](../CHANGELOG.md).

## 현재 스냅샷

| 항목     | 상태                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase    | **1-D + 1 마무리 완료** (Studio 마이그레이션 청크 1~6 + 5b 선택 모델 + file:new — Phase 2 AI 챗봇 진입 가능)                                                                                                  |
| 빌드     | ✅ `npm run dev` · `npx vite build`                                                                                                                                                                           |
| 타입     | ✅ `npm run typecheck`                                                                                                                                                                                        |
| 린트     | ✅ `npm run lint` (warning 2건 — shadcn 표준 패턴, react-refresh HMR 안내)                                                                                                                                    |
| 포맷     | ✅ `npm run format:check`                                                                                                                                                                                     |
| 테스트   | ✅ 2/2 (`App.test.tsx`)                                                                                                                                                                                       |
| Electron | 33.2 · sandbox=true · contextIsolation=true                                                                                                                                                                   |
| 의존성   | runtime: `@rhwp/core` · `react-resizable-panels` · `clsx` · `tailwind-merge` · `class-variance-authority` · `lucide-react` · `tailwindcss-animate` · `@radix-ui/react-slot` (chunk 6에서 `@rhwp/editor` 제거) |

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

## 다음

### Phase 2 — AI 챗봇 Manual 모드 (3주)

- BYOK 설정 UI (`safeStorage` 통합)
- Provider 어댑터 — OpenAI / Anthropic / Google / NVIDIA NIM / Ollama / 커스텀
- `ChatPanel` UI — 탭(History/Chat), 메시지 리스트, 입력창, 스트리밍 토큰 렌더
- Manual 모드: AI 변경사항을 diff로 제안 → Accept/Reject
- 파일별 채팅 히스토리 (better-sqlite3 도입 — schema/migration 정리)

### Phase 1 follow-up (선택)

- 폰트 크기 / 색상 picker (HWPUNIT → pt 변환)
- ⌘Z / ⌘Shift+Z (undo/redo)
- temp 파일 정리 (앱 종료 시 `userData/temp/new-*.hwp` 청소)
- 컨텍스트 메뉴 (recent 우클릭 → "최근 항목에서 제거", "Finder/Explorer에서 보기")

각 단계의 세부 체크리스트는 [ROADMAP.md](ROADMAP.md) 참고.
