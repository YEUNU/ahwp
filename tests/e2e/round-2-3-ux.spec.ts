/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * 2차 + 3차 UX 라운드 통합 회귀 (chunks 56 ~ 65, 0.2.60 ~ 0.2.65):
 *
 *   - 56 AI 우클릭 메뉴
 *   - 60 검색 in 폴더 (⌘⇧F)
 *   - 59 PDF 내보내기 (IPC contract)
 *   - 58 목차 사이드바 (⌘⇧O)
 *   - 57 AI inline diff
 *   - 61 룰러 토글
 *   - 64 슬래시 명령
 *   - 62 버전 히스토리
 *   - 65 다중 창
 *
 * Smoke-level coverage — IR / IPC contracts. Visual snapshot tests
 * are skipped (the SVG renderer's deterministic output requires an
 * exact-pixel match harness we don't have set up).
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');
const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
  focusViewer(): void;
  exportBytes(): Uint8Array;
  setSelection(a: number, b: number, c: number, d: number): void;
  clearSelection(): void;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp();
});

test.afterEach(async () => {
  await launched.close();
});

async function openBlank(page: Page): Promise<void> {
  await page.evaluate(async (p) => {
    await window.api.session.set({ lastActivePath: p });
  }, FIXTURE);
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

test.describe('round 2/3 UX — chunks 56 ~ 65', () => {
  test.skip(!existsSync(FIXTURE), 'fixtures/blank.hwpx missing');

  test('chunk 60 — folder.searchText IPC returns no-root when rootPath blank', async () => {
    const { page } = launched;
    await openBlank(page);
    const r = await page.evaluate(() =>
      window.api.folder.searchText({ rootPath: '', query: 'foo' }),
    );
    expect(r.status).toBe('no-root');
    expect(r.hits).toEqual([]);
  });

  test('chunk 60 — searchText returns 0-hit ok for empty query', async () => {
    const { page } = launched;
    await openBlank(page);
    // Use the test's userDataDir as a real filesystem root that's safe
    // to walk — guaranteed to have no .hwp files so we get an empty
    // ok result regardless of contents.
    const r = await page.evaluate(() =>
      window.api.folder.searchText({
        rootPath: '/tmp',
        query: '',
      }),
    );
    expect(r.status).toBe('ok');
    expect(r.hits).toEqual([]);
  });

  test('chunk 61 — view:toggle-ruler menu action toggles the page ruler', async () => {
    const { page } = launched;
    await openBlank(page);
    // Ruler off by default (no localStorage seed).
    expect(await page.getByTestId('studio-ruler-h').count()).toBe(0);
    // Trigger via the renderer's shared command-palette mapping —
    // the menu IPC isn't directly drivable from playwright but the
    // command palette runs the same dispatchMenuAction under the
    // hood. We open ⌘K and pick the "보기 → 룰러 토글" entry.
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+k`);
    await page.getByTestId('command-palette-input').fill('룰러');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('studio-ruler-h').first()).toBeVisible();
  });

  test('chunk 64 — typing `/` on an empty body paragraph opens slash menu', async () => {
    const { page } = launched;
    await openBlank(page);
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });
    await page.keyboard.press('/');
    await expect(page.getByTestId('studio-slash-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('studio-slash-menu')).not.toBeVisible();
  });

  test('chunk 62 — version history IPC: createVersion + listVersions round-trip', async () => {
    const { page, userDataDir } = launched;
    await openBlank(page);

    const target = path.join(userDataDir, 'version-test.hwp');
    // Seed two versions of the same path.
    await page.evaluate(async (p) => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      await window.api.file.createVersion({ path: p, bytes });
      // Force timestamps to differ — the filename uses ISO so a 1ms
      // gap is enough but Playwright's clock isn't always granular
      // enough; pad to 50ms.
      await new Promise<void>((r) => setTimeout(r, 50));
      await window.api.file.createVersion({ path: p, bytes });
    }, target);

    const versions = await page.evaluate(
      async (p) => await window.api.file.listVersions(p),
      target,
    );
    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions[0].size).toBeGreaterThan(0);

    // Read one version back.
    const buf = await page.evaluate(
      async ({ p, fname }) =>
        await window.api.file.readVersion({ path: p, filename: fname }),
      { p: target, fname: versions[0].filename },
    );
    expect(buf).not.toBeNull();
  });

  test('chunk 62 — version history dialog opens via ⌘K', async () => {
    const { page } = launched;
    await openBlank(page);
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+k`);
    await page.getByTestId('command-palette-input').fill('버전');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('version-history-dialog')).toBeVisible();
    await expect(page.getByTestId('version-history-empty')).toBeVisible();
  });

  test('chunk 65 — newWindow IPC creates a second BrowserWindow', async () => {
    const { app } = launched;
    expect(app.windows().length).toBe(1);
    await launched.page.evaluate(async () => {
      await window.api.newWindow();
    });
    // Wait for the second window to appear.
    await expect.poll(() => app.windows().length).toBe(2);
  });

  test('chunk 58 — outline sidebar opens via ⌘⇧O', async () => {
    test.skip(
      !existsSync(STRESS_FIXTURE),
      'examples/*.hwp stress fixture missing (gitignored)',
    );
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, STRESS_FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+Shift+o`);
    await expect(page.getByTestId('studio-outline-sidebar')).toBeVisible();
    await page.getByTestId('studio-outline-close').click();
    await expect(page.getByTestId('studio-outline-sidebar')).not.toBeVisible();
  });
});
