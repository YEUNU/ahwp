# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ahwp — Electron + React desktop app for viewing/editing Korean HWP/HWPX documents with AI assistance (OpenAI / Anthropic / Google / Ollama / custom OpenAI-compatible endpoints). Currently at the end of **Phase 0** (bootstrap shell + dummy 3-pane layout + IPC ping). See `docs/PROGRESS.md` for the up-to-date phase status; never assume features named in the README are implemented yet.

## Commands

```bash
npm run dev          # Vite + Electron dev (port 5173, strictPort)
npm run build        # typecheck + vite build + electron-builder (current OS)
npm run build:dir    # same, unpacked (faster, no installer)
npm run build:all    # build for mac+win+linux (CI)
npm test             # vitest run
npm run test:watch   # vitest watch
npm run typecheck    # tsc -p tsconfig.json && tsc -p tsconfig.node.json (both must pass)
npm run lint         # eslint .
npm run format       # prettier write
npm run format:check # prettier check (used in CI)
```

Run a single test: `npx vitest run src/App.test.tsx` (or `-t "<name>"` to filter).

`npm run build` runs typecheck first — it will fail on type errors. The `prepare` script installs Husky; `lint-staged` runs eslint+prettier on staged files via the pre-commit hook.

## Architecture

Standard Electron 2-process model with strict isolation. Read `docs/ARCHITECTURE.md` for the full design (IPC channel table, SQLite schema, document lifecycle, AI edit modes); the summary below is the part that's actually load-bearing across files.

**Process split**

- `electron/` — Main process (Node). All file I/O, AI provider calls, SQLite, keychain access, and rhwp core calls live here. Built by `vite-plugin-electron/simple` to `dist-electron/{main,preload}.js`.
- `src/` — Renderer (React + Vite). Sandboxed: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`. The renderer **cannot** import from `electron/` and has no Node access — it only sees what `preload.ts` exposes via `contextBridge`.
- `shared/` — Types shared between main and renderer. The IPC contract lives here (`shared/api.ts` defines `AhwpApi`, augments `Window.api`). **Per CONTRIBUTING.md, all main↔renderer shared types MUST go in `shared/`.**

**IPC contract pattern** (the single most important convention)

Every IPC channel is added in three places, in lockstep:

1. Type added to `AhwpApi` in `shared/api.ts` (request + response types alongside).
2. Handler registered in `electron/main.ts` (`ipcMain.handle('domain:action', ...)`) — currently inline in `registerIpcHandlers()`, will move to `electron/ipc/*.ts` modules in Phase 1+.
3. Wrapper added to `electron/preload.ts` calling `ipcRenderer.invoke('domain:action', req)`.

Channel naming is `domain:action` (see the table in `docs/ARCHITECTURE.md` §IPC — e.g. `file:open`, `ai:chat-stream`, `settings:set-secret`). Streaming responses (AI tokens) use `ipcRenderer.on` events keyed by request ID, not `invoke`.

**Path aliases** — `@/*` → `src/*`, `@shared/*` → `shared/*`. Configured in both `tsconfig.json` and `vite.config.ts`; keep them in sync.

**Two tsconfigs** — `tsconfig.json` covers `src` + `shared` (DOM lib, jsx). `tsconfig.node.json` covers `electron` + config files (Node lib, no DOM). `npm run typecheck` runs both; a change touching shared types must satisfy both.

**Document lifecycle (Phase 1+, not yet implemented)**

Every open document gets an in-memory `docId` (UUID). Renderer addresses documents by `docId`, not path — this is what lets unsaved new documents work. `.hwp` inputs are converted to `.hwpx` in a temp dir on open and treated as read-only; saves always go to `.hwpx` (originals are never overwritten). SQLite `conversations.file_id` is only populated once a document has a real path.

## Conventions

- **Branches**: target `dev` for all PRs (`feat/*`, `fix/*`, `chore/*`); `main` is release-only. See `CONTRIBUTING.md`.
- **Commits**: Conventional Commits (`feat(chat): …`, `fix(hwp): …`).
- **Strict mode is non-negotiable** — `tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedSideEffectImports`. Don't disable; fix the type.
- **Security model**: never relax the sandbox (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` in `electron/main.ts`). API keys go through `safeStorage`, never plaintext on disk or in `electron-store`. AI tool calls are whitelisted — never `eval` model output.
- **Package manager is npm** — pnpm was tried and abandoned (corepack EPERM on Windows, see `docs/PROGRESS.md` 2026-04-29). Don't reintroduce a `pnpm-lock.yaml`.
- **No dependencies yet, only devDependencies** — Phase 0 ships an empty runtime. When adding the first runtime dep (likely `@rhwp/editor` or `zustand` in Phase 1), put it in `dependencies`, not `devDependencies`.
