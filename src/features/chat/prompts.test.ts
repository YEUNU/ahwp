import { describe, expect, it } from 'vitest';
import { collectReferenceOutlines, buildReferenceSystemBlock } from './prompts';

/**
 * 0.7.19 — 참고자료 reference chip (Inserty 데모 참고) 가 의존하는 소비
 * 파이프라인 회귀 가드. ChatPanel 의 referencePaths state → 이 두 순수
 * 함수 → useChatStreaming 의 [Reference docs] 시스템 블록.
 */
describe('collectReferenceOutlines', () => {
  const openDocs = [
    { path: '/w/active.hwp', label: 'active.hwp', isActive: true },
    { path: '/w/ref-a.hwp', label: 'ref-a.hwp', isActive: false },
    { path: '/w/ref-b.pdf', label: 'ref-b.pdf', isActive: false },
  ];
  const outlineFor = (p: string): string =>
    p === '/w/ref-a.hwp'
      ? '# A heading\nbody a'
      : p === '/w/ref-b.pdf'
        ? 'pdf chunk 0'
        : '';

  it('collects outlines for opted-in non-active docs', () => {
    const out = collectReferenceOutlines(
      ['/w/ref-a.hwp', '/w/ref-b.pdf'],
      () => openDocs,
      outlineFor,
    );
    expect(out.map((r) => r.label)).toEqual(['ref-a.hwp', 'ref-b.pdf']);
    expect(out[0].outline).toContain('A heading');
  });

  it('drops the active doc even if opted in (target is implicit)', () => {
    const out = collectReferenceOutlines(
      ['/w/active.hwp', '/w/ref-a.hwp'],
      () => openDocs,
      outlineFor,
    );
    expect(out.map((r) => r.label)).toEqual(['ref-a.hwp']);
  });

  it('drops paths that are no longer open tabs (closed since toggled)', () => {
    const out = collectReferenceOutlines(
      ['/w/closed.hwp', '/w/ref-a.hwp'],
      () => openDocs,
      outlineFor,
    );
    expect(out.map((r) => r.label)).toEqual(['ref-a.hwp']);
  });

  it('skips docs whose outline is empty', () => {
    const out = collectReferenceOutlines(
      ['/w/ref-a.hwp', '/w/ref-b.pdf'],
      () => openDocs,
      (p) => (p === '/w/ref-a.hwp' ? '' : 'pdf chunk 0'),
    );
    expect(out.map((r) => r.label)).toEqual(['ref-b.pdf']);
  });

  it('returns [] when getters missing or no paths selected', () => {
    expect(collectReferenceOutlines([], () => openDocs, outlineFor)).toEqual(
      [],
    );
    expect(
      collectReferenceOutlines(['/w/ref-a.hwp'], undefined, outlineFor),
    ).toEqual([]);
    expect(
      collectReferenceOutlines(['/w/ref-a.hwp'], () => openDocs, undefined),
    ).toEqual([]);
  });
});

describe('buildReferenceSystemBlock', () => {
  it('emits a numbered, read-only [Reference docs] block', () => {
    const block = buildReferenceSystemBlock([
      { label: 'ref-a.hwp', outline: '# A heading' },
      { label: 'ref-b.pdf', outline: 'pdf chunk 0' },
    ]);
    expect(block).toContain('[Reference docs]:');
    expect(block).toContain('[ref 1] doc="ref-a.hwp" (read-only)');
    expect(block).toContain('[ref 2] doc="ref-b.pdf" (read-only)');
    expect(block).toContain('# A heading');
    // read-only contract must be stated so the model never targets refs.
    expect(block.toLowerCase()).toContain('never target it for modification');
  });
});
