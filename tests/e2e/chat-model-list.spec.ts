/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 48 — provider model list with 24h cache.
 *
 * The fake provider (env-gated) returns a deterministic catalog
 * `['fake/echo-1', 'fake/echo-2', 'fake/slow-1']` when `apiKey` is
 * present and rejects when it starts with 'BAD'. We don't test the
 * real OpenAI / NIM endpoints here — they're rate-limited and offline
 * during CI. The IPC + cache + datalist wiring is fixture-agnostic.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
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
}

test.describe('chat — chunk 48 model list (cache + datalist)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('listModels returns ok with the fake catalog when key is set', async () => {
    const { page } = launched;
    await openFixture(page);
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'good-key');
    });

    const result = await page.evaluate(async () => {
      return await window.api.ai.listModels('openai', { force: true });
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.models).toEqual([
        'fake/echo-1',
        'fake/echo-2',
        'fake/slow-1',
      ]);
      expect(result.fetchedAt).toBeGreaterThan(0);
    }
  });

  test('listModels returns error when key is BAD and no cache exists', async () => {
    const { page } = launched;
    await openFixture(page);
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'BAD-key');
      // Clear any cache from prior runs to guarantee no fallback.
      await window.api.ai.clearModelsCache('openai');
    });

    const result = await page.evaluate(async () => {
      return await window.api.ai.listModels('openai', { force: true });
    });
    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  test('listModels returns stale-cache when refetch fails after a prior success', async () => {
    const { page } = launched;
    await openFixture(page);

    // First successful fetch seeds the cache.
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'good-key');
      await window.api.ai.clearModelsCache('openai');
      await window.api.ai.listModels('openai', { force: true });
    });

    // Rotate to a BAD key — the next force-refetch should fail but
    // the cache fallback kicks in and main returns stale-cache.
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'BAD-key');
    });

    const result = await page.evaluate(async () => {
      return await window.api.ai.listModels('openai', { force: true });
    });
    expect(result.status).toBe('stale-cache');
    if (result.status === 'stale-cache') {
      expect(result.models).toContain('fake/echo-1');
    }
  });

  test('ChatPanel shows refresh button + datalist with fake catalog', async () => {
    const { page } = launched;
    // Set the secret BEFORE the chat panel mounts so its `hasKey` poll
    // catches it on first render and triggers the auto-fetch.
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'good-key');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await openFixture(page);
    // Wait for the panel's auto-fetch to finish — refresh button reflects
    // chunk 77 — refresh button is now SVG-icon driven; state is
    // exposed via data-state attribute (idle / loading / ok / stale /
    // error) instead of the ↻ / ⚠ unicode glyphs.
    await expect(page.getByTestId('chat-model-refresh')).toBeVisible();
    await expect(page.getByTestId('chat-model-refresh')).toHaveAttribute(
      'data-state',
      'ok',
      { timeout: 5000 },
    );

    // chunk 65 — model is a <select>, not <input list=...> + <datalist>.
    // Inspect the option values directly.
    const optionValues = await page.evaluate(() => {
      const sel = document.querySelector(
        '[data-testid="chat-model-input"]',
      ) as HTMLSelectElement | null;
      if (!sel) return [];
      return Array.from(sel.querySelectorAll('option')).map((o) => o.value);
    });
    // Fetched list is sorted/passed through. Saved model may also appear
    // as a "(저장됨)" sticky entry if the default differs from the catalog.
    expect(optionValues).toEqual(
      expect.arrayContaining(['fake/echo-1', 'fake/echo-2', 'fake/slow-1']),
    );
  });

  test('ChatPanel refresh button switches to ⚠ when listModels fails', async () => {
    const { page } = launched;
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'BAD-key');
      await window.api.ai.clearModelsCache('openai');
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await openFixture(page);

    // The button title carries the reason string when in error/stale.
    const btn = page.getByTestId('chat-model-refresh');
    await expect(btn).toBeVisible();
    // chunk 77 — error / stale state surfaces via data-state attribute.
    await expect(btn).toHaveAttribute('data-state', /error|stale/, {
      timeout: 5000,
    });
    const title = await btn.getAttribute('title');
    expect(title).toMatch(/확인 불가|오래된 캐시/);

    // chunk 65 — fetch failed but the saved (default) model still
    // appears as a sticky "(저장됨)" option, so the select stays
    // populated with exactly 1 entry. Not disabled — the user can
    // refresh manually or pick another later.
    const optionCount = await page.evaluate(() => {
      const sel = document.querySelector(
        '[data-testid="chat-model-input"]',
      ) as HTMLSelectElement | null;
      if (!sel) return 0;
      return sel.querySelectorAll('option').length;
    });
    expect(optionCount).toBeGreaterThanOrEqual(1);
    await expect(page.getByTestId('chat-model-input')).not.toBeDisabled();
  });
});
