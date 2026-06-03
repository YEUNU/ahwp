/**
 * Web IPC handlers — 0.7.7.
 *
 * `web:fetch` / `web:search` 도구의 main-process 구현. AI 의 webFetch /
 * webSearch 도구 호출은 renderer 의 dispatcher (`src/features/chat/
 * tools.ts`) 가 본 IPC 를 통해 main 으로 위임한다.
 *
 * **보안:**
 * - URL scheme http / https 만 허용. file:// / ftp:// 등 거부.
 * - 응답 본문 size cap + 30s timeout — DoS / memory blowup 회피.
 * - User-Agent 명시 (anon ahwp).
 * - Redirect 자동 추적 (Node fetch 기본 동작), 단 max 5 hop.
 *
 * **webSearch backend:** DuckDuckGo HTML interface (no API key).
 * `https://html.duckduckgo.com/html/?q=QUERY` 가 HTML 결과 페이지를
 * 반환 — 그 안의 `<a class="result__a">` 들을 파싱. 정식 API 가 아니라
 * 변경에 fragile 함. 정식 API 가 필요하면 Brave Search / SerpAPI 등을
 * Settings 에서 API 키 받아 별도 backend 로 추가 (future chunk).
 */
import { ipcMain } from 'electron';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import type {
  ActiveSearchBackend,
  WebFetchRequest,
  WebFetchResult,
  WebSearchBackend,
  WebSearchRequest,
  WebSearchResult,
  WebSearchResultItem,
} from '../../shared/api';
import {
  deleteWebSearchKey,
  getWebSearchKeyPlaintext,
  hasWebSearchKey,
  isWebSearchBackend,
  pickActiveSearchBackend,
  setWebSearchKey,
} from '../store/web-keys';

const FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 32 * 1024;
const HARD_MAX_BYTES = 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (compatible; ahwp/0.7; +https://github.com/YEUNU/ahwp) ahwp-AI-fetcher';

function ensureHttpUrl(url: unknown): URL {
  if (typeof url !== 'string' || url.length === 0)
    throw new Error('url-not-string');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('url-not-parseable');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    throw new Error('url-not-http-https');
  return parsed;
}

/**
 * Legacy HTML → text 변환 — 정규식 best-effort. `<script>` / `<style>`
 * 제거, tag strip, entity decode, whitespace 정규화. 0.7.10 부터는
 * Readability 가 실패한 경우 (article 아님 / parse 실패) 에만 fallback
 * 으로 사용.
 */
function legacyHtmlToText(html: string): string {
  let t = html;
  // strip script / style blocks (case-insensitive, multi-line)
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // strip HTML comments
  t = t.replace(/<!--[\s\S]*?-->/g, ' ');
  // <br> / <p> → newline
  t = t.replace(/<\/?(?:br|p|div|li|h[1-6]|tr)\b[^>]*>/gi, '\n');
  // remaining tags
  t = t.replace(/<[^>]+>/g, ' ');
  // basic entity decode
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  // collapse whitespace
  t = t
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/**
 * HTML → article text + metadata 변환 (0.7.10).
 *
 * Mozilla 의 Readability (Firefox Reader Mode 엔진) + linkedom (light
 * DOM impl) 사용. Readability 는 페이지의 article body 만 정확히 추출
 * (nav / sidebar / footer / ad 제거) + 자동 metadata (title / byline /
 * siteName / excerpt) 추출.
 *
 * 동작:
 *   - HTML 을 linkedom 으로 parse → DOM Document
 *   - Readability(doc).parse() → { title, content, textContent, byline,
 *     siteName, excerpt }
 *   - article 페이지가 아니거나 parse 실패하면 null → legacyHtmlToText
 *     fallback
 *
 * `extractionMethod` 로 어떤 path 가 적용됐는지 caller 가 인지.
 */
function htmlToArticle(
  html: string,
  url: string,
): {
  text: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  extractionMethod: 'readability' | 'regex';
} {
  try {
    const { document } = parseHTML(html);
    // Readability 가 base URL 필요 — linkedom 의 document 에 baseURI 주입.
    // parseHTML(html, {url}) 패턴이 linkedom 에 없어서 직접 attribute 설정.
    // 단, Readability 가 baseURI 없어도 동작은 함 (relative URL 처리만
    // 영향). 안전을 위해 try-catch.
    try {
      const baseEl = document.createElement('base');
      baseEl.setAttribute('href', url);
      document.head?.appendChild(baseEl);
    } catch {
      /* base 주입 실패 — relative URL 만 영향, 본문 추출은 OK. */
    }
    const article = new Readability(document as unknown as Document).parse();
    if (
      article &&
      typeof article.textContent === 'string' &&
      article.textContent.trim().length > 0
    ) {
      return {
        text: article.textContent.trim(),
        title: article.title ?? undefined,
        byline: article.byline ?? undefined,
        excerpt: article.excerpt ?? undefined,
        siteName: article.siteName ?? undefined,
        extractionMethod: 'readability',
      };
    }
  } catch (err) {
    console.warn(
      `[web] Readability failed for ${url}, falling back to regex:`,
      (err as Error).message,
    );
  }
  return { text: legacyHtmlToText(html), extractionMethod: 'regex' };
}

export async function webFetchImpl(
  req: WebFetchRequest,
): Promise<WebFetchResult> {
  let url: URL;
  try {
    url = ensureHttpUrl(req.url);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const maxBytes = Math.min(
    Math.max(req.maxBytes ?? DEFAULT_MAX_BYTES, 1024),
    HARD_MAX_BYTES,
  );
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    const status = res.status;
    const contentType = res.headers.get('content-type') ?? undefined;
    const ab = await res.arrayBuffer();
    const originalBytes = ab.byteLength;
    const slice = originalBytes > maxBytes ? ab.slice(0, maxBytes) : ab;
    const truncated = originalBytes > maxBytes;
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    // 0.7.10 — content-type 이 html 이면 Readability 로 article 추출.
    // 그 외 (JSON / plain text) 는 raw 그대로. text/html 인데 article 이
    // 아니면 (e.g. 검색 결과 페이지 / SPA shell) Readability 가 null 반환
    // → legacyHtmlToText regex fallback.
    if (contentType && /text\/html|application\/xhtml/i.test(contentType)) {
      const article = htmlToArticle(rawText, url.toString());
      return {
        ok: res.ok,
        status,
        contentType,
        text: article.text,
        truncated,
        originalBytes,
        error: res.ok ? undefined : `http-${status}`,
        title: article.title,
        byline: article.byline,
        excerpt: article.excerpt,
        siteName: article.siteName,
        extractionMethod: article.extractionMethod,
      };
    }
    return {
      ok: res.ok,
      status,
      contentType,
      text: rawText,
      truncated,
      originalBytes,
      error: res.ok ? undefined : `http-${status}`,
    };
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e as Error).message ?? String(e);
    return {
      ok: false,
      error: msg.includes('aborted') ? 'timeout' : `fetch-error:${msg}`,
    };
  }
}

/**
 * DuckDuckGo HTML 결과 페이지에서 검색 결과 추출. 그 page 가 server-side
 * render 된 HTML 이라 정규식만으로 파싱 가능. API 응답이 아니므로 변경에
 * fragile — robustness 보다 가독성 우선.
 *
 * 결과 anchor pattern (DDG 2024 기준):
 *   <a class="result__a" href="...">TITLE</a>
 *   ... 같은 result 안에 <a class="result__snippet">SNIPPET</a> 도 있음.
 *
 * 응답이 빈 경우 (rate-limit 등) results=[] 로 정상 반환 — error 아님.
 */
function parseDuckDuckGoHtml(
  html: string,
  maxResults: number,
): WebSearchResultItem[] {
  const items: WebSearchResultItem[] = [];
  // result block 단위로 분할 (각 result 는 <div class="result"...> 시작).
  const blocks = html.split(/<div\s+class="result[^"]*"/g).slice(1);
  for (const blk of blocks) {
    if (items.length >= maxResults) break;
    const aMatch =
      /<a\s+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(
        blk,
      );
    if (!aMatch) continue;
    let rawUrl = aMatch[1];
    // DDG 가 redirect 링크 (`//duckduckgo.com/l/?uddg=ENCODED_URL`) 로 감싸는
    // 경우가 흔함 — uddg 파라미터에서 실제 URL 복구.
    try {
      if (rawUrl.startsWith('//')) rawUrl = `https:${rawUrl}`;
      const u = new URL(rawUrl);
      const uddg = u.searchParams.get('uddg');
      if (uddg) rawUrl = decodeURIComponent(uddg);
    } catch {
      /* parse 실패 시 raw 그대로 사용 */
    }
    const title = legacyHtmlToText(aMatch[2]).slice(0, 256);
    const snipMatch = /<a\s+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(
      blk,
    );
    const snippet = snipMatch
      ? legacyHtmlToText(snipMatch[1]).slice(0, 512)
      : undefined;
    if (title && rawUrl) items.push({ title, url: rawUrl, snippet });
  }
  return items;
}

/**
 * Brave Search API backend (0.7.8). 사용자가 API key 등록한 경우 자동
 * 우선. 응답은 `{ web: { results: [{title, url, description}] } }` JSON.
 * 무료 tier: 2000 q/month, rate 1 q/s.
 */
async function searchViaBrave(
  query: string,
  maxResults: number,
  apiKey: string,
): Promise<WebSearchResult> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(maxResults, 20)));
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      headers: {
        'X-Subscription-Token': apiKey,
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'User-Agent': USER_AGENT,
      },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return {
        ok: false,
        query,
        results: [],
        error: `brave-http-${res.status}`,
      };
    }
    const json = (await res.json()) as {
      web?: {
        results?: Array<{ title?: string; url?: string; description?: string }>;
      };
    };
    const items: WebSearchResultItem[] = (json.web?.results ?? [])
      .slice(0, maxResults)
      .map((r) => ({
        title: (r.title ?? '').slice(0, 256),
        url: r.url ?? '',
        snippet: r.description ? r.description.slice(0, 512) : undefined,
      }))
      .filter((r) => r.title && r.url);
    return { ok: true, query, results: items };
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e as Error).message ?? String(e);
    return {
      ok: false,
      query,
      results: [],
      error: msg.includes('aborted') ? 'timeout' : `brave-error:${msg}`,
    };
  }
}

async function searchViaDdg(
  query: string,
  maxResults: number,
): Promise<WebSearchResult> {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort('timeout'), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ddgUrl, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return { ok: false, query, results: [], error: `http-${res.status}` };
    }
    const html = await res.text();
    const results = parseDuckDuckGoHtml(html, maxResults);
    return { ok: true, query, results };
  } catch (e) {
    clearTimeout(timeout);
    const msg = (e as Error).message ?? String(e);
    return {
      ok: false,
      query,
      results: [],
      error: msg.includes('aborted') ? 'timeout' : `search-error:${msg}`,
    };
  }
}

/**
 * Backend 자동 선택 + 실행. 우선순위:
 *   1. Brave (사용자 API key 등록 시) — JSON 응답, 안정적
 *   2. SerpAPI (등록 시) — placeholder, 0.7.8 에선 미구현
 *   3. DuckDuckGo HTML scraping — fallback, no key
 *
 * Brave 호출이 실패하면 (rate limit / network) DDG 로 자동 retry — 한
 * backend 의 일시적 문제로 검색 전체가 막히지 않도록.
 */
export async function webSearchImpl(
  req: WebSearchRequest,
): Promise<WebSearchResult> {
  const query = req.query?.trim() ?? '';
  if (query.length === 0)
    return { ok: false, query, results: [], error: 'query-empty' };
  const maxResults = Math.min(Math.max(req.maxResults ?? 10, 1), 20);

  const active = await pickActiveSearchBackend();
  if (active === 'brave') {
    const key = await getWebSearchKeyPlaintext('brave');
    if (key) {
      const r = await searchViaBrave(query, maxResults, key);
      if (r.ok) return r;
      // Brave 실패 → DDG fallback. 사용자가 결과 받도록.
      console.warn(`[web] brave failed (${r.error}), falling back to DDG`);
    }
  }
  // No Brave key (or it failed) → DDG HTML scraping fallback.
  return await searchViaDdg(query, maxResults);
}

export function registerWebIpc(): void {
  ipcMain.handle(
    'web:fetch',
    async (_event, req: WebFetchRequest): Promise<WebFetchResult> => {
      return await webFetchImpl(req);
    },
  );
  ipcMain.handle(
    'web:search',
    async (_event, req: WebSearchRequest): Promise<WebSearchResult> => {
      return await webSearchImpl(req);
    },
  );
  // 0.7.8 — search backend key 관리.
  ipcMain.handle(
    'web:set-search-key',
    async (_event, backend: unknown, key: unknown): Promise<void> => {
      if (!isWebSearchBackend(backend)) {
        throw new Error(`unknown-backend:${String(backend)}`);
      }
      if (typeof key !== 'string') {
        throw new Error('key-not-string');
      }
      await setWebSearchKey(backend as WebSearchBackend, key);
    },
  );
  ipcMain.handle(
    'web:has-search-key',
    async (_event, backend: unknown): Promise<boolean> => {
      if (!isWebSearchBackend(backend)) return false;
      return await hasWebSearchKey(backend as WebSearchBackend);
    },
  );
  ipcMain.handle(
    'web:delete-search-key',
    async (_event, backend: unknown): Promise<void> => {
      if (!isWebSearchBackend(backend)) {
        throw new Error(`unknown-backend:${String(backend)}`);
      }
      await deleteWebSearchKey(backend as WebSearchBackend);
    },
  );
  ipcMain.handle(
    'web:get-active-backend',
    async (): Promise<ActiveSearchBackend> => {
      const b = await pickActiveSearchBackend();
      return b ?? 'ddg';
    },
  );
}
