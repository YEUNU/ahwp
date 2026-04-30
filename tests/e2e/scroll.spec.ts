/// <reference lib="dom" />
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

/**
 * Sanity checks that the left folder tree and the editor tab bar both
 * scroll when their content overflows. We don't actually need to drive
 * the scroll — the assertion is that scrollHeight/scrollWidth exceed
 * clientHeight/clientWidth (i.e. the panel is scrollable at all).
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface DimDom {
  scrollHeight: number;
  clientHeight: number;
  scrollWidth: number;
  clientWidth: number;
}

async function readDims(
  page: import('@playwright/test').Page,
  testid: string,
): Promise<DimDom> {
  return page.evaluate((id) => {
    const el = document.querySelector(
      `[data-testid="${id}"]`,
    ) as HTMLElement | null;
    if (!el) throw new Error(`element not found: ${id}`);
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    };
  }, testid);
}

test.describe('scroll behavior — folder tree + tab bar', () => {
  test('folder tree scrolls vertically when contents overflow', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ahwp-scroll-folder-'));
    try {
      // Create enough files that the total list height exceeds the panel.
      // 100 entries × ~22px each ≈ 2200px, far above the typical panel.
      for (let i = 0; i < 100; i++) {
        await writeFile(
          path.join(root, `file_${String(i).padStart(3, '0')}.txt`),
          'x',
        );
      }
      const launched = await launchApp();
      try {
        await launched.page.evaluate(async (r) => {
          await window.api.session.set({ lastFolderPath: r });
        }, root);
        await launched.page.reload();
        await launched.page.waitForLoadState('domcontentloaded');
        // Wait for the tree to render at least one entry.
        await expect(
          launched.page.getByTestId('folder-tree-file').first(),
        ).toBeVisible({ timeout: 10_000 });
        const dims = await readDims(launched.page, 'folder-tree');
        // Vertical overflow: scrollHeight greater than clientHeight.
        expect(dims.scrollHeight).toBeGreaterThan(dims.clientHeight);
        // Sanity — file count rendered should equal what we wrote.
        await expect(launched.page.getByTestId('folder-tree-file')).toHaveCount(
          100,
        );
      } finally {
        await launched.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('tab bar scrolls horizontally when many tabs are open', async () => {
    test.skip(
      !existsSync(STRESS_FIXTURE),
      'examples/*.hwp stress fixture missing (gitignored)',
    );
    const root = await mkdtemp(path.join(tmpdir(), 'ahwp-scroll-tabs-'));
    try {
      await mkdir(root, { recursive: true });
      // 30 copies of the stress fixture — each opens cleanly.
      for (let i = 0; i < 30; i++) {
        await copyFile(
          STRESS_FIXTURE,
          path.join(root, `tab_${String(i).padStart(2, '0')}.hwp`),
        );
      }
      const launched = await launchApp();
      try {
        await launched.page.evaluate(async (r) => {
          await window.api.session.set({ lastFolderPath: r });
        }, root);
        await launched.page.reload();
        await launched.page.waitForLoadState('domcontentloaded');
        // Click each file in the folder tree to open as a tab.
        const files = launched.page.getByTestId('folder-tree-file');
        await expect(files).toHaveCount(30);
        for (let i = 0; i < 30; i++) {
          await files.nth(i).click();
        }
        await expect(launched.page.getByTestId('studio-tab')).toHaveCount(30);
        const dims = await readDims(launched.page, 'studio-tabbar');
        // Horizontal overflow: scrollWidth greater than clientWidth.
        expect(dims.scrollWidth).toBeGreaterThan(dims.clientWidth);
      } finally {
        await launched.close();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
