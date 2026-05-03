/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Folder tree operations — context menu, inline create/rename, trash,
 * drag-to-move.
 *
 * Trash assertions: shell.trashItem moves to OS trash on darwin/win/linux
 * and we can't assert on its content. We verify the source path is gone.
 *
 * Drag-and-drop: Playwright's `dragTo` simulates the HTML5 events; we
 * verify the on-disk move via fs.stat.
 */

async function fixture(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ahwp-ops-'));
  await writeFile(path.join(root, 'a.txt'), 'A');
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'inner.txt'), 'inner');
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function activate(page: Page, root: string): Promise<void> {
  await page.evaluate(async (r) => {
    await window.api.session.set({ lastFolderPath: r });
  }, root);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('folder-tree')).toBeVisible();
}

test.describe('folder ops — context menu / shortcuts / DnD', () => {
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

  test('right-click on a file opens the context menu', async () => {
    const { page } = launched;
    const file = page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' });
    await file.click({ button: 'right' });
    await expect(page.getByTestId('folder-tree-context-menu')).toBeVisible();
    // Files don't have New File / New Folder items.
    await expect(page.getByTestId('ctx-new-file')).toHaveCount(0);
    await expect(page.getByTestId('ctx-new-folder')).toHaveCount(0);
    await expect(page.getByTestId('ctx-rename')).toBeVisible();
    await expect(page.getByTestId('ctx-trash')).toBeVisible();
    await expect(page.getByTestId('ctx-reveal')).toBeVisible();
  });

  test('right-click on a folder shows New File / New Folder', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' })
      .click({ button: 'right' });
    await expect(page.getByTestId('ctx-new-file')).toBeVisible();
    await expect(page.getByTestId('ctx-new-folder')).toBeVisible();
  });

  test('context menu → New File → input → Enter creates a file on disk', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' })
      .click({ button: 'right' });
    await page.getByTestId('ctx-new-file').click();
    const input = page.getByTestId('folder-tree-new-file-input');
    await expect(input).toBeFocused();
    await input.fill('fresh.txt');
    await input.press('Enter');
    // Wait for chokidar to surface the file.
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).some(
          (n) => n.includes('fresh.txt'),
        ),
      )
      .toBe(true);
    const created = path.join(fx.root, 'sub', 'fresh.txt');
    expect((await stat(created)).isFile()).toBe(true);
  });

  test('context menu → New Folder under root creates the directory', async () => {
    const { page } = launched;
    // Right-click on the empty area of the panel → root-level menu.
    await page.getByTestId('folder-tree').click({ button: 'right' });
    await page.getByTestId('ctx-new-folder').click();
    const input = page.getByTestId('folder-tree-new-folder-input');
    await input.fill('newdir');
    await input.press('Enter');
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-folder').allTextContents()).some(
          (n) => n.includes('newdir'),
        ),
      )
      .toBe(true);
    expect((await stat(path.join(fx.root, 'newdir'))).isDirectory()).toBe(true);
  });

  test('inline rename: F2 → type → Enter renames on disk', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' })
      .click();
    await page.getByTestId('folder-tree').press('F2');
    const input = page.getByTestId('folder-tree-rename-input');
    await expect(input).toBeFocused();
    await input.fill('renamed.txt');
    await input.press('Enter');
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).some(
          (n) => n.includes('renamed.txt'),
        ),
      )
      .toBe(true);
    expect(existsSync(path.join(fx.root, 'a.txt'))).toBe(false);
    expect(existsSync(path.join(fx.root, 'renamed.txt'))).toBe(true);
  });

  test('inline rename Escape cancels (no fs change)', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' })
      .click();
    await page.getByTestId('folder-tree').press('F2');
    const input = page.getByTestId('folder-tree-rename-input');
    await input.fill('SHOULD-NOT-APPLY.txt');
    await input.press('Escape');
    await expect(page.getByTestId('folder-tree-rename-input')).toHaveCount(0);
    // Original file still there.
    expect(existsSync(path.join(fx.root, 'a.txt'))).toBe(true);
    expect(existsSync(path.join(fx.root, 'SHOULD-NOT-APPLY.txt'))).toBe(false);
  });

  test('Delete key sends to trash (file disappears from disk)', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' })
      .click();
    // Auto-accept the confirm() dialog.
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('folder-tree').press('Delete');
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).every(
          (n) => !n.includes('a.txt'),
        ),
      )
      .toBe(true);
    expect(existsSync(path.join(fx.root, 'a.txt'))).toBe(false);
  });

  test('drag a file onto a folder moves it (fs.rename)', async () => {
    const { page } = launched;
    const src = page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.txt' });
    const dst = page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' });
    // Playwright's dragTo simulates dragstart/dragover/drop.
    await src.dragTo(dst);
    // Expand the destination so we can see the moved file.
    await dst.click();
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).some(
          (n) => n.includes('a.txt'),
        ),
      )
      .toBe(true);
    expect(existsSync(path.join(fx.root, 'a.txt'))).toBe(false);
    expect(existsSync(path.join(fx.root, 'sub', 'a.txt'))).toBe(true);
  });

  test('cannot drop a folder into itself', async () => {
    const { page } = launched;
    const sub = page
      .getByTestId('folder-tree-folder')
      .filter({ hasText: 'sub' });
    // Drag-and-drop sub onto itself should be a no-op (no exception, no
    // change). Playwright's dragTo always fires drop, but our handler
    // checks src === target and bails.
    await sub.dragTo(sub);
    expect(existsSync(path.join(fx.root, 'sub'))).toBe(true);
    expect(existsSync(path.join(fx.root, 'sub', 'sub'))).toBe(false);
  });
});
