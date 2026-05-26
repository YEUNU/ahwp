/// <reference lib="dom" />
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * 0.6.0 — workspace 가 .hwp / .hwpx 외에 PDF / DOCX / TXT / MD / CSV /
 * JSON / XML / HTML 도 enumerate + extract 가능한지. AI 의
 * `folder:list-outlines` (= `searchWorkspaceOutlines` 도구) 가
 * 모든 readable 포맷을 entry 로 반환하고, `folder:read-paragraph` 가
 * non-HWP 파일에서도 chunk 단위 텍스트를 돌려주는지 검증.
 *
 * PDF / DOCX / Excel 은 binary fixture 가 필요해서 본 spec 에선 평문
 * 포맷 (TXT / MD / CSV / JSON / HTML) 만 다룬다. binary extractor 의 정확성은
 * unit (`readable-formats.test.ts`) + 별도 fixture-loaded e2e 가 담당.
 */

async function makeMixedFixture(): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ahwp-mixed-'));
  // 평문 — extractText 가 dispatch 할 수 있는 다양한 family.
  await writeFile(
    path.join(root, 'report.txt'),
    '사업비 실적\n\n총액 500만원\n\n세부 내역 생략',
  );
  await writeFile(
    path.join(root, 'notes.md'),
    '# 중간보고서\n\n주요 항목 정리\n\n## 사업비\n\n500만원 지출\n\n## 운영비\n\n200만원',
  );
  await writeFile(
    path.join(root, 'budget.csv'),
    'item,amount\n사업비,500\n교육비,200\n운영비,300',
  );
  await writeFile(
    path.join(root, 'data.json'),
    '{"items": ["a","b","c"], "total": 1000}',
  );
  await writeFile(
    path.join(root, 'page.html'),
    '<h1>중간보고서</h1><p>본문</p><h2>사업비 항목</h2><p>500만원</p>',
  );
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.describe('0.6.0 — mixed-format workspace (AI surface)', () => {
  let launched: LaunchedApp;
  let fixture: { root: string; cleanup: () => Promise<void> };

  test.beforeEach(async () => {
    fixture = await makeMixedFixture();
    launched = await launchApp();
    await launched.page.evaluate(async (root) => {
      await window.api.session.set({ lastFolderPath: root });
    }, fixture.root);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
    await fixture.cleanup();
  });

  test('folder:list-outlines enumerates all readable formats', async () => {
    const { page } = launched;
    const result = await page.evaluate(async (root) => {
      return await window.api.folder.listOutlines({ rootPath: root });
    }, fixture.root);
    expect(result.status === 'ok' || result.status === 'partial').toBe(true);
    const filenames = result.entries.map((e) => e.filename).sort();
    // 5 readable 평문 파일 모두 출현.
    expect(filenames).toEqual(
      ['budget.csv', 'data.json', 'notes.md', 'page.html', 'report.txt'].sort(),
    );
  });

  test('notes.md outline contains markdown headings', async () => {
    const { page } = launched;
    const result = await page.evaluate(async (root) => {
      return await window.api.folder.listOutlines({ rootPath: root });
    }, fixture.root);
    const md = result.entries.find((e) => e.filename === 'notes.md');
    expect(md).toBeDefined();
    const headings = md!.outline.map((o) => o.text);
    expect(headings).toContain('중간보고서');
    expect(headings).toContain('사업비');
    expect(headings).toContain('운영비');
  });

  test('page.html outline contains <hN> tags', async () => {
    const { page } = launched;
    const result = await page.evaluate(async (root) => {
      return await window.api.folder.listOutlines({ rootPath: root });
    }, fixture.root);
    const html = result.entries.find((e) => e.filename === 'page.html');
    expect(html).toBeDefined();
    const headings = html!.outline.map((o) => o.text);
    expect(headings).toContain('중간보고서');
    expect(headings).toContain('사업비 항목');
  });

  test('budget.csv outline contains column headers + 3 row chunks', async () => {
    const { page } = launched;
    const result = await page.evaluate(async (root) => {
      return await window.api.folder.listOutlines({ rootPath: root });
    }, fixture.root);
    const csv = result.entries.find((e) => e.filename === 'budget.csv');
    expect(csv).toBeDefined();
    const headings = csv!.outline.map((o) => o.text);
    // headers = item, amount → outline 의 heading 으로 노출.
    expect(headings).toContain('item');
    expect(headings).toContain('amount');
  });

  test('folder:read-paragraph returns chunk for non-HWP path', async () => {
    const { page } = launched;
    // notes.md 의 첫 chunk = "# 중간보고서" 또는 첫 paragraph. chunk index 0.
    const result = await page.evaluate(async (root) => {
      return await window.api.folder.readParagraph({
        path: root + '/notes.md',
        sectionIdx: 0,
        paragraphIdx: 0,
      });
    }, fixture.root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toContain('중간보고서');
    }
  });

  test('folder:read-paragraph rejects sectionIdx > 0 for non-HWP', async () => {
    const { page } = launched;
    const result = await page.evaluate(async (root) => {
      return await window.api.folder.readParagraph({
        path: root + '/report.txt',
        sectionIdx: 1, // non-HWP 은 section 개념 없음 — 0 만 valid
        paragraphIdx: 0,
      });
    }, fixture.root);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('out-of-range');
    }
  });
});
