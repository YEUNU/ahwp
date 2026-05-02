import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

test('app boots with three-pane layout and welcome view', async () => {
  const { page } = launched;
  await expect(page.getByText('파일').first()).toBeVisible();
  await expect(page.getByText('챗봇').first()).toBeVisible();
  // UI/UX revamp: welcome pane shows "안녕하세요." greeting + 2 cards.
  await expect(page.getByText('안녕하세요.')).toBeVisible();
  await expect(page.getByTestId('welcome-new-doc')).toBeVisible();
  await expect(page.getByTestId('welcome-open')).toBeVisible();
});

test('titlebar theme button toggles light / dark on html element', async () => {
  const { page } = launched;
  // Custom titlebar exposes a theme toggle (binary light/dark, not the
  // 3-state system→light→dark cycle we used to ship). Verify the
  // class flips on each click.
  const toggle = page.getByTestId('titlebar-theme');
  await expect(toggle).toBeVisible();

  const isDark = async () => {
    const cls = (await page.locator('html').getAttribute('class')) ?? '';
    return cls.split(/\s+/).includes('dark');
  };

  // Headless default = prefers-color-scheme: light → resolved 'light'.
  expect(await isDark()).toBe(false);

  await toggle.click();
  expect(await isDark()).toBe(true);

  await toggle.click();
  expect(await isDark()).toBe(false);
});
