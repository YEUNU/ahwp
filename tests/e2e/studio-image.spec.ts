/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Image insertion — toolbar button + drag-from-OS drop.
 *
 * The toolbar's "이미지 삽입" button triggers a hidden `<input type="file">`
 * that we can't drive cross-platform from Playwright. Drop events are
 * also tricky — we can fake them with dataTransfer.setData but the
 * `files` list won't be a real FileList. Both paths share the same
 * insertImage helper, so we exercise that helper directly via
 * __studioDebug.insertImageBase64 (deterministic, no FS dance).
 *
 * The actual UI handlers (button click + drop) are tiny shims that
 * unwrap the file → ArrayBuffer → call insertImage(...) — verified by
 * type-check + manual smoke. The test below covers the data path.
 */

const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

// 1×1 transparent PNG, base64-encoded. Validated by encoding.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

interface StudioDebug {
  isDirty(): boolean;
  insertImageBase64(
    base64: string,
    ext: string,
    description?: string,
  ): Promise<void>;
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

test.describe('image insert', () => {
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

  test('toolbar exposes the image-insert button + hidden file input', async () => {
    const { page } = launched;
    await page.getByTestId('studio-toolbar-more').click();
    await expect(page.getByTestId('studio-insert-image')).toBeVisible();
    // Hidden input is in the DOM but visually hidden (CSS `display: none`).
    const inputEl = page.getByTestId('studio-image-input');
    await expect(inputEl).toBeAttached();
    await expect(inputEl).toHaveAttribute('type', 'file');
  });

  test('insertImageBase64 inserts a picture into the doc', async () => {
    const { page } = launched;
    // Place the caret at the start of paragraph 5 (real text fixture).
    await page.evaluate(() => {
      // The fixture loads the user's stress doc; default caret is fine
      // for inserting at position (0, 0, 0).
    });
    await page.evaluate(
      async ({ b64 }) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        await dbg.insertImageBase64(b64, 'png', 'red dot');
      },
      { b64: TINY_PNG_B64 },
    );
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.isDirty(),
        ),
      )
      .toBe(true);
    // chunk 107: post-SVG-removal — verify image presence via the lib's
    // page-layer-tree (which lists every paint op including images, with
    // base64 data URIs). Body-layer images live on the canvas pixels;
    // floating images live in DOM `<img>` overlays. The layer tree is
    // the unified source of truth.
    const imagePresent = await page.evaluate(() => {
      const dbg = (
        window as Window & {
          __studioDebug?: { getPageLayerTreeJson?: (idx: number) => string };
        }
      ).__studioDebug;
      if (!dbg?.getPageLayerTreeJson) return false;
      const json = dbg.getPageLayerTreeJson(0);
      // Cheapest possible probe — the lib emits `"type":"image"` per
      // image op in the JSON. base64 follows when the image has data.
      return /"type":"image"/.test(json) && /"base64":"[^"]+"/.test(json);
    });
    expect(imagePresent).toBe(true);
  });
});
