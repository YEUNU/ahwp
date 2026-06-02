/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * 단축키 기능 검증 — 치트시트(단축키 탭)에 광고된 키가 실제로 효과를 내는지
 * 경험적으로 확인. ⌘K(작동 확인된 것)를 positive control 로 두고, dialog
 * 계열 단축키(F6 스타일 / Alt+L 글자모양 / Alt+T 문단모양 / ⌘⇧O 아웃라인)가
 * parent 또는 iframe 에 무언가 띄우는지 본다.
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
const FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
);

test.describe('shortcut functional verify', () => {
  test.skip(!existsSync(STUDIO_DIST), 'rhwp-studio dist missing');
  test.skip(!existsSync(FIXTURE), 'fixture missing');
  let launched: LaunchedApp;
  test.afterEach(async () => {
    await launched?.close();
  });

  test('cheatsheet shortcuts produce their effect', async () => {
    test.setTimeout(120_000);
    launched = await launchApp();
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    await page.evaluate(async (fixture) => {
      await window.api.session.set({ lastActivePath: fixture });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('rhwp-editor-iframe').first()).toBeAttached({
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

    // count any dialog/modal in parent + iframe document
    const dialogCount = async (): Promise<number> => {
      const parent = await page.locator('[role="dialog"]').count();
      let frameN = 0;
      try {
        const fl = page.frameLocator('[data-testid="rhwp-editor-iframe"]');
        frameN = await fl
          .locator('[role="dialog"], .modal, [aria-modal="true"]')
          .count();
      } catch {
        /* iframe not queryable */
      }
      return parent + frameN;
    };

    // POSITIVE CONTROL — ⌘K opens command palette (known-working).
    await page.keyboard.press(`${mod}+k`);
    const paletteVisible = await page
      .getByTestId('command-palette')
      .first()
      .isVisible()
      .catch(() => false);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // dialog-class shortcuts — record whether each makes a dialog appear.
    const results: Record<string, boolean> = {};
    const presses: Array<[string, string]> = [
      ['F6 (스타일 관리)', 'F6'],
      ['Alt+L (글자 모양)', 'Alt+l'],
      ['Alt+T (문단 모양)', 'Alt+t'],
      [`⌘⇧O (아웃라인)`, `${mod}+Shift+o`],
    ];
    for (const [label, combo] of presses) {
      const before = await dialogCount();
      await page.keyboard.press(combo);
      await page.waitForTimeout(700);
      const after = await dialogCount();
      results[label] = after > before;
      // close anything that opened so the next probe starts clean
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    console.log(
      '\n===SHORTCUT-VERIFY===\n' +
        `⌘K command-palette (control): ${paletteVisible ? 'WORKS' : 'BROKEN'}\n` +
        Object.entries(results)
          .map(([k, v]) => `${k}: ${v ? 'WORKS' : 'NO EFFECT'}`)
          .join('\n') +
        '\n===END===\n',
    );

    // positive control MUST work (proves the harness detects working keys).
    expect(paletteVisible, '⌘K positive control should open the palette').toBe(
      true,
    );

    // SECOND PROBE — focus INSIDE the editor iframe, then press F6 / Alt+L.
    // This covers the "user is editing" case where the studio might handle
    // the key itself before forwarding to the parent. Screenshot for visual
    // confirmation of whether any 스타일/글자모양 dialog appears in the iframe.
    const OUT = path.resolve(__dirname, '..', '..', '.ui-audit');
    const iframeEl = page.getByTestId('rhwp-editor-iframe').first();
    const box = await iframeEl.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(500);
    }
    // Re-focus the editor, then probe each key CLEANLY (Escape first so a
    // prior modal doesn't swallow the next key), one screenshot each.
    const cleanProbe: Array<[string, string]> = [
      ['f6', 'F6'],
      ['altL', 'Alt+l'],
      ['altT', 'Alt+t'],
      ['cmdShiftO', `${mod}+Shift+o`],
    ];
    for (const [name, combo] of cleanProbe) {
      if (box) {
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);
        await page.waitForTimeout(200);
      }
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      await page.keyboard.press(combo);
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `s-${name}.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  });
});
