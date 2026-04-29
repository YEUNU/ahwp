import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // single Electron app at a time
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'on-first-retry',
  },
});
