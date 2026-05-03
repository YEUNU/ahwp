/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * chunks 91~93 e2e — 한컴 툴팁 / SVG <title> 후처리 / i18n 전환.
 *
 * 91 — 한컴 매뉴얼 명칭 호버 툴팁 + 플랫폼별 단축키 표기.
 * 92 — 표 column width SVG 후처리: 모든 <text> 에 자기 textContent
 *      를 <title> 자식으로 추가 (네이티브 hover tooltip).
 * 93 — i18n: 로케일 변경 시 텍스트 키 재렌더 (TitleBar / Welcome).
 *
 * Edge cases:
 *   - 단축키 표기: macOS 는 ⌘, Win/Linux 는 Ctrl+ (현재 host platform
 *     기준).
 *   - 한컴 툴팁 title 은 multi-line (`\n` 으로 name·shortcut + description
 *     분리).
 *   - SVG <title> 추가는 idempotent — 같은 element 에 두 번 안 붙음.
 *   - 빈 텍스트 (`textContent.trim() === ''`) 는 제외.
 *   - i18n: localStorage 에 저장된 'en' / 'ko' 값에 따라 초기 렌더 변동.
 *   - i18n: 잘못된 locale 값 ('xx' 등) 은 fallback 'ko'.
 */

const BLANK = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, t: string): string;
  exportBytes(): Uint8Array;
}

let launched: LaunchedApp;

test.afterEach(async () => {
  await launched?.close();
});

test.describe('chunk 91 — 한컴 툴팁 + 플랫폼 단축키', () => {
  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test('Studio 툴바 Bold 버튼: title 에 한컴 명칭 + 설명 + 단축키', async () => {
    const { page } = launched;
    // 빈 문서로 시작 → 툴바 마운트.
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BLANK);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    const title = await page
      .getByTestId('studio-format-bold')
      .getAttribute('title');
    expect(title).toContain('진하게');
    expect(title).toContain('굵게');
    // Platform-specific shortcut. Test runner runs locally; macOS host
    // shows ⌘B, Win/Linux shows Ctrl+B.
    if (process.platform === 'darwin') {
      expect(title).toContain('⌘B');
    } else {
      expect(title).toContain('Ctrl+B');
    }
  });

  test('Studio 툴바 가운데 정렬 버튼 title', async () => {
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BLANK);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    const title = await page
      .getByTestId('studio-align-center')
      .getAttribute('title');
    expect(title).toContain('가운데 정렬');
  });

  test('Edge: 매핑 안 된 testid 는 title 없거나 fallback', async () => {
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BLANK);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
    // studio-zoom-reset 은 우리가 인라인 title 직접 부여.
    const t = await page.getByTestId('studio-zoom-reset').getAttribute('title');
    expect(t).toBe('원래 크기 (100%)');
  });
});

test.describe('chunk 92 — SVG <title> 후처리', () => {
  test.skip(!existsSync(BLANK), 'fixtures/blank.hwpx missing');

  test.beforeEach(async () => {
    launched = await launchApp();
  });

  test('각 <text> 가 동일 textContent 의 <title> 자식 보유', async () => {
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BLANK);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    // 텍스트 시드 — 빈 fixture 라 수동 삽입.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'hover me text content');
    });

    // Wait for SVG re-render after IR mutation. Debug: also dump first
    // text element's outer HTML so we know the structure.
    await expect
      .poll(async () =>
        page.evaluate(() => {
          const svgs = document.querySelectorAll(
            '[data-testid="studio-page-wrap"] svg',
          );
          let texts = 0;
          svgs.forEach((s) => {
            texts += s.querySelectorAll('text').length;
          });
          return texts;
        }),
      )
      .toBeGreaterThan(0);

    const result = await page.evaluate(() => {
      // 직접 자식 text node 만 추출 (title 자식의 text 는 제외).
      const directTextOf = (el: Element): string =>
        Array.from(el.childNodes)
          .filter((n): n is Text => n.nodeType === 3)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();

      const texts = Array.from(
        document.querySelectorAll('[data-testid="studio-page-wrap"] svg text'),
      );
      let total = 0;
      let withTitle = 0;
      let titleMatchesTextContent = 0;
      for (const t of texts) {
        const direct = directTextOf(t);
        if (!direct) continue;
        total += 1;
        const title = t.querySelector(':scope > title');
        if (title) {
          withTitle += 1;
          if ((title.textContent ?? '').trim() === direct) {
            titleMatchesTextContent += 1;
          }
        }
      }
      return { total, withTitle, titleMatchesTextContent };
    });

    expect(result.total).toBeGreaterThan(0);
    // 모든 non-empty text 가 <title> 보유.
    expect(result.withTitle).toBe(result.total);
    expect(result.titleMatchesTextContent).toBe(result.total);
  });

  test('Edge: 빈 텍스트 (whitespace-only) 는 <title> 추가 제외', async () => {
    const { page } = launched;
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, BLANK);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    // 검증: SVG 안 어떤 <text> 도 직접 text node 가 비어있으면 <title>
    // 없음 (lib placeholder 가 있을 수 있는 환경).
    const stat = await page.evaluate(() => {
      const directTextOf = (el: Element): string =>
        Array.from(el.childNodes)
          .filter((n): n is Text => n.nodeType === 3)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();

      const texts = Array.from(
        document.querySelectorAll('[data-testid="studio-page-wrap"] svg text'),
      );
      let emptyWithTitle = 0;
      for (const t of texts) {
        if (!directTextOf(t) && t.querySelector(':scope > title')) {
          emptyWithTitle += 1;
        }
      }
      return { emptyWithTitle };
    });
    expect(stat.emptyWithTitle).toBe(0);
  });
});

test.describe('chunk 93 — i18n 로케일 전환', () => {
  test('default ko: WelcomePane 한국어', async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.evaluate(() => {
      try {
        localStorage.removeItem('ahwp:locale');
      } catch {
        /* ignore */
      }
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // WelcomePane 의 빈 문서 카드 라벨.
    await expect(page.getByTestId('welcome-new-doc')).toContainText(
      '빈 문서로 시작',
    );
  });

  test('locale=en: WelcomePane 영어', async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.evaluate(() => {
      try {
        localStorage.setItem('ahwp:locale', 'en');
      } catch {
        /* ignore */
      }
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('welcome-new-doc')).toContainText(
      'Start blank',
    );
  });

  test('Edge: 잘못된 locale 값 → fallback ko', async () => {
    launched = await launchApp();
    const { page } = launched;
    await page.evaluate(() => {
      try {
        localStorage.setItem('ahwp:locale', 'xx-INVALID');
      } catch {
        /* ignore */
      }
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // 'xx-INVALID' 는 'ko' 로 fallback (loadInitialLocale 의 strict 검사).
    await expect(page.getByTestId('welcome-new-doc')).toContainText(
      '빈 문서로 시작',
    );
  });
});
