/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import {
  extractFirstHeading,
  extractSectionNumber,
  findSectionToReplace,
  type OutlineEntry,
} from './sectionMatcher';

describe('extractSectionNumber', () => {
  it('extracts dotted number prefix', () => {
    expect(extractSectionNumber('2.7.4 데이터 유효성 검증 방안')).toBe('2.7.4');
    expect(extractSectionNumber('2.7.4. 데이터 유효성 검증 방안')).toBe(
      '2.7.4',
    );
    expect(extractSectionNumber('1.2 시스템 개요')).toBe('1.2');
  });

  it('strips leading bracket / paren', () => {
    expect(extractSectionNumber('(2.7.4) 데이터 유효성')).toBe('2.7.4');
    expect(extractSectionNumber('[3.1.5] 모델 검증')).toBe('3.1.5');
  });

  it('returns null when no number prefix', () => {
    expect(extractSectionNumber('데이터 유효성 검증 방안')).toBeNull();
    expect(extractSectionNumber('Chapter Two')).toBeNull();
  });

  it('rejects single number (chapter-only)', () => {
    // 우리는 X.Y 이상만 — "2 Foo" 는 너무 ambiguous.
    expect(extractSectionNumber('2 데이터 수집')).toBeNull();
  });
});

describe('extractFirstHeading', () => {
  it('extracts <h*> heading', () => {
    expect(
      extractFirstHeading('<h3>2.7.4 데이터 유효성</h3><p>본문</p>'),
    ).toEqual({ text: '2.7.4 데이터 유효성', level: 3 });
  });

  it('falls back to <p><strong> when no <h*> (markdownToHtml 의 한컴 호환 변형)', () => {
    expect(
      extractFirstHeading('<p><strong>2.7.4 데이터 유효성</strong></p>'),
    ).toEqual({ text: '2.7.4 데이터 유효성', level: 2 });
  });

  it('matches markdownToHtml font-weight:bold 단락 + level 역산', () => {
    // ### → fontSize=22-3*2=16pt → level=3
    expect(
      extractFirstHeading(
        '<p style="font-weight:bold;font-size:16pt;">2.7.4 데이터 유효성</p>',
      ),
    ).toEqual({ text: '2.7.4 데이터 유효성', level: 3 });
    // # → fontSize=20pt → level=1
    expect(
      extractFirstHeading(
        '<p style="font-weight:bold;font-size:20pt;">2 본 사업</p><p>본문</p>',
      ),
    ).toEqual({ text: '2 본 사업', level: 1 });
  });

  it('strips inner tags from heading content', () => {
    expect(extractFirstHeading('<h2>2.1 <em>강조된</em> 제목</h2>')).toEqual({
      text: '2.1 강조된 제목',
      level: 2,
    });
  });

  it('returns null when no heading', () => {
    expect(extractFirstHeading('<p>그냥 본문</p>')).toBeNull();
  });
});

describe('findSectionToReplace', () => {
  const outline: OutlineEntry[] = [
    { paragraphIndex: 5, level: 1, text: '2. 사업 개요' },
    { paragraphIndex: 12, level: 2, text: '2.7 데이터' },
    { paragraphIndex: 18, level: 3, text: '2.7.3 데이터 수집' },
    { paragraphIndex: 25, level: 3, text: '2.7.4 데이터 유효성 검증 방안' },
    { paragraphIndex: 40, level: 3, text: '2.7.5 데이터 가공' },
    { paragraphIndex: 60, level: 2, text: '2.8 모델' },
    { paragraphIndex: 80, level: 1, text: '3. 결론' },
  ];

  it('matches heading by section number, returns span until next sibling', () => {
    const m = findSectionToReplace(
      outline,
      '<h3>2.7.4 데이터 유효성</h3><p>새 내용</p>',
    );
    expect(m).toEqual({
      startParaIdx: 25,
      endParaIdxExclusive: 40, // 2.7.5 paragraphIndex
      sectionNumber: '2.7.4',
      headingText: '2.7.4 데이터 유효성 검증 방안',
      level: 3,
    });
  });

  it('matches even when AI heading text differs (only number compared)', () => {
    const m = findSectionToReplace(
      outline,
      '<h3>2.7.4 (수정된 제목)</h3><p>새 내용</p>',
    );
    expect(m?.startParaIdx).toBe(25);
    expect(m?.sectionNumber).toBe('2.7.4');
  });

  it('uses higher-level boundary when no same-level sibling follows', () => {
    // 2.8 매칭하면 끝은 3. (level 1) 의 paragraphIndex.
    const m = findSectionToReplace(
      outline,
      '<h2>2.8 새 모델 섹션</h2><p>본문</p>',
    );
    expect(m).toEqual({
      startParaIdx: 60,
      endParaIdxExclusive: 80, // "3. 결론" paragraphIndex (level 1 ≤ 2)
      sectionNumber: '2.8',
      headingText: '2.8 모델',
      level: 2,
    });
  });

  it('caps end with paragraphCountCap when matched section is last in outline', () => {
    const m = findSectionToReplace(
      outline,
      '<h1>3. 결론 새</h1><p>본문</p>',
      120,
    );
    expect(m).toEqual({
      startParaIdx: 80,
      endParaIdxExclusive: 120,
      sectionNumber: '3', // trailing dot 정규화 — outline "3. 결론" 도 "3" 으로 추출
      headingText: '3. 결론',
      level: 1,
    });
  });

  it('returns null when outline has no matching number', () => {
    const m = findSectionToReplace(
      outline,
      '<h3>9.9.9 없는 섹션</h3><p>본문</p>',
    );
    expect(m).toBeNull();
  });

  it('returns null when html has no heading', () => {
    const m = findSectionToReplace(outline, '<p>그냥 본문</p>');
    expect(m).toBeNull();
  });

  it('returns null when heading has no section number', () => {
    const m = findSectionToReplace(outline, '<h2>요약</h2><p>본문</p>');
    expect(m).toBeNull();
  });

  it('returns null on empty outline', () => {
    expect(findSectionToReplace([], '<h3>2.7.4 X</h3>')).toBeNull();
  });
});
