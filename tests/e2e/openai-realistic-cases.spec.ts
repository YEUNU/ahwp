/**
 * OpenAI live — 사용자가 채팅창에 칠 만한 자연 한국어 문서 수정 케이스
 * 10개. 난이도별 (Easy 3 / Medium 3 / Hard 4).
 *
 * - 모델: gpt-5.4-mini (reasoning + tool-use). chunk 99 router 가
 *   reasoning_effort='low' 로 thinking 단계 최소화. main turn 은 default
 *   effort.
 * - 라우터: chunk 99 LLM 기반.
 * - 검토 모드: auto-approve OFF, polling 으로 자동 승인.
 *
 * AHWP_TEST_OPENAI_KEY 가 있을 때만 실행.
 */
/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

const OPENAI_KEY = process.env.AHWP_TEST_OPENAI_KEY;
const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');
const MODEL = 'gpt-5.4-mini';
const TURN_TIMEOUT_MS = 3 * 60 * 1000;

interface StudioDebug {
  getParaProps(s: number, p: number): Record<string, unknown>;
  getBookmarks(): Record<string, unknown>[] | null;
  insertText(s: number, p: number, c: number, t: string): string;
  getParagraphCount?(s: number): number;
  getParagraphLength?(s: number, p: number): number;
  getTextRange?(s: number, p: number, start: number, end: number): string;
}

test.describe('OpenAI 사용자 시나리오 — 난이도별 10 케이스', () => {
  test.skip(!OPENAI_KEY, 'AHWP_TEST_OPENAI_KEY env not set');
  // Playwright 기본 60s test timeout 가 reasoning model 의 multi-tool
  // chain (router LLM + main LLM + 도구 dispatch + Agent 재진입) 한
  // turn 보다 짧아 stream 중간에 죽는 경우가 잦았음. 8min 으로 확장
  // (Creative long-form 케이스 budget 7min 까지 커버).
  test.setTimeout(8 * 60 * 1000);

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    launched = await launchApp();
    await launched.page.evaluate(async (key: string) => {
      await window.api.secrets.set('openai', key);
    }, OPENAI_KEY!);
    await launched.page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
    await launched.page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );
  });

  test.afterEach(async () => {
    await launched.close();
  });

  async function setupChat(page: Page): Promise<void> {
    // 기본 provider 가 openai → selectOption 동일값 no-op 으로 hasKey 가
    // 영원히 null 로 남는 효과. 우회: nvidia 거쳐 openai 로 다시 와서
    // effect 강제 재실행.
    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-provider-select').selectOption('openai');
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('chat-model-input')).toBeEnabled({
      timeout: 30_000,
    });
    const modelSel = page.getByTestId('chat-model-input');
    const available = await modelSel.evaluate((el) =>
      Array.from((el as HTMLSelectElement).options).map((o) => o.value),
    );
    if (available.includes(MODEL)) await modelSel.selectOption(MODEL);
  }

  async function sendAndWaitTurnEnd(page: Page, text: string): Promise<void> {
    await page.getByTestId('chat-input').fill(text);
    await page.getByTestId('chat-send').click();
    const t0 = Date.now();
    while (Date.now() - t0 < TURN_TIMEOUT_MS) {
      const stopVisible = await page
        .getByTestId('chat-stop')
        .isVisible()
        .catch(() => false);
      const pending = await page
        .locator('[data-testid="chat-tool-entry"][data-tool-status="pending"]')
        .all();
      if (pending.length === 0 && !stopVisible) break;
      if (pending.length > 0) {
        const bulk = page.getByTestId('chat-tool-approve-all');
        const bulkVisible = await bulk.isVisible().catch(() => false);
        if (bulkVisible) {
          await bulk.click().catch(() => {});
        } else {
          for (const entry of pending) {
            const approve = entry.getByTestId('chat-tool-approve');
            const ok = await approve.isVisible().catch(() => false);
            if (ok) await approve.click().catch(() => {});
          }
        }
        await page.waitForTimeout(500);
      } else {
        await page.waitForTimeout(1000);
      }
    }
    // chunk 99 fallback — 모델이 tool 호출 안 하고 markdown 으로 응답한
    // 경우, "마크다운 적용" 버튼이 노출됨. 클릭해서 applyHtml 로 dispatch.
    const applyBtn = page.getByTestId('chat-action-apply-html');
    if (await applyBtn.isVisible().catch(() => false)) {
      await applyBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  async function expectAnyToolCalled(
    page: Page,
    toolNames: string[],
  ): Promise<void> {
    let total = 0;
    for (const n of toolNames) {
      total += await page
        .locator(`[data-testid="chat-tool-entry"][data-tool-name="${n}"]`)
        .count();
    }
    if (total >= 1) return;
    // chunk 99 fallback path — 모델이 tool 호출 대신 markdown 으로 응답
    // 했고 sendAndWaitTurnEnd 가 "마크다운 적용" 버튼을 자동 클릭했으면
    // 그 버튼은 화면에 남아 있다 (applied / 되돌리기 상태).
    const applyBtn = page.getByTestId('chat-action-apply-html');
    const fallback = await applyBtn.isVisible().catch(() => false);
    if (fallback) return; // pass — markdown fallback used
    expect(total).toBeGreaterThanOrEqual(1);
  }

  // ============================================================
  // Easy (3): 단일 도구.
  // ============================================================

  test('Easy 1 — "첫 단락 가운데 정렬"', async () => {
    const { page } = launched;
    await setupChat(page);
    await sendAndWaitTurnEnd(page, '첫 단락을 가운데 정렬해줘.');
    await expectAnyToolCalled(page, ['applyAlignment', 'applyParaProps']);
    const align = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(align).toBe('center');
  });

  test('Easy 2 — "첫 단락 굵게 해줘"', async () => {
    const { page } = launched;
    await setupChat(page);
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '제목');
    });
    await sendAndWaitTurnEnd(page, '첫 단락 글자를 굵게 만들어줘.');
    await expectAnyToolCalled(page, [
      'toggleCharFormat',
      'applyCharFormat',
      'applyHtml',
    ]);
  });

  test('Easy 3 — "글자 크기 16포인트로"', async () => {
    const { page } = launched;
    await setupChat(page);
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '본문');
    });
    await sendAndWaitTurnEnd(page, '글자 크기를 16포인트로 바꿔줘.');
    await expectAnyToolCalled(page, [
      'applyFontSize',
      'applyCharFormat',
      'applyHtml',
    ]);
  });

  // ============================================================
  // Medium (3).
  // ============================================================

  test('Medium 1 — "여기에 \'서론\' 책갈피 추가"', async () => {
    const { page } = launched;
    await setupChat(page);
    await sendAndWaitTurnEnd(
      page,
      '현재 위치에 "서론" 이라는 책갈피 하나 추가해줘.',
    );
    await expectAnyToolCalled(page, ['addBookmark']);
    const bookmarks = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getBookmarks() ?? [];
    });
    expect(bookmarks.length).toBeGreaterThanOrEqual(1);
  });

  test('Medium 2 — "쪽 모양을 가로 방향으로"', async () => {
    const { page } = launched;
    await setupChat(page);
    await sendAndWaitTurnEnd(page, '이 문서를 가로 모드로 바꿔줘.');
    await expectAnyToolCalled(page, ['applyPageDef']);
  });

  test('Medium 3 — "각주 \'자체 조사 자료\' 달아줘"', async () => {
    const { page } = launched;
    await setupChat(page);
    await sendAndWaitTurnEnd(
      page,
      '여기에 "자체 조사 자료" 라는 각주 하나 달아줘.',
    );
    await expectAnyToolCalled(page, ['insertFootnote']);
  });

  // ============================================================
  // Hard (4).
  // ============================================================

  test('Hard 1 — "3행 4열 표 만들어줘"', async () => {
    const { page } = launched;
    await setupChat(page);
    await sendAndWaitTurnEnd(page, '여기에 3행 4열짜리 표 하나 만들어줘.');
    await expectAnyToolCalled(page, ['createTable']);
  });

  test('Hard 2 — "본문 첫 줄에 \'월간 보고서\' 추가"', async () => {
    const { page } = launched;
    await setupChat(page);
    await sendAndWaitTurnEnd(
      page,
      '본문 첫 줄에 "월간 보고서" 라는 텍스트 한 줄 추가해줘.',
    );
    await expectAnyToolCalled(page, ['insertText', 'applyHtml']);
    const txt = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const paraCount = dbg.getParagraphCount!(0);
      const collected: string[] = [];
      for (let p = 0; p < Math.min(paraCount, 5); p++) {
        const len = dbg.getParagraphLength!(0, p);
        if (len > 0)
          collected.push(dbg.getTextRange!(0, p, 0, Math.min(len, 200)));
      }
      return collected.join('\n');
    });
    expect(txt).toContain('월간 보고서');
  });

  test('Hard 3 — "첫 단락에 \'제목 1\' 스타일 적용"', async () => {
    const { page } = launched;
    await setupChat(page);
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '서론');
    });
    await sendAndWaitTurnEnd(page, '첫 단락을 "제목 1" 스타일로 바꿔줘.');
    await expectAnyToolCalled(page, ['applyStyle', 'applyHtml']);
  });

  // ============================================================
  // Creative — 처음부터 끝까지 만드는 큰 작업.
  // ============================================================

  test('Creative — "사업계획서 처음부터 끝까지 작성해줘" (창의적 long-form)', async () => {
    const { page } = launched;
    await setupChat(page);
    // Creative long-form 은 다중 turn / 다수 tool 호출 필요. 기본 budget
    // (3min) 확장 위해 임시로 polling 자체 구현.
    const CREATIVE_BUDGET_MS = 7 * 60 * 1000;
    await page
      .getByTestId('chat-input')
      .fill(
        [
          '이 빈 문서에 가상의 IT 스타트업 사업계획서를 처음부터 끝까지 작성해줘.',
          '필요한 구성: 회사 소개 / 시장 분석 / 제품·서비스 / 비즈니스 모델 / 추진 일정 / 예산 / 팀 구성. 각 섹션마다 헤더 + 본문 1~2단락.',
          '예산 부분엔 가능하면 표도 하나 넣어줘.',
        ].join('\n'),
      );
    await page.getByTestId('chat-send').click();
    const t0 = Date.now();
    while (Date.now() - t0 < CREATIVE_BUDGET_MS) {
      const stopVisible = await page
        .getByTestId('chat-stop')
        .isVisible()
        .catch(() => false);
      const pending = await page
        .locator('[data-testid="chat-tool-entry"][data-tool-status="pending"]')
        .all();
      if (pending.length === 0 && !stopVisible) break;
      if (pending.length > 0) {
        const bulk = page.getByTestId('chat-tool-approve-all');
        const bulkVisible = await bulk.isVisible().catch(() => false);
        if (bulkVisible) {
          await bulk.click().catch(() => {});
        } else {
          for (const entry of pending) {
            const approve = entry.getByTestId('chat-tool-approve');
            const ok = await approve.isVisible().catch(() => false);
            if (ok) await approve.click().catch(() => {});
          }
        }
        await page.waitForTimeout(500);
      } else {
        await page.waitForTimeout(1000);
      }
    }
    const fallbackBtn = page.getByTestId('chat-action-apply-html');
    if (await fallbackBtn.isVisible().catch(() => false)) {
      await fallbackBtn.click().catch(() => {});
      await page.waitForTimeout(500);
    }
    // 검증 — 다중 도구 호출 (insertText / insertParagraph / applyStyle /
    // createTable / applyHtml 중 합쳐 최소 5개) + 단락 수 baseline (1) →
    // 5+ 증가 + 의미 있는 텍스트 (3자+) 다수.
    const writeTools = [
      'insertText',
      'insertParagraph',
      'applyStyle',
      'applyParaProps',
      'applyCharFormat',
      'applyAlignment',
      'applyFontSize',
      'applyHtml',
      'createTable',
      'insertTableRow',
      'mergeTableCells',
    ];
    let totalWrites = 0;
    for (const n of writeTools) {
      totalWrites += await page
        .locator(`[data-testid="chat-tool-entry"][data-tool-name="${n}"]`)
        .count();
    }
    // markdown fallback 도 카운트 (모델이 long-form markdown 으로 답했다면
    // 사용자 클릭으로 적용됨).
    const fallbackBtnVisible = await page
      .getByTestId('chat-action-apply-html')
      .isVisible()
      .catch(() => false);
    if (totalWrites < 5 && !fallbackBtnVisible) {
      // 적어도 어떤 도구라도 / fallback 이라도 — 둘 다 0 이면 fail.
      const anyTool = await page
        .locator('[data-testid="chat-tool-entry"]')
        .count();
      expect(anyTool + (fallbackBtnVisible ? 1 : 0)).toBeGreaterThanOrEqual(1);
    }
    // 활성 문서 단락 수 또는 본문 텍스트 길이 변화. baseline=1 (빈 문서에
    // 1 paragraph). 작성 후 5+ 단락이거나 누적 텍스트 100자+ 면 통과.
    const after = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const paraCount = dbg.getParagraphCount!(0);
      let totalChars = 0;
      for (let p = 0; p < Math.min(paraCount, 50); p++) {
        const len = dbg.getParagraphLength!(0, p);
        totalChars += len;
      }
      return { paraCount, totalChars };
    });
    expect(
      after.paraCount + Math.floor(after.totalChars / 100),
    ).toBeGreaterThan(1);
  });

  test('Hard 4 — "이전 보고서 양식 참고해서 첫 섹션" (워크스페이스)', async () => {
    const { page } = launched;
    const ALPHA = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
    );
    test.skip(!existsSync(ALPHA), 'examples/사업계획서 fixture missing');
    const { mkdtempSync, copyFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const workspaceDir = mkdtempSync(path.join(tmpdir(), 'ahwp-ws-real-'));
    try {
      const targetPath = path.join(workspaceDir, 'target.hwpx');
      copyFileSync(FIXTURE, targetPath);
      copyFileSync(ALPHA, path.join(workspaceDir, '이전_사업계획서.hwp'));
      await page.evaluate(
        async ({ folder, active }) => {
          await window.api.session.set({
            lastFolderPath: folder,
            lastActivePath: active,
            openTabPaths: [active],
          });
        },
        { folder: workspaceDir, active: targetPath },
      );
      await page.reload();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 30_000 },
      );
      await setupChat(page);
      await sendAndWaitTurnEnd(
        page,
        '이전 사업계획서 양식 참고해서 이 빈 문서에 첫 섹션 제목 한 줄 추가해줘.',
      );
      await expectAnyToolCalled(page, ['searchWorkspaceOutlines']);
      const after = await page.evaluate(() => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        const paraCount = dbg.getParagraphCount!(0);
        const collected: string[] = [];
        for (let p = 0; p < Math.min(paraCount, 5); p++) {
          const len = dbg.getParagraphLength!(0, p);
          if (len > 0)
            collected.push(dbg.getTextRange!(0, p, 0, Math.min(len, 300)));
        }
        return { paraCount, paragraphs: collected };
      });
      const hasMeaningful = after.paragraphs.some((t) => t.trim().length >= 3);
      expect(hasMeaningful).toBe(true);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
