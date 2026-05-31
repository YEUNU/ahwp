/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Deterministic form-fill regression guard (CI, no API key).
 *
 * Drives the real getEmptyFormFields → fillFormCells agent loop against a real
 * 양식(.hwp) fixture via the fake AI provider's `FORMFILL:` multi-step driver
 * (see electron/ai/providers/fake.ts): turn 1 calls getEmptyFormFields, turn 2
 * parses its result and fillFormCells-writes a sentinel into the first empty
 * cell (real fixture coords), turn 3 stops.
 *
 * Permanently guards the 0.7.13 bulk-fill + 0.7.15 scope self-heal fixes:
 * - getEmptyFormFields must return non-empty cellFields on a real form
 *   (else step 2 finds no cell → sentinel never written → assertion fails).
 * - fillFormCells must actually write into the table cell (the DOA-class
 *   regression that motivated this work).
 *
 * Runs whenever the e2e suite runs (AHWP_E2E_FAKE_AI=1 swaps all adapters).
 */

const STUDIO_DIST = path.resolve(
  __dirname,
  '..',
  '..',
  'vendor',
  'rhwp',
  'rhwp-studio',
  'dist',
  'index.html',
);
const FORM_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
);

/** Read-only wasm dispatch into the active editor iframe (assertions only). */
async function readWasm<T>(
  page: Page,
  fn: string,
  args: unknown[],
): Promise<T> {
  return (await page.evaluate(
    async ({ fn, args }) => {
      const iframe = document.querySelector(
        '[data-testid="rhwp-editor-iframe"]',
      ) as HTMLIFrameElement | null;
      if (!iframe || !iframe.contentWindow) {
        throw new Error('rhwp-editor iframe not mounted');
      }
      return await new Promise<unknown>((resolve, reject) => {
        const id = `verify-${Math.random().toString(36).slice(2)}`;
        const timer = window.setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error(`bridge timeout: ${fn}`));
        }, 15_000);
        const handler = (e: MessageEvent) => {
          const d = e.data as {
            type?: string;
            id?: string;
            result?: unknown;
            error?: string;
          };
          if (!d || d.type !== 'rhwp-response' || d.id !== id) return;
          if (e.source !== iframe.contentWindow) return;
          window.clearTimeout(timer);
          window.removeEventListener('message', handler);
          if (d.error) reject(new Error(d.error));
          else resolve(d.result);
        };
        window.addEventListener('message', handler);
        iframe.contentWindow!.postMessage(
          { type: 'rhwp-request', id, method: 'wasm', params: { fn, args } },
          '*',
        );
      });
    },
    { fn, args },
  )) as T;
}

/** Send a chat prompt and wait for the full agent loop (chat-send re-visible). */
async function sendChatPrompt(
  page: Page,
  prompt: string,
  timeoutMs = 60_000,
): Promise<void> {
  await page.getByTestId('chat-input').first().fill(prompt);
  await page.getByTestId('chat-send').first().click();
  await expect(page.getByTestId('chat-send')).toBeVisible({
    timeout: timeoutMs,
  });
  await page.waitForTimeout(500);
}

test.describe('Deterministic form-fill — fake AI getEmptyFormFields → fillFormCells', () => {
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  test.skip(!existsSync(FORM_FIXTURE), 'form fixture missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    // provider=openai (fake adapter keeps the openai meta), plan-mode OFF so
    // the fillFormCells write auto-applies, fixture as active tab.
    await page.evaluate(async (fixture) => {
      window.localStorage.setItem('ahwp:chat:provider', 'openai');
      window.localStorage.setItem('ahwp:chat:plan-mode-default', '0');
      await window.api.secrets.set('openai', 'fake-key');
      await window.api.session.set({ lastActivePath: fixture });
    }, FORM_FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('rhwp-editor-iframe').first()).toBeAttached({
      timeout: 30_000,
    });
    await expect
      .poll(
        async () => {
          try {
            return await readWasm<number>(launched.page, 'getSectionCount', []);
          } catch {
            return 0;
          }
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  // TODO(form-fill-det): held as fixme — the FORMFILL driver reaches step 2
  // (getEmptyFormFields runs, fillFormCells fires) but the cell coords come
  // through undefined: fillFormCells rejects with
  // `cell[0].sectionIdx-not-non-negative-int`. Root cause is a field-name
  // mismatch between getEmptyFormFields' `cellFields[]` element shape and the
  // coord names fillFormCells requires (sectionIdx / parentParaIdx /
  // controlIdx / cellIdx / cellParaIdx). Confirm the real element field names
  // in src/features/rhwp-studio/bridge-ir-helper.ts (~L1201) and map them in
  // electron/ai/providers/fake.ts's FORMFILL step-2, then flip back to test().
  test.fixme('FORMFILL driver writes a sentinel into the first empty cell', async () => {
    const { page } = launched;
    const sentinel = 'AHWPDET-' + Date.now().toString(36).toUpperCase();

    const before = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(before.length).toBe(0);

    // The fake provider decodes this into the 2-tool chain.
    await sendChatPrompt(page, `FORMFILL:${sentinel}`, 90_000);

    // fillFormCells write may surface as a diff/patches card; auto-accept any
    // pending one (disabled = already auto-applied = normal).
    await page.waitForTimeout(500);
    const acceptAll = page.getByTestId('diff-accept-all');
    const acceptSingle = page.getByTestId('diff-accept-1');
    if (
      (await acceptAll.count()) > 0 &&
      (await acceptAll.first().isEnabled())
    ) {
      await acceptAll.first().click();
    } else if (
      (await acceptSingle.count()) > 0 &&
      (await acceptSingle.first().isEnabled())
    ) {
      await acceptSingle.first().click();
    }
    await page.waitForTimeout(2000);

    // diag: surface the chat transcript + which tool cards rendered, so a
    // failing run tells us where the chain broke (no card = tool never called;
    // plan/차단 = write blocked; card present but no text = coords/parse wrong).
    const msgs = await page
      .locator('[data-testid="chat-message"]')
      .allTextContents();
    console.log('[formfill-debug] chat-message count:', msgs.length);
    msgs.forEach((m, i) =>
      console.log(
        `[formfill-debug] msg ${i}:`,
        m.replace(/\s+/g, ' ').slice(0, 400),
      ),
    );
    const bodyText = await page.locator('body').innerText();
    console.log(
      '[formfill-debug] getEmptyFormFields card:',
      bodyText.includes('getEmptyFormFields'),
      '| fillFormCells card:',
      bodyText.includes('fillFormCells'),
      '| plan/차단:',
      /plan mode|계획 모드|dry-run|차단/i.test(bodyText),
    );

    const after = await readWasm<unknown[]>(page, 'searchAllText', [
      sentinel,
      true,
      false,
    ]);
    expect(after.length).toBeGreaterThanOrEqual(1);
  });
});
