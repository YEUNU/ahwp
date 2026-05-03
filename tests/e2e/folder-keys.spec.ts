/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * OS file-explorer-parity shortcuts in the folder tree:
 *   Tier 1: ↑↓←→ navigation, ⌘N / ⌘⇧N for new file/folder
 *   Tier 2: ⌘C / ⌘X / ⌘V for file copy/cut/paste
 */

async function fixture(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ahwp-keys-'));
  await writeFile(path.join(root, 'a.txt'), 'A');
  await writeFile(path.join(root, 'b.txt'), 'B');
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'c.txt'), 'C');
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function activate(page: Page, root: string): Promise<void> {
  await page.evaluate(async (r) => {
    await window.api.session.set({ lastFolderPath: r });
  }, root);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('folder-tree')).toBeVisible();
  // Click into the tree to ensure focus before pressing keys.
  await page.getByTestId('folder-tree').click();
}

test.describe('folder tree keyboard parity', () => {
  let launched: LaunchedApp;
  let fx: { root: string; cleanup: () => Promise<void> };

  test.beforeEach(async () => {
    fx = await fixture();
    launched = await launchApp();
    await activate(launched.page, fx.root);
  });

  test.afterEach(async () => {
    await launched.close();
    await fx.cleanup();
  });

  test('ArrowDown / ArrowUp move selection between visible entries', async () => {
    const { page } = launched;
    // Initial: nothing selected → ArrowDown picks the first entry (sub/).
    await page.keyboard.press('ArrowDown');
    await expect
      .poll(async () =>
        (
          await page
            .locator('[data-testid="folder-tree-folder"][data-path*="sub"]')
            .first()
            .getAttribute('class')
        )?.includes('bg-muted'),
      )
      .toBe(true);
    // ArrowDown again → next entry (a.txt, since folders are sorted first).
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(50);
    // ArrowUp returns to sub/.
    await page.keyboard.press('ArrowUp');
    await expect
      .poll(async () =>
        (
          await page
            .locator('[data-testid="folder-tree-folder"][data-path*="sub"]')
            .first()
            .getAttribute('class')
        )?.includes('bg-muted'),
      )
      .toBe(true);
  });

  test('ArrowRight on a folder expands it; ArrowLeft collapses', async () => {
    const { page } = launched;
    await page.keyboard.press('ArrowDown'); // sub selected
    await page.keyboard.press('ArrowRight');
    // After expand, c.txt under sub becomes visible.
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).some(
          (n) => n.includes('c.txt'),
        ),
      )
      .toBe(true);
    await page.keyboard.press('ArrowLeft');
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).some(
          (n) => n.includes('c.txt'),
        ),
      )
      .toBe(false);
  });

  test('Cmd/Ctrl+N creates a new file under the selected folder', async () => {
    const { page } = launched;
    await page.keyboard.press('ArrowDown'); // sub
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+n`);
    const input = page.getByTestId('folder-tree-new-file-input');
    await expect(input).toBeFocused();
    await input.fill('keyboard.txt');
    await input.press('Enter');
    await expect
      .poll(() => existsSync(path.join(fx.root, 'sub', 'keyboard.txt')))
      .toBe(true);
  });

  test('Cmd/Ctrl+Shift+N creates a new folder at root when no selection', async () => {
    const { page } = launched;
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Shift+n`);
    const input = page.getByTestId('folder-tree-new-folder-input');
    await expect(input).toBeFocused();
    await input.fill('kbd-folder');
    await input.press('Enter');
    await expect
      .poll(async () =>
        (await stat(path.join(fx.root, 'kbd-folder'))).isDirectory(),
      )
      .toBe(true);
  });

  test('Cmd/Ctrl+C then Cmd/Ctrl+V copies a file (source kept, dest created)', async () => {
    const { page } = launched;
    // Select a.txt, copy, then select sub, paste.
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' })
      .click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+c`);
    await page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' })
      .click();
    await page.keyboard.press(`${mod}+v`);
    await expect
      .poll(() => existsSync(path.join(fx.root, 'sub', 'a.txt')))
      .toBe(true);
    // Source still there.
    expect(existsSync(path.join(fx.root, 'a.txt'))).toBe(true);
  });

  test('Cmd/Ctrl+X then Cmd/Ctrl+V moves a file (source removed)', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'b.txt' })
      .click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+x`);
    await page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' })
      .click();
    await page.keyboard.press(`${mod}+v`);
    await expect
      .poll(() => existsSync(path.join(fx.root, 'sub', 'b.txt')))
      .toBe(true);
    expect(existsSync(path.join(fx.root, 'b.txt'))).toBe(false);
  });

  test('paste of a copied file twice produces "(1)" disambiguated name', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' })
      .click();
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+c`);
    // Paste twice into sub.
    await page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' })
      .click();
    await page.keyboard.press(`${mod}+v`);
    await page.waitForTimeout(150);
    await page.keyboard.press(`${mod}+v`);
    await expect
      .poll(() => existsSync(path.join(fx.root, 'sub', 'a (1).txt')))
      .toBe(true);
  });
});
