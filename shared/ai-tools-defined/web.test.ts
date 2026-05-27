/**
 * web 도구 (webFetch / webSearch) defineTool 단위 테스트 — 0.7.7.
 *
 * 검증 범위:
 * - DEFINED_TOOL_REGISTRY 에 등록됨
 * - readonly=true (사용자 confirm 게이트 우회)
 * - URL scheme 강제 (http / https only)
 * - args size cap (url / prompt / query)
 * - maxBytes / maxResults 범위 검증
 */
import { describe, expect, it } from 'vitest';
import { DEFINED_TOOL_REGISTRY } from './index';

describe('web 도구 — 0.7.7 defineTool registry', () => {
  it('webFetch / webSearch 가 registry 에 등록', () => {
    expect(DEFINED_TOOL_REGISTRY.validators.has('webFetch')).toBe(true);
    expect(DEFINED_TOOL_REGISTRY.validators.has('webSearch')).toBe(true);
  });

  it('둘 다 readonly=true (사용자 confirm 게이트 우회)', () => {
    expect(DEFINED_TOOL_REGISTRY.readonlyNames.has('webFetch')).toBe(true);
    expect(DEFINED_TOOL_REGISTRY.readonlyNames.has('webSearch')).toBe(true);
  });
});

describe('webFetch validator', () => {
  const v = DEFINED_TOOL_REGISTRY.validators.get('webFetch')!;

  it('정상 https URL 통과', () => {
    const r = v({ url: 'https://example.com/path' });
    expect(r.ok).toBe(true);
  });

  it('정상 http URL 통과', () => {
    const r = v({ url: 'http://example.com' });
    expect(r.ok).toBe(true);
  });

  it('file:// scheme 거부', () => {
    const r = v({ url: 'file:///etc/passwd' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('url-not-http-https');
  });

  it('ftp:// scheme 거부', () => {
    const r = v({ url: 'ftp://example.com/file' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('url-not-http-https');
  });

  it('빈 URL 거부', () => {
    const r = v({ url: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('url-empty');
  });

  it('url-not-string', () => {
    const r = v({ url: 123 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('url-not-string');
  });

  it('prompt 정상 전달', () => {
    const r = v({
      url: 'https://example.com',
      prompt: '핵심 요약해줘',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as { prompt?: string };
      expect(args.prompt).toBe('핵심 요약해줘');
    }
  });

  it('maxBytes 범위 검증 (1024~1MB)', () => {
    const ok = v({ url: 'https://x', maxBytes: 10000 });
    expect(ok.ok).toBe(true);
    const tooSmall = v({ url: 'https://x', maxBytes: 100 });
    expect(tooSmall.ok).toBe(false);
    const tooLarge = v({ url: 'https://x', maxBytes: 999_999_999 });
    expect(tooLarge.ok).toBe(false);
  });
});

describe('webSearch validator', () => {
  const v = DEFINED_TOOL_REGISTRY.validators.get('webSearch')!;

  it('정상 query 통과', () => {
    const r = v({ query: '한국 제조AI 동향 2025' });
    expect(r.ok).toBe(true);
  });

  it('빈 query 거부', () => {
    const r = v({ query: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('query-empty');
  });

  it('maxResults 범위 (1-20)', () => {
    const ok = v({ query: 'x', maxResults: 5 });
    expect(ok.ok).toBe(true);
    const tooMany = v({ query: 'x', maxResults: 100 });
    expect(tooMany.ok).toBe(false);
    const zero = v({ query: 'x', maxResults: 0 });
    expect(zero.ok).toBe(false);
  });

  it('maxResults 미지정 → ok (default 사용)', () => {
    const r = v({ query: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as { maxResults?: number };
      expect(args.maxResults).toBeUndefined();
    }
  });
});
