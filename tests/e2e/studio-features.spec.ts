/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Toolbar expansion + new editor ops surfaced in the second row:
 *   - Bullet / numbered list toggles
 *   - Page break insertion
 *   - Insert table (rows × cols mini picker)
 *   - View toggles (control codes, transparent borders)
 *
 * Uses the stress fixture so paragraphs already have layout (the
 * blank.hwpx seed paragraph has length 0 and would no-op many of these).
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface StudioDebug {
  isDirty(): boolean;
}

async function activate(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(
    () =>
      Boolean(
        (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
      ),
    { timeout: 30_000 },
  );
}

test.describe('studio toolbar — expand + new ops', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activate(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('toolbar expand button toggles the second row', async () => {
    const { page } = launched;
    await expect(page.getByTestId('studio-toolbar-row2')).toHaveCount(0);
    await page.getByTestId('studio-toolbar-more').click();
    await expect(page.getByTestId('studio-toolbar-row2')).toBeVisible();
    await page.getByTestId('studio-toolbar-more').click();
    await expect(page.getByTestId('studio-toolbar-row2')).toHaveCount(0);
  });

  test('numbered list toggle marks the doc dirty', async () => {
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-toggle-number').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.isDirty(),
        ),
      )
      .toBe(true);
  });

  test('page break increases pageCount', async () => {
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    const beforeText =
      (await page.getByTestId('studio-page-indicator').textContent()) ?? '';
    const before = Number(beforeText.match(/\/\s*(\d+)/)?.[1] ?? 0);
    expect(before).toBeGreaterThan(0);
    await page.getByTestId('studio-insert-page-break').click();
    await expect
      .poll(async () => {
        const txt =
          (await page.getByTestId('studio-page-indicator').textContent()) ?? '';
        return Number(txt.match(/\/\s*(\d+)/)?.[1] ?? 0);
      })
      .toBeGreaterThan(before);
  });

  test('table picker shows then hides on cancel', async () => {
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    await expect(page.getByTestId('studio-table-picker')).toBeVisible();
    // 64 cells in the 8×8 grid.
    await expect(page.getByTestId('studio-table-picker-cell')).toHaveCount(64);
    // Click the same button again to close.
    await page.getByTestId('studio-insert-table').click();
    await expect(page.getByTestId('studio-table-picker')).toHaveCount(0);
  });

  test('table picker click commits a 3×3 table (doc dirty)', async () => {
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    await page.getByTestId('studio-insert-table').click();
    // Pick the 3rd row, 3rd column cell.
    const cell = page
      .locator(
        '[data-testid="studio-table-picker-cell"][data-rows="3"][data-cols="3"]',
      )
      .first();
    await cell.click();
    // Picker closes; doc is dirty.
    await expect(page.getByTestId('studio-table-picker')).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.isDirty(),
        ),
      )
      .toBe(true);
  });

  test('view toggles flip aria-pressed', async () => {
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    const ctrls = page.getByTestId('studio-toggle-controls');
    await expect(ctrls).toHaveAttribute('aria-pressed', 'false');
    await ctrls.click();
    await expect(ctrls).toHaveAttribute('aria-pressed', 'true');

    const trans = page.getByTestId('studio-toggle-transparent');
    await expect(trans).toHaveAttribute('aria-pressed', 'false');
    await trans.click();
    await expect(trans).toHaveAttribute('aria-pressed', 'true');
  });
});
