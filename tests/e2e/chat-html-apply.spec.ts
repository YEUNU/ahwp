/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * ChatPanel chunk 18 — doc-context toggle + apply-html button.
 *
 * Uses the env-gated fake provider so assistant content is the exact
 * payload echoed back. The renderer detects ```html``` fences in the
 * completed assistant message and surfaces a "문서에 적용" button that
 * forwards the fragment to the active StudioViewer's
 * applyHtmlAtCaret. End-to-end coverage of the IR side already lives
 * in studio-html-paste.spec.ts; here we lock the chat-side wiring.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  getParaProps(s: number, p: number): Record<string, unknown>;
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

async function sendEcho(page: Page, payload: string): Promise<void> {
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

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

test.describe('chat — chunk 18 doc-context + apply-html', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('attach-doc toggle is visible when a doc is loaded', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await expect(page.getByTestId('chat-attach-toggle')).toBeVisible();
    // chunk 74 — default true (persisted via localStorage). User
    // expectation when opening ChatPanel with an active doc is "AI
    // already sees what I'm looking at".
    await expect(page.getByTestId('chat-attach-checkbox')).toBeChecked();
  });

  test('apply-html button surfaces on assistant html block + applies to doc', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // Echo a markdown response containing a single ```html``` block. The
    // fake provider yields the payload verbatim.
    const reply =
      '여기 정렬 변경:\n```html\n<p style="text-align:center;">CENTER</p>\n```';
    await sendEcho(page, reply);

    const applyBtn = page.getByTestId('chat-action-apply-html');
    await expect(applyBtn).toBeVisible();
    await expect(applyBtn).toHaveText('문서에 적용');

    await applyBtn.click();
    await expect(applyBtn).toHaveText('✓ 적용됨');

    // Verify the doc actually received the alignment change.
    const align = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(align).toBe('center');
  });

  test('no apply-html button on assistant messages without ```html``` block', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await sendEcho(page, '안녕 그냥 인사할게');
    await expect(page.getByTestId('chat-action-apply-html')).toHaveCount(0);
  });
});
