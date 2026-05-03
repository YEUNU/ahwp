/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * ChatPanel chunk 26 — SQLite-backed conversation persistence.
 *
 * Drives the persistence path via the fake AI provider so we can
 * assert deterministically:
 *   1. First send creates a conversation row
 *   2. Both user + assistant turns are appended
 *   3. The 📚 popover shows them and clicking loads the messages back
 *   4. + button starts a fresh chat
 *   5. × removes a conversation
 *
 * Each spec gets a fresh user-data-dir from launchApp so the
 * chat-history.db is empty at start.
 */

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

async function sendEcho(payload: string): Promise<void> {
  const { page } = launched;
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

test.describe('chat — chunk 26 history persistence', () => {
  test('history popover starts empty', async () => {
    const { page } = launched;
    await page.getByTestId('chat-history-toggle').click();
    await expect(page.getByTestId('chat-history-popover')).toContainText(
      '저장된 대화가 없습니다',
    );
  });

  test('first send creates a conversation; popover lists it', async () => {
    const { page } = launched;
    await sendEcho('hello world');
    await page.getByTestId('chat-history-toggle').click();
    const items = page.getByTestId('chat-history-item');
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('hello world');
  });

  test('reload restores history (DB-backed)', async () => {
    const { page } = launched;
    await sendEcho('test sentinel one');

    // Reload the renderer — DB persists across reloads.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await page.getByTestId('chat-history-toggle').click();
    await expect(
      page
        .getByTestId('chat-history-item')
        .filter({ hasText: 'test sentinel one' }),
    ).toHaveCount(1);
  });

  test('clicking a saved conversation loads its messages', async () => {
    const { page } = launched;
    await sendEcho('first turn');
    // Start a fresh conversation, then load the saved one.
    await page.getByTestId('chat-history-new').click();
    await expect(page.locator('[data-testid="chat-message"]')).toHaveCount(0);

    await page.getByTestId('chat-history-toggle').click();
    await page.getByTestId('chat-history-item-load').first().click();

    // user + assistant turns reload (assistant content was 'first turn'
    // because fake provider echoes the payload).
    const userBubble = page
      .locator('[data-testid="chat-message"][data-role="user"]')
      .first();
    await expect(userBubble).toContainText('first turn');
    const assistantBubble = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .first();
    await expect(assistantBubble).toContainText('first turn');
  });

  test('delete × removes the conversation', async () => {
    const { page } = launched;
    await sendEcho('to be deleted');
    await page.getByTestId('chat-history-toggle').click();
    await expect(page.getByTestId('chat-history-item')).toHaveCount(1);

    // The delete button is hidden until hover; force click to bypass.
    await page
      .getByTestId('chat-history-item-delete')
      .first()
      .click({ force: true });

    await expect(page.getByTestId('chat-history-item')).toHaveCount(0);
  });

  test('+ button clears the current chat without deleting from DB', async () => {
    const { page } = launched;
    await sendEcho('persist me');
    await expect(page.locator('[data-testid="chat-message"]')).not.toHaveCount(
      0,
    );

    await page.getByTestId('chat-history-new').click();
    await expect(page.locator('[data-testid="chat-message"]')).toHaveCount(0);

    // Saved conversation still in DB.
    await page.getByTestId('chat-history-toggle').click();
    await expect(page.getByTestId('chat-history-item')).toHaveCount(1);
  });
});
