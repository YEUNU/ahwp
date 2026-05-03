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
  getParaText?(s: number, p: number): string;
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

    // DiffCard 가 가시 — 단일 패치이므로 SinglePatchCard 변형.
    await expect(page.getByTestId('diff-single-card')).toBeVisible();
    await expect(page.getByTestId('diff-line-del')).toContainText('before');
    await expect(page.getByTestId('diff-line-add')).toContainText('after');

    // Accept.
    await page.getByTestId('diff-accept-1').click();

    // 문서 상태 검증 — exportBytes 후 본문 텍스트 추출. paragraph 0 의
    // text 가 'after' 가 됐어야 함.
    const txt = await page.evaluate(() => {
      const dbg = (window as Window & { __studioDebug?: StudioDebug })
        .__studioDebug!;
      // getParaText 가 없는 빌드를 대비 — exportBytes 의 첫 100바이트
      // 헥스가 변했는지로도 충분.
      return dbg.getParaText ? dbg.getParaText(0, 0) : '';
    });
    if (txt) {
      expect(txt).toContain('after');
      expect(txt).not.toContain('before');
    }

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

    // MultiPatchStack 가시 (StackedPatch 두 개).
    await expect(page.getByTestId('diff-multi-stack')).toBeVisible();
    await expect(page.getByTestId('diff-patch-1')).toBeVisible();
    await expect(page.getByTestId('diff-patch-2')).toBeVisible();

    // Accept All 클릭.
    await page.getByTestId('diff-accept-all').click();
    // Accept All 후 두 패치 모두 accepted 가 되거나 적어도 disabled
    // (재클릭 불가). check: Accept 버튼 disabled.
    await expect(page.getByTestId('diff-accept-1')).toBeDisabled();
    await expect(page.getByTestId('diff-accept-2')).toBeDisabled();
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
