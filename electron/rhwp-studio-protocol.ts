/**
 * `ahwp-studio://` 커스텀 프로토콜 — Phase 7 Phase C.
 *
 * iframe 으로 `vendor/rhwp/rhwp-studio/dist` 를 로드할 때 origin / CSP
 * 처리를 단순하게 만들기 위한 전용 scheme. dev / packaged 양쪽에서
 * 같은 URL 형태 (`ahwp-studio://main/index.html`) 가 작동한다 — 실제
 * 디스크 위치만 다르다.
 *
 * 보안:
 * - 부수 출처에서 fetch 못 함 (file:// 대비 origin 명시적).
 * - secure scheme 으로 등록 → service worker / SubtleCrypto 등 보안
 *   API 사용 가능 (rhwp-studio 의 PWA registerSW 호환).
 * - path traversal 가드 — 응답 직전 normalized path 가 root 안인지 확인.
 *
 * Phase D 의 RhwpEditor 가 `iframe.src = 'ahwp-studio://main/index.html'`
 * 로 마운트하고, CSP 의 `frame-src ahwp-studio:` 가 이 origin 만 허용.
 */
import { app, protocol, net } from 'electron';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** 프로토콜 scheme 이름. CSP / iframe.src 양쪽에서 사용. */
export const RHWP_STUDIO_SCHEME = 'ahwp-studio';

/**
 * 디스크 상의 root. dev 에선 submodule dist, packaged 에선 resourcesPath.
 *
 * - dev (`!app.isPackaged`): `vendor/rhwp/rhwp-studio/dist` (repo 상대).
 *   __dirname 은 `dist-electron/` 이라 한 단계 위로 올라가 repo 루트
 *   기준으로 해석.
 * - packaged: `process.resourcesPath/rhwp-studio` (electron-builder 의
 *   `extraResources` 가 dist 폴더 통째로 동봉).
 */
function studioRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'rhwp-studio');
  }
  return path.resolve(__dirname, '..', 'vendor', 'rhwp', 'rhwp-studio', 'dist');
}

/**
 * `protocol.registerSchemesAsPrivileged` 는 `app.ready` 이전에 호출돼야
 * 한다. main.ts 의 top-level 에서 한 번 호출.
 *
 * privilege 의미:
 * - `standard: true` — URL parsing rules 가 http 와 동일 (host/pathname).
 *   기본은 file-like 라 `ahwp-studio://main/a/b` 의 host=main, path=/a/b 가 안 됨.
 * - `secure: true` — Mixed Content / SubresourceFilter 가 https 로 간주.
 * - `supportFetchAPI: true` — `fetch('ahwp-studio://...')` 가능 (rhwp-studio
 *   가 자기 자산 fetch 하는 케이스 대비).
 * - `corsEnabled: true` — 다른 origin 에서 보내는 fetch 의 CORS preflight 처리.
 * - `stream: true` — 큰 파일 (WASM 4.5 MB) 스트리밍 응답 허용.
 */
export function registerRhwpStudioSchemeAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: RHWP_STUDIO_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

/**
 * 실제 파일 응답을 하는 handler. `app.whenReady` 이후 호출.
 *
 * `ahwp-studio://main/foo/bar.js` →
 *   - host: main (무시 — single bundle)
 *   - pathname: /foo/bar.js
 *   - 디스크: <studioRoot>/foo/bar.js
 */
export function registerRhwpStudioProtocol(): void {
  protocol.handle(RHWP_STUDIO_SCHEME, async (request) => {
    const root = studioRoot();
    if (!existsSync(root)) {
      return new Response(
        `rhwp-studio dist not found at ${root}. ` +
          'Run `npm run vendor:rhwp:build` first.',
        { status: 500, headers: { 'content-type': 'text/plain' } },
      );
    }
    const url = new URL(request.url);
    // pathname 은 항상 /index.html 또는 /assets/* 형태. 빈 path 면 index.
    const rel = (url.pathname || '/').replace(/^\/+/, '') || 'index.html';
    const abs = path.normalize(path.join(root, rel));

    // Path traversal 가드 — normalize 후에도 root 바깥을 가리키면 차단.
    const r = path.relative(root, abs);
    if (r.startsWith('..' + path.sep) || r === '..' || path.isAbsolute(r)) {
      return new Response('Forbidden', { status: 403 });
    }

    if (!existsSync(abs) || statSync(abs).isDirectory()) {
      return new Response('Not Found', { status: 404 });
    }

    // net.fetch 의 file:// 경로 처리 — 큰 wasm 도 스트리밍.
    try {
      const resp = await net.fetch(pathToFileURL(abs).toString());
      // Strip the file:// content-type guesses; we set our own based on ext.
      const headers = new Headers(resp.headers);
      const mime = MIME[path.extname(abs).toLowerCase()];
      if (mime) headers.set('content-type', mime);
      return new Response(resp.body, {
        status: 200,
        headers,
      });
    } catch (err) {
      return new Response(
        `read failed: ${err instanceof Error ? err.message : String(err)}`,
        { status: 500, headers: { 'content-type': 'text/plain' } },
      );
    }
  });
}

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
  '.ico': 'image/x-icon',
};
