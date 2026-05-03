/**
 * Settings dialog — provider rows, secrets round-trip, ai:ping connection
 * test (with stored + transient keys), delete flow.
 *
 * Uses the env-gated fake AI provider (AHWP_E2E_FAKE_AI=1) so the connection
 * test never hits a real network. The fake's ping rejects iff the supplied
 * apiKey starts with "BAD" — see electron/ai/providers/fake.ts.
 */
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
});

test.afterEach(async () => {
  await launched.close();
});

test.describe('settings dialog — flow', () => {
  test('opens via the ChatPanel "설정 열기" CTA when no key is set', async () => {
    const { page } = launched;
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await page.getByTestId('chat-open-settings').click();
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    // Both implemented providers are listed.
    await expect(page.getByTestId('settings-row-openai')).toBeVisible();
    await expect(page.getByTestId('settings-row-nvidia')).toBeVisible();
  });

  test('opens via the view:settings menu IPC', async () => {
    const { page, app } = launched;
    await app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows();
      wins[0]?.webContents.send('menu:action', 'view:settings');
    });
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
  });

  test('save key → indicator flips 미연결 → 연결됨; chat panel input becomes enabled', async () => {
    const { page } = launched;
    await page.getByTestId('chat-open-settings').click();
    // UI/UX align — indicator 는 ● / ○ 대신 pill ("연결됨" / "미연결").
    await expect(page.getByTestId('settings-indicator-openai')).toContainText(
      '미연결',
    );

    await page.getByTestId('settings-input-openai').fill('sk-fake');
    await page.getByTestId('settings-save-openai').click();
    await expect(page.getByTestId('settings-indicator-openai')).toContainText(
      '연결됨',
    );
    // Input clears after save.
    await expect(page.getByTestId('settings-input-openai')).toHaveValue('');

    // Close via Esc → ChatPanel re-checks key on next provider effect.
    await page.keyboard.press('Escape');
    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-provider-select').selectOption('openai');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);
    await expect(page.getByTestId('chat-input')).toBeEnabled();
  });

  test('connection test with a transient key shows ✓ on success', async () => {
    const { page } = launched;
    await page.getByTestId('chat-open-settings').click();
    await page.getByTestId('settings-input-openai').fill('test-key');
    await page.getByTestId('settings-test-openai').click();
    await expect(page.getByTestId('settings-ping-ok-openai')).toBeVisible();
  });

  test('connection test with a BAD key shows the error', async () => {
    const { page } = launched;
    await page.getByTestId('chat-open-settings').click();
    await page.getByTestId('settings-input-openai').fill('BAD-key');
    await page.getByTestId('settings-test-openai').click();
    await expect(page.getByTestId('settings-ping-error-openai')).toContainText(
      'invalid key',
    );
  });

  test('connection test against a stored key (no input) succeeds', async () => {
    const { page } = launched;
    // Pre-store a key.
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'stored-key');
    });
    await page.getByTestId('chat-open-settings').click();
    // Input is empty → the IPC falls back to the stored key.
    await page.getByTestId('settings-test-openai').click();
    await expect(page.getByTestId('settings-ping-ok-openai')).toBeVisible();
  });

  test('delete clears stored key and removes the delete button', async () => {
    const { page } = launched;
    await page.evaluate(async () => {
      await window.api.secrets.set('openai', 'sk-fake');
    });
    await page.getByTestId('chat-open-settings').click();
    await expect(page.getByTestId('settings-indicator-openai')).toContainText(
      '연결됨',
    );
    await expect(page.getByTestId('settings-delete-openai')).toBeVisible();

    await page.getByTestId('settings-delete-openai').click();
    await expect(page.getByTestId('settings-indicator-openai')).toContainText(
      '미연결',
    );
    // Delete button hides once there's no stored key.
    await expect(page.getByTestId('settings-delete-openai')).toHaveCount(0);
  });

  test('per-provider rows are independent', async () => {
    const { page } = launched;
    await page.getByTestId('chat-open-settings').click();

    await page.getByTestId('settings-input-nvidia').fill('nvapi-fake');
    await page.getByTestId('settings-save-nvidia').click();
    await expect(page.getByTestId('settings-indicator-nvidia')).toContainText(
      '연결됨',
    );
    // openai untouched.
    await expect(page.getByTestId('settings-indicator-openai')).toContainText(
      '미연결',
    );
  });
});
