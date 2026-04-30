# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ahwp — Electron + React desktop app for viewing/editing Korean HWP/HWPX documents with AI assistance (OpenAI / Anthropic / Google / NVIDIA NIM / Ollama / custom OpenAI-compatible endpoints). **Phase 1 complete**: full editor (text/IME/selection/format/Undo/Copy/Find/page-nav), VS Code-style folder tree (chokidar watcher + create/rename/trash/move), browser-style center tabs. Phase 2 (AI chatbot) is next. See `docs/PROGRESS.md` for the up-to-date phase status — never assume features named in the README are implemented yet.

## Commands

```bash
npm run dev          # Vite + Electron dev (port 5173, strictPort)
npm run build        # typecheck + vite build + electron-builder (current OS)
npm run build:dir    # same, unpacked (faster, no installer)
npm run build:all    # build for mac+win+linux (CI)
npm test             # vitest run (renderer unit tests)
npm run test:watch   # vitest watch
npm run e2e          # vite build + Playwright Electron e2e (106 cases)
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

- `electron/` — Main process (Node). All file I/O, folder watching (chokidar), AI provider calls (Phase 2+), keychain access (Phase 2+), and `@rhwp/core` (WASM) calls. Built by `vite-plugin-electron/simple` to `dist-electron/{main,preload}.js`. Subdirs: `electron/ipc/` (per-domain IPC handlers — file, folder, clipboard, session), `electron/store/` (JSON-backed persistence — `recent.json` legacy, `session.json`), `electron/hwp/` (`@rhwp/core` wrapper + base64 blank seed), `electron/menu.ts` (native app menu).
- `src/` — Renderer (React + Vite). Sandboxed: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The renderer **cannot** import from `electron/` and has no Node access — `process` is undefined here (don't reference it; pass platform info from main if needed). Only `preload.ts`-exposed API is visible via `contextBridge`. Subdirs: `src/app/` (AppShell, ThemeProvider, ThemeToggle), `src/features/{files,studio}/` (per-pane components — `FolderTree`, `StudioViewer`, `TabBar`), `src/components/ui/` (shadcn primitives), `src/lib/{utils,rhwp-core}.ts`.
- `shared/` — Types shared between main and renderer. The IPC contract lives here (`shared/api.ts` defines `AhwpApi`, augments `Window.api`). `shared/format.ts` has the magic-byte format sniff. **All main↔renderer shared types MUST go in `shared/`** per CONTRIBUTING.md.
- `tests/e2e/` — Playwright + Electron tests (`launch.ts` helper, `*.spec.ts` cases).

**IPC contract pattern** (the single most important convention)

Every IPC channel is added in three places, in lockstep:

1. Type added to `AhwpApi` (or a sub-namespace like `FileApi`) in `shared/api.ts` with request + response types.
2. Handler registered in `electron/ipc/*.ts` (e.g. `electron/ipc/file.ts`'s `registerFileIpc()`), called from `electron/main.ts`'s `registerIpcHandlers()`.
3. Wrapper in `electron/preload.ts` calling `ipcRenderer.invoke('domain:action', req)` (or `ipcRenderer.on(...)` for events like `menu:action`).

Channel naming is `domain:action` (`file:open`, `file:save`, `session:get`, `menu:action`, `ipc:ping`). Streaming responses (Phase 2+ AI tokens) will use `ipcRenderer.on` events keyed by request ID, not `invoke`.

**HWP/HWPX content boundary**

- All HWP/HWPX content manipulation (parse, normalize, edit, serialize) defers to `@rhwp/core` directly — no iframe wrapper. The renderer's `src/lib/rhwp-core.ts` lazy-inits the WASM and installs the `measureTextWidth` callback. The main process has its own `@rhwp/core` instance in `electron/hwp/converter.ts` for save-side normalization.
- `shared/format.ts`'s `detectHwpFormat` is a **cheap pre-parse magic-byte sniff**, kept only as a fast-path optimizer. For authoritative format identification post-parse, use `HwpDocument.getSourceFormat()`.
- **Save canonical = HWP/CFB** (provisional). `@rhwp/core` v0.7.8's HWPX round-trip drops embedded image references (KNOWN_ISSUES L-001), so `file:save` writes HWP and auto-routes `.hwpx` paths to `.hwp`. Read path passes input bytes through unchanged. Will revert to HWPX once the lib fixes the round-trip.
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
- **Strict mode is non-negotiable** — `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Don't disable; fix the type.
- **Security model**: never relax the sandbox (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` in `electron/main.ts`). API keys (Phase 2+) go through `safeStorage`, never plaintext on disk. AI tool calls are whitelisted — never `eval` model output. CSP allows `'wasm-unsafe-eval'` for `@rhwp/core` WASM compilation; no `frame-src` (no external iframes after chunk 6).
- **Package manager is npm** — pnpm was tried and abandoned (corepack EPERM on Windows, see `docs/PROGRESS.md`). Don't reintroduce a `pnpm-lock.yaml`.
- **`@rhwp/core` ESM-only** — published as `"type": "module"`. The main bundle is CJS (vite-plugin-electron default), so `require('@rhwp/core')` throws `ERR_REQUIRE_ESM` in Electron 33's Node 20. Use `await import('@rhwp/core')` (see `electron/hwp/converter.ts`). The package is also externalized in `vite.config.ts` so its WASM asset isn't bundled — Node resolves from `node_modules` at runtime.
- **better-sqlite3 deferred to Phase 2** — recent files originally lived in `userData/recent.json` (LRU max 20). The current UI (folder tree) doesn't display recent files; `recent.json` is still updated by `file:open` etc. but unused in the renderer. The `versions` SQLite schema (`docs/ARCHITECTURE.md`) is documented but not yet implemented.
- **Session schema** — `userData/session.json` holds `lastFolderPath` (left panel root), `lastActivePath` (which tab is active), `openTabPaths` (full tab list). Restored on launch by `AppShell`'s session-restore effect. Tabs that point to deleted files are dropped during restore.
- **Renderer caveat** — `process` is undefined in the sandbox. Don't write `process.platform === 'darwin'` in renderer code; it crashes the React render silently. If platform info is needed in the renderer, surface it through `ipc:ping`'s response or a dedicated IPC.
