/// <reference lib="dom" />
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Folder tree (left panel).
 *
 * - Root selected via session.lastFolderPath (skips the OS dialog)
 * - Lazy expand: children fetched on first folder click
 * - chokidar watcher: a file added to the root after launch should
 *   appear in the tree without a manual refresh
 * - Restoration: lastFolderPath survives app restart
 */

async function makeFixture(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ahwp-tree-'));
  // root/a.hwp
  await writeFile(path.join(root, 'a.hwp'), 'placeholder');
  // root/notes.txt
  await writeFile(path.join(root, 'notes.txt'), 'plain');
  // root/sub/b.hwpx
  await mkdir(path.join(root, 'sub'));
  await writeFile(path.join(root, 'sub', 'b.hwpx'), 'placeholder');
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.describe('folder tree — left panel', () => {
  let launched: LaunchedApp;
  let fixture: { root: string; cleanup: () => Promise<void> };

  test.beforeEach(async () => {
    fixture = await makeFixture();
    launched = await launchApp();
    // Seed the session with the fixture root so restoration auto-opens it.
    await launched.page.evaluate(async (root) => {
      await window.api.session.set({ lastFolderPath: root });
    }, fixture.root);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
    await fixture.cleanup();
  });

  test('renders the root label and immediate children (folders + files)', async () => {
    const { page } = launched;
    // Root label is the basename of the folder.
    await expect(page.getByTestId('folder-tree-root-label')).toContainText(
      path.basename(fixture.root),
    );
    // Children: folders first, then files. We assert all three are present.
    await expect(page.getByTestId('folder-tree')).toBeVisible();
    const folders = page.getByTestId('folder-tree-folder');
    const files = page.getByTestId('folder-tree-file');
    await expect(folders).toHaveCount(1);
    await expect(folders.nth(0)).toContainText('sub');
    await expect(files).toHaveCount(2);
    // a.hwp + notes.txt are both shown — no extension filter.
    const fileNames = await files.allTextContents();
    expect(fileNames.some((n) => n.includes('a.hwp'))).toBe(true);
    expect(fileNames.some((n) => n.includes('notes.txt'))).toBe(true);
  });

  test('clicking a folder toggles expand + lazy-loads children', async () => {
    const { page } = launched;
    const sub = page.getByTestId('folder-tree-folder').first();
    // Before click — sub's child b.hwpx not present.
    await expect(page.getByTestId('folder-tree-file')).toHaveCount(2);
    await sub.click();
    // After click — b.hwpx appears.
    await expect
      .poll(async () => await page.getByTestId('folder-tree-file').count())
      .toBe(3);
    const allFiles = await page
      .getByTestId('folder-tree-file')
      .allTextContents();
    expect(allFiles.some((n) => n.includes('b.hwpx'))).toBe(true);
  });

  test('chokidar watcher picks up a file added after load', async () => {
    const { page } = launched;
    await expect(page.getByTestId('folder-tree-file')).toHaveCount(2);
    // Add a new file directly on disk.
    await writeFile(path.join(fixture.root, 'fresh.hwp'), 'new');
    await expect
      .poll(async () => page.getByTestId('folder-tree-file').count(), {
        timeout: 5_000,
      })
      .toBe(3);
    const fileNames = await page
      .getByTestId('folder-tree-file')
      .allTextContents();
    expect(fileNames.some((n) => n.includes('fresh.hwp'))).toBe(true);
  });

  test('clicking a non-hwp file is a no-op (does not crash)', async () => {
    const { page } = launched;
    const txt = page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'notes.txt' });
    await txt.click();
    // No error popup; viewer still on welcome screen since no .hwp opened.
    await expect(page.getByTestId('welcome-new-doc')).toBeVisible();
  });

  test('clicking a .hwp file opens it in the studio viewer', async () => {
    const { page } = launched;
    // Replace the placeholder a.hwp with a valid blank doc, since the fixture
    // file is just text. file:new gives us a real CFB file we can rename.
    const real = await page.evaluate(async () => window.api.file.new());
    await rm(path.join(fixture.root, 'a.hwp'));
    // Rename via fs
    const fs = await import('node:fs/promises');
    await fs.rename(real.path, path.join(fixture.root, 'a.hwp'));
    // Wait for chokidar to surface the renamed file.
    await expect
      .poll(async () =>
        (await page.getByTestId('folder-tree-file').allTextContents()).some(
          (n) => n.includes('a.hwp'),
        ),
      )
      .toBe(true);
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .first()
      .click();
    await expect(page.getByTestId('studio-viewer')).toBeVisible({
      timeout: 30_000,
    });
  });
});
