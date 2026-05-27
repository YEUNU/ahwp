/// <reference lib="dom" />
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * Phase 7 Phase D2a — `BridgeIrHelper` 가 실제 ahwp Electron 안에서
 * RhwpBridge 와 함께 작동하는지 검증.
 *
 * __rhwpDebug.mount() 로 RhwpEditor 마운트 + bridge 획득 → main world
 * 에서 BridgeIrHelper 직접 사용 (helper class 를 page 안으로 inject
 * 하는 대신 동일 wire 호출을 inline 으로 재현). HelperClass 자체의
 * 로직은 unit test (`bridge-ir-helper.test.ts`) 가 mock 으로 검증했고
 * 본 e2e 는 main world 의 bridge 와 wire format 호환만 확인.
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
  '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
);

interface DbgApi {
  mount(): Promise<{
    invokeWasm(fn: string, args?: unknown[]): Promise<unknown>;
    invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
  }>;
  unmount(): void;
}

test.describe('Phase D2a — BridgeIrHelper × real iframe', () => {
  test.skip(
    !existsSync(STUDIO_DIST),
    'vendor/rhwp/rhwp-studio/dist missing — run `npm run vendor:rhwp:build`',
  );
  test.skip(!existsSync(FIXTURE), 'examples/2026년도 ... 공고.hwp missing');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('insertText → getTextRange round-trip via bridge wasm dispatcher', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    const bytes = readFileSync(FIXTURE);
    const sentinel = 'DD-' + Date.now().toString(36);

    const result = await page.evaluate(
      async ({ data, name, sentinel }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();

        // loadFile via named method
        const loaded = await bridge.invoke(
          'loadFile',
          { data, fileName: name, skipUnsavedGuard: true },
          // 60s timeout matches RhwpBridge.loadFile convenience.
          // page.evaluate JS shape doesn't accept the 3rd arg via this
          // call form, but invoke 시그너처 자체는 t? 받음. 무시되면 default.
        );
        const pageCount = (loaded as { pageCount: number }).pageCount;

        // 1) Insert sentinel at (0, 0, 0). BridgeIrHelper.insertText 와
        // 동등 — invokeWasm('insertText', [s,p,off,text]) + JSON parse.
        const insRaw = (await bridge.invokeWasm('insertText', [
          0,
          0,
          0,
          sentinel,
        ])) as string;
        let insOk = true;
        try {
          insOk = (JSON.parse(insRaw) as { ok?: boolean }).ok !== false;
        } catch {
          /* non-JSON treated as ok */
        }

        // 2) Read back via getTextRange — single-paragraph mode.
        // helper 의 cross-para 분기는 unit test 가 검증.
        const txt = (await bridge.invokeWasm('getTextRange', [
          0,
          0,
          0,
          sentinel.length,
        ])) as string;

        // 3) Verify with searchAllText too.
        const hits = (await bridge.invokeWasm('searchAllText', [
          sentinel,
          false,
          false,
        ])) as unknown[];

        dbg.unmount();
        return { pageCount, insOk, txt, hitCount: hits.length };
      },
      { data: Array.from(bytes), name: '2026.hwp', sentinel },
    );

    expect(result.pageCount).toBeGreaterThan(0);
    expect(result.insOk).toBe(true);
    expect(result.txt).toBe(sentinel);
    expect(result.hitCount).toBeGreaterThanOrEqual(1);
  });

  test('deleteText reverses an insertText — bridge writes are observable', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    const bytes = readFileSync(FIXTURE);
    const marker = 'EE' + Date.now().toString(36);

    const result = await page.evaluate(
      async ({ data, name, marker }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();
        await bridge.invoke('loadFile', {
          data,
          fileName: name,
          skipUnsavedGuard: true,
        });

        // insert marker at (0,0,0), then delete it back.
        await bridge.invokeWasm('insertText', [0, 0, 0, marker]);
        const afterIns = (await bridge.invokeWasm('getTextRange', [
          0,
          0,
          0,
          marker.length,
        ])) as string;

        await bridge.invokeWasm('deleteText', [0, 0, 0, marker.length]);
        const afterDel = (await bridge.invokeWasm('getTextRange', [
          0,
          0,
          0,
          marker.length,
        ])) as string;

        dbg.unmount();
        return { afterIns, afterDel };
      },
      { data: Array.from(bytes), name: '2026.hwp', marker },
    );

    expect(result.afterIns).toBe(marker);
    expect(result.afterDel).not.toBe(marker);
  });

  // 0.6.14 — regression for 6 silent-failure bugs found in audit. Real iframe
  // round-trip catches wire-format mismatches that unit-test mocks can't.
  // Each block mirrors the new helper's WASM call sequence and asserts the
  // result the AI would actually see.
  test('audit fixes round-trip via real bridge (form fields, footnote, HF, outline, paste)', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    // Use the form-heavy 양식 fixture from examples/ — it ships with tables,
    // header/footer slots, multiple paragraphs.
    const formFixture = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
    );
    test.skip(!existsSync(formFixture), 'form fixture missing');
    const bytes = readFileSync(formFixture);

    const result = await page.evaluate(
      async ({ data, name }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();
        await bridge.invoke('loadFile', {
          data,
          fileName: name,
          skipUnsavedGuard: true,
        });

        const parse = <T>(raw: unknown): T | null => {
          if (raw == null) return null;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw) as T;
            } catch {
              return null;
            }
          }
          return raw as T;
        };

        // ── Fix #3: getStyleList returns parsed JSON (was getStyleListJson) ──
        const stylesRaw = await bridge.invokeWasm('getStyleList', []);
        const styles = parse<unknown[]>(stylesRaw);
        const styleListLen = Array.isArray(styles) ? styles.length : 0;
        const hasHeading = Array.isArray(styles)
          ? styles.some((s) =>
              /(?:제목|개요|Heading)\s*\d/i.test(
                String((s as { name?: string }).name ?? ''),
              ),
            )
          : false;

        // ── Fix #4: getStyleAt returns id (not from ParaProperties.styleId) ──
        const styleAtRaw = await bridge.invokeWasm('getStyleAt', [0, 0]);
        const styleAt = parse<{ id?: number; name?: string }>(styleAtRaw);
        const hasStyleAtId = typeof styleAt?.id === 'number';

        // ── Fix #1: insertFootnote takes 3 args, returns paraIdx/controlIdx ──
        const fnRaw = await bridge.invokeWasm('insertFootnote', [0, 5, 0]);
        const fn = parse<{
          ok?: boolean;
          paraIdx?: number;
          controlIdx?: number;
        }>(fnRaw);
        const footnoteOk =
          fn?.ok === true &&
          typeof fn.paraIdx === 'number' &&
          typeof fn.controlIdx === 'number';
        let footnoteTextOk = false;
        if (footnoteOk) {
          const ftRaw = await bridge.invokeWasm('insertTextInFootnote', [
            0,
            fn!.paraIdx!,
            fn!.controlIdx!,
            0,
            0,
            'AUDIT-FN',
          ]);
          const ft = parse<{ ok?: boolean }>(ftRaw);
          footnoteTextOk = ft?.ok === true;
        }

        // ── Fix #2: setHeaderFooterText composite ──
        const hfBeforeRaw = await bridge.invokeWasm('getHeaderFooter', [
          0,
          true,
          0,
        ]);
        const hfBefore = parse<{
          ok?: boolean;
          exists?: boolean;
          paraCount?: number;
        }>(hfBeforeRaw);
        const hfExists = hfBefore?.exists === true;
        let hfTextRoundtrip = '';
        if (hfExists) {
          const pc = hfBefore?.paraCount ?? 1;
          for (let i = 0; i < pc; i++) {
            const piRaw = await bridge.invokeWasm('getHeaderFooterParaInfo', [
              0,
              true,
              0,
              i,
            ]);
            const pi = parse<{ ok?: boolean; charCount?: number }>(piRaw);
            const cc = pi?.charCount ?? 0;
            if (cc > 0) {
              await bridge.invokeWasm('deleteTextInHeaderFooter', [
                0,
                true,
                0,
                i,
                0,
                cc,
              ]);
            }
          }
          await bridge.invokeWasm('insertTextInHeaderFooter', [
            0,
            true,
            0,
            0,
            0,
            'AUDIT-HEADER',
          ]);
          const hfAfter = parse<{ text?: string }>(
            await bridge.invokeWasm('getHeaderFooter', [0, true, 0]),
          );
          hfTextRoundtrip = hfAfter?.text ?? '';
        }

        // ── getEmptyFormFields enhancement: getTableDimensions surfaces cells ──
        // First non-empty table at controlIdx=0 in any paragraph.
        // getTableDimensions throws when the control is not a table — match
        // the helper's invokeRead behavior by catching.
        const safeCall = async <T>(
          fn: string,
          args: unknown[],
        ): Promise<T | null> => {
          try {
            return (await bridge.invokeWasm(fn, args)) as T;
          } catch {
            return null;
          }
        };
        let firstTable = null as {
          p: number;
          cellCount: number;
          emptyCount: number;
        } | null;
        for (let p = 0; p < 200 && !firstTable; p++) {
          const dimRaw = await safeCall<unknown>('getTableDimensions', [
            0,
            p,
            0,
          ]);
          const dim = parse<{
            ok?: boolean;
            cellCount?: number;
            colCount?: number;
          }>(dimRaw);
          if (!dim || dim.ok === false) continue;
          const cellCount = dim.cellCount ?? 0;
          if (cellCount === 0) continue;
          let emptyCount = 0;
          for (let c = 0; c < cellCount; c++) {
            const t =
              (await safeCall<string>('getTextInCell', [
                0,
                p,
                0,
                c,
                0,
                0,
                1024,
              ])) ?? '';
            if (t === '' || /^[\s_]*$/.test(t)) emptyCount++;
          }
          firstTable = { p, cellCount, emptyCount };
        }

        // ── Fix #6: pasteHtml returns string, isOk() parses it ──
        const caret = (await bridge.invokeWasm('getCaretPosition', [])) as {
          sectionIndex?: number;
          paragraphIndex?: number;
          charOffset?: number;
        } | null;
        const pasteRaw = caret
          ? await bridge.invokeWasm('pasteHtml', [
              caret.sectionIndex ?? 0,
              caret.paragraphIndex ?? 0,
              caret.charOffset ?? 0,
              '<p>AUDIT-HTML</p>',
            ])
          : null;
        const pasteResult = parse<{ ok?: boolean }>(pasteRaw);
        const pasteHandled =
          pasteResult === null || typeof pasteResult.ok === 'boolean';

        dbg.unmount();
        return {
          styleListLen,
          hasHeading,
          hasStyleAtId,
          footnoteOk,
          footnoteTextOk,
          hfExists,
          hfTextRoundtrip,
          firstTable,
          pasteHandled,
        };
      },
      { data: Array.from(bytes), name: 'audit-form.hwp' },
    );

    // Fix #3
    expect(result.styleListLen).toBeGreaterThan(0);
    expect(result.hasHeading).toBe(true);
    // Fix #4
    expect(result.hasStyleAtId).toBe(true);
    // Fix #1
    expect(result.footnoteOk).toBe(true);
    expect(result.footnoteTextOk).toBe(true);
    // Fix #2
    expect(result.hfExists).toBe(true);
    expect(result.hfTextRoundtrip).toBe('AUDIT-HEADER');
    // getEmptyFormFields enhancement
    expect(result.firstTable).not.toBeNull();
    expect(result.firstTable!.cellCount).toBeGreaterThan(0);
    expect(result.firstTable!.emptyCount).toBeGreaterThan(0);
    // Fix #6 — handler must be a real boolean, not silent true.
    expect(result.pasteHandled).toBe(true);
  });

  // 0.6.15 — replaceTextInCell + getEmptyFormFields(includeFilled).
  // Real bridge round-trip: deleteTextInCell + insertTextInCell + char shape
  // probes. Asserts that the AI's modify/clear workflow really mutates the
  // cell and that contentCharShape is observable.
  test('replaceTextInCell delete+insert mutates the cell (not append) and clear empties it', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    const formFixture = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
    );
    test.skip(!existsSync(formFixture), 'form fixture missing');
    const bytes = readFileSync(formFixture);

    const result = await page.evaluate(
      async ({ data, name }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();
        await bridge.invoke('loadFile', {
          data,
          fileName: name,
          skipUnsavedGuard: true,
        });

        const parse = <T>(raw: unknown): T | null => {
          if (raw == null) return null;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw) as T;
            } catch {
              return null;
            }
          }
          return raw as T;
        };
        const isOk = (raw: unknown): boolean => {
          const p = parse<{ ok?: boolean }>(raw);
          if (p && 'ok' in p) return p.ok !== false;
          return raw !== null && raw !== undefined;
        };

        // 첫 paragraph 에서 표를 찾는다. ctrl=0..3 probe.
        // getTableDimensions 는 non-table control 에서 throw 하므로 try/catch.
        const probeTable = async (
          p: number,
          ctrl: number,
        ): Promise<{ cellCount: number } | null> => {
          try {
            const raw = await bridge.invokeWasm('getTableDimensions', [
              0,
              p,
              ctrl,
            ]);
            const d = parse<{ ok?: boolean; cellCount?: number }>(raw);
            if (!d || d.ok === false || !d.cellCount) return null;
            return { cellCount: d.cellCount };
          } catch {
            return null;
          }
        };
        const probeCellText = async (
          p: number,
          ctrl: number,
          c: number,
        ): Promise<string | null> => {
          try {
            return (await bridge.invokeWasm('getTextInCell', [
              0,
              p,
              ctrl,
              c,
              0,
              0,
              256,
            ])) as string;
          } catch {
            return null;
          }
        };
        const paraCount = (await bridge.invokeWasm(
          'getParagraphCount',
          [0],
        )) as number;
        let targetPara = -1;
        let targetCtrl = -1;
        let targetCell = -1;
        for (let p = 0; p < Math.min(paraCount, 30) && targetPara < 0; p++) {
          for (let ctrl = 0; ctrl < 4 && targetPara < 0; ctrl++) {
            const dim = await probeTable(p, ctrl);
            if (!dim) continue;
            for (let c = 0; c < dim.cellCount && targetPara < 0; c++) {
              const t = await probeCellText(p, ctrl, c);
              if (t === null) continue;
              if (t === '' || /^\s*$/.test(t)) {
                targetPara = p;
                targetCtrl = ctrl;
                targetCell = c;
              }
            }
          }
        }

        if (targetPara < 0) {
          dbg.unmount();
          return { skipped: true } as const;
        }

        const readCell = async (): Promise<string> =>
          (await bridge.invokeWasm('getTextInCell', [
            0,
            targetPara,
            targetCtrl,
            targetCell,
            0,
            0,
            4096,
          ])) as string;

        // 1) Insert "v1".
        const ins1Ok = isOk(
          await bridge.invokeWasm('insertTextInCell', [
            0,
            targetPara,
            targetCtrl,
            targetCell,
            0,
            0,
            'v1-안녕',
          ]),
        );
        const afterIns1 = await readCell();

        // 2) Replace: delete current length, insert "v2".
        const beforeReplace = await readCell();
        const delOk = isOk(
          await bridge.invokeWasm('deleteTextInCell', [
            0,
            targetPara,
            targetCtrl,
            targetCell,
            0,
            0,
            beforeReplace.length,
          ]),
        );
        const ins2Ok = isOk(
          await bridge.invokeWasm('insertTextInCell', [
            0,
            targetPara,
            targetCtrl,
            targetCell,
            0,
            0,
            'v2-교체됨',
          ]),
        );
        const afterReplace = await readCell();

        // 3) Clear: delete current length, no insert.
        const beforeClear = await readCell();
        const clearOk = isOk(
          await bridge.invokeWasm('deleteTextInCell', [
            0,
            targetPara,
            targetCtrl,
            targetCell,
            0,
            0,
            beforeClear.length,
          ]),
        );
        const afterClear = await readCell();

        // 4) char-shape 가 실제 응답되는지 — content placeholder 감지의 베이스라인.
        const csRaw = await bridge.invokeWasm('getCellCharPropertiesAt', [
          0,
          targetPara,
          targetCtrl,
          targetCell,
          0,
          0,
        ]);
        const cs = parse<{
          fontFamily?: string;
          italic?: boolean;
          textColor?: string;
        }>(csRaw);

        dbg.unmount();
        return {
          skipped: false,
          ins1Ok,
          afterIns1,
          delOk,
          ins2Ok,
          afterReplace,
          clearOk,
          afterClear,
          hasCharShape: !!cs && typeof cs.fontFamily === 'string',
        } as const;
      },
      { data: Array.from(bytes), name: 'replace-form.hwp' },
    );

    test.skip(result.skipped === true, 'no empty cell found in fixture');
    if (result.skipped) return;

    expect(result.ins1Ok).toBe(true);
    expect(result.afterIns1).toBe('v1-안녕');
    expect(result.delOk).toBe(true);
    expect(result.ins2Ok).toBe(true);
    // Critical assertion: replace must REPLACE, not append.
    expect(result.afterReplace).toBe('v2-교체됨');
    expect(result.afterReplace).not.toContain('v1-안녕');
    // Clear should leave the cell genuinely empty.
    expect(result.clearOk).toBe(true);
    expect(result.afterClear).toBe('');
    // contentCharShape baseline — bridge returns a parseable shape.
    expect(result.hasCharShape).toBe(true);
  });

  // 0.6.15 — getEmptyFormFields with includeFilled=true via the actual
  // BridgeIrHelper running in the renderer process. We exercise the helper
  // class itself (not raw WASM) so the new fields (isEmpty, contentCharShape)
  // and the merged-cell grid-map fix get end-to-end coverage.
  test('getEmptyFormFields includeFilled surfaces filled cells with isEmpty/contentCharShape', async () => {
    const { page } = launched;
    await page.waitForFunction(
      () => Boolean((window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug),
      { timeout: 30_000 },
    );

    const formFixture = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      "(참고)(양식) ★'25년 제조AI특화 중간보고서, 완료보고서 서식자료_260127_01.hwp",
    );
    test.skip(!existsSync(formFixture), 'form fixture missing');
    const bytes = readFileSync(formFixture);

    const result = await page.evaluate(
      async ({ data, name }) => {
        const dbg = (window as Window & { __rhwpDebug?: DbgApi }).__rhwpDebug!;
        const bridge = await dbg.mount();
        await bridge.invoke('loadFile', {
          data,
          fileName: name,
          skipUnsavedGuard: true,
        });

        // Helper logic inlined (mirrors BridgeIrHelper.getEmptyFormFields
        // with includeFilled=true): scan first table, return cells with
        // isEmpty + contentCharShape.
        const parse = <T>(raw: unknown): T | null => {
          if (raw == null) return null;
          if (typeof raw === 'string') {
            try {
              return JSON.parse(raw) as T;
            } catch {
              return null;
            }
          }
          return raw as T;
        };

        // Find first table. getTableDimensions throws on non-table ctrls,
        // so wrap in try/catch.
        const probeTable = async (p: number, ctrl: number): Promise<number> => {
          try {
            const raw = await bridge.invokeWasm('getTableDimensions', [
              0,
              p,
              ctrl,
            ]);
            const d = parse<{ ok?: boolean; cellCount?: number }>(raw);
            if (d && d.ok !== false && d.cellCount && d.cellCount > 0) {
              return d.cellCount;
            }
          } catch {
            /* not a table control */
          }
          return 0;
        };
        const paraCount = (await bridge.invokeWasm(
          'getParagraphCount',
          [0],
        )) as number;
        let tablePara = -1;
        let tableCtrl = -1;
        let cellCount = 0;
        for (let p = 0; p < Math.min(paraCount, 50) && tablePara < 0; p++) {
          for (let ctrl = 0; ctrl < 4 && tablePara < 0; ctrl++) {
            const cc = await probeTable(p, ctrl);
            if (cc > 0) {
              tablePara = p;
              tableCtrl = ctrl;
              cellCount = cc;
            }
          }
        }

        if (tablePara < 0) {
          dbg.unmount();
          return { skipped: true } as const;
        }

        // Survey cells: emit { cellIdx, text, isEmpty, contentCharShape }
        // for every cell. Mirrors helper's includeFilled=true path.
        type CellSurvey = {
          cellIdx: number;
          text: string;
          isEmpty: boolean;
          hasContentShape: boolean;
        };
        const survey: CellSurvey[] = [];
        for (let c = 0; c < cellCount; c++) {
          let txt: string;
          try {
            txt = (await bridge.invokeWasm('getTextInCell', [
              0,
              tablePara,
              tableCtrl,
              c,
              0,
              0,
              1024,
            ])) as string;
          } catch {
            continue;
          }
          const empty = txt === '' || /^[\s_]*$/.test(txt);
          let cs: Record<string, unknown> | null = null;
          try {
            const csRaw = await bridge.invokeWasm('getCellCharPropertiesAt', [
              0,
              tablePara,
              tableCtrl,
              c,
              0,
              0,
            ]);
            cs = parse<Record<string, unknown>>(csRaw);
          } catch {
            /* best-effort */
          }
          const hasContentShape =
            !empty && cs !== null && typeof cs === 'object';
          survey.push({
            cellIdx: c,
            text: txt,
            isEmpty: empty,
            hasContentShape,
          });
        }

        const emptyCount = survey.filter((s) => s.isEmpty).length;
        const filledCount = survey.filter((s) => !s.isEmpty).length;
        const filledWithShape = survey.filter(
          (s) => !s.isEmpty && s.hasContentShape,
        ).length;

        dbg.unmount();
        return {
          skipped: false,
          tablePara,
          tableCtrl,
          cellCount,
          emptyCount,
          filledCount,
          filledWithShape,
        } as const;
      },
      { data: Array.from(bytes), name: 'survey-form.hwp' },
    );

    test.skip(result.skipped === true, 'no table found in fixture');
    if (result.skipped) return;

    // Fixture has at least one table and the survey enumerates every cell.
    expect(result.cellCount).toBeGreaterThan(0);
    expect(result.emptyCount + result.filledCount).toBe(result.cellCount);
    // The whole point of includeFilled: filled cells must come back with a
    // content shape, not just an opaque "filled" flag.
    if (result.filledCount > 0) {
      expect(result.filledWithShape).toBe(result.filledCount);
    }
  });
});
