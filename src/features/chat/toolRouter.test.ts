/**
 * Heuristic tool router unit tests — chunk 98.
 */
import { describe, expect, it } from 'vitest';
import { selectToolsForQuery } from './toolRouter';
import { AHWP_TOOL_NAMES } from '@shared/ai-tools';

describe('selectToolsForQuery', () => {
  it('워크스페이스 키워드 → search/read tool 포함', () => {
    const r = selectToolsForQuery(
      '워크스페이스에 있는 사업계획서 양식 참고해서 첫 섹션 추가해줘',
    );
    expect(r.isFullCatalog).toBe(false);
    expect(r.tools).toContain('searchWorkspaceOutlines');
    expect(r.tools).toContain('readParagraphByPath');
    // editing keyword (추가/섹션) 도 매칭 → write tool 포함.
    expect(r.tools).toContain('insertText');
    expect(r.tools).toContain('applyHtml');
  });

  it('단순 정렬 → applyAlignment 만 좁게', () => {
    const r = selectToolsForQuery('첫 단락을 가운데 정렬해줘');
    expect(r.isFullCatalog).toBe(false);
    expect(r.tools).toContain('applyAlignment');
    // 항상 포함 set.
    expect(r.tools).toContain('getCaretPosition');
    expect(r.tools).toContain('getDocumentOutline');
    // 표 / 그림 같은 무관한 카테고리는 포함 안 됨.
    expect(r.tools).not.toContain('createTable');
    expect(r.tools).not.toContain('insertPicture');
  });

  it('표 키워드 → table tool 들 포함', () => {
    const r = selectToolsForQuery('이 단락 뒤에 3x4 표 하나 만들어');
    expect(r.tools).toContain('createTable');
    expect(r.tools).toContain('insertTableRow');
    expect(r.tools).toContain('mergeTableCells');
    expect(r.tools).toContain('getCellInfo');
  });

  it('그림 / 도형 키워드 분리', () => {
    const a = selectToolsForQuery('여기에 그림 하나 넣어줘');
    expect(a.tools).toContain('insertPicture');
    const b = selectToolsForQuery('사각형 도형 하나 그려줘');
    expect(b.tools).toContain('createRectShape');
  });

  it('머리말 / 책갈피 / 각주', () => {
    const a = selectToolsForQuery('머리말 텍스트 바꿔줘');
    expect(a.tools).toContain('setHeaderFooterText');
    const b = selectToolsForQuery('이 위치에 책갈피 추가');
    expect(b.tools).toContain('addBookmark');
    const c = selectToolsForQuery('각주 달아줘');
    expect(c.tools).toContain('insertFootnote');
  });

  it('매칭 안 되면 full catalog fallback', () => {
    const r = selectToolsForQuery('안녕하세요');
    expect(r.isFullCatalog).toBe(true);
    expect(r.tools.length).toBe(AHWP_TOOL_NAMES.length);
  });

  it('빈 query → full catalog (의도 모호)', () => {
    const r = selectToolsForQuery('');
    expect(r.isFullCatalog).toBe(true);
  });

  it('always-include set 은 모든 매칭 결과에 포함', () => {
    const samples = [
      '굵게 만들어줘',
      '5x5 표 만들어줘',
      '그림 넣어줘',
      '머리말 설정',
    ];
    for (const q of samples) {
      const r = selectToolsForQuery(q);
      expect(r.tools).toContain('getCaretPosition');
      expect(r.tools).toContain('getDocumentOutline');
    }
  });

  it('대소문자 / 한국어 혼합', () => {
    const r = selectToolsForQuery('Bold 하게 + 진하게 처리');
    // '진하게' 매칭됨.
    expect(r.tools).toContain('toggleCharFormat');
  });

  it('복합 키워드 → 여러 그룹 활성', () => {
    const r = selectToolsForQuery(
      '워크스페이스 양식 참고해서 표 한 개 만들고 첫 셀 가운데 정렬',
    );
    expect(r.matchedGroups.length).toBeGreaterThanOrEqual(3);
    expect(r.tools).toContain('searchWorkspaceOutlines');
    expect(r.tools).toContain('createTable');
    expect(r.tools).toContain('applyAlignment');
  });
});
