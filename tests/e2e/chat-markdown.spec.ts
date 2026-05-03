/**
 * Markdown rendering in assistant messages — react-markdown + remark-gfm
 * + react-syntax-highlighter (PrismLight). Driven by the fake provider's
 * ECHO mode so we can stuff arbitrary markdown into a single test message.
 *
 * User messages stay plain text by design (echoing the user's literal
 * input, no markdown surprises).
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
}

const lastAssistantBubble = (page: Page) =>
  page
    .locator('[data-testid="chat-message"][data-role="assistant"]')
    .last()
    .getByTestId('chat-message-content');

test.describe('chat — markdown rendering', () => {
  test('inline emphasis: **bold** and *italic* and `code`', async () => {
    const { page } = launched;
    await sendEcho(page, '**bold** and *italic* and `inline-code`');
    const bubble = lastAssistantBubble(page);
    await expect(bubble.locator('strong')).toContainText('bold');
    await expect(bubble.locator('em')).toContainText('italic');
    await expect(bubble.locator('code').first()).toContainText('inline-code');
  });

  test('links open in a new tab with rel=noreferrer', async () => {
    const { page } = launched;
    await sendEcho(page, '[a link](https://example.com)');
    const link = lastAssistantBubble(page).locator('a');
    await expect(link).toHaveText('a link');
    await expect(link).toHaveAttribute('href', 'https://example.com');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /noreferrer/);
  });

  test('GFM strikethrough and task list (remark-gfm)', async () => {
    const { page } = launched;
    await sendEcho(page, '~~done~~ and\n- [x] one\n- [ ] two');
    const bubble = lastAssistantBubble(page);
    await expect(bubble.locator('del')).toContainText('done');
    // Two task-list checkboxes (rendered as input[type="checkbox"]).
    await expect(bubble.locator('input[type="checkbox"]')).toHaveCount(2);
  });

  test('GFM table renders as a real <table>', async () => {
    const { page } = launched;
    await sendEcho(page, '| h1 | h2 |\n| --- | --- |\n| a | b |');
    const bubble = lastAssistantBubble(page);
    const table = bubble.locator('table');
    await expect(table).toBeVisible();
    await expect(table.locator('th').nth(0)).toContainText('h1');
    await expect(table.locator('td').nth(1)).toContainText('b');
  });

  test('fenced code block uses the syntax highlighter', async () => {
    const { page } = launched;
    await sendEcho(page, '```ts\nconst x: number = 1;\n```');
    const codeblock = lastAssistantBubble(page).getByTestId('chat-codeblock');
    await expect(codeblock).toBeVisible();
    // The PrismLight highlighter wraps tokens in spans with inline color
    // styles. We just check that the keyword token (`const`) was tokenized
    // — i.e. it sits inside its own span, not a flat text node.
    await expect(
      codeblock.locator('span').filter({ hasText: 'const' }).first(),
    ).toBeVisible();
  });

  test('user messages render as plain text (no markdown surprises)', async () => {
    const { page } = launched;
    await page.getByTestId('chat-input').fill('**not bold**');
    await page.getByTestId('chat-send').click();
    const userBubble = page
      .locator('[data-testid="chat-message"][data-role="user"]')
      .last()
      .getByTestId('chat-message-content');
    // Literal asterisks survive — nothing was parsed as markdown.
    await expect(userBubble).toContainText('**not bold**');
    await expect(userBubble.locator('strong')).toHaveCount(0);
  });
});
