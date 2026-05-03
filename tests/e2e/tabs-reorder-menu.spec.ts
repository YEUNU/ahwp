/// <reference lib="dom" />
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 1 leftover: tab drag-reorder + right-click context menu.
 * Uses three temp copies of blank.hwpx so the path-keyed tab state has
 * three distinct entries.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

let launched: LaunchedApp;
let tmpDir: string;
let docs: string[];

test.beforeEach(async () => {
  tmpDir = mkdtempSync(path.join(tmpdir(), 'ahwp-tabs-'));
  docs = ['a.hwpx', 'b.hwpx', 'c.hwpx'].map((n) => path.join(tmpDir, n));
  for (const d of docs) copyFileSync(FIXTURE, d);

  launched = await launchApp();
  await launched.page.evaluate(async (paths) => {
    await window.api.session.set({
      openTabPaths: paths,
      lastActivePath: paths[0],
    });
  }, docs);
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
  await launched.page.waitForFunction(
    () => document.querySelectorAll('[data-testid="studio-tab"]').length >= 3,
    { timeout: 30_000 },
  );
});

test.afterEach(async () => {
  await launched.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function tabPaths(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="studio-tab"]')).map(
      (el) => (el as HTMLElement).dataset.path ?? '',
    ),
  );
}

test.describe('tabs — Phase 1 leftover (reorder + context menu)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('drag tab[2] before tab[0] → order swaps to c, a, b', async () => {
    const { page } = launched;
    expect(await tabPaths(page)).toEqual(docs);

    // Synthetic drag — Playwright's dragTo doesn't propagate custom MIME
    // through the synthetic events, so we drive dispatchEvent directly.
    await page.evaluate(() => {
      const tabs = Array.from(
        document.querySelectorAll('[data-testid="studio-tab"]'),
      ) as HTMLElement[];
      const dt = new DataTransfer();
      tabs[2].dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      tabs[0].dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      tabs[0].dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    });

    const after = await tabPaths(page);
    expect(after[0]).toBe(docs[2]);
    expect(after[1]).toBe(docs[0]);
    expect(after[2]).toBe(docs[1]);
  });

  test('right-click → "다른 탭 모두 닫기" leaves only the targeted tab', async () => {
    const { page } = launched;
    // Auto-confirm the dirty-check (none should be dirty, so confirm
    // shouldn't even appear; safety guard anyway).
    page.on('dialog', (d) => void d.accept());

    const tabs = page.getByTestId('studio-tab');
    await tabs.nth(1).click({ button: 'right' });
    await expect(page.getByTestId('studio-tab-context-menu')).toBeVisible();
    await page.getByTestId('studio-tab-menu-close-others').click();
    await expect(tabs).toHaveCount(1);
    expect(await tabPaths(page)).toEqual([docs[1]]);
  });

  test('right-click → "오른쪽 탭 모두 닫기" trims tabs after target', async () => {
    const { page } = launched;
    page.on('dialog', (d) => void d.accept());

    const tabs = page.getByTestId('studio-tab');
    await tabs.nth(0).click({ button: 'right' });
    await page.getByTestId('studio-tab-menu-close-right').click();
    await expect(tabs).toHaveCount(1);
    expect(await tabPaths(page)).toEqual([docs[0]]);
  });

  test('context menu hides on Escape', async () => {
    const { page } = launched;
    await page.getByTestId('studio-tab').nth(0).click({ button: 'right' });
    await expect(page.getByTestId('studio-tab-context-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('studio-tab-context-menu')).toHaveCount(0);
  });
});
