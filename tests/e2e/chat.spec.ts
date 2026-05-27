/**
 * ChatPanel + secrets + ai:chat IPC end-to-end coverage.
 *
 * All provider adapters are swapped for a deterministic fake when the
 * Electron main process is launched with `AHWP_E2E_FAKE_AI=1` (see
 * electron/ai/registry.ts → providers/fake.ts). The fake reads scripted
 * behavior from the *last user message content*:
 *
 *   ECHO:hello   → emit "hello" as text-deltas, then done
 *   ERROR:msg    → emit a single error event
 *   SLOW:abc     → echo with 50ms gap between chars (for abort tests)
 *
 * No network is involved. We exercise the real IPC + ChatPanel state
 * machine; only the provider implementation is faked.
 */
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
});

test.afterEach(async () => {
  await launched.close();
});

async function setKey(page: Page, providerId: 'openai' | 'google') {
  await page.evaluate(async (id: 'openai' | 'google') => {
    await window.api.secrets.set(id, 'test-key');
  }, providerId);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test.describe('chat panel — secrets gate + provider/model selectors', () => {
  test('without a key: input is disabled, indicator shows ○', async () => {
    const { page } = launched;
    await expect(page.getByTestId('chat-input')).toBeDisabled();
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'missing',
    );
    await expect(page.getByTestId('chat-send')).toBeDisabled();
  });

  test('after secrets.set + reload: input is enabled, indicator shows ●', async () => {
    const { page } = launched;
    await setKey(page, 'openai');
    await expect(page.getByTestId('chat-input')).toBeEnabled();
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );
  });

  test('switching provider re-checks key for the new provider', async () => {
    const { page } = launched;
    // Set key for openai only.
    await setKey(page, 'openai');
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );

    // Switch to google → indicator goes back to ○ (no key for google).
    await page.getByTestId('chat-provider-select').selectOption('google');
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'missing',
    );
    await expect(page.getByTestId('chat-input')).toBeDisabled();

    // Set google key → indicator flips to ● again.
    await page.evaluate(async () => {
      await window.api.secrets.set('google', 'test-google-key');
    });
    // The has-check listens on provider change — switch back and forth to refresh.
    await page.getByTestId('chat-provider-select').selectOption('openai');
    await page.getByTestId('chat-provider-select').selectOption('google');
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );
  });

  test('provider + model picks survive reload via localStorage', async () => {
    const { page } = launched;
    await setKey(page, 'openai');
    await setKey(page, 'google');
    // chunk 65 — model is now a <select>. The fake provider's catalog
    // includes 'fake/echo-2' on every provider, so we pick that and
    // verify it persists across reload. Auto-fetch is gated on
    // hasKey === true, so we set the google key too.
    await page.getByTestId('chat-provider-select').selectOption('google');
    // Wait for the auto-fetched catalog to populate the select.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const sel = document.querySelector(
            '[data-testid="chat-model-input"]',
          ) as HTMLSelectElement | null;
          return sel
            ? Array.from(sel.querySelectorAll('option')).map((o) => o.value)
            : [];
        }),
      )
      .toContain('fake/echo-2');
    await page.getByTestId('chat-model-input').selectOption('fake/echo-2');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('chat-provider-select')).toHaveValue(
      'google',
    );
    await expect(page.getByTestId('chat-model-input')).toHaveValue(
      'fake/echo-2',
    );
  });
});

test.describe('chat panel — streaming via fake provider', () => {
  test.beforeEach(async () => {
    await setKey(launched.page, 'openai');
  });

  test('ECHO script streams text-deltas into the assistant bubble', async () => {
    const { page } = launched;
    await page.getByTestId('chat-input').fill('ECHO:hello world');
    await page.getByTestId('chat-send').click();

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');
    await expect(assistantContent).toHaveText('hello world');
    // Streaming finished → send button visible (not stop).
    await expect(page.getByTestId('chat-send')).toBeVisible();
    await expect(page.getByTestId('chat-stop')).toHaveCount(0);
  });

  test('ERROR script surfaces the error banner', async () => {
    const { page } = launched;
    await page.getByTestId('chat-input').fill('ERROR:rate limited');
    await page.getByTestId('chat-send').click();
    await expect(page.getByRole('alert')).toContainText('rate limited');
    // Streaming aborted → send button comes back.
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  test('SLOW script + Stop button aborts mid-stream with partial content', async () => {
    const { page } = launched;
    // 20-char payload at 50ms/char ≈ 1s total. Plenty of room to abort.
    await page.getByTestId('chat-input').fill('SLOW:abcdefghijklmnopqrst');
    await page.getByTestId('chat-send').click();

    // Wait for at least one delta to land before aborting.
    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');
    await expect(assistantContent).not.toHaveText('', { timeout: 2_000 });

    // Stop button appears while streaming.
    await page.getByTestId('chat-stop').click();

    // After abort, send button comes back; partial text remains.
    await expect(page.getByTestId('chat-send')).toBeVisible();
    const partialText = (await assistantContent.textContent()) ?? '';
    expect(partialText.length).toBeGreaterThan(0);
    expect(partialText.length).toBeLessThan(25); // didn't reach the full 25-char payload
  });

  test('Enter submits, Shift+Enter inserts newline', async () => {
    const { page } = launched;
    const input = page.getByTestId('chat-input');
    await input.click();
    await input.type('ECHO:line');
    await input.press('Enter');

    await expect(
      page.getByTestId('chat-message').filter({ hasText: 'line' }).last(),
    ).toBeVisible();

    // Now type a multiline draft using Shift+Enter — should NOT submit.
    await input.fill('');
    await input.type('first');
    await input.press('Shift+Enter');
    await input.type('second');
    await expect(input).toHaveValue('first\nsecond');
  });
});

test.describe('secrets IPC — direct round-trip', () => {
  test('set / has / list / delete via window.api.secrets', async () => {
    const { page } = launched;
    const result = await page.evaluate(async () => {
      const { secrets } = window.api;
      const before = await secrets.has('openai');
      await secrets.set('openai', 'sk-fake');
      const afterSet = await secrets.has('openai');
      const list = await secrets.list();
      await secrets.delete('openai');
      const afterDelete = await secrets.has('openai');
      return { before, afterSet, list, afterDelete };
    });
    expect(result.before).toBe(false);
    expect(result.afterSet).toBe(true);
    expect(result.list).toContain('openai');
    expect(result.afterDelete).toBe(false);
  });

  test('set rejects empty / non-string keys', async () => {
    const { page } = launched;
    const errors = await page.evaluate(async () => {
      const out: string[] = [];
      try {
        await window.api.secrets.set('openai', '');
      } catch (e) {
        out.push(e instanceof Error ? e.message : String(e));
      }
      try {
        // @ts-expect-error invalid type by design
        await window.api.secrets.set('openai', null);
      } catch (e) {
        out.push(e instanceof Error ? e.message : String(e));
      }
      return out;
    });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/non-empty|empty/i);
    expect(errors[1]).toMatch(/string/i);
  });
});

// 0.7.0 / 0.7.1 — Task-Mode UI smoke. ModeBadge 가 provider bar 에 마운트
// 되고 default state (free-authoring / "편집") 로 렌더링되는지 확인.
// dynamic switching (form-fill 자동 진입) 은 useChatStreaming 가 chat
// turn 마다 detectMode 호출 시 발동 — unit/integration 테스트가 검증.
// e2e 는 mount 검증 + 사용자 가시성 만 다룸.
test.describe('Task-Mode UI badge (0.7.1)', () => {
  test('ModeBadge default 마운트 — free-authoring / "편집" / source=default', async () => {
    const { page } = launched;
    const badge = page.getByTestId('chat-mode-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('data-mode', 'free-authoring');
    await expect(badge).toHaveAttribute('data-source', 'default');
    await expect(badge).toHaveText('편집');
  });
});
