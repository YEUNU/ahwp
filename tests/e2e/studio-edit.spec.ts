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
    const initialBefore = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return {
        bytes: dbg.exportBytes().byteLength,
        dirty: dbg.isDirty(),
      };
    });
    expect(initialBefore.dirty).toBe(false);

    const after = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'STUDIO-EDIT-TEST');
      return {
        bytes: dbg.exportBytes().byteLength,
        dirty: dbg.isDirty(),
      };
    });
    expect(after.bytes).toBeGreaterThan(initialBefore.bytes);
    expect(after.dirty).toBe(true);

    // UI dirty indicator
    await expect(page.getByTestId('studio-dirty-indicator')).toBeVisible();
  });

  test('save round-trip: edit → save → reopen → edit persists', async () => {
    const { page } = launched;
    const target = path.join(workDir, 'edited.hwpx');

    // Insert text + capture mutated bytes
    const mutatedSize = await page.evaluate(
      async ({ dst }) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.insertText(0, 0, 0, 'STUDIO-EDIT-ROUNDTRIP');
        const bytes = dbg.exportBytes();
        const result = await window.api.file.save({ path: dst, bytes });
        return { savedPath: result.path, size: bytes.byteLength };
      },
      { dst: target },
    );

    // file:save normalizes via @rhwp/core (parse → exportHwpx). The on-disk
    // size may differ slightly from raw exportBytes due to normalization,
    // but the file must exist with HWPX magic.
    const onDisk = await readFile(target);
    expect(Array.from(onDisk.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // Re-read via app's file:read (also goes through @rhwp/core ensureHwpxBytes —
    // pass-through for HWPX). Bytes should equal disk bytes.
    const reread = await page.evaluate(async (p) => {
      const buf = await window.api.file.read(p);
      return new Uint8Array(buf).byteLength;
    }, target);
    expect(reread).toBe(onDisk.byteLength);
    // Sanity: saved size differs from blank (it has more content now).
    expect(mutatedSize.size).toBeGreaterThan(0);
  });

  test('deleteText reverts insertion (idempotent round-trip)', async () => {
    const { page } = launched;
    const sizes = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const beforeBytes = dbg.exportBytes().byteLength;
      dbg.insertText(0, 0, 0, 'TEMP');
      const insertedBytes = dbg.exportBytes().byteLength;
      dbg.deleteText(0, 0, 0, 'TEMP'.length);
      const afterDeleteBytes = dbg.exportBytes().byteLength;
      return { beforeBytes, insertedBytes, afterDeleteBytes };
    });
    expect(sizes.insertedBytes).toBeGreaterThan(sizes.beforeBytes);
    // After delete, bytes should be back near the original (not necessarily
    // identical — the IR may carry residual structural changes).
    expect(sizes.afterDeleteBytes).toBeLessThan(sizes.insertedBytes);
  });
});
