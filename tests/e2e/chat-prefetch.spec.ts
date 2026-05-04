/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * chunk 70 — secrets:changed broadcast → ChatPanel re-runs the
 * pre-fetch. Verifies that adding a key for a *non-active* provider
 * still populates that provider's model selector immediately, without
 * requiring the user to manually switch + wait.
 */

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
});

test.afterEach(async () => {
  await launched.close();
});

async function getOptions(page: typeof launched.page): Promise<string[]> {
  return page.evaluate(() => {
    const sel = document.querySelector(
      '[data-testid="chat-model-input"]',
    ) as HTMLSelectElement | null;
    return sel
      ? Array.from(sel.querySelectorAll('option')).map((o) => o.value)
      : [];
  });
}

test.describe('chat — chunk 70 secrets:changed pre-fetch', () => {
  test('saving a key for a non-active provider populates its catalog', async () => {
    const { page } = launched;

    // Active provider is openai by default; no keys stored yet. Sanity:
    // the model selector shows only the saved fallback (DEFAULT_MODELS).
    await expect(page.getByTestId('chat-model-input')).toBeVisible();

    // Save a key for nvidia (NOT the active provider).
    await page.evaluate(async () => {
      await window.api.secrets.set('nvidia', 'test-key');
    });

    // Switch to nvidia. The fake catalog should already be in
    // modelList state — the broadcast triggered a pre-fetch.
    await page.getByTestId('chat-provider-select').selectOption('nvidia');

    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');
  });

  test('deleting a key still keeps the (저장됨) sticky entry available for selection', async () => {
    const { page } = launched;
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'test-key');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');

    // Delete the key — broadcast fires, pre-fetch re-runs but skips
    // openai (no key). The previously-fetched catalog stays in state
    // since we don't clear `modelList` on broadcast (only re-fetch on
    // present keys). Sanity: select still works.
    await page.evaluate(async () => {
      await window.api.secrets.delete('openai');
    });
    // The select stays populated from the prior fetch.
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');
  });

  // chunk 95 보강 — multi-provider race + provider-switch fast path.
  test('saving keys for multiple providers populates each catalog independently', async () => {
    const { page } = launched;
    // Save keys for two non-active providers in succession.
    await page.evaluate(async () => {
      await window.api.secrets.set('nvidia', 'nv-key');
    });
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'oa-key');
    });

    // Each provider should now have its catalog after switching.
    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');

    await page.getByTestId('chat-provider-select').selectOption('openai');
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');

    // Switching back to nvidia: catalog still present (cached, no
    // refetch storm).
    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');
  });

  test('overwriting a key fires broadcast → catalog refresh still resolves', async () => {
    const { page } = launched;
    // Initial set + verify catalog populates.
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'first-key');
    });
    await page.getByTestId('chat-provider-select').selectOption('openai');
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');

    // Overwrite with a new key — secrets:changed broadcast fires
    // again, pre-fetch re-runs. Catalog must remain selectable
    // (no transient empty state that the user can't recover from).
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'second-key');
    });
    await expect.poll(() => getOptions(page)).toContain('fake/echo-2');
    // The model select itself is still present + interactive.
    await expect(page.getByTestId('chat-model-input')).toBeVisible();
    await expect(page.getByTestId('chat-model-input')).toBeEnabled();
  });
});
