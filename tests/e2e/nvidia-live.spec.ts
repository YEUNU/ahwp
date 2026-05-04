/**
 * Live smoke test against NVIDIA NIM's hosted endpoint
 * (https://integrate.api.nvidia.com/v1).
 *
 * Skips silently unless `NVAPI_KEY` is in the environment so this never runs
 * in CI by default and never blocks contributors who don't have a NIM key.
 *
 * The test exercises the *real* adapter path: stores the key via the secrets
 * IPC, selects the NVIDIA provider in ChatPanel, sends a deterministic prompt,
 * and asserts the streamed reply contains a known sentinel. SSE format
 * compatibility with our OpenAI adapter (which nvidia.ts delegates to) was
 * verified manually and again by this test.
 *
 * Run locally:
 *   NVAPI_KEY='nvapi-...' npx playwright test tests/e2e/nvidia-live.spec.ts --workers=1
 *
 * The key is only ever passed to the launched Electron via secrets.set; it is
 * never written to disk in plaintext (safeStorage encrypts it under userData).
 * The launched app uses an isolated `--user-data-dir` so the key does not
 * persist beyond the test.
 */
/// <reference lib="dom" />
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

const NVAPI_KEY = process.env.NVAPI_KEY;
const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  getParaProps(s: number, p: number): Record<string, unknown>;
  getBookmarks(): Record<string, unknown>[] | null;
  insertText(s: number, p: number, c: number, text: string): string;
  setSelection(
    anchorPara: number,
    anchorOff: number,
    focusPara: number,
    focusOff: number,
  ): void;
  getParagraphCount?(s: number): number;
  getParagraphLength?(s: number, p: number): number;
  getTextRange?(s: number, p: number, start: number, end: number): string;
}

test.describe('NVIDIA NIM — live smoke', () => {
  test.skip(!NVAPI_KEY, 'NVAPI_KEY env not set — skipping live test');

  let launched: LaunchedApp;

  test.beforeEach(async () => {
    // No fake-AI env → real adapter path runs.
    launched = await launchApp();
    await launched.page.evaluate(async (key: string) => {
      await window.api.secrets.set('nvidia', key);
    }, NVAPI_KEY!);
    await launched.page.reload();
    await launched.page.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await launched.close();
  });

  test('NVIDIA provider streams a real reply containing the sentinel', async () => {
    const { page } = launched;
    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page
      .getByTestId('chat-input')
      .fill('Reply with the single token NIM_OK and nothing else.');
    await page.getByTestId('chat-send').click();

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');

    // Real network — give it up to 30s. Most replies arrive in <3s.
    await expect(assistantContent).toContainText('NIM_OK', { timeout: 30_000 });
    // Stream finished → send button is back.
    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  // chunk 18 — doc-context attach + apply HTML round trip. Loads the
  // blank fixture, asks NIM for a centered paragraph as ```html```, then
  // clicks "문서에 적용" and asserts the IR alignment flipped to
  // 'center'. Real model output is non-deterministic, so we steer with a
  // strict prompt and a fallback regex (any ```html``` block with
  // text-align:center).
  test('chunk 18 — attach doc + apply HTML edit (centered paragraph)', async () => {
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const { page } = launched;

    // Open the blank fixture so the StudioViewer mounts and exposes
    // exportDocumentHtml + applyHtmlAtCaret to the chat panel.
    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page.getByTestId('chat-attach-checkbox').check();

    // Tightly scoped prompt — system prompt already tells the model to
    // emit one ```html``` fenced block.
    await page
      .getByTestId('chat-input')
      .fill(
        'Center the first paragraph. Reply with EXACTLY one fenced ```html``` code block containing only `<p style="text-align:center;">CENTERED</p>` and nothing else.',
      );
    await page.getByTestId('chat-send').click();

    const applyBtn = page.getByTestId('chat-action-apply-html');
    await expect(applyBtn).toBeVisible({ timeout: 60_000 });

    await applyBtn.click();
    await expect(applyBtn).toHaveText('✓ 적용됨');

    const align = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(align).toBe('center');
  });

  // chunk 19 — ahwp-tools dispatch round trip. Asks NIM for a tool
  // block that adds a bookmark, then verifies the IR sees it post-click.
  test('chunk 19 — ahwp-tools dispatch (addBookmark) round trip', async () => {
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const { page } = launched;

    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    await page.getByTestId('chat-attach-checkbox').check();

    await page
      .getByTestId('chat-input')
      .fill(
        [
          'Add a bookmark named "intro" at the cursor.',
          'Reply with EXACTLY one fenced ```ahwp-tools``` code block of valid JSON like:',
          '{"ops":[{"tool":"addBookmark","args":{"name":"intro"}}]}',
          'No other code blocks. No prose outside.',
        ].join('\n'),
      );
    await page.getByTestId('chat-send').click();

    const runBtn = page.getByTestId('chat-action-run-tools');
    await expect(runBtn).toBeVisible({ timeout: 60_000 });
    await runBtn.click();
    await expect(runBtn).toHaveText(/✓ 적용됨/, { timeout: 10_000 });

    const bookmarks = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getBookmarks();
    });
    expect(bookmarks?.some((b) => b.name === 'intro')).toBe(true);
  });

  // chunk 20 — excerpt attachment round trip. Captures a viewer
  // selection as a chip and verifies that:
  //  1. The chip survives the send-time stale check
  //  2. The model responds with `[1]` style references (proving the
  //     `[발췌]:` block in the system prompt reached it)
  //  3. attachDoc toggle is suppressed (excerpts win over whole-doc)
  test('chunk 20 — excerpt chip drives system context (whole-doc HTML suppressed)', async () => {
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const { page } = launched;

    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    // Seed paragraph 0 with a sentinel and select it. The model can
    // reference the sentinel back in its reply, proving the excerpt
    // block landed in the prompt.
    const SENTINEL = '거버넌스 위원회는 분기마다 회의록을 공개한다';
    await page.evaluate((text) => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, text);
      dbg.setSelection(0, 0, 0, text.length);
    }, SENTINEL);

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
    await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

    // Toggle stays available but goes disabled once a chip is captured.
    await page.getByTestId('chat-attach-checkbox').check();
    await page.getByTestId('chat-capture-excerpt').click();
    await expect(page.getByTestId('chat-excerpt-chip')).toHaveAttribute(
      'data-status',
      'fresh',
    );
    await expect(page.getByTestId('chat-attach-checkbox')).toBeDisabled();

    await page
      .getByTestId('chat-input')
      .fill(
        '발췌 [1]에 등장한 한국어 명사 하나를 정확히 따옴표로 인용해서 그대로 응답에 포함시켜줘. 다른 설명은 짧게만.',
      );
    await page.getByTestId('chat-send').click();

    const assistantContent = page
      .locator('[data-testid="chat-message"][data-role="assistant"]')
      .last()
      .getByTestId('chat-message-content');
    // Model should quote at least one noun from the excerpt back at us
    // — '거버넌스' / '위원회' / '회의록' all appear in the sentinel.
    await expect(assistantContent).toContainText(/(거버넌스|위원회|회의록)/, {
      timeout: 60_000,
    });

    await expect(page.getByTestId('chat-send')).toBeVisible();
  });

  // chunk 21 — multi-doc reference round trip. Two distinct tabs:
  // target (active) and reference. Reference is opted in via chip
  // checkbox; the model is asked to quote the reference's body. A
  // successful quote proves the [참조 문서] block reached the prompt.
  test('chunk 21 — reference doc outline landed in system prompt (model quotes it back)', async () => {
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const { page } = launched;

    // Set up two distinct paths via copying the blank fixture.
    const dir = mkdtempSync(path.join(tmpdir(), 'ahwp-nim21-'));
    const docA = path.join(dir, 'target.hwpx');
    const docB = path.join(dir, 'reference.hwpx');
    copyFileSync(FIXTURE, docA);
    copyFileSync(FIXTURE, docB);
    try {
      await page.evaluate(
        async (paths) => {
          await window.api.session.set({
            openTabPaths: paths,
            lastActivePath: paths[0],
          });
        },
        [docA, docB],
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

      // Switch to reference tab and seed sentinel.
      // The activate handler lives on the first <button> inside the
      // studio-tab wrapper (the close × is the second button). Locator
      // chain to grab the right one.
      const tabButtons = page
        .getByTestId('studio-tab')
        .locator('button:not([data-testid="studio-tab-close"])');
      await tabButtons.nth(1).click();
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 10_000 },
      );
      const REF_SENTINEL = '본 규정은 매 분기 사외이사 회의에서 검토된다';
      await page.evaluate((text) => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        dbg.insertText(0, 0, 0, text);
      }, REF_SENTINEL);

      // Switch back to target tab.
      await tabButtons.nth(0).click();
      await page.waitForFunction(
        () =>
          Boolean(
            (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
          ),
        { timeout: 10_000 },
      );

      await page.getByTestId('chat-provider-select').selectOption('nvidia');
      await page.getByTestId('chat-model-input').fill('qwen/qwen3.5-122b-a10b');
      await expect(page.getByTestId('chat-key-indicator')).toHaveText(/●/);

      // Opt in the reference doc.
      const chips = page.getByTestId('chat-multidoc-chip');
      await expect(chips).toHaveCount(2);
      await chips.nth(1).getByTestId('chat-multidoc-checkbox').check();

      await page
        .getByTestId('chat-input')
        .fill(
          '참조 문서 [ref 1]에서 보이는 한국어 명사 두 개를 따옴표로 인용해서 그대로 응답에 포함시켜줘. 다른 설명은 짧게만.',
        );
      await page.getByTestId('chat-send').click();

      const assistantContent = page
        .locator('[data-testid="chat-message"][data-role="assistant"]')
        .last()
        .getByTestId('chat-message-content');
      // The reference body has '규정 / 분기 / 사외이사 / 회의 / 검토'
      // — model should quote at least one back.
      await expect(assistantContent).toContainText(
        /(규정|분기|사외이사|회의|검토)/,
        { timeout: 60_000 },
      );

      await expect(page.getByTestId('chat-send')).toBeVisible();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // chunk 96 — outline-as-router workspace search. Sets the workspace
  // root to a temp dir containing two distinct .hwp fixtures (each with
  // a sentinel heading), opens the blank doc as the active target, and
  // sends a concept-level query without naming the docs. Verifies the
  // model called `searchWorkspaceOutlines` (the Agent had access to the
  // inventory) — actual chained call to `readParagraphByPath` is best-
  // effort because real LLMs may answer from outline alone.
  test('chunk 96 — Agent calls searchWorkspaceOutlines on concept query', async () => {
    const { page } = launched;
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');
    const ALPHA = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
    );
    const BETA = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
    );
    test.skip(
      !existsSync(ALPHA) || !existsSync(BETA),
      'examples/ workspace fixtures missing',
    );
    const workspaceDir = mkdtempSync(path.join(tmpdir(), 'ahwp-ws-96-'));
    try {
      // Stage two real .hwp files into a workspace folder + the active
      // blank doc as a sibling target.
      const targetPath = path.join(workspaceDir, 'target.hwpx');
      copyFileSync(FIXTURE, targetPath);
      copyFileSync(ALPHA, path.join(workspaceDir, '사업계획서_양식.hwp'));
      copyFileSync(BETA, path.join(workspaceDir, '2026_공고.hwp'));

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

      await page.getByTestId('chat-provider-select').selectOption('nvidia');
      // Wait for the model dropdown to populate + enable (pre-fetch
      // settles after secrets:changed broadcast). Don't pick a specific
      // model — chunk 96 verifies tool-call behavior, not model id.
      await expect(page.getByTestId('chat-model-input')).toBeEnabled({
        timeout: 30_000,
      });
      // chunk 99 follow-up — 자동 승인 토글 폐기.
      // Key-indicator UI: data-state='ok' once secrets:set settled.
      await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
        'data-state',
        'ok',
      );

      // Concept-level query — no doc name, no attachment, no excerpt.
      // The Agent guide tells the model to call searchWorkspaceOutlines
      // first when the user references workspace context implicitly.
      await page
        .getByTestId('chat-input')
        .fill(
          '워크스페이스에 있는 사업계획서의 어떤 항목 (제목 단락) 이라도 하나 골라서 정확한 제목 텍스트를 응답에 그대로 인용해줘. 그 단락이 어느 문서의 몇 번 단락인지도 함께 표시해. 다른 설명은 짧게.',
        );
      await page.getByTestId('chat-send').click();

      // tool-entry 가 화면에 나타날 때까지 대기 — Agent 가 검색 도구를
      // 호출했는지 확인. real model 이라 readParagraphByPath 까지 chain
      // 안 할 수도 있어, 일단 inventory 호출 만 검증.
      const searchEntry = page
        .locator(
          '[data-testid="chat-tool-entry"][data-tool-name="searchWorkspaceOutlines"]',
        )
        .first();
      await expect(searchEntry).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(async () => searchEntry.getAttribute('data-tool-status'), {
          timeout: 60_000,
        })
        .toBe('ok');

      // 핵심은 tool 호출 자체 + dispatcher 응답 ok. turn 종료까지
      // 기다리지 않음 — 실제 모델이 readParagraphByPath 까지 chain 한 뒤
      // assistant 본문 응답을 길게 작성하면서 시간이 변동적이라, send 버튼
      // 가시성은 변동성이 큰 신호.
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });

  // chunk 97 — Manual/Agent 통합 + 자동 승인 토글. 검토 모드 (default
  // off) 일 때 NIM 이 write tool 호출 → tool-entry status='pending' +
  // 승인/거절 버튼. 승인 클릭 시 dispatch → ok. 실제 LLM 으로 검토 게이트
  // 가 실제 production tool-use 흐름에 통합돼 동작하는지 검증.
  test('chunk 97 — 검토 모드: NIM write tool 호출 → pending → 승인 → ok', async () => {
    const { page } = launched;
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await expect(page.getByTestId('chat-model-input')).toBeEnabled({
      timeout: 30_000,
    });
    // chunk 99 follow-up — 자동 승인 토글 폐기. write 즉시 dispatch.
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );

    // write tool 호출을 강하게 유도. applyAlignment 가 selection 없어도
    // 호출은 발생 (실패해도 dispatcher 가 reason 캡처) — 핵심은 pending
    // 게이트 통과 후 dispatch 가 발생하는지.
    await page
      .getByTestId('chat-input')
      .fill(
        '활성 문서의 첫 단락을 가운데 정렬해줘. applyAlignment(align="center") 도구를 한 번만 호출. 다른 설명 없이 도구 호출만.',
      );
    await page.getByTestId('chat-send').click();

    // tool-entry 가 pending 으로 잡힐 때까지 대기.
    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="applyAlignment"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'), {
        timeout: 60_000,
      })
      .toBe('pending');

    // 승인 버튼 가시 → 클릭 → dispatch → status pending 탈출.
    await expect(entry.getByTestId('chat-tool-approve')).toBeVisible();
    await entry.getByTestId('chat-tool-approve').click();
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'), {
        timeout: 30_000,
      })
      .toBe('ok');

    // IR 검증 — 첫 단락 alignment 가 'center' 로 실제 변경됐는지. 검토
    // 게이트가 단순 UI flag 변경이 아니라 dispatcher 까지 도달해서 실제
    // applyAlignment 가 호출됐음을 확인.
    const align = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(align).toBe('center');
  });

  // chunk 97 — 거절 경로. NIM 이 write tool 호출 → pending → 거절 클릭
  // → status='rejected' + IR 미변경 검증.
  test('chunk 97 — 검토 모드: NIM write tool → 거절 → IR 미변경', async () => {
    const { page } = launched;
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

    await page.evaluate(async (p) => {
      await window.api.session.set({ lastActivePath: p });
    }, FIXTURE);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.getByTestId('chat-provider-select').selectOption('nvidia');
    await expect(page.getByTestId('chat-model-input')).toBeEnabled({
      timeout: 30_000,
    });
    await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
      'data-state',
      'ok',
    );

    // 첫 단락 align baseline 캡처.
    const baselineAlign = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });

    await page
      .getByTestId('chat-input')
      .fill(
        '활성 문서의 첫 단락을 오른쪽 정렬해줘. applyAlignment(align="right") 도구를 한 번만 호출. 다른 설명 없이.',
      );
    await page.getByTestId('chat-send').click();

    const entry = page
      .locator(
        '[data-testid="chat-tool-entry"][data-tool-name="applyAlignment"]',
      )
      .first();
    await expect(entry).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'), {
        timeout: 60_000,
      })
      .toBe('pending');

    // 거절 클릭 → rejected.
    await entry.getByTestId('chat-tool-reject').click();
    await expect
      .poll(async () => entry.getAttribute('data-tool-status'), {
        timeout: 10_000,
      })
      .toBe('rejected');

    // IR 미변경 — alignment baseline 그대로.
    const afterAlign = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      return dbg.getParaProps(0, 0).alignment as string;
    });
    expect(afterAlign).toBe(baselineAlign);
  });

  // chunks 96 + 97 + 98 종단간 — 자연 한국어 컨셉 질의로 워크스페이스
  // 검색 + 검토 모드 승인 + 실제 IR 변경. chunk 98 휴리스틱 라우터로
  // tool catalog 사전 필터링 → request 크기 감소 → NIM 일부 모델의
  // stall 회피 가설 검증.
  test('chunks 96+97+98 종단간 — 자연 컨셉 질의 + 휴리스틱 라우터 + tool-use 모델', async () => {
    const { page } = launched;
    test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

    const ALPHA = path.resolve(
      __dirname,
      '..',
      '..',
      'examples',
      '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
    );
    test.skip(!existsSync(ALPHA), 'examples/사업계획서 fixture missing');

    const workspaceDir = mkdtempSync(path.join(tmpdir(), 'ahwp-ws-e2e-'));
    try {
      const targetPath = path.join(workspaceDir, 'target.hwpx');
      copyFileSync(FIXTURE, targetPath);
      copyFileSync(ALPHA, path.join(workspaceDir, '사업계획서_양식.hwp'));

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

      const baseline = await page.evaluate(() => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        const paraCount = dbg.getParagraphCount!(0);
        const collected: string[] = [];
        for (let p = 0; p < Math.min(paraCount, 10); p++) {
          const len = dbg.getParagraphLength!(0, p);
          if (len > 0)
            collected.push(dbg.getTextRange!(0, p, 0, Math.min(len, 200)));
        }
        return { paraCount, paragraphs: collected };
      });

      await page.getByTestId('chat-provider-select').selectOption('nvidia');
      await expect(page.getByTestId('chat-model-input')).toBeEnabled({
        timeout: 30_000,
      });
      // 사용 가능한 tool-use 모델 중 NIM 에서 stable 한 것 선택. fallback
      // 순으로 시도. (qwen3.5-122b 는 stall 패턴 확인됨, llama-3.3 / kimi-k2
      // 가 더 안정.)
      const PREFER = [
        'meta/llama-3.3-70b-instruct',
        'moonshotai/kimi-k2-instruct',
        'meta/llama-3.1-70b-instruct',
        'qwen/qwen3.5-122b-a10b',
      ];
      const modelSel = page.getByTestId('chat-model-input');
      const availableModels = await modelSel.evaluate((el) =>
        Array.from((el as HTMLSelectElement).options).map((o) => o.value),
      );
      const pickedModel =
        PREFER.find((m) => availableModels.includes(m)) ?? PREFER[0];
      await modelSel.selectOption(pickedModel);
      console.log(`[chunk96+97+98 e2e] model=${pickedModel}`);
      await expect(page.getByTestId('chat-key-indicator')).toHaveAttribute(
        'data-state',
        'ok',
      );

      // 자연 한국어 — 사용자가 그대로 칠 만한 한 줄. 키워드 (워크스페이스 /
      // 양식 / 참고 / 사업계획서 / 추가 / 섹션) 가 휴리스틱 라우터의 두
      // 그룹 (workspace + editing) 활성. tool catalog 가 ~25개로 좁혀짐.
      await page
        .getByTestId('chat-input')
        .fill(
          '워크스페이스에 있는 사업계획서 양식을 참고해서 이 빈 문서에 첫 섹션 제목 한 줄 추가해줘.',
        );
      await page.getByTestId('chat-send').click();

      const TURN_TIMEOUT_MS = 4 * 60 * 1000;
      const t0 = Date.now();
      while (Date.now() - t0 < TURN_TIMEOUT_MS) {
        const stopVisible = await page
          .getByTestId('chat-stop')
          .isVisible()
          .catch(() => false);
        const pendingEntries = await page
          .locator(
            '[data-testid="chat-tool-entry"][data-tool-status="pending"]',
          )
          .all();
        if (pendingEntries.length === 0 && !stopVisible) break;
        if (pendingEntries.length > 0) {
          const bulk = page.getByTestId('chat-tool-approve-all');
          const bulkVisible = await bulk.isVisible().catch(() => false);
          if (bulkVisible) {
            await bulk.click().catch(() => {});
          } else {
            for (const entry of pendingEntries) {
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

      const searchEntries = page.locator(
        '[data-testid="chat-tool-entry"][data-tool-name="searchWorkspaceOutlines"]',
      );
      expect(await searchEntries.count()).toBeGreaterThanOrEqual(1);

      const after = await page.evaluate(() => {
        const dbg = (window as Window & { __studioDebug?: StudioDebug })
          .__studioDebug!;
        const paraCount = dbg.getParagraphCount!(0);
        const collected: string[] = [];
        for (let p = 0; p < Math.min(paraCount, 10); p++) {
          const len = dbg.getParagraphLength!(0, p);
          if (len > 0)
            collected.push(dbg.getTextRange!(0, p, 0, Math.min(len, 500)));
        }
        return { paraCount, paragraphs: collected };
      });
      const changed =
        after.paraCount > baseline.paraCount ||
        JSON.stringify(after.paragraphs) !==
          JSON.stringify(baseline.paragraphs);
      expect(changed).toBe(true);
      expect(after.paragraphs.some((t) => t.trim().length >= 3)).toBe(true);
    } finally {
      rmSync(workspaceDir, { recursive: true, force: true });
    }
  });
});
