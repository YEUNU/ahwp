/// <reference lib="dom" />
import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * ChatPanel chunk 55 — Diff Viewer (`ahwp-patches` 응답 블록).
 *
 * Fake provider 가 `ECHO:<text>` 시 text 를 그대로 echo. 모델이
 * \`\`\`ahwp-patches\`\`\` JSON 블록을 emit 한 것으로 시뮬레이션. ChatPanel
 * 이 detect → MultiPatchStack 렌더 → Accept 클릭 → IR 변경 → ⌘Z 로
 * 묶음 undo.
 */

const FIXTURE = path.resolve(__dirname, 'fixtures', 'blank.hwpx');

interface StudioDebug {
  insertText(s: number, p: number, c: number, t: string): string;
  exportBytes(): Uint8Array;
  getTextRange(s: number, p: number, start: number, end: number): string;
  canUndo(): boolean;
  undo(): void;
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

async function sendEcho(page: Page, payload: string): Promise<void> {
  await page.getByTestId('chat-input').fill(`ECHO:${payload}`);
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-send')).toBeVisible();
}

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

/** 0.4.6 — chunk 99 follow-up 의 patches 자동 acceptAll 을 우회. plan mode
 *  를 켜서 Accept/Reject 가 'pending' 상태로 머무르도록 한 뒤, 명시적
 *  버튼 클릭을 검증한다 (per-patch reject UI 흐름 회귀 가드). */
async function enablePlanModeAndReload(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('ahwp:chat:plan-mode-default', '1');
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test.describe('chat — chunk 55 Diff Viewer (ahwp-patches)', () => {
  test.skip(!existsSync(FIXTURE), 'tests/e2e/fixtures/blank.hwpx missing');

  test('single patch — Accept 클릭 시 단락 텍스트 변경 + ⌘Z 로 롤백', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // Seed 단락 0 에 텍스트 삽입.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'before');
    });

    // 모델이 단락 0 의 'before' → 'after' 패치를 emit.
    const reply = [
      '여기 한 가지 수정을 제안합니다:',
      '```ahwp-patches',
      JSON.stringify({
        ops: [
          {
            title: '단락 톤 통일',
            location: { sectionIndex: 0, paragraphIndex: 0 },
            deletion: 'before',
            addition: 'after',
            reason: 'tone test',
          },
        ],
      }),
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    // DiffCard 가 가시 — 단일 패치이므로 SinglePatchCard 변형. chunk 99
    // follow-up 의 자동 acceptAll 로 이미 적용되어 있다. 명시적 click 은
    // 불필요 (auto-accept 가 microtask 안에서 처리 완료).
    await expect(page.getByTestId('diff-single-card')).toBeVisible();
    await expect(page.getByTestId('diff-line-del')).toContainText('before');
    await expect(page.getByTestId('diff-line-add')).toContainText('after');

    // 문서 상태 검증 — paragraph 0 의 text 가 'after' 가 됐어야 함.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const dbg = (window as Window & { __studioDebug?: StudioDebug })
            .__studioDebug!;
          return dbg.getTextRange(0, 0, 0, 20);
        }),
      )
      .toContain('after');

    // ⌘Z 로 묶음 undo. canUndo true 인 상태에서 undo 호출.
    const undone = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      if (!dbg.canUndo()) return false;
      dbg.undo();
      return true;
    });
    expect(undone).toBe(true);
  });

  test('multi patch — Accept All 한 번으로 모두 accepted 상태', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // 두 단락 시드.
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'alpha');
    });

    const reply = [
      '두 가지 수정 제안:',
      '```ahwp-patches',
      JSON.stringify({
        ops: [
          {
            title: '단락 0 수정',
            location: { sectionIndex: 0, paragraphIndex: 0 },
            deletion: 'alpha',
            addition: 'beta',
          },
          {
            title: '단락 0 부분 수정',
            location: {
              sectionIndex: 0,
              paragraphIndex: 0,
              startOffset: 0,
              endOffset: 4,
            },
            deletion: 'beta',
            addition: 'gamm',
          },
        ],
      }),
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    // MultiPatchStack 가시 (StackedPatch 두 개). chunk 99 follow-up 의 자동
    // acceptAll 로 둘 다 이미 accepted 상태 → 두 Accept 버튼 disabled.
    await expect(page.getByTestId('diff-multi-stack')).toBeVisible();
    await expect(page.getByTestId('diff-patch-1')).toBeVisible();
    await expect(page.getByTestId('diff-patch-2')).toBeVisible();
    await expect(page.getByTestId('diff-accept-1')).toBeDisabled();
    await expect(page.getByTestId('diff-accept-2')).toBeDisabled();
  });

  test('multi patch — Reject 개별, accept 가능 / 부분 적용', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    // Plan mode 켜서 자동 acceptAll 우회 — per-patch reject/accept 버튼이
    // 'pending' 상태로 머무르도록 한다 (chunk 99 follow-up 대응).
    await enablePlanModeAndReload(page);
    await page.waitForFunction(
      () =>
        Boolean(
          (window as Window & { __studioDebug?: StudioDebug }).__studioDebug,
        ),
      { timeout: 30_000 },
    );

    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'foo');
    });

    const reply = [
      '두 가지 제안 (하나는 reject):',
      '```ahwp-patches',
      JSON.stringify({
        ops: [
          {
            title: '단락 0 → bar',
            location: { sectionIndex: 0, paragraphIndex: 0 },
            deletion: 'foo',
            addition: 'bar',
          },
          {
            title: '단락 0 → baz',
            location: { sectionIndex: 0, paragraphIndex: 0 },
            deletion: 'foo',
            addition: 'baz',
          },
        ],
      }),
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    await expect(page.getByTestId('diff-multi-stack')).toBeVisible();

    // 첫 번째 reject — 그 패치만 dim 처리, 두 번째는 여전히 accept 가능.
    await page.getByTestId('diff-reject-1').click();
    await expect(page.getByTestId('diff-accept-1')).toBeDisabled();
    await expect(page.getByTestId('diff-accept-2')).toBeEnabled();

    // 두 번째 accept — 적용 시 doc 의 단락 0 이 baz 로 바뀌어야 함.
    await page.getByTestId('diff-accept-2').click();
    await expect(page.getByTestId('diff-accept-2')).toBeDisabled();
  });

  test('preview 클릭 → 에디터 단락 스크롤 (callback fire)', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    // 단락 0 만 시드. preview 는 click 만 검증 (scroll 위치는 viewer
    // 이벤트라 smoke level).
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, 'para 0 content');
    });

    const reply = [
      '단락 0 수정:',
      '```ahwp-patches',
      JSON.stringify({
        ops: [
          {
            title: '단락 0',
            location: { sectionIndex: 0, paragraphIndex: 0 },
            deletion: 'para 0 content',
            addition: 'para 0 fixed',
          },
        ],
      }),
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    await expect(page.getByTestId('diff-single-card')).toBeVisible();
    // preview button 가시 + click — onPreview 가 wired 면 click 자체가
    // throw 없이 처리.
    const preview = page.getByTestId('diff-preview-1');
    await expect(preview).toBeVisible();
    await preview.click();
  });

  test('chunk 99 follow-up — Diff cards portal 이 가운데 패널 overlay 로 떠 있고 chat 엔 hint 만', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);
    await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      dbg.insertText(0, 0, 0, '발맞추기 위해서 만들어졌고요');
    });
    const reply = [
      '한 줄 톤만 다듬을게요:',
      '```ahwp-patches',
      '{"ops":[{"title":"톤","location":{"sectionIndex":0,"paragraphIndex":0},"deletion":"발맞추기 위해서 만들어졌고요","addition":"대응하기 위하여 수립되었다"}]}',
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    // 가운데 패널의 overlay 컨테이너에 카드 portal 됨.
    const overlay = page.getByTestId('editor-diff-overlay');
    await expect(overlay).toBeVisible();
    const portalCard = overlay.getByTestId('chat-patches-block');
    await expect(portalCard).toBeVisible();
    await expect(portalCard.getByTestId('diff-single-card')).toBeVisible();

    // chat 안엔 hint 만 (full 카드 없음).
    const hint = page.getByTestId('chat-patches-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('변경 제안');
    // chat 안에서 chat-patches-block 검색 시 portal 결과는 overlay 밑에
    // 있고 chat 메시지 트리 안에는 없음 — chat-message 컨테이너로 scope 후
    // count 0 검증.
    const inChatBubble = page.locator(
      '[data-testid="chat-message"][data-role="assistant"] [data-testid="chat-patches-block"]',
    );
    await expect(inChatBubble).toHaveCount(0);
  });

  test('invalid patches block — error 표시', async () => {
    const { page } = launched;
    await openFixture(page, FIXTURE);

    const reply = [
      '잘못된 블록:',
      '```ahwp-patches',
      '{"ops": []}', // empty ops
      '```',
    ].join('\n');
    await sendEcho(page, reply);

    await expect(page.getByTestId('chat-patches-error')).toBeVisible();
    await expect(page.getByTestId('chat-patches-error')).toContainText(
      '파싱 실패',
    );
  });
});
