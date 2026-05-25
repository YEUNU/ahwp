/// <reference lib="dom" />
import { createServer, type Server } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, relative, sep } from 'node:path';
import path from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

/**
 * Phase A2 PoC — `vendor/rhwp/rhwp-studio` 의 postMessage bridge 가 Phase A2
 * 에서 추가한 6 method (`getSectionCount` / `getParagraphCount` /
 * `getTextRange` / `searchAllText` / `insertText` / `getCaretPosition`) 에
 * 올바르게 응답하는지 검증. Phase D 에서 ahwp 의 55 AI tools 가 이 채널
 * 위에 올라가기 전 단계 확인.
 *
 * 일반 e2e 와 달리 Electron 을 띄우지 않고 chromium 만으로 rhwp-studio
 * 의 build 산출물 (`vendor/rhwp/rhwp-studio/dist/index.html`) 을 file://
 * 로 띄운다. `npm run vendor:rhwp:build` 가 미실행이면 spec 자동 skip.
 */

const STUDIO_DIST_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'vendor',
  'rhwp',
  'rhwp-studio',
  'dist',
);
const STUDIO_DIST = path.join(STUDIO_DIST_DIR, 'index.html');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Tiny static server scoped to rhwp-studio dist. We can't use file:// because
 * chromium blocks ES-module + WASM fetches under the null origin (CORS).
 * Listens on an ephemeral port; returned URL is `http://127.0.0.1:<port>/`.
 */
function startStudioServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve_, reject) => {
    const root = STUDIO_DIST_DIR;
    const server: Server = createServer((req, res) => {
      try {
        const reqPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const rel =
          reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
        const abs = normalize(join(root, rel));
        // Path traversal guard.
        if (
          relative(root, abs).startsWith('..' + sep) ||
          relative(root, abs) === '..'
        ) {
          res.statusCode = 403;
          res.end();
          return;
        }
        if (!existsSync(abs) || statSync(abs).isDirectory()) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader(
          'content-type',
          MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream',
        );
        createReadStream(abs).pipe(res);
      } catch {
        res.statusCode = 500;
        res.end();
      }
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('address bind failed'));
        return;
      }
      resolve_({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
const FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
);

interface BridgeRequest {
  method: string;
  params?: Record<string, unknown>;
}
interface BridgeResponse {
  result?: unknown;
  error?: string;
}

/**
 * Send a `rhwp-request` postMessage to the same window (which is where
 * rhwp-studio installs the listener) and await the matching `rhwp-response`.
 */
async function invokeBridge(
  page: Page,
  req: BridgeRequest,
  timeoutMs = 15_000,
): Promise<BridgeResponse> {
  return await page.evaluate(
    async ({ method, params, timeoutMs }) => {
      return await new Promise<BridgeResponse>((resolve, reject) => {
        const id = `poc-${Math.random().toString(36).slice(2)}`;
        const timer = window.setTimeout(() => {
          window.removeEventListener('message', handler);
          reject(new Error(`bridge timeout: ${method}`));
        }, timeoutMs);
        const handler = (e: MessageEvent) => {
          const d = e.data as
            | { type?: string; id?: string; result?: unknown; error?: string }
            | undefined;
          if (!d || d.type !== 'rhwp-response' || d.id !== id) return;
          window.clearTimeout(timer);
          window.removeEventListener('message', handler);
          resolve({ result: d.result, error: d.error });
        };
        window.addEventListener('message', handler);
        window.postMessage({ type: 'rhwp-request', id, method, params }, '*');
      });
    },
    { method: req.method, params: req.params ?? {}, timeoutMs },
  );
}

test.describe('rhwp-studio bridge — Phase A2 PoC', () => {
  test.skip(
    !existsSync(STUDIO_DIST),
    'vendor/rhwp/rhwp-studio/dist missing — run `npm run vendor:rhwp:build` first',
  );
  test.skip(!existsSync(FIXTURE), 'examples/2026년도 ... 공고.hwp missing');

  test('bridge responds to ready / loadFile + 6 new methods', async () => {
    const { url: serverUrl, close: closeServer } = await startStudioServer();
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const consoleMsgs: string[] = [];
    page.on('console', (m) => consoleMsgs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => consoleMsgs.push(`[error] ${e.message}`));
    try {
      await page.goto(serverUrl);
      console.log('--- studio page console (first 40) ---');
      console.log(consoleMsgs.slice(0, 40).join('\n'));

      // 1) ready — WASM init 완료 대기 (race condition #522 가드).
      const ready = await invokeBridge(page, { method: 'ready' }, 30_000);
      expect(ready.error).toBeUndefined();
      expect(ready.result).toBe(true);

      // 2) loadFile — fixture 바이트를 main world 에서 ArrayBuffer 로 전달.
      const bytes = readFileSync(FIXTURE);
      const data = Array.from(bytes);
      const loaded = await invokeBridge(
        page,
        {
          method: 'loadFile',
          params: { data, fileName: '2026.hwp', skipUnsavedGuard: true },
        },
        30_000,
      );
      expect(loaded.error).toBeUndefined();
      expect(
        (loaded.result as { pageCount: number }).pageCount,
      ).toBeGreaterThan(0);

      // 3) getSectionCount — 작은 number 반환.
      const sc = await invokeBridge(page, { method: 'getSectionCount' });
      expect(sc.error).toBeUndefined();
      expect(typeof sc.result).toBe('number');
      expect(sc.result as number).toBeGreaterThanOrEqual(1);

      // 4) getParagraphCount(sec=0) — number.
      const pc = await invokeBridge(page, {
        method: 'getParagraphCount',
        params: { sec: 0 },
      });
      expect(pc.error).toBeUndefined();
      expect(typeof pc.result).toBe('number');
      expect(pc.result as number).toBeGreaterThan(0);

      // 5) getTextRange — 짧은 string 반환.
      const tr = await invokeBridge(page, {
        method: 'getTextRange',
        params: { sec: 0, para: 0, charOffset: 0, count: 200 },
      });
      expect(tr.error).toBeUndefined();
      expect(typeof tr.result).toBe('string');

      // 6) searchAllText — 0.7.12 native, JSON array of hits.
      const sa = await invokeBridge(page, {
        method: 'searchAllText',
        params: { query: '사업', caseSensitive: false, includeCells: false },
      });
      expect(sa.error).toBeUndefined();
      expect(Array.isArray(sa.result)).toBe(true);
      // public fixture had ~12 top-level matches (per migration probe).
      expect((sa.result as unknown[]).length).toBeGreaterThanOrEqual(1);

      // 7) getCaretPosition — null or {sectionIndex, paragraphIndex, charOffset}.
      const cp = await invokeBridge(page, { method: 'getCaretPosition' });
      expect(cp.error).toBeUndefined();
      // After loadFile caret should be defined.
      expect(cp.result).not.toBeNull();

      // 8) insertText — IR mutation. Insert at doc start, then verify it
      // appears in the next getTextRange call. searchAllText invalidation
      // is implicit in the lib (no client-side cache).
      const sentinel = `PHASE7-PoC-${Date.now().toString(36)}`;
      const ins = await invokeBridge(page, {
        method: 'insertText',
        params: { sec: 0, para: 0, charOffset: 0, text: sentinel },
      });
      expect(ins.error).toBeUndefined();
      // lib returns a JSON status string (e.g. `{"ok":true,...}`).
      expect(typeof ins.result).toBe('string');

      const after = await invokeBridge(page, {
        method: 'searchAllText',
        params: { query: sentinel, caseSensitive: false, includeCells: false },
      });
      expect(after.error).toBeUndefined();
      expect((after.result as unknown[]).length).toBeGreaterThanOrEqual(1);
    } finally {
      await ctx.close();
      await browser.close();
      await closeServer();
    }
  });

  test('unknown method returns descriptive error', async () => {
    const { url: serverUrl, close: closeServer } = await startStudioServer();
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(serverUrl);
      // Wait for the bridge listener — `ready` returns true once init promise resolves.
      const r0 = await invokeBridge(page, { method: 'ready' }, 30_000);
      expect(r0.result).toBe(true);
      const r = await invokeBridge(page, {
        method: 'definitelyNotARealMethod',
      });
      expect(r.result).toBeUndefined();
      expect(r.error).toMatch(/Unknown method/);
    } finally {
      await ctx.close();
      await browser.close();
      await closeServer();
    }
  });
});
