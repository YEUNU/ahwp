import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

test('app boots with three-pane layout and ipc:ping resolves', async () => {
  const { page } = launched;
  await expect(page.getByText('파일').first()).toBeVisible();
  await expect(page.getByText('챗봇').first()).toBeVisible();
  await expect(page.getByText('Hello, ahwp')).toBeVisible();
  // ipc:ping renders as JSON; pong text should appear.
  await expect(page.getByText(/hello from renderer/)).toBeVisible();
});

test('theme toggle cycles system → light → dark on html element', async () => {
  const { page } = launched;
  // The toggle button is the only icon button in the header (lucide icon).
  // Use the aria-label that ThemeToggle renders.
  const toggle = page.getByRole('button', { name: /테마:/ });
  await expect(toggle).toBeVisible();

  // Helper to read whether <html> currently has the dark class. Uses
  // getAttribute (no page.evaluate) so we don't need the DOM lib in the
  // test tsconfig.
  const isDark = async () => {
    const cls = (await page.locator('html').getAttribute('class')) ?? '';
    return cls.split(/\s+/).includes('dark');
  };

  // Initial state in headless test env: prefers-color-scheme: light by default,
  // theme=system → resolved 'light' → no .dark class.
  expect(await isDark()).toBe(false);

  // system → light: still light, no .dark
  await toggle.click();
  expect(await isDark()).toBe(false);

  // light → dark: .dark applied
  await toggle.click();
  expect(await isDark()).toBe(true);

  // dark → system: back to false (since system default is light)
  await toggle.click();
  expect(await isDark()).toBe(false);
});
