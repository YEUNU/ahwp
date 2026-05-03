/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Equation preview — chunk 16. Wraps `renderEquationPreview` from
 * @rhwp/core. Returns a self-contained SVG string for any 한컴 수식
 * script.
 *
 * Inserting a new equation control into the body is deferred (no
 * one-call createEquation in the lib). MVP is preview-only.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  renderEquationSvg(
    script: string,
    fontSizeHwpunit?: number,
    color?: number,
  ): string;
}

async function activateStudio(page: Page, fixture: string): Promise<void> {
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

test.describe('studio equation — chunk 16', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('renderEquationSvg returns a non-empty <svg> string', async () => {
    const svg = await launched.page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.renderEquationSvg('a^2 + b^2 = c^2'),
    );
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });

  test('UI: insert:equation IPC opens dialog with default script + preview', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'insert:equation');
    });
    await expect(page.getByTestId('equation-dialog')).toBeVisible();
    await expect(page.getByTestId('equation-script')).toHaveValue(
      'a^2 + b^2 = c^2',
    );
    // Preview area should contain the rendered SVG.
    const previewSvg = page.getByTestId('equation-preview').locator('svg');
    await expect(previewSvg).toBeVisible({ timeout: 5_000 });
  });

  test('UI: changing script re-renders the preview', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'insert:equation');
    });
    const script = page.getByTestId('equation-script');
    await script.fill('1 over 2');
    // The IR re-renders the new svg — we can't easily assert on
    // contents, but the <svg> element should still be present.
    const previewSvg = page.getByTestId('equation-preview').locator('svg');
    await expect(previewSvg).toBeVisible({ timeout: 5_000 });
  });

  test('UI: clearing the script shows the placeholder', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'insert:equation');
    });
    await page.getByTestId('equation-script').fill('');
    await expect(page.getByTestId('equation-preview')).toContainText(
      '수식을 입력하면',
    );
  });
});
