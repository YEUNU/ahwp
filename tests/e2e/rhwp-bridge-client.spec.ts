/// <reference lib="dom" />
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { dirname, extname, join, normalize, relative, sep } from 'node:path';
import { chromium, expect, test, type Page } from '@playwright/test';

/**
 * Phase B — RhwpBridge 클라이언트가 실제 rhwp-studio dist 와 round-trip
 * 으로 동작하는지 검증.
 *
 * `rhwp-bridge-poc.spec.ts` 가 postMessage 채널 자체를 직접 호출 (window
 * 가 자기 자신에 post) 했다면 본 spec 은 parent / iframe 분리 구조를
 * 그대로 재현 — Playwright 가 parent HTML 을 로드, parent 안에 iframe
 * 을 만들고 거기에 RhwpBridge 를 연결.
 *
 * RhwpBridge 의 ts 소스를 page.evaluate 안에서 사용하려면 transpile 이
 * 필요하므로, 동일한 wire 프로토콜을 inline JS 로 다시 구현 (포터블).
 * unit test 가 이미 RhwpBridge 의 내부 동작을 mock 으로 검증했고, 이
 * spec 은 wire format 호환만 확인.
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
const FIXTURE = path.resolve(
  __dirname,
  '..',
  '..',
  'examples',
  '2026년도 제조AI특화 스마트공장 구축지원사업 공고.hwp',
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
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
 * 한 서버에서 두 디렉터리를 노출 — rhwp-studio dist 의 자산 +
 * `parent.html` 을 같은 origin 으로 제공. iframe 의 contentWindow
 * 와 parent 가 동일 출처라 postMessage 가 cross-origin 제약 없음.
 *
 * `/` → parent.html (생성된 HTML)
 * `/studio/*` → vendor/rhwp/rhwp-studio/dist 의 정적 자산
 */
function startServer(parentHtml: string): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve_, reject) => {
    const server: Server = createServer((req, res) => {
      try {
        const reqPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
        if (reqPath === '/' || reqPath === '/parent.html') {
          res.statusCode = 200;
          res.setHeader('content-type', 'text/html; charset=utf-8');
          res.end(parentHtml);
          return;
        }
        if (reqPath.startsWith('/studio/')) {
          const rel = reqPath.replace(/^\/studio\/?/, '') || 'index.html';
          const abs = normalize(join(STUDIO_DIST_DIR, rel));
          if (
            relative(STUDIO_DIST_DIR, abs).startsWith('..' + sep) ||
            relative(STUDIO_DIST_DIR, abs) === '..'
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
          return;
        }
        res.statusCode = 404;
        res.end();
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

/**
 * Parent HTML — RhwpBridge 와 동일한 wire 프로토콜을 inline 으로 구현.
 * `window.testBridge` 에 노출해서 Playwright 가 page.evaluate 로 호출.
 *
 * RhwpBridge 의 *내부* 로직 (pending Map, timer, listener registry) 은
 * unit test 가 이미 검증했으니, 본 e2e 는 wire format 호환만 검증한다.
 */
const PARENT_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>RhwpBridge e2e</title></head>
<body>
<iframe id="studio" src="/studio/" style="width:100vw;height:100vh;border:0"></iframe>
<script type="module">
class TestBridge {
  constructor(iframe) {
    this.iframe = iframe;
    this.pending = new Map();
    this.listeners = new Map();
    this.counter = 0;
    window.addEventListener('message', (e) => {
      if (e.source !== iframe.contentWindow) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'rhwp-response') {
        const p = this.pending.get(d.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(d.id);
        if (d.error != null) p.reject(new Error(d.error));
        else p.resolve(d.result);
      } else if (d.type === 'rhwp-event') {
        const s = this.listeners.get(d.name);
        if (s) for (const fn of s) fn(d.data);
      }
    });
  }
  invoke(method, params, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = 'e2e-' + (++this.counter);
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error('timeout: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.iframe.contentWindow.postMessage({ type: 'rhwp-request', id, method, params }, '*');
    });
  }
  invokeWasm(fn, args = [], timeoutMs) {
    return this.invoke('wasm', { fn, args }, timeoutMs);
  }
}
const iframe = document.getElementById('studio');
window.testBridge = null;
iframe.addEventListener('load', () => {
  window.testBridge = new TestBridge(iframe);
});
</script>
</body></html>
`;

test.describe('RhwpBridge e2e — Phase B', () => {
  test.skip(
    !existsSync(join(STUDIO_DIST_DIR, 'index.html')),
    'vendor/rhwp/rhwp-studio/dist missing — run `npm run vendor:rhwp:build`',
  );
  test.skip(!existsSync(FIXTURE), 'examples/2026년도 ... 공고.hwp missing');

  test('RhwpBridge wire format works end-to-end with iframe-hosted studio', async () => {
    const { url, close } = await startServer(PARENT_HTML);
    const browser = await chromium.launch();
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(url);
      // Wait for iframe.load → testBridge attached.
      await page.waitForFunction(
        () =>
          Boolean((window as unknown as { testBridge?: object }).testBridge),
        { timeout: 30_000 },
      );

      // 1) ready
      const ready = await page.evaluate(
        async () =>
          await (
            window as unknown as {
              testBridge: { invoke(m: string): Promise<unknown> };
            }
          ).testBridge.invoke('ready'),
      );
      expect(ready).toBe(true);

      // 2) invokeWasm — getSectionCount (function)
      const sc = await invokeWasm<number>(page, 'getSectionCount');
      // Doc not loaded yet → 0.
      expect(sc).toBe(0);

      // 3) loadFile via named method
      const bytes = readFileSync(FIXTURE);
      const loaded = await page.evaluate(
        async ({ data, name }) =>
          await (
            window as unknown as {
              testBridge: {
                invoke(
                  m: string,
                  p: Record<string, unknown>,
                  t?: number,
                ): Promise<{ pageCount: number }>;
              };
            }
          ).testBridge.invoke(
            'loadFile',
            { data, fileName: name, skipUnsavedGuard: true },
            60_000,
          ),
        { data: Array.from(bytes), name: '2026.hwp' },
      );
      expect(loaded.pageCount).toBeGreaterThan(0);

      // 4) invokeWasm — getSectionCount after load
      const sc2 = await invokeWasm<number>(page, 'getSectionCount');
      expect(sc2).toBeGreaterThan(0);

      // 5) invokeWasm — getter (pageCount). bridge 는 method/getter 동일 처리.
      const pc = await invokeWasm<number>(page, 'pageCount');
      expect(pc).toBeGreaterThan(0);

      // 6) invokeWasm — searchAllText
      const hits = await invokeWasm<unknown[]>(page, 'searchAllText', [
        '사업',
        false,
        false,
      ]);
      expect(Array.isArray(hits)).toBe(true);
      expect(hits.length).toBeGreaterThan(0);

      // 7) Error path — blocked dispose.
      const blocked = await page.evaluate(async () => {
        try {
          await (
            window as unknown as {
              testBridge: { invokeWasm(fn: string): Promise<unknown> };
            }
          ).testBridge.invokeWasm('dispose');
          return { ok: true };
        } catch (e) {
          return { ok: false, msg: (e as Error).message };
        }
      });
      expect(blocked.ok).toBe(false);
      expect(blocked.msg).toMatch(/not exposed/);

      // 8) Error path — non-existent fn.
      const missing = await page.evaluate(async () => {
        try {
          await (
            window as unknown as {
              testBridge: { invokeWasm(fn: string): Promise<unknown> };
            }
          ).testBridge.invokeWasm('definitelyNotARealMethod');
          return { ok: true };
        } catch (e) {
          return { ok: false, msg: (e as Error).message };
        }
      });
      expect(missing.ok).toBe(false);
      expect(missing.msg).toMatch(/not defined/);

      // 9) Concurrent calls don't cross-talk.
      const both = await page.evaluate(async () => {
        const tb = (
          window as unknown as {
            testBridge: {
              invokeWasm(fn: string, args?: unknown[]): Promise<unknown>;
            };
          }
        ).testBridge;
        const [a, b] = await Promise.all([
          tb.invokeWasm('getSectionCount'),
          tb.invokeWasm('pageCount'),
        ]);
        return [a, b];
      });
      expect(both[0]).toBe(sc2);
      expect(both[1]).toBe(pc);
    } finally {
      await ctx.close();
      await browser.close();
      await close();
    }
  });
});

async function invokeWasm<T>(
  page: Page,
  fn: string,
  args: unknown[] = [],
): Promise<T> {
  return (await page.evaluate(
    async ({ fn, args }) =>
      await (
        window as unknown as {
          testBridge: {
            invokeWasm(fn: string, args?: unknown[]): Promise<unknown>;
          };
        }
      ).testBridge.invokeWasm(fn, args),
    { fn, args },
  )) as T;
}

// Hint for the type-checker that `dirname` import is intentional (kept
// alongside its sibling utilities for future test additions).
void dirname;
