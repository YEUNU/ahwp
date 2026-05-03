/// <reference lib="dom" />
import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp } from './launch';

/**
 * Phase 1 마무리 — file:new flow.
 *
 * Verifies the menu/button "새 문서" path:
 *   1. Welcome view shows the new-doc button
 *   2. Clicking it calls window.api.file.new() → returns a temp .hwp path
 *   3. The returned bytes are CFB (HWP) — `HwpDocument.createEmpty()` +
 *      `exportHwp` route through @rhwp/core
 *   4. AppShell sets activePath; StudioViewer mounts and renders
 */

interface StudioDebug {
  insertText(s: number, p: number, c: number, text: string): string;
  isDirty(): boolean;
  exportBytes(): Uint8Array;
  focusViewer(): void;
}

test.describe('file:new — Phase 1 마무리', () => {
  test('new-doc button creates a blank doc and mounts the viewer', async () => {
    const launched = await launchApp();
    try {
      const { page } = launched;
      // Welcome view should be present (no session restoration of an
      // existing path, since this launch is fresh and no lastActivePath).
      await expect(page.getByTestId('welcome-new-doc')).toBeVisible();
      await page.getByTestId('welcome-new-doc').click();

      // Studio mounts on the new file.
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('studio-viewer')).toBeVisible();
    } finally {
      await launched.close();
    }
  });

  test('file.new IPC returns a CFB-magic .hwp path under userData/temp', async () => {
    const launched = await launchApp();
    try {
      const { page } = launched;
      const result = await page.evaluate(() => window.api.file.new());
      expect(result.path).toMatch(/\.hwp$/);
      // The temp file should exist on disk and start with CFB magic.
      const stat = await fs.stat(result.path);
      expect(stat.isFile()).toBe(true);
      const head = await fs.readFile(result.path);
      expect(Array.from(head.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
      // Path should land under userData/temp (sandboxed launch dir).
      expect(result.path).toMatch(/temp[\\/]new-\d+\.hwp$/);
    } finally {
      await launched.close();
    }
  });

  test('new doc supports edit + Save As to a real path', async () => {
    const launched = await launchApp();
    const workDir = await mkdtemp(path.join(tmpdir(), 'ahwp-new-'));
    try {
      const { page } = launched;
      await page.getByTestId('welcome-new-doc').click();
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 30_000 },
      );
      // Insert text, then save to workDir.
      const target = path.join(workDir, 'fresh.hwp');
      await page.evaluate(async (dst) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.insertText(0, 0, 0, 'NEW-DOC-CONTENT');
        const bytes = dbg.exportBytes();
        await window.api.file.save({ path: dst, bytes });
      }, target);
      const stat = await fs.stat(target);
      expect(stat.isFile()).toBe(true);
      const head = await fs.readFile(target);
      expect(Array.from(head.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0]);
    } finally {
      await launched.close();
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
