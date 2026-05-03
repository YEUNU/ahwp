/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * 1차 UX round — chunks 50/51/52/53/54/55:
 *
 *   - 50: ⌘K command palette
 *   - 51: status bar word/char/paragraph counters
 *   - 52: auto-save sidecar (`<path>.ahwp-draft`)
 *   - 53: ⌘/ shortcuts cheatsheet
 *   - 54: page paper stays white in dark mode
 *   - 55: tab pinning protects against bulk close
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
  focusViewer(): void;
  exportBytes(): Uint8Array;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

async function openFixture(page: Page): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, FIXTURE);
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

test.describe('round 1 UX — chunks 50/51/52/53/54/55', () => {
  test.skip(!existsSync(FIXTURE), 'fixtures/blank.hwpx missing');

  test('chunk 50 — ⌘K opens the command palette and filters by query', async () => {
    const { page } = launched;
    await openFixture(page);

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+k`);
    await expect(page.getByTestId('command-palette')).toBeVisible();

    // Type a partial query — only matching items should remain.
    await page.getByTestId('command-palette-input').fill('저장');
    const items = page.getByTestId('command-palette-item');
    await expect(items.first()).toBeVisible();
    // At least one match should mention "저장".
    const firstText = await items.first().textContent();
    expect(firstText ?? '').toContain('저장');

    // Esc closes.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).not.toBeVisible();
  });

  test('chunk 51 — status bar shows word/char counters', async () => {
    const { page } = launched;
    await openFixture(page);

    // Status bar appears once the doc is ready.
    const stats = page.getByTestId('studio-doc-stats');
    await expect(stats).toBeVisible({ timeout: 5000 });
    // Initial blank doc has zero or near-zero chars.
    const initialText = await stats.textContent();
    expect(initialText ?? '').toMatch(/단어/);
    expect(initialText ?? '').toMatch(/글자/);

    // Insert text → counter updates after debounce.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '안녕 세계 hello world');
    });
    await expect
      .poll(async () => (await stats.textContent()) ?? '')
      .toMatch(/[1-9]/);
  });

  test('chunk 52 — saveDraft + hasDraft + clearDraft IPC contract', async () => {
    const { page, userDataDir } = launched;
    await openFixture(page);

    const target = path.join(userDataDir, 'autosave-test.hwp');
    // Stage an "existing" file so a draft alongside it is meaningful.
    await page.evaluate(async (p) => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      await window.api.file.save({ path: p, bytes });
    }, target);

    // Initially no draft.
    expect(
      await page.evaluate(
        async (p) => await window.api.file.hasDraft(p),
        target,
      ),
    ).toBe(false);

    // Save a draft.
    await page.evaluate(async (p) => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      await window.api.file.saveDraft({ path: p, bytes });
    }, target);

    // hasDraft now true; on-disk sibling exists.
    expect(
      await page.evaluate(
        async (p) => await window.api.file.hasDraft(p),
        target,
      ),
    ).toBe(true);
    expect(existsSync(`${target}.ahwp-draft`)).toBe(true);

    // Clear and verify.
    await page.evaluate(
      async (p) => await window.api.file.clearDraft(p),
      target,
    );
    expect(existsSync(`${target}.ahwp-draft`)).toBe(false);
  });

  test('chunk 53 — ⌘/ opens the shortcuts cheatsheet', async () => {
    const { page } = launched;
    await openFixture(page);

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+/`);
    // UI/UX align — 단축키는 Settings 의 단축키 탭으로 통합.
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await expect(page.getByTestId('settings-pane-body')).toContainText('⌘K');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).not.toBeVisible();
  });

  test('chunk 54 — page div uses --paper variable (light mode = white)', async () => {
    const { page } = launched;
    await openFixture(page);

    // The page surface ([data-testid="studio-viewer-page"]) is the SVG
    // mount target; its parent (the cursor-text div) carries the bg.
    const bg = await page.evaluate(() => {
      const svgRoot = document.querySelector(
        '[data-testid="studio-viewer-page"]',
      ) as HTMLElement | null;
      const pageDiv = svgRoot?.parentElement as HTMLElement | null;
      if (!pageDiv) return null;
      return getComputedStyle(pageDiv).backgroundColor;
    });
    // hsl(0, 0%, 100%) resolves to rgb(255, 255, 255).
    expect(bg).toBe('rgb(255, 255, 255)');
  });
});
