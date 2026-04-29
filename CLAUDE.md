# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ahwp — Electron + React desktop app for viewing/editing Korean HWP/HWPX documents with AI assistance (OpenAI / Anthropic / Google / NVIDIA NIM / Ollama / custom OpenAI-compatible endpoints). Currently in **Phase 1-C** (rhwp viewer + save round-trip via `@rhwp/core`). Phase 0/1-A/1-B complete; AI features start in Phase 2. See `docs/PROGRESS.md` for the up-to-date phase status — never assume features named in the README are implemented yet.

## Commands

```bash
npm run dev          # Vite + Electron dev (port 5173, strictPort)
npm run build        # typecheck + vite build + electron-builder (current OS)
npm run build:dir    # same, unpacked (faster, no installer)
npm run build:all    # build for mac+win+linux (CI)
npm test             # vitest run (renderer unit tests)
npm run test:watch   # vitest watch
npm run e2e          # vite build + Playwright Electron e2e (7 cases)
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

- `electron/` — Main process (Node). All file I/O, AI provider calls, SQLite (Phase 2+), keychain access, and `@rhwp/core` (WASM) calls. Built by `vite-plugin-electron/simple` to `dist-electron/{main,preload}.js`. Subdirs: `electron/ipc/` (per-domain IPC handlers), `electron/store/` (JSON-backed persistence — `recent.json`, `session.json`), `electron/hwp/` (`@rhwp/core` wrapper), `electron/menu.ts` (native app menu).
- `src/` — Renderer (React + Vite). Sandboxed: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The renderer **cannot** import from `electron/` and has no Node access — it only sees what `preload.ts` exposes via `contextBridge`. Subdirs: `src/app/` (AppShell, ThemeProvider, ThemeToggle), `src/features/{editor,files}/` (per-pane components), `src/components/ui/` (shadcn primitives), `src/lib/utils.ts` (`cn()` helper).
- `shared/` — Types shared between main and renderer. The IPC contract lives here (`shared/api.ts` defines `AhwpApi`, augments `Window.api`). `shared/format.ts` has the magic-byte format sniff. **All main↔renderer shared types MUST go in `shared/`** per CONTRIBUTING.md.
- `tests/e2e/` — Playwright + Electron tests (`launch.ts` helper, `*.spec.ts` cases).

**IPC contract pattern** (the single most important convention)

Every IPC channel is added in three places, in lockstep:

1. Type added to `AhwpApi` (or a sub-namespace like `FileApi`) in `shared/api.ts` with request + response types.
2. Handler registered in `electron/ipc/*.ts` (e.g. `electron/ipc/file.ts`'s `registerFileIpc()`), called from `electron/main.ts`'s `registerIpcHandlers()`.
3. Wrapper in `electron/preload.ts` calling `ipcRenderer.invoke('domain:action', req)` (or `ipcRenderer.on(...)` for events like `menu:action`).

Channel naming is `domain:action` (`file:open`, `file:save`, `session:get`, `menu:action`, `ipc:ping`). Streaming responses (Phase 2+ AI tokens) will use `ipcRenderer.on` events keyed by request ID, not `invoke`.

**HWP/HWPX content boundary** (Phase 1-C policy)

- All HWP/HWPX content manipulation (parse, normalize, edit, serialize) defers to `@rhwp/core`. See `electron/hwp/converter.ts` — `ensureHwpxBytes` for read-side conversion, `normalizeToHwpx` for save-side IR round-trip, both via `roundTripHwpx` shared helper.
- `shared/format.ts`'s `detectHwpFormat` is a **cheap pre-parse magic-byte sniff**, kept only as a fast-path optimizer (HWPX pass-through in `ensureHwpxBytes`). For authoritative format identification post-parse, use `HwpDocument.getSourceFormat()`.
- Internal canonical = HWPX. `file:read` always returns HWPX bytes; `file:save` always writes HWPX (auto-routes `.hwp` paths to `.hwpx`).
- `@rhwp/editor` (the iframe wrapper) loads from `https://edwardkim.github.io/rhwp/` — external dep, will be replaced by self-hosted assets in Phase 4. Treat its postMessage RPC as flaky (10s timeout, occasional non-response on `loadFile`); see `src/features/editor/RhwpViewer.tsx` for the prototype patches and fire-and-forget `loadFile`.

**Path aliases** — `@/*` → `src/*`, `@shared/*` → `shared/*`. Configured in `tsconfig.json` and `vite.config.ts`; keep them in sync.

**Two tsconfigs** — `tsconfig.json` covers `src` + `shared` + `vitest.setup.ts` (DOM lib, jsx). `tsconfig.node.json` covers `electron` + `shared` + `tests` + config files (Node lib, no DOM). Some test files add `/// <reference lib="dom" />` for `page.evaluate` callbacks. `npm run typecheck` runs both; a change touching shared types must satisfy both.

## Conventions

- **Branches**: target `dev` for all PRs (`feat/*`, `fix/*`, `chore/*`); `main` is release-only. See `CONTRIBUTING.md`.
- **Commits**: Conventional Commits (`feat(chat): …`, `fix(hwp): …`).
- **Strict mode is non-negotiable** — `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Don't disable; fix the type.
- **Security model**: never relax the sandbox (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` in `electron/main.ts`). API keys (Phase 2+) go through `safeStorage`, never plaintext on disk. AI tool calls are whitelisted — never `eval` model output. CSP allows `frame-src https://edwardkim.github.io` only for the rhwp studio iframe; widen with care.
- **Package manager is npm** — pnpm was tried and abandoned (corepack EPERM on Windows, see `docs/PROGRESS.md`). Don't reintroduce a `pnpm-lock.yaml`.
- **`@rhwp/core` ESM-only** — published as `"type": "module"`. The main bundle is CJS (vite-plugin-electron default), so `require('@rhwp/core')` throws `ERR_REQUIRE_ESM` in Electron 33's Node 20. Use `await import('@rhwp/core')` (see `electron/hwp/converter.ts`). The package is also externalized in `vite.config.ts` so its WASM asset isn't bundled — Node resolves from `node_modules` at runtime.
- **better-sqlite3 deferred to Phase 2** — recent files use `userData/recent.json` (LRU max 20, atomic write). The `versions` SQLite schema (`docs/ARCHITECTURE.md`) is documented but not yet implemented; full HWPX BLOB per version, no member-level dedup.
