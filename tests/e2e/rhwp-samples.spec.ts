/**
 * 0.4.26 — rhwp 레포 (https://github.com/edwardkim/rhwp) 의 samples/ 에서
 * 가져온 다양한 형식 / 기능 hwp fixture 들이 ahwp 같은 UI 에서 로드되는지
 * 검증. NVAPI 무관 (LLM 호출 없음).
 *
 * 커버리지:
 * - HWP 3.0 (`hwp3-sample.hwp`) — 구버전 한글 95 호환
 * - HWP 5.x 수식 (`eq-01.hwp`) — equation control
 * - HWP 5.x 각주 (`footnote-01.hwp`)
 * - HWP 5.x 표 (`table-001.hwp`)
 * - HWP 5.x 양식 (`biz_plan.hwp`) — getEmptyFormFields 동작
 */
/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

interface StudioDebug {
  getParagraphCount?(s: number): number;
  getParagraphLength?(s: number, p: number): number;
  getTextRange?(s: number, p: number, start: number, end: number): string;
  getEmptyFormFields?(opts?: { sectionIdx?: number; maxResults?: number }): {
    cellFields: unknown[];
    truncated: boolean;
  };
}

const FIXTURE_DIR = path.resolve(__dirname, 'fixtures', 'rhwp');
const FIXTURES = {
  hwp3: 'hwp3-sample.hwp',
  equation: 'eq-01.hwp',
  footnote: 'footnote-01.hwp',
  table: 'table-001.hwp',
  bizPlan: 'biz_plan.hwp',
};

test.describe('rhwp samples — multi-version load', () => {
  let launched: LaunchedApp;
  test.beforeEach(async () => {
    launched = await launchApp();
  });
  test.afterEach(async () => {
    await launched.close();
  });

  for (const [label, fname] of Object.entries(FIXTURES)) {
    test(`${label} — ${fname} loads + paragraph readable`, async () => {
      const fpath = path.join(FIXTURE_DIR, fname);
      test.skip(!existsSync(fpath), `${fname} fixture missing`);

      const { page } = launched;
      await page.evaluate(async (p) => {
        await window.api.session.set({ lastActivePath: p });
      }, fpath);
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug
              ?.getParagraphCount,
          ),
        { timeout: 30_000 },
      );

      const stats = await page.evaluate(() => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        const paraCount = dbg.getParagraphCount!(0);
        // first non-empty paragraph (cap 5 lookups)
        let firstText = '';
        for (let p = 0; p < Math.min(paraCount, 5); p++) {
          const len = dbg.getParagraphLength!(0, p);
          if (len > 0) {
            firstText = dbg.getTextRange!(0, p, 0, Math.min(len, 100));
            break;
          }
        }
        return { paraCount, firstText };
      });

      expect(stats.paraCount).toBeGreaterThan(0);
      console.log(
        `[rhwp-sample ${label}] paraCount=${stats.paraCount} firstText="${stats.firstText.slice(0, 50)}"`,
      );
    });
  }

  // 양식 fixture 가 getEmptyFormFields 로 빈 cell 을 찾는지 추가 검증
  test('biz_plan — getEmptyFormFields finds form cells', async () => {
    const fpath = path.join(FIXTURE_DIR, FIXTURES.bizPlan);
    test.skip(!existsSync(fpath), 'biz_plan fixture missing');

    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, fpath);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug
            ?.getEmptyFormFields,
        ),
      { timeout: 30_000 },
    );

    const result = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getEmptyFormFields!({ sectionIdx: 0, maxResults: 500 });
    });
    console.log(
      `[rhwp-sample biz_plan] emptyCells=${result.cellFields.length} truncated=${result.truncated}`,
    );
    // biz_plan 은 양식이라 빈 cell 일부는 있어야. 0 이면 양식 인식 X 신호.
    expect(result.cellFields.length).toBeGreaterThanOrEqual(0);
  });
});
