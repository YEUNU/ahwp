# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ahwp — Electron + React desktop app for viewing/editing Korean HWP/HWPX documents with AI assistance (OpenAI / NVIDIA NIM live; Anthropic / Google / custom OpenAI-compatible endpoints scaffolded but blocked on maintainer keys — `custom` covers any /v1-compatible endpoint including self-hosted Ollama, vLLM, LM Studio). **Phase 1 + Phase 2 + 1차 UX 라운드 완료** (current `0.2.55`, chunks 1~55 + UX rounds): full editor with visual-line caret nav (ArrowUp/Down) / shift+click selection / drag auto-scroll / ⌘A IR-scoped, table cell editing v3 + table props + cell props + cell style + table formula evaluator, multi-line headers/footers with odd/even/both templates, image insert + picture props, control clipboard (⌘⇧C/V), HTML export, **Manual AI mode** (HTML round-trip + `ahwp-tools` JSON dispatcher + 11 whitelisted tools + grouped undo per turn + "되돌리기" toast + multi-paragraph excerpts + multi-doc context + chat history with inline rename + per-tab dirty + 60s `.ahwp-draft` autosave + `.bak` sidecar), VS Code-style folder tree with chokidar + cross-tab external-change detection, browser-style tabs with **pinning + drag reorder + context menu**, command palette (⌘K) + shortcut cheatsheet (⌘/) + status bar counters, BYOK Settings with model dropdown auto-fetched from provider `/v1/models` + 24h cache. See `docs/PROGRESS.md` for the up-to-date phase status — never assume features named in the README are implemented yet.

## Commands

```bash
npm run dev          # Vite + Electron dev (port 5173, strictPort)
npm run build        # typecheck + vite build + electron-builder (current OS)
npm run build:dir    # same, unpacked (faster, no installer)
npm run build:all    # build for mac+win+linux (CI)
npm test             # vitest run (renderer unit tests)
npm run test:watch   # vitest watch
npm run e2e          # vite build + Playwright Electron e2e (~303 cases, 4 workers / retries=1)
npm run e2e:headed   # same, with visible window
npm run typecheck    # tsc -p tsconfig.json && tsc -p tsconfig.node.json (both must pass)
npm run lint         # eslint .
npm run format       # prettier write
npm run format:check # prettier check (used in CI)
```

Run a single unit test: `npx vitest run src/App.test.tsx -t "<name>"`. Run a single e2e: `npx playwright test tests/e2e/smoke.spec.ts`.

`npm run build` runs typecheck first — it will fail on type errors. The `prepare` script installs Husky; `lint-staged` runs eslint+prettier on staged files via the pre-commit hook. CI is **PR-only** (no push trigger) plus `workflow_dispatch`.

## Architecture

Standard Electron 2-process model with strict isolation. Read `docs/ARCHITECTURE.md` for the full design (IPC channel table, SQLite schema, document lifecycle, AI edit modes); the summary below is what's load-bearing across files.

**Process split**

- `electron/` — Main process (Node). All file I/O, folder watching (chokidar), AI provider calls + model-list 24h cache, keychain access (`safeStorage`), and `@rhwp/core` (WASM) calls. Built by `vite-plugin-electron/simple` to `dist-electron/{main,preload}.js`. Subdirs: `electron/ipc/` (per-domain IPC handlers — file, folder, clipboard, session, secrets, ai, chat-history), `electron/ai/` (provider adapters + registry, env-gated fake for tests), `electron/store/` (`recent.json` legacy, `session.json`, `secrets.json` encrypted, `model-cache.json`, `chat-history.db` better-sqlite3), `electron/hwp/` (`@rhwp/core` wrapper + base64 blank seed), `electron/menu.ts` (native app menu).
- `src/` — Renderer (React + Vite). Sandboxed: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The renderer **cannot** import from `electron/` and has no Node access — `process` is undefined here (don't reference it; pass platform info from main if needed). Only `preload.ts`-exposed API is visible via `contextBridge`. Subdirs: `src/app/` (AppShell, TitleBar, WelcomePane, ThemeProvider, ThemeToggle), `src/features/{files,studio,chat,settings,cmdk}/` (per-pane components — `FolderTree`, `StudioViewer`, `TabBar`, `ChatPanel`, `SettingsDialog`, `CommandPalette` + `ShortcutsDialog`), `src/components/ui/` (shadcn primitives — Button, Dialog, Input), `src/lib/{utils,rhwp-core}.ts`.
- `shared/` — Types shared between main and renderer. The IPC contract lives here (`shared/api.ts` defines `AhwpApi`, augments `Window.api`). `shared/format.ts` has the magic-byte format sniff. **All main↔renderer shared types MUST go in `shared/`** per CONTRIBUTING.md.
- `tests/e2e/` — Playwright + Electron tests (`launch.ts` helper, `*.spec.ts` cases).

**IPC contract pattern** (the single most important convention)

Every IPC channel is added in three places, in lockstep:

1. Type added to `AhwpApi` (or a sub-namespace like `FileApi`) in `shared/api.ts` with request + response types.
2. Handler registered in `electron/ipc/*.ts` (e.g. `electron/ipc/file.ts`'s `registerFileIpc()`), called from `electron/main.ts`'s `registerIpcHandlers()`.
3. Wrapper in `electron/preload.ts` calling `ipcRenderer.invoke('domain:action', req)` (or `ipcRenderer.on(...)` for events like `menu:action`).

Channel naming is `domain:action` (`file:open`, `file:save`, `session:get`, `menu:action`, `ipc:ping`). Streaming responses (AI tokens) use `ipcRenderer.on` events on a per-request channel (`ai:chat-event:<id>`), not `invoke` — main spawns an `AbortController` keyed by `id` and the renderer can cancel by invoking `ai:chat-abort` with that `id`. External-change push events (`folder:changed`, `file:external-change`) follow the same `on(...)` event pattern.

**HWP/HWPX content boundary**

- All HWP/HWPX content manipulation (parse, normalize, edit, serialize) defers to `@rhwp/core` directly — no iframe wrapper. The renderer's `src/lib/rhwp-core.ts` lazy-inits the WASM and installs the `measureTextWidth` callback. The main process has its own `@rhwp/core` instance in `electron/hwp/converter.ts` for save-side normalization.
- `shared/format.ts`'s `detectHwpFormat` is a **cheap pre-parse magic-byte sniff**, kept only as a fast-path optimizer. For authoritative format identification post-parse, use `HwpDocument.getSourceFormat()`.
- **Save canonical = HWP/CFB** (provisional). `@rhwp/core` v0.7.x's HWPX round-trip drops embedded image references (KNOWN_ISSUES L-001), so `file:save` writes HWP and auto-routes `.hwpx` paths to `.hwp`. Read path passes input bytes through unchanged. Will revert to HWPX once the lib fixes the round-trip. Currently on v0.7.9 (added `insertParagraph`/`deleteParagraph` IR ops, exposed via `__studioDebug` for Phase 3 Agent tool wiring).
- **Lib quirks** (do not work around silently — check KNOWN_ISSUES first):
  - `applyCharFormat` over an empty paragraph (`length=0`) silently no-ops; only paragraphs with text accept char shape changes.
  - `pasteInternal` doesn't auto-advance the IR caret — the caller must sync from the result `{paraIdx, charOffset}`.
  - `getStyleAt` + `getStyleDetail` returns the static **style template** (not the effective shape after `applyCharFormat`/`applyParaFormat`); use `getCharPropertiesAt` / `getParaPropertiesAt` for active state read-back.
  - `HwpDocument.createEmpty()` returns a `sectionCount=0` shell that fails on subsequent `insertText`. Use the embedded blank-seed approach (`electron/hwp/blank-seed.ts` → `new HwpDocument(seed).createBlankDocument()`) for `file:new`.

**Path aliases** — `@/*` → `src/*`, `@shared/*` → `shared/*`. Configured in `tsconfig.json` and `vite.config.ts`; keep them in sync.

**Two tsconfigs** — `tsconfig.json` covers `src` + `shared` + `vitest.setup.ts` (DOM lib, jsx). `tsconfig.node.json` covers `electron` + `shared` + `tests` + config files (Node lib, no DOM). Some test files add `/// <reference lib="dom" />` for `page.evaluate` callbacks. `npm run typecheck` runs both; a change touching shared types must satisfy both.

## Conventions

- **Branches**: target `dev` for all PRs (`feat/*`, `fix/*`, `chore/*`); `main` is release-only. See `CONTRIBUTING.md`.
- **Commits**: Conventional Commits (`feat(chat): …`, `fix(hwp): …`).
- **Docs (압축 정책)**: 청크당 (a) `CHANGELOG.md`에 1-3줄 + (b) commit body에 디테일 + (c) `ROADMAP.md` 체크박스 토글만. **`PROGRESS.md`는 라운드/Phase 단위로만 일지 추가** — 청크별 작업 디테일은 `git log` + `git show <hash>`에 위임. `PROGRESS.md`를 매 청크마다 업데이트하지 말 것 (이전 패턴이라 누적되어 압축 작업 필요).
- **Strict mode is non-negotiable** — `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Don't disable; fix the type.
- **Security model**: never relax the sandbox (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` in `electron/main.ts`). API keys (Phase 2+) go through `safeStorage`, never plaintext on disk. AI tool calls are whitelisted — never `eval` model output. CSP allows `'wasm-unsafe-eval'` for `@rhwp/core` WASM compilation; no `frame-src` (no external iframes after chunk 6).
- **Package manager is npm** — pnpm was tried and abandoned (corepack EPERM on Windows, see `docs/PROGRESS.md`). Don't reintroduce a `pnpm-lock.yaml`.
- **`@rhwp/core` ESM-only** — published as `"type": "module"`. The main bundle is CJS (vite-plugin-electron default), so `require('@rhwp/core')` throws `ERR_REQUIRE_ESM` in Electron 33's Node 20. Use `await import('@rhwp/core')` (see `electron/hwp/converter.ts`). The package is also externalized in `vite.config.ts` so its WASM asset isn't bundled — Node resolves from `node_modules` at runtime.
- **better-sqlite3 deferred to Phase 2** — recent files originally lived in `userData/recent.json` (LRU max 20). The current UI (folder tree) doesn't display recent files; `recent.json` is still updated by `file:open` etc. but unused in the renderer. The `versions` SQLite schema (`docs/ARCHITECTURE.md`) is documented but not yet implemented.
- **Session schema** — `userData/session.json` holds `lastFolderPath` (left panel root), `lastActivePath` (which tab is active), `openTabPaths` (full tab list). Restored on launch by `AppShell`'s session-restore effect. Tabs that point to deleted files are dropped during restore.
- **Renderer caveat** — `process` is undefined in the sandbox. Don't write `process.platform === 'darwin'` in renderer code; it crashes the React render silently. If platform info is needed in the renderer, surface it through `ipc:ping`'s response or a dedicated IPC.
- **AI architecture (Phase 2)** — Provider adapters live in `electron/ai/providers/` and implement the `Provider` interface from `shared/ai.ts`. The renderer never holds API keys: `electron/store/secrets.ts` encrypts them via `safeStorage` and `electron/ipc/ai.ts` injects the plaintext into adapters at request time. The renderer-facing `secrets` IPC has no `get` — only `set`/`has`/`delete`/`list`. AI requests use an id-based streaming channel (`ai:chat-event:<id>`) with an in-flight `AbortController` registry. New providers go in 3 places: a new file in `providers/`, an entry in `registry.ts`, and (for UI exposure) the `SHOWN_IDS` set in `SettingsDialog.tsx` + the ChatPanel `PROVIDER_OPTIONS`.
- **E2E infrastructure** — Playwright + Electron, `tests/e2e/launch.ts` mints a fresh `--user-data-dir` per spec file. `playwright.config.ts` runs 4 workers locally / 2 in CI with `retries: 1` (parallel race noise; a true bug fails twice). `AHWP_E2E_FAKE_AI=1` swaps real provider adapters for `electron/ai/providers/fake.ts` — its ECHO/ERROR/SLOW prompt-encoded scripts cover deterministic streaming + abort cases. Live NVIDIA NIM smoke (`nvidia-live.spec.ts`) gates on `NVAPI_KEY` env. `examples/` is **tracked in git** — the .hwp fixtures (~5MB total) ship with the repo so CI and new clones don't auto-skip.
- **`__studioDebug` window surface** — every StudioViewer feature exposes a debug entry on `window.__studioDebug` for e2e (insertText, applyCharFormat, openFind, openReplace, replaceAll, etc.). Only the active tab claims the surface (other viewers stay mounted but skip the global). When adding a new IR-mutating feature, expose it on `__studioDebug` _and_ add an e2e in lockstep — that's how chunks 1~7 stayed safe.
