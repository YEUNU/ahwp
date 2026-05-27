/**
 * Task-Mode integration test — 0.7.1.
 *
 * detectMode → getAhwpToolCatalog → appendModePrompt 전체 chain 이
 * useChatStreaming 안에서 어떻게 결합되는지 검증. 회귀 시나리오 (사용자
 * 보고 1.6.20→0.7.1 사이에 본 본문 dump) 가 새 architecture 에서
 * 어떻게 차단되는지 정합 확인.
 */
import { describe, expect, it } from 'vitest';
import { detectMode } from './mode-detector';
import { getAhwpToolCatalog } from '@shared/ai-tool-catalog';
import { appendModePrompt } from './prompts';

describe('Task-Mode integration (form-fill chain)', () => {
  it('전체 chain — form prefix → form-fill 진입 → catalog 가 본문 write 제외 → prompt fragment 활성', () => {
    // Step 1: getDocumentSummary tool 결과의 content (양식 문서).
    const summaryContent =
      '"[form: 9 tables, 212 empty cells — call getEmptyFormFields before any write]\\n[서식 1]\\n..."';

    // Step 2: detectMode 가 form-fill 진입 결정.
    const ctx = detectMode({ docSummaryPrefix: summaryContent });
    expect(ctx.primary).toBe('form-fill');
    expect(ctx.source).toBe('detected');

    // Step 3: catalog filter — 본문 write 도구 catalog 에서 제외.
    const catalog = getAhwpToolCatalog(ctx);
    const names = catalog.map((d) => d.name);
    // 본문 write 류 절대 catalog 에 없어야 함 (AI 가 emit 할 방법 없음).
    expect(names).not.toContain('insertText');
    expect(names).not.toContain('applyHtml');
    expect(names).not.toContain('deleteRange');
    expect(names).not.toContain('insertParagraph');
    expect(names).not.toContain('createTable');
    // Cell 도구는 catalog 에 있어야 함 (정상 form-fill path).
    expect(names).toContain('insertTextInCell');
    expect(names).toContain('replaceTextInCell');
    expect(names).toContain('getEmptyFormFields');
    expect(names).toContain('getPageSvg');

    // Step 4: prompt 가 Form Fill Mode fragment 포함.
    const prompt = appendModePrompt('BASE PROMPT', ctx);
    expect(prompt).toContain('Form Fill Mode');
    expect(prompt).toContain('insertTextInCell');
    expect(prompt).toContain('Body write tools');
    expect(prompt).not.toBe('BASE PROMPT'); // append 됐어야 함.
    // 0.7.2 — slotKind 가이드가 prompt 에 들어갔는지.
    expect(prompt).toContain('slotKind');
    expect(prompt).toContain("'value-slot'");
    expect(prompt).toContain("'instruction'");
    expect(prompt).toContain('replaceTextInCell');
    // 0.7.2 — getPageSvg enforcement 안내.
    expect(prompt).toContain('getPageSvg');
  });

  // 0.7.7 — Cross-Doc Research mode 활성화 검증.
  it('cross-doc-research mode → catalog 가 read-only + web 도구만, 본문 write 제외', () => {
    const ctx = {
      primary: 'cross-doc-research' as const,
      addons: [],
      source: 'user-override' as const,
    };
    const catalog = getAhwpToolCatalog(ctx);
    const names = catalog.map((d) => d.name);
    // 0.7.7 web 도구 포함.
    expect(names).toContain('webFetch');
    expect(names).toContain('webSearch');
    // 워크스페이스 read 도구 포함.
    expect(names).toContain('searchWorkspaceOutlines');
    expect(names).toContain('readParagraphByPath');
    // 본문 write 도구는 제외.
    expect(names).not.toContain('insertText');
    expect(names).not.toContain('applyHtml');
    expect(names).not.toContain('insertTextInCell');
    expect(names).not.toContain('replaceTextInCell');
    expect(names).not.toContain('createTable');

    // prompt fragment 가 cross-doc-research 가이드 포함.
    const prompt = appendModePrompt('BASE', ctx);
    expect(prompt).toContain('Cross-Doc Research Mode');
    expect(prompt).toContain('webSearch');
    expect(prompt).toContain('webFetch');
    expect(prompt).toContain('cite');
  });

  it('non-form 문서 → free-authoring 유지 → 전체 catalog', () => {
    const ctx = detectMode({
      docSummaryPrefix: '"normal document with three sections"',
    });
    expect(ctx.primary).toBe('free-authoring');

    const catalog = getAhwpToolCatalog(ctx);
    const names = catalog.map((d) => d.name);
    // 모든 도구가 catalog 에 있어야 함 (0.6.20 동작 보존).
    expect(names).toContain('insertText');
    expect(names).toContain('applyHtml');
    expect(names).toContain('insertTextInCell');
    expect(names).toContain('getEmptyFormFields');

    // prompt 변경 없음 (free-authoring fragment 가 빈 문자열).
    const prompt = appendModePrompt('BASE', ctx);
    expect(prompt).toBe('BASE');
  });

  it('threshold 미달 form (M < 3) → free-authoring (false positive 회피)', () => {
    const ctx = detectMode({
      docSummaryPrefix: '"[form: 1 tables, 2 empty cells]"',
    });
    expect(ctx.primary).toBe('free-authoring');
  });

  it('userOverride 가 detection 을 무력화 — form 문서지만 free-authoring 으로 작업 가능', () => {
    const ctx = detectMode({
      docSummaryPrefix: '"[form: 9 tables, 212 empty cells]"',
      userOverride: 'free-authoring',
    });
    expect(ctx.primary).toBe('free-authoring');
    expect(ctx.source).toBe('user-override');

    // catalog 가 다시 전체 — 사용자가 명시 override 했으니 자유 편집 가능.
    const catalog = getAhwpToolCatalog(ctx);
    expect(catalog.map((d) => d.name)).toContain('insertText');
  });
});
