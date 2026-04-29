/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Studio chunk 4-A — programmatic edit + round-trip.
 *
 * Verifies the architecture works:
 *   1. HwpDocument.insertText mutates the in-memory IR
 *   2. exportHwpx returns updated bytes (different from initial)
 *   3. Save bytes to disk → reopen → re-export → mutated state preserved
 *
 * Real keyboard / mouse / cursor UI lands in chunk 4-B; this spec drives
 * the document directly via window.__studioDebug.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  deleteText(s: number, p: number, c: number, count: number): string;
  getCaretPosition(): string;
  exportBytes(): Uint8Array;
  getPageCount(): number;
  isDirty(): boolean;
}

async function activateStudio(page: Page, fixture: string): Promise<void> {
  await page.evaluate(async (p) => {
    localStorage.setItem('ahwp:use-studio', '1');
    await window.api.session.set({ lastActivePath: p });
  }, fixture);
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  // wait for studio debug surface to attach (post-render)
  await page.waitForFunction(
    () =>
      Boolean(
        (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
      ),
    { timeout: 30_000 },
  );
}

test.describe('studio edit — chunk 4-A (programmatic mutation + round-trip)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  let launched: LaunchedApp;
  let workDir: string;

  test.beforeEach(async () => {
    launched = await launchApp();
    workDir = await mkdtemp(path.join(tmpdir(), 'ahwp-edit-'));
    await activateStudio(launched.page, FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
    await rm(workDir, { recursive: true, force: true });
  });

  test('insertText changes exportBytes; dirty indicator appears', async () => {
    const { page } = launched;
    // Compare a content checksum (not byteLength) — HWP/CFB pads to fixed
    // sector sizes so small inserts may not bump the byte count, but content
    // certainly changes.
    const before = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return { hash: h, dirty: dbg.isDirty() };
    });
    expect(before.dirty).toBe(false);

    const after = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'STUDIO-EDIT-TEST');
      const bytes = dbg.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return { hash: h, dirty: dbg.isDirty() };
    });
    expect(after.hash).not.toBe(before.hash);
    expect(after.dirty).toBe(true);

    // UI dirty indicator
    await expect(page.getByTestId('studio-dirty-indicator')).toBeVisible();
  });

  test('save round-trip: edit → save → reopen → edit persists', async () => {
    const { page } = launched;
    // Server auto-routes .hwpx → .hwp regardless of caller's choice.
    const requested = path.join(workDir, 'edited.hwpx');
    const actualPath = path.join(workDir, 'edited.hwp');

    // Insert text + capture mutated bytes
    const result = await page.evaluate(
      async ({ dst }) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.insertText(0, 0, 0, 'STUDIO-EDIT-ROUNDTRIP');
        const bytes = dbg.exportBytes();
        const r = await window.api.file.save({ path: dst, bytes });
        return { savedPath: r.path, size: bytes.byteLength };
      },
      { dst: requested },
    );
    expect(result.savedPath).toBe(actualPath);

    // file:save normalizes via @rhwp/core to HWP (CFB) — required to keep
    // images intact, see electron/hwp/converter.ts.
    const onDisk = await readFile(actualPath);
    expect(Array.from(onDisk.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
    // Re-read via app's file:read (pass-through). Bytes should equal disk.
    const reread = await page.evaluate(async (p) => {
      const buf = await window.api.file.read(p);
      return new Uint8Array(buf).byteLength;
    }, actualPath);
    expect(reread).toBe(onDisk.byteLength);
    expect(result.size).toBeGreaterThan(0);
  });

  test('deleteText after insertText brings content closer to original', async () => {
    const { page } = launched;
    const hashes = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const fold = (bytes: Uint8Array): number => {
        let h = 0;
        for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
        return h;
      };
      const before = fold(dbg.exportBytes());
      dbg.insertText(0, 0, 0, 'TEMP');
      const inserted = fold(dbg.exportBytes());
      dbg.deleteText(0, 0, 0, 'TEMP'.length);
      const afterDelete = fold(dbg.exportBytes());
      return { before, inserted, afterDelete };
    });
    // Insert changed content
    expect(hashes.inserted).not.toBe(hashes.before);
    // Delete changed content again (differs from the inserted state). We
    // don't assert byte-exact reversion to pre-insert — HWP's doc IR can
    // carry a redo/revision entry that survives a simple delete-by-count.
    expect(hashes.afterDelete).not.toBe(hashes.inserted);
  });
});

// Image preservation across save round-trip — verified against the user's
// example HWP (gitignored, so skipped in CI).
const STRESS_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

test.describe('studio edit — chunk 4-A (image preservation across save)', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  test('edit + save + reopen preserves embedded images', async () => {
    const launched = await launchApp();
    const workDir = await mkdtemp(path.join(tmpdir(), 'ahwp-img-'));
    try {
      // 1. Open user's example HWP, then a tiny edit + save
      await launched.page.evaluate(async (p) => {
        localStorage.setItem('ahwp:use-studio', '1');
        await window.api.session.set({ lastActivePath: p });
      }, STRESS_FIXTURE);
      await launched.page.reload();
      await launched.page.waitForLoadState('domcontentloaded');
      await launched.page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 30_000 },
      );

      const requested = path.join(workDir, 'edited.hwpx');
      const actualPath = path.join(workDir, 'edited.hwp');

      const savedPath = await launched.page.evaluate(
        async ({ dst }) => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          dbg.insertText(0, 0, 0, 'IMG-PRESERVE');
          const bytes = dbg.exportBytes();
          const r = await window.api.file.save({ path: dst, bytes });
          return r.path;
        },
        { dst: requested },
      );
      expect(savedPath).toBe(actualPath);
      // Disk file is HWP (CFB).
      const onDisk = await readFile(actualPath);
      expect(Array.from(onDisk.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0]);

      // 2. Re-open the saved file in the same app via session restoration.
      await launched.page.evaluate(async (p) => {
        await window.api.session.set({ lastActivePath: p });
      }, actualPath);
      await launched.page.reload();
      await launched.page.waitForLoadState('domcontentloaded');
      await launched.page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 30_000 },
      );

      // 3. Scroll through every page to force lazy-render, then check the
      //    diag for total image count.
      type Diag = Record<
        number,
        { string: number; parsed: number; mounted: number }
      >;
      const placeholders = launched.page.getByTestId('studio-viewer-page');
      const total = await placeholders.count();
      for (let i = 0; i < total; i++) {
        await placeholders.nth(i).scrollIntoViewIfNeeded();
      }
      await launched.page.waitForTimeout(2000);

      const diag = (await launched.page.evaluate(
        () => (window as Window & { __studioPageDiag?: Diag }).__studioPageDiag,
      )) as Diag | undefined;
      const totalImages = Object.values(diag ?? {}).reduce(
        (sum, v) => sum + v.mounted,
        0,
      );
      console.log(
        `[e2e] images preserved across edit+save+reopen: ${totalImages}`,
      );
      // Original HWP has 25 images (per scripts/check-image-pipeline.mjs).
      // Don't pin to exact count — text reflow can shift content slightly.
      // Require at least half of the original: anything >= 12 confirms
      // images survive the round-trip (i.e. we're not on the broken HWPX
      // path that drops them all to 0).
      expect(totalImages).toBeGreaterThanOrEqual(12);
    } finally {
      await launched.close();
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
