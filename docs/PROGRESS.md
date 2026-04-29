# 진행 상황

ahwp 개발의 시간 순 기록. PR이 머지될 때마다 갱신합니다. 단순 체크리스트는 [ROADMAP.md](ROADMAP.md), 사용자 영향 변경은 [CHANGELOG.md](../CHANGELOG.md).

## 현재 스냅샷

| 항목     | 상태                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phase    | **1-B 진행 중** (파일 리스트)                                                                                                                                |
| 빌드     | ✅ `npm run dev` · `npx vite build`                                                                                                                          |
| 타입     | ✅ `npm run typecheck`                                                                                                                                       |
| 린트     | ✅ `npm run lint` (warning 2건 — shadcn 표준 패턴, react-refresh HMR 안내)                                                                                   |
| 포맷     | ✅ `npm run format:check`                                                                                                                                    |
| 테스트   | ✅ 2/2 (`App.test.tsx`)                                                                                                                                      |
| Electron | 33.2 · sandbox=true · contextIsolation=true                                                                                                                  |
| 의존성   | runtime: `react-resizable-panels` · `clsx` · `tailwind-merge` · `class-variance-authority` · `lucide-react` · `tailwindcss-animate` · `@radix-ui/react-slot` |

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

## 다음

### Phase 1-B — 남은 항목

- 메뉴 `file:new`도 IPC 연결 (Phase 1-C에서 빈 HWPX 시드와 함께)
- 컨텍스트 메뉴(목록 항목 우클릭): "최근 항목에서 제거", "Finder/Explorer에서 보기"

### Phase 1-C — rhwp 에디터

- `@rhwp/editor` / `@rhwp/core` API 조사 (npm 패키지 또는 source build)
- HWP → HWPX 변환기 (`electron/hwp/converter.ts`)
- `RhwpEditor.tsx`
- `file:new`, `file:save`, dirty 추적

각 단계의 세부 체크리스트는 [ROADMAP.md](ROADMAP.md) 참고.
