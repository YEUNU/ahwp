/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * ChatPanel chunk 20 — excerpt attachment chips.
 *
 * Drives capture/verify through __studioDebug since real HTML5 drag
 * from the SVG selection model isn't wired (deferred polish item, see
 * docs/AI_INTEGRATION.md §발췌 드래그 첨부 UX). The chunk 20
 * deliverable is the data model + chip UI + send-time stale check —
 * dragging from the viewer onto chat is a follow-up.
 *
 * Flow under test:
 *   1. Set selection in viewer
 *   2. Click "📌 발췌 첨부" → chip appears
 *   3. Optionally edit IR to invalidate the anchor
 *   4. Send → ChatPanel verifies, surfaces error or re-anchors
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  deleteText(s: number, p: number, c: number, count: number): string;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  captureExcerpt(): unknown;
  getParagraphCount(s: number): number;
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

/** Seed paragraph 0 with `text`, then select [start..end] inside it. */
async function seedSelection(
  page: Page,
  text: string,
  start: number,
  end: number,
): Promise<void> {
  await page.evaluate(
    ({ text, start, end }: { text: string; start: number; end: number }) => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // Clear paragraph 0 first by scanning length and deleting.
      // Simpler: just insert at the start; tests use blank fixture.
      dbg.insertText(0, 0, 0, text);
      dbg.setSelection(0, start, 0, end);
    },
    { text, start, end },
  );
}

test.describe('chat — chunk 20 excerpt attachment', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('capture button visible whenever attach toggle is — clicking with no viewer surfaces error', async () => {
    const { page } = launched;
    // No fixture loaded → no active viewer. AppShell still passes
    // captureExcerpt (a thunk that returns null when there's no viewer),
    // so the button renders. Clicking it surfaces the "no selection"
    // error instead of silently doing nothing.
    await expect(page.getByTestId('chat-capture-excerpt')).toBeVisible();
    await page.getByTestId('chat-capture-excerpt').click();
    await expect(page.getByTestId('chat-excerpt-error')).toBeVisible();
  });

  test('capture creates a chip; chip shows label, paragraph idx, snippet', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await seedSelection(page, '안녕하세요 반갑습니다', 0, 5);

    await page.getByTestId('chat-capture-excerpt').click();

    const chip = page.getByTestId('chat-excerpt-chip');
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('data-status', 'fresh');
    await expect(chip).toHaveAttribute('data-role', 'target');
    await expect(chip).toContainText('¶0');
    await expect(chip).toContainText('안녕하세요');
  });

  test('capture without selection surfaces error', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    await page.getByTestId('chat-capture-excerpt').click();
    await expect(page.getByTestId('chat-excerpt-error')).toBeVisible();
    await expect(page.getByTestId('chat-excerpt-chip')).toHaveCount(0);
  });

  test('attach toggle disables when chips present (excerpts win)', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await seedSelection(page, 'foobar', 0, 3);

    const toggle = page.getByTestId('chat-attach-checkbox');
    await expect(toggle).toBeEnabled();

    await page.getByTestId('chat-capture-excerpt').click();
    await expect(toggle).toBeDisabled();

    // Remove the chip → toggle re-enabled.
    await page.getByTestId('chat-excerpt-remove').click();
    await expect(page.getByTestId('chat-excerpt-chip')).toHaveCount(0);
    await expect(toggle).toBeEnabled();
  });

  test('chip remove × button drops it from state', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await seedSelection(page, '한컴 한글 보고서', 0, 5);
    await page.getByTestId('chat-capture-excerpt').click();
    await expect(page.getByTestId('chat-excerpt-chip')).toHaveCount(1);
    await page.getByTestId('chat-excerpt-remove').click();
    await expect(page.getByTestId('chat-excerpt-chip')).toHaveCount(0);
  });

  test('send with stale-relocated anchor — chip shifts to relocated and goes through', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await seedSelection(page, '제안서 본문 시작', 0, 3);
    await page.getByTestId('chat-capture-excerpt').click();

    // Insert text BEFORE the anchor — captured offset shifts.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'XX');
    });

    await page.getByTestId('chat-input').fill('ECHO:이 발췌를 다듬어줘');
    await page.getByTestId('chat-send').click();

    // No error — stale-relocated is silent.
    await expect(page.getByTestId('chat-excerpt-error')).toHaveCount(0);
    // Chip persists with relocated status (anchor updated to new offset).
    const chip = page.getByTestId('chat-excerpt-chip');
    await expect(chip).toHaveAttribute('data-status', 'stale-relocated');

    // Streaming wrapped up.
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  test('send with stale-missing anchor — error shown, send blocked', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await seedSelection(page, '한번만 등장하는 고유한 문구', 0, 11);
    await page.getByTestId('chat-capture-excerpt').click();

    // Wipe the source paragraph completely.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.deleteText(0, 0, 0, 1000);
    });

    await page.getByTestId('chat-input').fill('ECHO:fail');
    await page.getByTestId('chat-send').click();

    await expect(page.getByTestId('chat-excerpt-error')).toBeVisible();
    // No assistant turn was created because send was blocked.
    await expect(
      page.locator('[data-testid="chat-message"][data-role="assistant"]'),
    ).toHaveCount(0);
  });

  test('long excerpt shows ⚠️ token-cost warning', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    // 2500 chars > EXCERPT_SOFT_CHAR_LIMIT (2000)
    const long = 'X'.repeat(2500);
    await seedSelection(page, long, 0, 2500);
    await page.getByTestId('chat-capture-excerpt').click();

    const chip = page.getByTestId('chat-excerpt-chip');
    await expect(chip).toContainText('⚠️');
  });
});
