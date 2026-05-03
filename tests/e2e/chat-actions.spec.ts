/**
 * Per-message actions: 복사 / 재생성 / 삭제.
 *
 * Driven by the env-gated fake provider so we can assert on deterministic
 * content and orchestrate streams without a network. The fake's ECHO mode
 * yields the payload as text-deltas + done.
 */
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

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
  // Wait for streaming to finish — actions only show after `done`.
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

const lastAssistantBubble = (page: Page) =>
  page.locator('[data-testid="chat-message"][data-role="assistant"]').last();
const lastUserBubble = (page: Page) =>
  page.locator('[data-testid="chat-message"][data-role="user"]').last();

test.describe('chat — message actions', () => {
  test('assistant message exposes copy / regenerate / delete after streaming', async () => {
    const { page } = launched;
    await sendEcho(page, 'hello');
    const bubble = lastAssistantBubble(page);
    await expect(
      bubble.getByTestId('chat-action-copy-assistant'),
    ).toBeVisible();
    await expect(bubble.getByTestId('chat-action-regenerate')).toBeVisible();
    await expect(bubble.getByTestId('chat-action-delete')).toBeVisible();
  });

  test('user message exposes copy only', async () => {
    const { page } = launched;
    await sendEcho(page, 'hello');
    const bubble = lastUserBubble(page);
    await expect(bubble.getByTestId('chat-action-copy-user')).toBeVisible();
    // No regenerate/delete on user bubbles.
    await expect(bubble.getByTestId('chat-action-regenerate')).toHaveCount(0);
    await expect(bubble.getByTestId('chat-action-delete')).toHaveCount(0);
  });

  test('copy assistant content writes to system clipboard', async () => {
    const { page } = launched;
    await sendEcho(page, 'copy-payload');
    await lastAssistantBubble(page)
      .getByTestId('chat-action-copy-assistant')
      .click();
    const text = await page.evaluate(() => window.api.clipboard.readText());
    expect(text).toBe('copy-payload');
  });

  test('regenerate replaces the assistant bubble with a fresh stream', async () => {
    const { page } = launched;
    await sendEcho(page, 'first');
    const firstBubble = lastAssistantBubble(page);
    const firstContent = await firstBubble
      .getByTestId('chat-message-content')
      .textContent();
    expect(firstContent?.trim()).toBe('first');

    await firstBubble.getByTestId('chat-action-regenerate').click();
    // Streaming kicks off → wait for it to finish again.
    await expect(page.getByTestId('chat-send')).toBeVisible();

    // Same text payload (the user message — "ECHO:first" — is reused).
    const replayed = await lastAssistantBubble(page)
      .getByTestId('chat-message-content')
      .textContent();
    expect(replayed?.trim()).toBe('first');
    // Still exactly one assistant bubble, not two.
    await expect(
      page.locator('[data-testid="chat-message"][data-role="assistant"]'),
    ).toHaveCount(1);
  });

  test('delete removes the assistant bubble; user bubble stays', async () => {
    const { page } = launched;
    await sendEcho(page, 'gone');
    await expect(
      page.locator('[data-testid="chat-message"][data-role="assistant"]'),
    ).toHaveCount(1);

    await lastAssistantBubble(page).getByTestId('chat-action-delete').click();
    await expect(
      page.locator('[data-testid="chat-message"][data-role="assistant"]'),
    ).toHaveCount(0);
    // The preceding user message stays.
    await expect(
      page.locator('[data-testid="chat-message"][data-role="user"]'),
    ).toHaveCount(1);
  });

  test('actions are hidden while a stream is in flight', async () => {
    const { page } = launched;
    // Slow stream so we can observe the in-flight state.
    await page.getByTestId('chat-input').fill('SLOW:abcdefghij');
    await page.getByTestId('chat-send').click();
    // Stop button visible → streaming is active.
    await expect(page.getByTestId('chat-stop')).toBeVisible();

    // Action toolbars on existing assistant bubbles (none yet — first turn)
    // and on the user bubble should be hidden.
    await expect(
      lastUserBubble(page).getByTestId('chat-action-copy-user'),
    ).toHaveCount(0);

    // Wait for completion.
    await page.getByTestId('chat-stop').click();
    await expect(page.getByTestId('chat-send')).toBeVisible();
    // Actions reappear after streaming ends.
    await expect(
      lastUserBubble(page).getByTestId('chat-action-copy-user'),
    ).toBeVisible();
  });
});
