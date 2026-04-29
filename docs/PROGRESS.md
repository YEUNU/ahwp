# 진행 상황

ahwp 개발의 시간 순 기록. PR이 머지될 때마다 갱신합니다. 단순 체크리스트는 [ROADMAP.md](ROADMAP.md), 사용자 영향 변경은 [CHANGELOG.md](../CHANGELOG.md).

## 현재 스냅샷

| 항목     | 상태                                                    |
| -------- | ------------------------------------------------------- |
| Phase    | **0 완료** → **1 진입 예정**                            |
| 빌드     | ✅ `npm run dev` · `npx vite build`                     |
| 타입     | ✅ `npm run typecheck`                                  |
| 린트     | ✅ `npm run lint`                                       |
| 포맷     | ✅ `npm run format:check`                               |
| 테스트   | ✅ 2/2 (`App.test.tsx`)                                 |
| Electron | 33.2 · sandbox=true · contextIsolation=true             |
| 의존성   | ~720 packages (devDependencies 전체, dependencies 없음) |

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

## 다음

### Phase 1-A — 레이아웃 토대

- shadcn/ui CLI 초기화 + Button / Tabs / ScrollArea / Resizable / Dialog
- `react-resizable-panels` 도입
- `AppShell.tsx` (현재 인라인 grid → 리사이저블 패널 3개)
- 다크/라이트 테마 토글 (system 감지)
- 메뉴바 골격 (File / View / Help)

### Phase 1-B — 파일 리스트

- better-sqlite3 + 마이그레이션
- `electron/store/db.ts`, `electron/ipc/file.ts` (`file:list-recent`, `file:open`)
- 좌측 패널: 최근 파일, drag-and-drop

### Phase 1-C — rhwp 에디터

- `@rhwp/editor` / `@rhwp/core` API 조사 (npm 패키지 또는 source build)
- HWP → HWPX 변환기 (`electron/hwp/converter.ts`)
- `RhwpEditor.tsx`
- `file:new`, `file:save`, dirty 추적

각 단계의 세부 체크리스트는 [ROADMAP.md](ROADMAP.md) 참고.
