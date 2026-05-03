/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Find & Replace — chunk 7. Wraps @rhwp/core's replaceOne / replaceAll
 * (delegating case-handling to the IR rather than splicing matches in JS).
 *
 * The find bar is shared with chunk 9's search; replace adds a second row
 * with the substitution input + 바꾸기 / 모두 바꾸기 buttons. ⌘H opens the
 * bar focused on the replace input.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  getTextRange(s: number, p: number, start: number, end: number): string;
  openFind(initial?: string): void;
  openReplace(): void;
  setReplaceQuery(text: string): void;
  replaceCurrent(override?: string): void;
  replaceAll(override?: string): void;
  closeFind(): void;
  getFindState(): {
    open: boolean;
    query: string;
    matchCount: number;
    activeIndex: number;
    replaceQuery: string;
    replaceFeedback: string | null;
  };
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

test.describe('studio find & replace — chunk 7', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('⌘H opens the find bar with replace row visible', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.openReplace();
    });
    await expect(page.getByTestId('studio-find-bar')).toBeVisible();
    await expect(page.getByTestId('studio-replace-row')).toBeVisible();
    await expect(page.getByTestId('studio-replace-input')).toBeVisible();
    await expect(page.getByTestId('studio-replace-one')).toBeVisible();
    await expect(page.getByTestId('studio-replace-all')).toBeVisible();
  });

  /**
   * `getFindState()` reads closure-captured React state from the moment the
   * `__studioDebug` object was last set up, so calling it synchronously
   * after a setState-driven path (`runFindSearch`, `replaceX`) returns stale
   * values. We poll until the renderer surfaces the new state.
   */
  const matchCount = (page: Page) =>
    page.evaluate(
      () =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.getFindState().matchCount,
    );

  test('replaceOne replaces only the first match; remaining matches stay', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'alpha beta alpha gamma alpha');
      dbg.openFind('alpha');
    });
    await expect.poll(() => matchCount(page)).toBe(3);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.replaceCurrent('XXX');
    });
    await expect.poll(() => matchCount(page)).toBe(2);

    const text = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getTextRange(0, 0, 0, 200),
    );
    expect(text).toContain('XXX beta alpha gamma alpha');
  });

  test('replaceAll replaces every match in one shot', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'apple banana apple banana apple');
      dbg.openFind('apple');
    });
    await expect.poll(() => matchCount(page)).toBe(3);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.replaceAll('cherry');
    });
    await expect.poll(() => matchCount(page)).toBe(0);

    const text = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getTextRange(0, 0, 0, 200),
    );
    expect(text).toContain('cherry banana cherry banana cherry');
  });

  test('empty replacement deletes the matches', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'keep DROP keep DROP keep');
      dbg.openFind('DROP ');
    });
    await expect.poll(() => matchCount(page)).toBe(2);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.replaceAll('');
    });
    await expect.poll(() => matchCount(page)).toBe(0);

    const text = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getTextRange(0, 0, 0, 200),
    );
    expect(text).toContain('keep keep keep');
    expect(text).not.toContain('DROP');
  });

  test('replace buttons are disabled when there are no matches', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'hello world');
      dbg.openFind('zzzzzzz');
    });
    await expect(page.getByTestId('studio-find-count')).toHaveText('0 / 0');
    await expect(page.getByTestId('studio-replace-one')).toBeDisabled();
    await expect(page.getByTestId('studio-replace-all')).toBeDisabled();
  });

  test('case-insensitive replace (matches lowercase + uppercase)', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'Hello hello HELLO');
      dbg.openFind('hello');
    });
    await expect.poll(() => matchCount(page)).toBe(3);

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.replaceAll('Hi');
    });
    await expect.poll(() => matchCount(page)).toBe(0);

    const text = await page.evaluate(() =>
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.getTextRange(0, 0, 0, 200),
    );
    // All three case variants collapsed to 'Hi'.
    expect(text).not.toMatch(/[Hh][Ee][Ll][Ll][Oo]/);
    expect(text).toContain('Hi Hi Hi');
  });
});
