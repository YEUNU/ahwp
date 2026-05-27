/**
 * Web IPC pure-logic 테스트 — 0.7.7.
 *
 * 실제 network fetch 는 e2e 영역. 본 테스트는 IPC handler 안의 pure
 * 변환 / 파싱 부분만 검증:
 *   - URL scheme 거부 (file:// / ftp://)
 *   - HTML → text 변환 (script / style 제거, tag strip, entity decode)
 *   - DuckDuckGo HTML 결과 파싱
 *
 * fetch 자체는 vi.spyOn(globalThis, 'fetch') 로 mock — actual network
 * 호출 없이 handler 의 전체 flow 검증.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webFetchImpl, webSearchImpl } from './web';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('webFetchImpl — URL scheme 검증', () => {
  it('http URL 정상 처리 (mock fetch)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<p>hello world</p>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );
    const r = await webFetchImpl({ url: 'http://example.com' });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect(r.text).toContain('hello world');
    // HTML 변환되어 <p> tag 가 제거됐는지.
    expect(r.text).not.toContain('<p>');
  });

  it('https URL 정상 처리', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('plain text body', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com' });
    expect(r.ok).toBe(true);
    // text/plain 은 변환 안 함.
    expect(r.text).toBe('plain text body');
  });

  it('file:// scheme 거부 (fetch 호출 자체 안 함)', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const r = await webFetchImpl({ url: 'file:///etc/passwd' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('url-not-http-https');
    expect(f).not.toHaveBeenCalled();
  });

  it('잘못된 URL 형식 거부', async () => {
    const r = await webFetchImpl({ url: 'not a url' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('url-not-parseable');
  });

  it('4xx 응답 → ok=false, error=http-XXX', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not found', { status: 404 }),
    );
    const r = await webFetchImpl({ url: 'https://example.com/missing' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.error).toBe('http-404');
  });

  it('fetch 가 throw → error=fetch-error:...', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ENOTFOUND'));
    const r = await webFetchImpl({ url: 'https://no-such-domain.example' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('fetch-error');
  });

  it('maxBytes 초과 시 trim + truncated=true', async () => {
    const big = 'A'.repeat(100_000);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(big, {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const r = await webFetchImpl({
      url: 'https://example.com',
      maxBytes: 10_000,
    });
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.originalBytes).toBe(100_000);
    expect(r.text!.length).toBeLessThanOrEqual(10_000);
  });
});

describe('webFetchImpl — HTML → text 변환', () => {
  it('script / style block 제거', async () => {
    const html = `
      <html><head><script>alert("x")</script><style>body{color:red}</style></head>
      <body><p>visible text</p></body></html>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com' });
    expect(r.text).toContain('visible text');
    expect(r.text).not.toContain('alert');
    expect(r.text).not.toContain('body{color:red}');
  });

  it('HTML entity decode (&nbsp; / &amp; / &lt;)', async () => {
    const html = '<p>a &amp; b &lt;tag&gt;</p>';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com' });
    expect(r.text).toContain('a & b <tag>');
  });
});

describe('webSearchImpl — DDG HTML 파싱', () => {
  it('정상 결과 페이지 파싱', async () => {
    // DDG-style HTML (간소화).
    const html = `
      <html><body>
      <div class="result">
        <a class="result__a" href="https://example.com/1">First Result</a>
        <a class="result__snippet">snippet text one</a>
      </div>
      <div class="result">
        <a class="result__a" href="https://example.com/2">Second Result</a>
        <a class="result__snippet">snippet text two</a>
      </div>
      </body></html>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webSearchImpl({ query: 'test' });
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(2);
    expect(r.results[0]).toMatchObject({
      title: 'First Result',
      url: 'https://example.com/1',
      snippet: 'snippet text one',
    });
    expect(r.results[1].url).toBe('https://example.com/2');
  });

  it('uddg redirect URL 디코딩', async () => {
    const real = 'https://news.example.com/article-xyz';
    const encoded = encodeURIComponent(real);
    const html = `
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=${encoded}">Article</a>
      </div>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webSearchImpl({ query: 'x' });
    expect(r.results[0].url).toBe(real);
  });

  it('maxResults cap 적용', async () => {
    const blocks = Array.from(
      { length: 15 },
      (_, i) =>
        `<div class="result"><a class="result__a" href="https://x/${i}">Result ${i}</a></div>`,
    ).join('');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(blocks, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webSearchImpl({ query: 'q', maxResults: 5 });
    expect(r.results).toHaveLength(5);
  });

  it('빈 query 거부', async () => {
    const r = await webSearchImpl({ query: '' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('query-empty');
  });

  it('fetch 실패 → ok=false', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const r = await webSearchImpl({ query: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('search-error');
  });

  it('HTTP 4xx → ok=false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('', { status: 429 }),
    );
    const r = await webSearchImpl({ query: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('http-429');
  });
});
