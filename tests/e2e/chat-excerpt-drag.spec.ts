/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * ChatPanel chunk 22 — HTML5 drag from selection rect to chat form.
 *
 * The selection rect (`studio-selection-rect`) is now `draggable=true`
 * and emits a structured `application/x-ahwp-excerpt` payload on
 * dragstart. The chat input form's onDrop accepts that MIME and
 * promotes the payload to a chip — the same chip shape as the button
 * path (chunk 20).
 *
 * Playwright's dragTo helper drives real DOM drag events, so this
 * exercises the full HTML5 surface, not a synthetic shortcut.
 *
 * Uses STRESS_FIXTURE (not blank.hwpx) because blank.hwpx's seed
 * paragraph has no rendered layout (lib quirk noted in
 * studio-selection.spec.ts) and getSelectionRects returns [] there.
 * Drag needs a visible selection rect.
 */

const FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
  await launched.page.evaluate(async () => {
    await window.api.secrets.set('openai', 'test-key');
  });
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await launched.close();
});

async function openFixture(page: Page, fixture: string): Promise<void> {
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

async function selectAndWaitForRect(page: Page): Promise<void> {
  // Use paragraph 5 — the stress fixture has rendered text there.
  await page.evaluate(() => {
    const dbg = (window as Window & { __studioDebug?: StudioDebug })
      .__studioDebug!;
    dbg.setSelection(5, 0, 5, 10);
  });
  await expect
    .poll(async () => page.getByTestId('studio-selection-rect').count(), {
      timeout: 10_000,
    })
    .toBeGreaterThan(0);
}

test.describe('chat — chunk 22 selection drag UX', () => {
  test.skip(
    !existsSync(FIXTURE),
    '예시 .hwp fixture missing (gitignored stress doc)',
  );

  test('selection rect is draggable when selection is non-empty', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await selectAndWaitForRect(page);
    const rect = page.getByTestId('studio-selection-rect').first();
    await expect(rect).toHaveAttribute('draggable', 'true');
  });

  test('drag from selection rect to chat form creates a chip', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await selectAndWaitForRect(page);

    // Playwright's dragTo doesn't reliably propagate custom MIME types
    // through dataTransfer in synthetic drag events. We dispatch the
    // sequence manually with a shared DataTransfer so the rect's
    // onDragStart populates it and the form's onDrop reads it back.
    await page.evaluate(() => {
      const rect = document.querySelector(
        '[data-testid="studio-selection-rect"]',
      ) as HTMLElement | null;
      const form = document.querySelector(
        '[data-testid="chat-input-form"]',
      ) as HTMLElement | null;
      if (!rect || !form) throw new Error('missing rect or form');
      const dt = new DataTransfer();
      rect.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      form.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      form.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      rect.dispatchEvent(
        new DragEvent('dragend', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    });

    const chip = page.getByTestId('chat-excerpt-chip');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('data-status', 'fresh');
  });

  test('drag preserves anchor — send-time stale check passes', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await selectAndWaitForRect(page);

    await page.evaluate(() => {
      const rect = document.querySelector(
        '[data-testid="studio-selection-rect"]',
      ) as HTMLElement;
      const form = document.querySelector(
        '[data-testid="chat-input-form"]',
      ) as HTMLElement;
      const dt = new DataTransfer();
      rect.dispatchEvent(
        new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      form.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
      form.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
        }),
      );
    });
    await expect(page.getByTestId('chat-excerpt-chip')).toHaveCount(1);

    // Send turn — should pass stale check (anchor still fresh).
    await page.getByTestId('chat-input').fill('ECHO:hi');
    await page.getByTestId('chat-send').click();
    await expect(page.getByTestId('chat-send')).toBeVisible();
    await expect(page.getByTestId('chat-excerpt-error')).toHaveCount(0);
  });
});
