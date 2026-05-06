/**
 * markdownToHtml 단위 테스트 — chunk 99 fallback. 모델이 도구 호출
 * 대신 markdown 으로 응답할 때 HTML 변환 정확도 검증.
 */
import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './markdownToHtml';

describe('markdownToHtml', () => {
  it('순수 대화 텍스트 → null (fallback 미적용)', () => {
    expect(markdownToHtml('안녕하세요')).toBeNull();
    expect(markdownToHtml('네, 알겠습니다.')).toBeNull();
    expect(markdownToHtml('이 문서를 확인해보겠습니다')).toBeNull();
    expect(markdownToHtml('')).toBeNull();
    expect(markdownToHtml('   \n\n   ')).toBeNull();
  });

  it('**bold** 인라인 → <strong>', () => {
    const r = markdownToHtml('첫 단락을 **굵게** 처리합니다.')!;
    expect(r).not.toBeNull();
    expect(r.html).toContain('<strong>굵게</strong>');
    expect(r.matchedPatterns).toContain('inline');
  });

  it('*italic* 인라인 → <em>', () => {
    const r = markdownToHtml('이 부분은 *기울임* 처리.')!;
    expect(r.html).toContain('<em>기울임</em>');
  });

  it('~~strike~~ → <s>', () => {
    const r = markdownToHtml('취소: ~~삭제됨~~')!;
    expect(r.html).toContain('<s>삭제됨</s>');
  });

  it('# 헤딩 → 굵은 큰 글자 단락', () => {
    const r = markdownToHtml('# 서론\n\n본문 내용')!;
    expect(r.html).toContain('font-weight:bold');
    expect(r.html).toContain('서론');
    expect(r.matchedPatterns).toContain('heading');
  });

  it('## H2 도 인식', () => {
    const r = markdownToHtml('## 매출 분석')!;
    expect(r.html).toContain('매출 분석');
    expect(r.html).toContain('font-weight:bold');
  });

  it('불릿 리스트 → <ul><li>', () => {
    const r = markdownToHtml('- 첫번째\n- 두번째\n- 세번째')!;
    expect(r.html).toContain('<ul>');
    expect(r.html).toContain('<li>첫번째</li>');
    expect(r.html).toContain('<li>세번째</li>');
    expect(r.matchedPatterns).toContain('bullet-list');
  });

  it('번호 리스트 → <ol><li>', () => {
    const r = markdownToHtml('1. 분석\n2. 계획\n3. 실행')!;
    expect(r.html).toContain('<ol>');
    expect(r.html).toContain('<li>분석</li>');
    expect(r.matchedPatterns).toContain('ordered-list');
  });

  it('마크다운 표 → <table>', () => {
    const md = [
      '| 항목 | 값 |',
      '|------|-----|',
      '| 매출 | 100 |',
      '| 비용 | 60  |',
    ].join('\n');
    const r = markdownToHtml(md)!;
    expect(r.html).toContain('<table>');
    expect(r.html).toContain('항목');
    expect(r.html).toContain('매출');
    expect(r.html).toContain('100');
    expect(r.matchedPatterns).toContain('table');
  });

  it('복합 (헤딩 + 리스트 + 인라인)', () => {
    const md = [
      '# 분석 결과',
      '',
      '핵심: **매출 증가**',
      '',
      '- 1분기 +10%',
      '- 2분기 +15%',
    ].join('\n');
    const r = markdownToHtml(md)!;
    expect(r.matchedPatterns).toContain('heading');
    expect(r.matchedPatterns).toContain('inline');
    expect(r.matchedPatterns).toContain('bullet-list');
    expect(r.html).toContain('<strong>매출 증가</strong>');
    expect(r.html).toContain('<ul>');
  });

  it('XSS 가능 입력 → escape', () => {
    const r = markdownToHtml('# <script>alert(1)</script>')!;
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('** ** 안의 < > 도 escape', () => {
    const r = markdownToHtml('**<b>x</b>**')!;
    expect(r.html).toContain('&lt;b&gt;');
    expect(r.html).not.toContain('<b>x</b>');
  });
});
