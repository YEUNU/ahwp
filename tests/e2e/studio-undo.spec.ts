/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Chunk 7 — Undo / Redo (snapshot-based).
 *
 * @rhwp/core exposes saveSnapshot/restoreSnapshot/discardSnapshot as a
 * bidirectional history. We push a snapshot after every mutation; ⌘Z and
 * ⌘⇧Z move the index pointer and restore the corresponding state.
 *
 * Uses the stress fixture so SVG actually contains rendered text — the
 * blank.hwpx seed paragraph has no lineseg layout (see studio-format spec).
 */

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
  exportBytes(): Uint8Array;
  focusViewer(): void;
  toggleCharFormat(key: 'bold' | 'italic' | 'underline'): void;
  getActiveFormat(): {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    styleId: number;
  };
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  historyDepth(): { index: number; size: number };
}

async function activateStudio(page: Page, fixture: string): Promise<void> {
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

test.describe('studio undo/redo — chunk 7', () => {
  test.skip(
    !existsSync(STRESS_FIXTURE),
    'examples/*.hwp stress fixture missing (gitignored)',
  );

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await activateStudio(launched.page, STRESS_FIXTURE);
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('baseline: canUndo=false, canRedo=false, history size=1', async () => {
    const { page } = launched;
    const state = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return {
        canUndo: dbg.canUndo(),
        canRedo: dbg.canRedo(),
        depth: dbg.historyDepth(),
      };
    });
    expect(state.canUndo).toBe(false);
    expect(state.canRedo).toBe(false);
    expect(state.depth).toEqual({ index: 0, size: 1 });
  });

  test('insertText pushes a history entry; undo reverses it', async () => {
    const { page } = launched;
    const before = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return h;
    });

    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 0, 0, 'UNDO-TEST');
    });

    const afterInsert = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return {
        hash: h,
        canUndo: dbg.canUndo(),
        canRedo: dbg.canRedo(),
      };
    });
    expect(afterInsert.hash).not.toBe(before);
    expect(afterInsert.canUndo).toBe(true);
    expect(afterInsert.canRedo).toBe(false);

    // Undo
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.undo();
    });

    const afterUndo = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return {
        hash: h,
        canUndo: dbg.canUndo(),
        canRedo: dbg.canRedo(),
        dirty: dbg.isDirty(),
      };
    });
    expect(afterUndo.hash).toBe(before);
    expect(afterUndo.canUndo).toBe(false);
    expect(afterUndo.canRedo).toBe(true);
    expect(afterUndo.dirty).toBe(false);
  });

  test('redo restores the undone state', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 0, 0, 'REDO');
    });
    const afterInsert = await page.evaluate(() => {
      const bytes = (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return h;
    });
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.undo();
    });
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.redo();
    });
    const afterRedo = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const bytes = dbg.exportBytes();
      let h = 0;
      for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
      return {
        hash: h,
        canUndo: dbg.canUndo(),
        canRedo: dbg.canRedo(),
        dirty: dbg.isDirty(),
      };
    });
    expect(afterRedo.hash).toBe(afterInsert);
    expect(afterRedo.canUndo).toBe(true);
    expect(afterRedo.canRedo).toBe(false);
    expect(afterRedo.dirty).toBe(true);
  });

  test('new mutation after undo discards the redo tail', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'A'); // entry 1
      dbg.insertText(0, 0, 1, 'B'); // entry 2
    });
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.historyDepth(),
      ),
    ).toEqual({ index: 2, size: 3 });

    // Undo back to entry 1, then make a new mutation — entry 2 (B) should
    // be discarded; new entry takes its place.
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.undo();
    });
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.historyDepth(),
      ),
    ).toEqual({ index: 1, size: 3 });

    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 0, 1, 'C');
    });
    const after = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return { depth: dbg.historyDepth(), canRedo: dbg.canRedo() };
    });
    expect(after.depth).toEqual({ index: 2, size: 3 });
    expect(after.canRedo).toBe(false);
  });

  test('Cmd/Ctrl+Z keyboard shortcut undoes', async () => {
    const { page } = launched;
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.focusViewer();
    });
    await page.keyboard.type('XYZ');
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.canUndo(),
        ),
      )
      .toBe(true);

    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${mod}+z`);

    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as Window & { __studioDebug?: StudioDebug }
          ).__studioDebug!.canRedo(),
        ),
      )
      .toBe(true);
  });

  test('toolbar Undo button reverses a mutation (history rollback)', async () => {
    const { page } = launched;
    // Make a mutation (insertText), then Undo via toolbar; assert depth
    // returned to baseline. Doesn't depend on getCharPropertiesAt's
    // sensitivity to paragraph layout (which varies by fixture).
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 0, 0, '!');
    });
    expect(
      await page.evaluate(() =>
        (
          window as Window & { __studioDebug?: StudioDebug }
        ).__studioDebug!.historyDepth(),
      ),
    ).toEqual({ index: 1, size: 2 });

    await page.getByTestId('studio-undo').click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as Window & { __studioDebug?: StudioDebug }
            ).__studioDebug!.historyDepth().index,
        ),
      )
      .toBe(0);
  });

  test('Undo button is disabled at baseline; enabled after a mutation', async () => {
    const { page } = launched;
    await expect(page.getByTestId('studio-undo')).toBeDisabled();
    await page.evaluate(() => {
      (
        window as Window & { __studioDebug?: StudioDebug }
      ).__studioDebug!.insertText(0, 0, 0, '!');
    });
    await expect(page.getByTestId('studio-undo')).toBeEnabled();
  });
});
