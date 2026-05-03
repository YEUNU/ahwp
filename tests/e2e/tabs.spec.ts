/// <reference lib="dom" />
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Multi-tab editor.
 *
 * - Open two .hwp files via folder tree → two tabs
 * - Tab click switches active; only the active StudioViewer is visible
 * - Close X removes a tab; ⌘W closes the active tab
 * - Session persists openTabPaths + activeIndex across reload
 *
 * The fixture seeds two real CFB blanks via the file:new IPC, then
 * renames them into a fresh temp folder we open as the workspace.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
}

async function makeFixture(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ahwp-tabs-'));
  await mkdir(root, { recursive: true });
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.describe('editor tabs', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;
  let fixture: { root: string; cleanup: () => Promise<void> };

  test.beforeEach(async () => {
    fixture = await makeFixture();
    // Drop two real .hwp files into the temp folder by copying the
    // stress fixture (real CFB bytes — opens cleanly in StudioViewer).
    await copyFile(STRESS_FIXTURE, path.join(fixture.root, 'a.hwp'));
    await copyFile(STRESS_FIXTURE, path.join(fixture.root, 'b.hwp'));
    launched = await launchApp();
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

  test('opening two files creates two tabs; second is active', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await expect(page.getByTestId('studio-tab')).toHaveCount(1);
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'b.hwp' })
      .click();
    await expect(page.getByTestId('studio-tab')).toHaveCount(2);
    // Second tab (b.hwp) should be active.
    const tabs = page.getByTestId('studio-tab');
    await expect(tabs.nth(1)).toHaveAttribute('data-active', 'true');
    await expect(tabs.nth(0)).toHaveAttribute('data-active', 'false');
  });

  test('clicking a tab switches the visible viewer', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'b.hwp' })
      .click();
    // Click first tab to switch.
    await page.getByTestId('studio-tab').nth(0).click();
    await expect(page.getByTestId('studio-tab').nth(0)).toHaveAttribute(
      'data-active',
      'true',
    );
    // Both viewers stay mounted (display:none for inactive).
    const panes = page.locator('[data-testid="studio-tab-pane"]');
    await expect(panes).toHaveCount(2);
  });

  test('clicking the same file again focuses the existing tab (no dup)', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await expect(page.getByTestId('studio-tab')).toHaveCount(1);
  });

  test('tab close X removes the tab', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'b.hwp' })
      .click();
    await expect(page.getByTestId('studio-tab')).toHaveCount(2);
    // Close the active (second) tab.
    await page
      .getByTestId('studio-tab')
      .nth(1)
      .getByTestId('studio-tab-close')
      .click();
    await expect(page.getByTestId('studio-tab')).toHaveCount(1);
    // Remaining tab is now active.
    await expect(page.getByTestId('studio-tab').nth(0)).toHaveAttribute(
      'data-active',
      'true',
    );
  });

  test('Cmd/Ctrl+W closes the active tab', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'b.hwp' })
      .click();
    await expect(page.getByTestId('studio-tab')).toHaveCount(2);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+w`);
    await expect(page.getByTestId('studio-tab')).toHaveCount(1);
  });

  test('dirty tab shows the dot; non-dirty tab does not', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    // Wait for the studio to mount + attach __studioDebug.
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    // Make a mutation so the tab becomes dirty.
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 11, 0, 'X');
    });
    await expect
      .poll(async () => {
        const t = await page
          .getByTestId('studio-tab')
          .nth(0)
          .getAttribute('data-dirty');
        return t;
      })
      .toBe('true');
    await expect(
      page.getByTestId('studio-tab').nth(0).getByTestId('studio-tab-dirty-dot'),
    ).toBeVisible();
  });

  test('session restores open tabs + active index after reload', async () => {
    const { page } = launched;
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'a.hwp' })
      .click();
    await page
      .getByTestId('folder-tree-file')
      .filter({ hasText: 'b.hwp' })
      .click();
    // Switch to first tab so lastActivePath = a.hwp.
    await page.getByTestId('studio-tab').nth(0).click();
    await expect(page.getByTestId('studio-tab').nth(0)).toHaveAttribute(
      'data-active',
      'true',
    );

    // Reload — both tabs should re-mount, first one active.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('studio-tab')).toHaveCount(2);
    await expect(page.getByTestId('studio-tab').nth(0)).toHaveAttribute(
      'data-active',
      'true',
    );
  });
});
