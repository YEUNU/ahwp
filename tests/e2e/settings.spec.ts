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
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );
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

  // chunk 100 — 캐시 비우기 버튼 동작 + 파일 삭제 확인.
  test('일반 탭 — 캐시 비우기 버튼이 outline-cache + model-cache 만 삭제', async () => {
    const { app, page } = launched;
    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const fs = await import('node:fs');
    const path = await import('node:path');
    const outline = path.join(userDataDir, 'outline-cache.json');
    const models = path.join(userDataDir, 'model-cache.json');
    // 사용자 데이터 보존 검증 — IPC 화이트리스트에 없는 임의 파일이 절대
    // 안 사라져야 함. session.json 은 앱이 mount 시 자동 재작성하니
    // 별도 sentinel 파일로 검증.
    const sentinelFile = path.join(userDataDir, '_test-sentinel.json');
    fs.writeFileSync(outline, '{}', 'utf8');
    fs.writeFileSync(models, '{}', 'utf8');
    fs.writeFileSync(sentinelFile, '{"keep":"this"}', 'utf8');

    await page.getByTestId('chat-open-settings').click();
    // 기본 진입 탭 = AI 공급자. 일반 탭으로 이동.
    await page.getByTestId('settings-tab-general').click();
    const btn = page.getByTestId('settings-clear-caches');
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByTestId('settings-clear-caches-ok')).toBeVisible({
      timeout: 5_000,
    });

    // 캐시 두 개 사라지고 sentinel 보존.
    expect(fs.existsSync(outline)).toBe(false);
    expect(fs.existsSync(models)).toBe(false);
    expect(fs.existsSync(sentinelFile)).toBe(true);
    expect(fs.readFileSync(sentinelFile, 'utf8')).toContain('keep');
  });

  test('AI 공급자 — Agent turn 한계 입력이 localStorage 에 저장됨 (chunk 99 follow-up)', async () => {
    const { page } = launched;
    await page.getByTestId('chat-open-settings').click();
    // AI tab is the default — assert the input exists.
    const input = page.getByTestId('settings-agent-max-turns-input');
    await expect(input).toBeVisible();
    // 기본값 50 (AGENT_MAX_TURNS_DEFAULT).
    await expect(input).toHaveValue('50');
    // 변경 → localStorage 반영 (debounce 없이 onChange 즉시 save).
    await input.fill('120');
    await input.dispatchEvent('change');
    const stored = await page.evaluate(() =>
      localStorage.getItem('ahwp:chat:max-turns'),
    );
    expect(stored).toBe('120');
    // 한계 초과 → clamp.
    await input.fill('999');
    await input.dispatchEvent('change');
    const clamped = await page.evaluate(() =>
      localStorage.getItem('ahwp:chat:max-turns'),
    );
    expect(clamped).toBe('200'); // AGENT_MAX_TURNS_HARD_CAP
  });

  test('캐시 비우기 — 캐시 파일 없어도 silent 성공', async () => {
    const { app, page } = launched;
    const userDataDir = await app.evaluate(({ app: a }) =>
      a.getPath('userData'),
    );
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.rmSync(path.join(userDataDir, 'outline-cache.json'), { force: true });
    fs.rmSync(path.join(userDataDir, 'model-cache.json'), { force: true });

    await page.getByTestId('chat-open-settings').click();
    await page.getByTestId('settings-tab-general').click();
    await page.getByTestId('settings-clear-caches').click();
    await expect(page.getByTestId('settings-clear-caches-ok')).toBeVisible({
      timeout: 5_000,
    });
  });
});
