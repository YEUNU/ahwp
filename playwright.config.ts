import { defineConfig } from '@playwright/test';

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
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
