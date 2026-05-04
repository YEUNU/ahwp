import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// Local-only .env loader (gitignored). Live smoke tests (nvidia-live,
// gemini-live) read provider API keys from process.env. Loading once here
// means individual specs don't need a per-file loader. dependency-free —
// just KEY=VALUE lines, # comments, blanks ignored. Existing process.env
// vars win over .env (CI / shell can override).
function loadDotEnv(): void {
  const envPath = path.resolve(__dirname, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key.length === 0) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
}
loadDotEnv();

/**
 * Each spec file launches its own Electron process with an isolated
 * `--user-data-dir` (see tests/e2e/launch.ts), so file-level parallelism
 * is safe. We keep `fullyParallel: false` because tests *within* a file
 * share the `launched` app via beforeAll/afterAll.
 *
 * Workers: 4 locally (10-core machines comfortably run 4 Electron procs;
 * the 144-page stress fixture peaks ~500MB per process). 2 in CI where
 * GitHub-hosted runners are typically 2~4 cores.
 *
 * Override with `npm run e2e -- --workers=N` for a one-off bisect.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 4,
  // Parallel Electron + macOS file-system races (folder-ops DnD, the studio
  // debug-state propagation in find/replace) flake at <0.5% with 4 workers
  // but pass deterministically in isolation. One retry absorbs the noise
  // without masking real regressions — a true bug fails twice.
  retries: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
