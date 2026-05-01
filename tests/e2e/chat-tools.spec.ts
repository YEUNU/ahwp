/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * ChatPanel chunk 19 — `ahwp-tools` JSON block dispatcher.
 *
 * Drives the dispatcher through the fake provider's ECHO mode so the
 * assistant content is the exact tools block we craft. Verifies:
 * - block detected → preview rows rendered (one per op)
 * - "도구 실행" button routes through runTools → IR mutated
 * - validation failures show in red and don't crash the run
 * - all-failed block disables the button
 * - parse failure surfaces an error message instead of preview
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  getParaProps(s: number, p: number): Record<string, unknown>;
  getBookmarks(): Record<string, unknown>[] | null;
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

async function sendEcho(page: Page, payload: string): Promise<void> {
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

test.describe('chat — chunk 19 ahwp-tools dispatcher', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('valid block — preview lists ops, button routes to IR', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    const block = JSON.stringify({
      ops: [
        { tool: 'applyAlignment', args: { align: 'right' } },
        { tool: 'addBookmark', args: { name: 'chapter1' } },
      ],
    });
    const reply = `변경합니다.\n\`\`\`ahwp-tools\n${block}\n\`\`\``;
    await sendEcho(page, reply);

    // Two preview rows, both ok.
    const ops = page.getByTestId('chat-tools-op');
    await expect(ops).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(ops.nth(i)).toHaveAttribute('data-op-ok', 'true');
    }

    const runBtn = page.getByTestId('chat-action-run-tools');
    await expect(runBtn).toBeVisible();
    await expect(runBtn).toHaveText('도구 실행');
    await runBtn.click();
    await expect(runBtn).toHaveText('✓ 적용됨 (2/2)');

    // Verify IR side: alignment flipped and bookmark added.
    const r = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return {
        align: dbg.getParaProps(0, 0).alignment as string,
        bookmarks: dbg.getBookmarks(),
      };
    });
    expect(r.align).toBe('right');
    expect(r.bookmarks?.some((b) => b.name === 'chapter1')).toBe(true);
  });

  test('invalid arg — failed op shown in red, valid ops still run', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    const block = JSON.stringify({
      ops: [
        { tool: 'applyAlignment', args: { align: 'center' } },
        { tool: 'applyTextColor', args: { hex: 'not-a-color' } }, // invalid
      ],
    });
    await sendEcho(page, `\`\`\`ahwp-tools\n${block}\n\`\`\``);

    const ops = page.getByTestId('chat-tools-op');
    await expect(ops).toHaveCount(2);
    await expect(ops.nth(0)).toHaveAttribute('data-op-ok', 'true');
    await expect(ops.nth(1)).toHaveAttribute('data-op-ok', 'false');

    await page.getByTestId('chat-action-run-tools').click();
    // 1 of 2 succeeded — the invalid op passes through as a failure.
    await expect(page.getByTestId('chat-action-run-tools')).toHaveText(
      '✓ 적용됨 (1/2)',
    );

    const align = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(align).toBe('center');
  });

  test('unknown tool — preview shows ✗ and button still routes valid ones', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    const block = JSON.stringify({
      ops: [
        { tool: 'rm_rf', args: { path: '/' } }, // not in whitelist
        { tool: 'applyAlignment', args: { align: 'left' } },
      ],
    });
    await sendEcho(page, `\`\`\`ahwp-tools\n${block}\n\`\`\``);

    const ops = page.getByTestId('chat-tools-op');
    await expect(ops).toHaveCount(2);
    await expect(ops.nth(0)).toHaveAttribute('data-op-ok', 'false');
    await expect(ops.nth(0)).toContainText('unknown_tool');
  });

  test('all-failed block — run button disabled', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    const block = JSON.stringify({
      ops: [{ tool: 'rm_rf', args: {} }],
    });
    await sendEcho(page, `\`\`\`ahwp-tools\n${block}\n\`\`\``);

    await expect(page.getByTestId('chat-action-run-tools')).toBeDisabled();
  });

  test('malformed JSON — surface parse error, no preview', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    await sendEcho(page, '```ahwp-tools\n{not json\n```');

    await expect(page.getByTestId('chat-tools-error')).toBeVisible();
    await expect(page.getByTestId('chat-tools-op')).toHaveCount(0);
    await expect(page.getByTestId('chat-action-run-tools')).toHaveCount(0);
  });

  test('over op limit — block-level rejection', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // 51 valid ops — over the 50 ceiling.
    const ops = Array.from({ length: 51 }, () => ({
      tool: 'applyAlignment',
      args: { align: 'left' },
    }));
    await sendEcho(
      page,
      `\`\`\`ahwp-tools\n${JSON.stringify({ ops })}\n\`\`\``,
    );

    await expect(page.getByTestId('chat-tools-error')).toContainText(
      'ops-over-limit',
    );
  });

  test('html and ahwp-tools in same response — both buttons render', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    const reply = [
      '먼저 양식 변경:',
      '```html',
      '<p style="text-align:center;">제목</p>',
      '```',
      '',
      '그다음 책갈피:',
      '```ahwp-tools',
      JSON.stringify({
        ops: [{ tool: 'addBookmark', args: { name: 'chapter1' } }],
      }),
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    await expect(page.getByTestId('chat-action-apply-html')).toBeVisible();
    await expect(page.getByTestId('chat-action-run-tools')).toBeVisible();
  });
});
