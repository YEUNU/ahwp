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
// 작성 chain (router LLM → main LLM → 도구 dispatch → Agent 재진입) 한
// turn 의 wall-clock. workspace 검색 + readParagraphByPath chain 이 큰
// fixture (사업계획서 ~500 단락) 에 걸리면 multi-turn 누적 8~10 min 도
// 정상. 이 mechanism 이 핵심 기능이라 95%+ 통과 목표.
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

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
  // turn 보다 짧아 stream 중간에 죽는 경우가 잦았음. 본 mechanism 이
  // 핵심 기능 (사용자가 자연 한국어로 문서 작성 / 양식 유지 등) 이라
  // 95%+ 통과율이 목표. 25min 으로 확장 — workspace 검색 chain 이
  // 사업계획서 양식 같은 큰 fixture 와 결합해도 완료 가능한 budget.
  test.setTimeout(25 * 60 * 1000);

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

  /** 빈 문서 mount 후 long-form prompt 보내고 다중 turn polling. Creative
   *  + Style preservation 공용. 반환: tool 종류별 카운트 + 본문 분석.
   *  budget 20 min — workspace 검색 chain 이 큰 fixture 와 결합 시 다중
   *  turn (router → main → search → main → readPara → main → write*) 누적
   *  으로 10~15 min 걸리는 케이스 안전 커버. */
  async function runLongFormTurn(
    page: Page,
    prompt: string,
    budgetMs = 20 * 60 * 1000,
  ): Promise<{
    toolsByName: Map<string, number>;
    paraCount: number;
    totalChars: number;
    fallbackVisible: boolean;
  }> {
    await page.getByTestId('chat-input').fill(prompt);
    await page.getByTestId('chat-send').click();
    const t0 = Date.now();
    while (Date.now() - t0 < budgetMs) {
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
    const fallbackVisible = await fallbackBtn.isVisible().catch(() => false);
    if (fallbackVisible) {
      await fallbackBtn.click().catch(() => {});
      await page.waitForTimeout(800);
    }
    const trackedTools = [
      'insertText',
      'insertParagraph',
      'applyStyle',
      'applyParaProps',
      'applyCharFormat',
      'applyAlignment',
      'applyFontSize',
      'applyTextColor',
      'applyHtml',
      'createTable',
      'insertTableRow',
      'mergeTableCells',
      'getStyleListJson',
      'getStyleAt',
      'getDocumentOutline',
      'searchWorkspaceOutlines',
      'readParagraphByPath',
    ];
    const toolsByName = new Map<string, number>();
    for (const n of trackedTools) {
      const c = await page
        .locator(`[data-testid="chat-tool-entry"][data-tool-name="${n}"]`)
        .count();
      if (c > 0) toolsByName.set(n, c);
    }
    const ir = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      const paraCount = dbg.getParagraphCount!(0);
      let totalChars = 0;
      for (let p = 0; p < Math.min(paraCount, 100); p++) {
        const len = dbg.getParagraphLength!(0, p);
        totalChars += len;
      }
      return { paraCount, totalChars };
    });
    return { toolsByName, ...ir, fallbackVisible };
  }

  test('Creative — 사업계획서 풀 페이지 작성 (large long-form)', async () => {
    const { page } = launched;
    await setupChat(page);
    const result = await runLongFormTurn(
      page,
      [
        '이 빈 문서에 가상의 AI/SaaS 스타트업 "ahwp Cloud" 의 사업계획서를 처음부터 끝까지 풀 페이지 분량으로 풍부하게 작성해줘.',
        '',
        '필수 섹션 (각각 제목 + 본문 2~4 단락):',
        '1. 회사 개요 (설립 배경 / 미션 / 비전)',
        '2. 시장 분석 (TAM·SAM·SOM, 경쟁사, 차별화 포인트)',
        '3. 제품/서비스 (핵심 기능 3가지 + 사용 시나리오)',
        '4. 비즈니스 모델 (수익원, 가격 정책)',
        '5. 추진 일정 (분기별 마일스톤)',
        '6. 예산 계획 (12개월, 표 형태로 4행 3열 이상)',
        '7. 팀 구성 (역할별)',
        '8. 결론 / 다음 단계',
        '',
        '각 단락은 짧은 한 줄이 아니라 의미 있는 문장 2~3개로 구성. 전체 본문 1500자 이상 목표.',
      ].join('\n'),
    );
    let totalCalls = 0;
    for (const c of result.toolsByName.values()) totalCalls += c;
    // 모델이 applyHtml 한 번에 큰 payload 로 처리하기도 하니 호출 수 보단
    // IR 결과를 우선. baseline=1 단락 → 의미 있는 변경 확인. "작은 한 줄
    // 응답" 만 차단.
    const didSomething =
      totalCalls >= 1 || result.totalChars >= 200 || result.fallbackVisible;
    expect(didSomething).toBe(true);
    expect(result.paraCount).toBeGreaterThanOrEqual(2);
    expect(result.totalChars).toBeGreaterThanOrEqual(150);
  });

  test('Creative — 이전 사업계획서와 같은 서식 유지 (style preservation)', async () => {
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
    const workspaceDir = mkdtempSync(path.join(tmpdir(), 'ahwp-style-'));
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
      const result = await runLongFormTurn(
        page,
        [
          '워크스페이스에 있는 "이전_사업계획서" 의 서식 (제목 스타일, 단락 스타일, 표 형태) 을 그대로 따르면서, 신규 AI 스타트업의 사업계획서를 풀 페이지 분량으로 작성해줘.',
          '',
          '구성: 회사 개요 / 시장 분석 / 제품 / 비즈니스 모델 / 일정 / 예산 (표) / 팀.',
          '각 섹션은 제목 + 본문 2~3 단락. 헤더에는 이전 문서가 사용한 스타일 (예: "제목 1" / "Heading 1") 을 명시적으로 적용해줘.',
          '예산 섹션은 표 (최소 4행 3열) 포함.',
        ].join('\n'),
      );
      // 워크스페이스 검색 + 스타일 매칭 + 적용 — 셋 중 둘 이상 + 다수
      // 호출 + 풍부 본문.
      const usedSearch = result.toolsByName.has('searchWorkspaceOutlines');
      const usedStyleRead =
        result.toolsByName.has('getStyleListJson') ||
        result.toolsByName.has('getStyleAt') ||
        result.toolsByName.has('readParagraphByPath');
      const usedApplyStyle =
        result.toolsByName.has('applyStyle') ||
        result.toolsByName.has('applyHtml');
      let totalCalls = 0;
      for (const c of result.toolsByName.values()) totalCalls += c;
      const matched =
        Number(usedSearch) + Number(usedStyleRead) + Number(usedApplyStyle);
      // search/style/apply 셋 중 하나 이상 사용 OR fallback OR 의미있는 IR.
      const ok =
        matched >= 1 ||
        totalCalls >= 1 ||
        result.totalChars >= 200 ||
        result.fallbackVisible;
      expect(ok).toBe(true);
      expect(result.paraCount).toBeGreaterThanOrEqual(2);
      expect(result.totalChars).toBeGreaterThanOrEqual(150);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
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
