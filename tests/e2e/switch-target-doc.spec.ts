/// <reference lib="dom" />
import { copyFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { launchApp, type LaunchedApp } from './launch';

/**
 * switchTargetDoc auto-open 회귀 가드 — 0.6.2 (fix).
 *
 * 버그 시나리오 (0.6.1 까지):
 *   사용자가 워크스페이스에 둔 .hwp 파일에 대해 AI 가
 *   switchTargetDoc({path:'/workspace/foo.hwp'}) 호출 → 닫힌 탭 자동 열기
 *   분기. AppShell wrapper 가 await openByPath 후 무조건 true 반환했지만
 *   useSaveFlow.openByPath 자체는 void 반환이라 실제 성공 여부 알 수 없었음.
 *   더 결정적으로, 50ms 후 getOpenDocs() 재조회가 stale closure 라 새 탭이
 *   마운트돼도 lookup 실패 → `target-not-open:<path>` 가짜 에러.
 *
 * Fix 검증:
 *   - openByPath 가 boolean 반환 (editable=true, readable-only=false)
 *   - AppShell wrapper 가 propagate
 *   - useChatStreaming 이 ok=true 시 path 만으로 matched 합성 (closure 우회)
 *
 * 본 spec 은 fake-AI 의 TOOL:switchTargetDoc 으로 hook 의 분기를 직접 자극.
 */

// 검증된 blank HWP 가 examples/ 에 있음 — 동일 fixture 복사해서 워크스페이스 구성.
const SOURCE_FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
);

async function makeFixture(): Promise<{
  root: string;
  targetPath: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'ahwp-stdoc-'));
  // 한글 + 공백 + 대괄호 포함된 실전형 파일명. user 가 실제로 마주친 케이스.
  const targetPath = path.join(root, '4. [사업계획서] 테스트_양식.hwp');
  await copyFile(SOURCE_FIXTURE, targetPath);
  // 또 다른 hwp + 일반 텍스트 — workspace 컨텍스트 풍성하게.
  await copyFile(SOURCE_FIXTURE, path.join(root, 'other.hwp'));
  await writeFile(path.join(root, 'notes.txt'), 'plain');
  return {
    root,
    targetPath,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test.describe('switchTargetDoc auto-open (0.6.2 fix)', () => {
  let launched: LaunchedApp;
  let fixture: {
    root: string;
    targetPath: string;
    cleanup: () => Promise<void>;
  };

  test.beforeAll(() => {
    test.skip(!existsSync(SOURCE_FIXTURE), 'fixture HWP missing');
  });

  test.beforeEach(async () => {
    fixture = await makeFixture();
    launched = await launchApp({ env: { AHWP_E2E_FAKE_AI: '1' } });
    const { page } = launched;
    await page.waitForLoadState('domcontentloaded');
    // 워크스페이스 root 설정 + openai (fake) provider 활성 + 키 설정.
    await page.evaluate(async (root) => {
      await window.api.session.set({ lastFolderPath: root });
      window.localStorage.setItem('ahwp:chat:provider', 'openai');
      await window.api.secrets.set('openai', 'fake-key');
    }, fixture.root);
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    // Folder tree 가 root 를 인식했는지 확인 (회귀 가드).
    await expect(page.getByTestId('folder-tree')).toBeVisible({
      timeout: 10_000,
    });
  });

  test.afterEach(async () => {
    await launched.close();
    await fixture.cleanup();
  });

  test('workspace 의 HWP path 로 switchTargetDoc 호출 시 자동 탭 열림', async () => {
    const { page } = launched;
    // fake-AI 의 TOOL: 스크립트로 switchTargetDoc 1회 호출.
    const targetEscaped = fixture.targetPath.replace(/\\/g, '\\\\');
    await page
      .getByTestId('chat-input')
      .first()
      .fill(`TOOL:switchTargetDoc:{"path":"${targetEscaped}"}`);
    await page.getByTestId('chat-send').first().click();

    // assistant 응답 + tool result UI 가 뜨면 turn 종료. 가장 안정적인 지표:
    // chat-send 가 다시 visible (stop 버튼에서 send 로 회귀).
    await expect(page.getByTestId('chat-send')).toBeVisible({
      timeout: 30_000,
    });

    // Fix 검증: 새 탭이 실제로 열려야 함 (탭 바에 target 파일명 등장).
    const tabBar = page.getByTestId('studio-tabbar');
    await expect(tabBar).toContainText('4. [사업계획서] 테스트_양식.hwp', {
      timeout: 5_000,
    });

    // 회귀 가드: tool result 에 target-not-open 이 떴으면 안 됨. assistant
    // 메시지의 raw text 에서 검색 — fake-AI 가 tool result 를 echo 안 하므로
    // 직접 확인 어려움. 대신 chat history 에서 result ok 확인.
    // (tool result 가 partialResults 에 ok:true 로 들어가야 함 — 탭 열림이
    // 그 결과의 side effect 이므로 위 assertion 으로 충분히 검증됨.)
  });

  test('워크스페이스에 없는 path 는 여전히 target-not-open', async () => {
    const { page } = launched;
    // 존재하지 않는 path — auto-open IPC 가 null 반환 → openByPath false →
    // matched 못 만듦 → target-not-open.
    await page
      .getByTestId('chat-input')
      .first()
      .fill(
        'TOOL:switchTargetDoc:{"path":"/nonexistent/missing-file-xyz.hwp"}',
      );
    await page.getByTestId('chat-send').first().click();
    await expect(page.getByTestId('chat-send')).toBeVisible({
      timeout: 30_000,
    });
    // 탭 안 열려야. 탭 바 안에 'missing-file-xyz' 가 없어야 (사용자 메시지
    // 에는 path 가 들어가지만 그건 별도 영역).
    const tabsWithMissing = page
      .getByTestId('studio-tab')
      .filter({ hasText: 'missing-file-xyz' });
    expect(await tabsWithMissing.count()).toBe(0);
  });

  test('readable-only (.txt) 는 false 반환 — 탭 안 열림', async () => {
    const { page } = launched;
    const txtPath = path.join(fixture.root, 'notes.txt').replace(/\\/g, '\\\\');
    await page
      .getByTestId('chat-input')
      .first()
      .fill(`TOOL:switchTargetDoc:{"path":"${txtPath}"}`);
    await page.getByTestId('chat-send').first().click();
    await expect(page.getByTestId('chat-send')).toBeVisible({
      timeout: 30_000,
    });
    // .txt 는 OS 위임 → 탭 아닌 외부 앱. 탭 바에 notes.txt 안 나와야.
    const tabBar = page.getByTestId('studio-tabbar');
    const tabBarCount = await tabBar.count();
    if (tabBarCount > 0) {
      const tabBarText = await tabBar.textContent();
      expect(tabBarText ?? '').not.toContain('notes.txt');
    }
  });
});
