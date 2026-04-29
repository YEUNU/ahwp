/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Round-trip tests using the user's example HWP. The file is gitignored
 * (per docs/PROGRESS.md: examples/ contains user-supplied fixtures), so
 * tests skip when it's missing — useful in dev, harmless in CI.
 *
 * What we cover end-to-end here is the IPC + main-side conversion / persist
 * layer. We don't depend on the studio iframe (which is external + flaky for
 * automated tests).
 */
const EXAMPLE_HWP = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);

const HWPX_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"

test.describe('file round-trip', () => {
  test.skip(!existsSync(EXAMPLE_HWP), 'examples/*.hwp fixture not present');

  let launched: LaunchedApp;
  let workDir: string;

  test.beforeEach(async () => {
    launched = await launchApp();
    workDir = await mkdtemp(path.join(tmpdir(), 'ahwp-rt-'));
  });

  test.afterEach(async () => {
    await launched.close();
    await rm(workDir, { recursive: true, force: true });
  });

  test('file:read returns raw bytes (HWP magic preserved)', async () => {
    // We used to pre-convert HWP→HWPX in main, but @rhwp/core v0.7.8 drops
    // image references in that round-trip (see electron/hwp/converter.ts).
    // file:read now returns bytes verbatim; the renderer's HwpDocument
    // auto-detects HWP vs HWPX and parses each correctly.
    const { page } = launched;
    const head = await page.evaluate(async (p) => {
      const buf = await window.api.file.read(p);
      return Array.from(new Uint8Array(buf).slice(0, 4));
    }, EXAMPLE_HWP);
    // HWP CFB magic: D0 CF 11 E0
    expect(head).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
  });

  test('save round-trip: HWPX bytes survive write → read', async () => {
    const { page } = launched;
    const target = path.join(workDir, 'roundtrip.hwpx');

    const written = await page.evaluate(
      async ({ src, dst }) => {
        const bytes = await window.api.file.read(src);
        const result = await window.api.file.save({ path: dst, bytes });
        return result.path;
      },
      { src: EXAMPLE_HWP, dst: target },
    );
    expect(written).toBe(target);

    const onDisk = await readFile(target);
    expect(Array.from(onDisk.slice(0, 4))).toEqual(HWPX_MAGIC);

    // file:read on HWPX is byte-exact pass-through (ensureHwpxBytes
    // short-circuits HWPX), so the size must match disk.
    const reread = await page.evaluate(async (p) => {
      const buf = await window.api.file.read(p);
      return new Uint8Array(buf).byteLength;
    }, target);
    expect(reread).toBe(onDisk.byteLength);
  });

  test('file:save auto-routes .hwp path to .hwpx (server normalizes to HWPX)', async () => {
    const { page } = launched;
    // Caller naively passes the original .hwp path — server should rewrite
    // to .hwpx since the on-disk format is always HWPX after normalization.
    const requested = path.join(workDir, 'naive.hwp');
    const expected = path.join(workDir, 'naive.hwpx');

    const result = await page.evaluate(
      async ({ src, dst }) => {
        const bytes = await window.api.file.read(src);
        return window.api.file.save({ path: dst, bytes });
      },
      { src: EXAMPLE_HWP, dst: requested },
    );
    expect(result.path).toBe(expected);

    // The .hwp name must NOT exist; the .hwpx sibling must.
    const onDisk = await readFile(expected);
    expect(Array.from(onDisk.slice(0, 4))).toEqual(HWPX_MAGIC);
    await expect(readFile(requested)).rejects.toThrow();
  });
});

test.describe('session restoration', () => {
  test.skip(!existsSync(EXAMPLE_HWP), 'examples/*.hwp fixture not present');

  test('lastActivePath persists across app restarts', async () => {
    // Launch 1: open file, persist session
    const first = await launchApp();
    await first.page.evaluate(async (p) => {
      await window.api.file.openByPath(p);
      await window.api.session.set({ lastActivePath: p });
    }, EXAMPLE_HWP);
    await first.app.close();

    // Re-launch using the SAME userDataDir so session.json carries over.
    const sharedUserData = first.userDataDir;
    const { _electron: electron } = await import('@playwright/test');
    const repoRoot = path.resolve(__dirname, '..', '..');
    const app = await electron.launch({
      args: [
        path.join(repoRoot, 'dist-electron', 'main.js'),
        `--user-data-dir=${sharedUserData}`,
      ],
      cwd: repoRoot,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // Renderer auto-opens lastActivePath on mount → wait for path to land
    // in the editor header (which renders activePath).
    await expect(page.getByText(EXAMPLE_HWP)).toBeVisible({ timeout: 10_000 });

    // Sanity check: session.json still has the path.
    const stored = await page.evaluate(async () => {
      return window.api.session.get();
    });
    expect(stored.lastActivePath).toBe(EXAMPLE_HWP);

    await app.close();
    await rm(sharedUserData, { recursive: true, force: true });
  });
});

test.describe('recent files', () => {
  test.skip(!existsSync(EXAMPLE_HWP), 'examples/*.hwp fixture not present');

  test('openByPath populates listRecent', async () => {
    const launched = await launchApp();
    try {
      const recent = await launched.page.evaluate(async (p) => {
        await window.api.file.openByPath(p);
        return window.api.file.listRecent();
      }, EXAMPLE_HWP);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent[0].path).toBe(EXAMPLE_HWP);
      expect(typeof recent[0].lastOpenedAt).toBe('number');
    } finally {
      await launched.close();
    }
  });
});
