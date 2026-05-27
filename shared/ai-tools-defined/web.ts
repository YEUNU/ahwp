/**
 * External world access 도구들 — defineTool migration (0.7.7).
 *
 * Cross-doc-research mode 의 핵심. 워크스페이스 외 정보 (HTTP URL /
 * 검색 결과) 를 AI 가 직접 가져올 수 있게 한다. 모두 read-only — HWP
 * IR 변경 없음, 사용자 confirm 게이트 우회 (즉시 실행).
 *
 * 보안:
 * - URL scheme 은 http / https 만 허용 (main process validator 에서 강제).
 * - 응답 본문은 size cap + 30s timeout — 무한 다운로드 / 응답 누락 방지.
 * - CSP: main process 가 fetch 하므로 renderer CSP 우회 없이 임의 도메인
 *   접근 가능. 단, 라이센스 / robots.txt 등은 사용자 책임.
 *
 * 도구 (2):
 * - webFetch — 단일 URL fetch + HTML→text 추출
 * - webSearch — 웹 검색 (DuckDuckGo HTML scraping, no API key)
 */
import type { AhwpToolArgs } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, coerceNonNegInt } from '../ai-tool-validate';

export const webFetch = defineTool<'webFetch', AhwpToolArgs['webFetch']>({
  name: 'webFetch',
  description:
    'Fetch a URL (http or https only) and return the page content as plain text. Useful when you need information from a specific webpage the user referenced (article, documentation, news, etc.). The body is automatically converted from HTML to readable text (tags stripped, whitespace normalized). Capped at maxBytes (default 32KB) — large pages are trimmed. If you need to summarize against a specific intent, pass `prompt` (echoed back in the response so you can keep that intent in your reasoning). 30-second timeout. Use for: (a) "이 페이지 내용 요약해줘" with a URL, (b) verifying specific claims against an external source. Do NOT use for: searching the web (use webSearch instead) or fetching paginated content (call repeatedly with different URLs).',
  inputSchema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        minLength: 1,
        description: 'http:// 또는 https:// URL only.',
      },
      prompt: { type: 'string', maxLength: 1024 },
      maxBytes: { type: 'integer', minimum: 1024, maximum: 1048576 },
    },
    required: ['url'],
  },
  readonly: true,
  modes: ['cross-doc-research', 'free-authoring', 'body-edit'],
  validate(raw) {
    const url = raw.url;
    if (typeof url !== 'string') return { ok: false, reason: 'url-not-string' };
    if (url.length === 0) return { ok: false, reason: 'url-empty' };
    if (!/^https?:\/\//i.test(url))
      return { ok: false, reason: 'url-not-http-https' };
    if (byteLen(url) > 4096) return { ok: false, reason: 'url-too-large' };
    const out: AhwpToolArgs['webFetch'] = { url };
    if (raw.prompt !== undefined) {
      if (typeof raw.prompt !== 'string')
        return { ok: false, reason: 'prompt-not-string' };
      if (byteLen(raw.prompt) > 1024)
        return { ok: false, reason: 'prompt-too-large' };
      out.prompt = raw.prompt;
    }
    if (raw.maxBytes !== undefined) {
      const n = coerceNonNegInt(raw.maxBytes);
      if (n === null || n < 1024 || n > 1024 * 1024)
        return { ok: false, reason: 'maxBytes-out-of-range' };
      out.maxBytes = n;
    }
    return { ok: true, args: out };
  },
});

export const webSearch = defineTool<'webSearch', AhwpToolArgs['webSearch']>({
  name: 'webSearch',
  description:
    'Search the web for a query and return ranked results (title, url, snippet). Use when the user asks for recent / external information you don\'t have in the workspace (e.g. "최근 동향 찾아줘", "이 회사 정보 검색"). Each result has a URL — pair with webFetch to retrieve the body of the most relevant ones. maxResults 1-20 (default 10). Search engine: DuckDuckGo HTML interface (no API key required, may return fewer results than Google). Do NOT use for: arithmetic / coding tasks (you already know that), or for fetching a known URL (use webFetch directly).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1024 },
      maxResults: { type: 'integer', minimum: 1, maximum: 20 },
    },
    required: ['query'],
  },
  readonly: true,
  modes: ['cross-doc-research', 'free-authoring', 'body-edit'],
  validate(raw) {
    const query = raw.query;
    if (typeof query !== 'string')
      return { ok: false, reason: 'query-not-string' };
    if (query.length === 0) return { ok: false, reason: 'query-empty' };
    if (byteLen(query) > 1024) return { ok: false, reason: 'query-too-large' };
    const out: AhwpToolArgs['webSearch'] = { query };
    if (raw.maxResults !== undefined) {
      const n = coerceNonNegInt(raw.maxResults);
      if (n === null || n < 1 || n > 20)
        return { ok: false, reason: 'maxResults-out-of-range' };
      out.maxResults = n;
    }
    return { ok: true, args: out };
  },
});
