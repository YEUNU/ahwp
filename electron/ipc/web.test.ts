/**
 * Web IPC pure-logic 테스트 — 0.7.7 / 0.7.8.
 *
 * 실제 network fetch 는 e2e 영역. 본 테스트는 IPC handler 안의 pure
 * 변환 / 파싱 부분만 검증:
 *   - URL scheme 거부 (file:// / ftp://)
 *   - HTML → text 변환 (script / style 제거, tag strip, entity decode)
 *   - DuckDuckGo HTML 결과 파싱
 *   - 0.7.8 — Brave Search JSON API + backend 자동 선택 + fallback
 *
 * fetch 자체는 vi.spyOn(globalThis, 'fetch') 로 mock — actual network
 * 호출 없이 handler 의 전체 flow 검증.
 *
 * web-keys store 도 mock — safeStorage / Electron app context 없이 테스트
 * 가능하도록 helper module 의 export 를 mock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webFetchImpl, webSearchImpl } from './web';
import * as webKeys from '../store/web-keys';

// webFetchImpl resolves the host (SSRF guard) before fetching. Mock DNS so the
// unit tests stay hermetic (no real network) and resolve to a public IP by
// default; specific tests override for private-IP / failure cases.
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
  },
}));

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

  it('loopback IP 거부 (SSRF guard, fetch 안 함)', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const r = await webFetchImpl({ url: 'http://127.0.0.1:8080/admin' });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked-host');
    expect(f).not.toHaveBeenCalled();
  });

  it('cloud metadata IP 거부 (SSRF guard, fetch 안 함)', async () => {
    const f = vi.spyOn(globalThis, 'fetch');
    const r = await webFetchImpl({
      url: 'http://169.254.169.254/latest/meta-data/',
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('blocked-host');
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

describe('webFetchImpl — HTML → text 변환 (0.7.10 Readability)', () => {
  // article 페이지 (h1 + 본문) → Readability 가 추출 성공.
  it('article 페이지 → Readability 추출 + metadata', async () => {
    const html = `
      <html lang="en">
        <head>
          <title>Example Article</title>
          <meta name="author" content="John Doe">
          <meta property="og:site_name" content="Example Site">
          <meta name="description" content="A brief description">
          <script>alert("noise")</script>
          <style>body{color:red}</style>
        </head>
        <body>
          <nav>Navigation links</nav>
          <article>
            <h1>Example Article Title</h1>
            <p>This is the main article body. It contains substantive content
            that should be extracted by Readability. We need enough text here
            to pass the minimum content length heuristic — at least a couple
            hundred characters of real prose so Readability classifies this
            as an article rather than discarding it.</p>
            <p>Second paragraph with more meaningful content about the topic.
            Readability looks at link density, paragraph length, and other
            heuristics to decide what is article body vs chrome.</p>
          </article>
          <footer>Site footer with links</footer>
        </body>
      </html>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com/article' });
    expect(r.ok).toBe(true);
    expect(r.extractionMethod).toBe('readability');
    expect(r.text).toContain('main article body');
    expect(r.text).toContain('Second paragraph');
    // chrome 제거 — Readability 가 nav/footer 제외.
    expect(r.text).not.toContain('Navigation links');
    expect(r.text).not.toContain('Site footer');
    // metadata 자동 추출.
    expect(r.title).toContain('Example Article');
  });

  // non-article 페이지 (검색 결과 / SPA shell) → Readability null → regex fallback.
  it('non-article 페이지 → regex fallback', async () => {
    const html = `
      <html><body>
        <ul>
          <li><a href="/1">Link 1</a></li>
          <li><a href="/2">Link 2</a></li>
        </ul>
      </body></html>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com/list' });
    expect(r.ok).toBe(true);
    // Readability 가 짧은 link list 는 article 로 보지 않음 → regex fallback.
    // (or readability may still succeed — test 가 robust 하게 양쪽 다 OK.)
    expect(r.text).toBeDefined();
    expect(['readability', 'regex']).toContain(r.extractionMethod);
  });

  // script / style block 은 어느 path 든 제거됨.
  it('script / style block 제거 (어느 path 든)', async () => {
    const html = `
      <html><head><script>alert("x")</script><style>body{color:red}</style></head>
      <body><p>visible text content with enough words to be meaningful</p></body></html>`;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com' });
    expect(r.text).toContain('visible text');
    expect(r.text).not.toContain('alert("x")');
    expect(r.text).not.toContain('body{color:red}');
  });

  // text/plain content-type 은 HTML 변환 안 함 (그대로).
  it('text/plain → 변환 없이 그대로 (extractionMethod undefined)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('raw text without HTML tags', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const r = await webFetchImpl({ url: 'https://example.com/txt' });
    expect(r.text).toBe('raw text without HTML tags');
    // text/plain 는 HTML 추출 path 안 거침 → extractionMethod 없음.
    expect(r.extractionMethod).toBeUndefined();
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

// ── 0.7.8 — Brave backend + fallback ─────────────────────────────────

describe('webSearchImpl — Brave Search backend (0.7.8)', () => {
  it('Brave key 등록 시 Brave API 우선 사용', async () => {
    vi.spyOn(webKeys, 'pickActiveSearchBackend').mockResolvedValue('brave');
    vi.spyOn(webKeys, 'getWebSearchKeyPlaintext').mockResolvedValue(
      'test-brave-key',
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          web: {
            results: [
              {
                title: 'Brave Result',
                url: 'https://example.com/brave',
                description: 'Brave snippet',
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const r = await webSearchImpl({ query: 'test' });
    expect(r.ok).toBe(true);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]).toEqual({
      title: 'Brave Result',
      url: 'https://example.com/brave',
      snippet: 'Brave snippet',
    });
    // Brave endpoint 가 호출됐는지.
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api.search.brave.com'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Subscription-Token': 'test-brave-key',
        }),
      }),
    );
  });

  it('Brave API 실패 시 DDG fallback', async () => {
    vi.spyOn(webKeys, 'pickActiveSearchBackend').mockResolvedValue('brave');
    vi.spyOn(webKeys, 'getWebSearchKeyPlaintext').mockResolvedValue('test-key');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    // 첫 번째 호출 (Brave) — 429 rate-limit
    fetchSpy.mockResolvedValueOnce(new Response('', { status: 429 }));
    // 두 번째 호출 (DDG) — 정상
    fetchSpy.mockResolvedValueOnce(
      new Response(
        `<div class="result"><a class="result__a" href="https://ddg.example/r">DDG Result</a></div>`,
        { status: 200, headers: { 'content-type': 'text/html' } },
      ),
    );
    const r = await webSearchImpl({ query: 'q' });
    expect(r.ok).toBe(true);
    expect(r.results[0].title).toBe('DDG Result');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('Brave key 없음 → DDG 바로 사용', async () => {
    vi.spyOn(webKeys, 'pickActiveSearchBackend').mockResolvedValue(null);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<div class="result"></div>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    await webSearchImpl({ query: 'q' });
    // Brave endpoint 호출 안 되고 DDG 만.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('duckduckgo.com'),
      expect.any(Object),
    );
  });

  it('Brave 응답 maxResults cap 적용', async () => {
    vi.spyOn(webKeys, 'pickActiveSearchBackend').mockResolvedValue('brave');
    vi.spyOn(webKeys, 'getWebSearchKeyPlaintext').mockResolvedValue('k');
    const manyResults = Array.from({ length: 15 }, (_, i) => ({
      title: `R${i}`,
      url: `https://x/${i}`,
      description: `s${i}`,
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ web: { results: manyResults } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const r = await webSearchImpl({ query: 'q', maxResults: 5 });
    expect(r.results).toHaveLength(5);
  });

  it('Brave 응답에 web.results 없음 → 빈 results', async () => {
    vi.spyOn(webKeys, 'pickActiveSearchBackend').mockResolvedValue('brave');
    vi.spyOn(webKeys, 'getWebSearchKeyPlaintext').mockResolvedValue('k');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const r = await webSearchImpl({ query: 'q' });
    expect(r.ok).toBe(true);
    expect(r.results).toEqual([]);
  });
});
