import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// App version injected at build time so the About pane always shows the
// real package.json version. `app.getVersion()` returns ELECTRON's version
// when the app runs unpackaged (dev / e2e launch — no app bundle manifest),
// so it can't be trusted there. A build-time constant is deterministic in
// dev AND packaged.
const APP_VERSION = (
  JSON.parse(
    readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'),
  ) as { version: string }
).version;

export default defineConfig({
  // chunk 80 — packaged Electron 은 `file://...../dist/index.html` 로
  // 로드되어 absolute root path (`/icon.svg`, `/assets/*.js`) 가
  // `file:///icon.svg` 같은 잘못된 위치로 resolve → 404. relative base
  // 로 vite 가 출력 자산 경로를 `./assets/...` 로 작성하면 file:// 환경
  // 에서도 정상 로드. dev server (vite serve) 는 / 가 항상 server root
  // 라 영향 없음.
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          define: {
            __APP_VERSION__: JSON.stringify(APP_VERSION),
          },
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // @rhwp/core ships a WASM binary alongside its JS — bundling it
              // through Rollup loses the WASM asset. Keep external so Node
              // resolves from node_modules at runtime (electron-builder copies
              // dependencies into the packed app).
              // better-sqlite3 ships native bindings (.node) — must run
              // from node_modules unbundled, same reasoning as @rhwp/core
              // kordoc is ESM-only and dynamically imported (electron/files/
              // readable-formats.ts); its .cjs build contains `import.meta` so
              // bundling/requiring it breaks — keep external so Node resolves
              // the ESM entry from node_modules at runtime, same as @rhwp/core
              external: ['@rhwp/core', 'better-sqlite3', 'kordoc'],
              output: {
                entryFileNames: 'main.js',
              },
            },
          },
        },
      },
      preload: {
        input: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: 'preload.js',
              },
            },
          },
        },
      },
      renderer: {},
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
  // @rhwp/core ESM 패키지는 내부적으로
  // `new URL('rhwp_bg.wasm', import.meta.url)`로 WASM 위치를 잡음.
  // Vite의 esbuild 사전 번들링(optimizeDeps)을 거치면 import.meta.url이
  // 번들된 가상 경로를 가리켜 WASM 파일이 404 → SPA fallback으로
  // index.html이 응답되고 'expected magic word' CompileError가 남.
  // exclude로 사전 번들 자체를 스킵해 node_modules 원본을 직접 서빙.
  optimizeDeps: {
    exclude: ['@rhwp/core'],
  },
});
