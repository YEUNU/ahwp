/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * chunk 99 follow-up — outline-aware section replace.
 *
 * 사용자 보고 (코렌스 사업계획서, 2.7.4 데이터 유효성 검증 방안):
 *
 *   AI 가 markdown 으로 "### 2.7.4 ..." 응답 → "마크다운 적용" 클릭 →
 *   기존 2.7.4 섹션 그대로 두고 새 내용을 caret 위치에 paste → 두 번
 *   복제됨.
 *
 * Fix: AI 응답의 첫 heading 의 섹션 번호 ("2.7.4") 가 doc outline 의
 * 같은 번호 항목과 일치하면, 기존 섹션 영역 (heading 부터 다음 동등/
 * 상위 heading 직전까지) 을 delete 후 paste. 사용자에겐 버튼이
 * "기존 2.7.4 섹션 교체" 로 바뀌어 의도가 가시화.
 *
 * 두 묶음:
 *  1. IR 레벨 (`applyHtmlReplaceSection` 디버그 호출): pre-set 단락을
 *     교체 → paragraphCount + 텍스트 검증. 매칭 / replace 이 동작하는
 *     로직 자체.
 *  2. 챗 UI 레벨: outline 가 비어있으면 (blank.hwpx) 매칭 미발동 →
 *     기본 "마크다운 적용" 버튼 (회귀 가드 — 기존 chunk 99 흐름 유지).
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, t: string): string;
  insertParagraph(s: number, p: number): string;
  getParagraphCount(s: number): number;
  getParagraphLength(s: number, p: number): number;
  getTextRange(s: number, p: number, so: number, eo: number): string;
  applyHtmlReplaceSection(
    html: string,
    target: { startParaIdx: number; endParaIdxExclusive: number },
  ): void;
  applyStyle(styleId: number): void;
  getStyleListJson(): Array<{
    id: number;
    name: string;
    englishName?: string;
  }> | null;
  getOutline?: () => Array<{
    paragraphIndex: number;
    level: number;
    text: string;
  }>;
}

let launched: LaunchedApp;

test.beforeEach(async () => {
  launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
  await launched.page.evaluate(async () => {
    await window.api.secrets.set('openai', 'test-key');
  });
  await launched.page.reload();
  await launched.page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await launched.close();
});

async function openFixture(page: Page, fixture: string): Promise<void> {
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

async function sendEcho(page: Page, payload: string): Promise<void> {
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

test.describe('chat — section replace (chunk 99 follow-up)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('IR: applyHtmlReplaceSection collapses existing span + pastes new HTML', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // Set up a synthetic outline: 4 paragraphs that we will treat as a
    // section span. Since blank.hwpx has 1 empty paragraph at index 0,
    // we insertText at (0,0,0) for the first para then insertParagraph
    // for the rest. The actual heading style isn't required for the IR
    // test — applyHtmlReplaceSection takes explicit start/end indices.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '2.7.4 기존 헤딩');
      dbg.insertParagraph(0, 1);
      dbg.insertText(0, 1, 0, '기존 본문 라인 1');
      dbg.insertParagraph(0, 2);
      dbg.insertText(0, 2, 0, '기존 본문 라인 2');
      dbg.insertParagraph(0, 3);
      dbg.insertText(0, 3, 0, '다음 섹션 헤딩');
    });

    // Sanity — 4 paragraphs.
    const initialCount = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParagraphCount(0);
    });
    expect(initialCount).toBe(4);

    // Replace [0, 3) — heading + 2 body paragraphs — with new content.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.applyHtmlReplaceSection(
        '<h3>2.7.4 새 데이터 유효성 검증 방안</h3><p>새 본문 한 줄.</p>',
        { startParaIdx: 0, endParaIdxExclusive: 3 },
      );
    });

    // After: para 0 = new heading, para 1 = new body, para 2 = "다음 섹션 헤딩"
    // (preserved). 기존 헤딩 + 본문 라인 1 + 본문 라인 2 는 모두 사라짐
    // (no duplication).
    const after = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const count = dbg.getParagraphCount(0);
      const texts: string[] = [];
      for (let p = 0; p < count; p++) {
        const len = dbg.getParagraphLength(0, p);
        texts.push(len > 0 ? dbg.getTextRange(0, p, 0, len) : '');
      }
      return { count, texts };
    });

    // 새 heading 1 + 새 본문 1 + preserved next-section heading 1 = 3
    expect(after.count).toBe(3);
    expect(after.texts[0]).toContain('2.7.4 새 데이터 유효성 검증 방안');
    expect(after.texts[0]).not.toContain('기존');
    expect(after.texts[1]).toContain('새 본문 한 줄');
    expect(after.texts[2]).toBe('다음 섹션 헤딩');
    // 기존 본문 라인 1/2 가 어디에도 남아있지 않음 (중복 없음).
    for (const t of after.texts) {
      expect(t).not.toContain('기존 본문 라인 1');
      expect(t).not.toContain('기존 본문 라인 2');
    }
  });

  test('UI: outline 에 같은 섹션 번호 있으면 버튼이 "기존 X 섹션 교체" 로 바뀜', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // 1. Heading 스타일 id 찾기 — blank.hwpx 에 "제목 N" 또는 "Heading N"
    //    이름의 style 이 사전 등록되어 있어야 outline 검출 가능. 없으면
    //    test.skip.
    const headingStyleId = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const styles = dbg.getStyleListJson() ?? [];
      const h = styles.find(
        (s) =>
          /^제목\s*\d?/.test(s.name) ||
          /^개요\s*\d?/.test(s.name) ||
          /^Heading\s*\d?/i.test(s.englishName ?? ''),
      );
      return h?.id ?? null;
    });
    test.skip(headingStyleId == null, 'blank.hwpx 에 heading 스타일 미등록');

    // 2. Para 0 에 "2.7.4 데이터 유효성 검증" 텍스트 + 헤딩 스타일.
    await page.evaluate((sid) => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '2.7.4 데이터 유효성 검증');
      dbg.applyStyle(sid as number);
      dbg.insertParagraph(0, 1);
      dbg.insertText(0, 1, 0, '기존 본문');
    }, headingStyleId);

    // 3. outline 이 매치 후보 찾을 수 있는 상태인지 sanity check.
    const outlineHasMatch = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const out = dbg.getOutline?.() ?? [];
      return out.some((e) => e.text.startsWith('2.7.4'));
    });
    expect(outlineHasMatch).toBe(true);

    // 4. AI 가 markdown 으로 같은 섹션 번호의 새 내용을 응답.
    await sendEcho(page, '### 2.7.4 데이터 유효성 보강\n\n새 내용 라인.');

    const applyBtn = page.getByTestId('chat-action-apply-html');
    await expect(applyBtn).toBeVisible();
    // 매칭 발동 → 버튼 라벨이 "기존 2.7.4 섹션 교체" 로 변경.
    await expect(applyBtn).toHaveText('기존 2.7.4 섹션 교체');
    await expect(applyBtn).toHaveAttribute('data-section-match', '2.7.4');
  });

  test('UI: outline 비어있으면 매칭 미발동 → 기본 마크다운 적용 (회귀 가드)', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // blank.hwpx 는 heading 스타일이 적용된 단락이 없어 outline=[]. AI 가
    // "### 2.7.4 ..." 로 응답해도 매칭 후보가 없으니 버튼은 기존
    // markdown fallback 텍스트 그대로.
    await sendEcho(page, '### 2.7.4 데이터 유효성 검증\n\n새 내용');

    const applyBtn = page.getByTestId('chat-action-apply-html');
    await expect(applyBtn).toBeVisible();
    await expect(applyBtn).toHaveText('마크다운 적용');
    // markdown fallback 경로 활성, 섹션 매치는 미발동.
    await expect(applyBtn).toHaveAttribute('data-markdown-fallback', 'true');
    // outline 비어있으니 data-section-match 는 React 가 빈 문자열을 strip
    // 한 상태 (attribute 부재 또는 ""). 핵심은 버튼 라벨이 "기존 X 섹션
    // 교체" 가 *아니라는* 점.
    await expect(applyBtn).not.toHaveText(/기존.*섹션 교체/);
  });
});
