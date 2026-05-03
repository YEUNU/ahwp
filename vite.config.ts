import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // @rhwp/core ships a WASM binary alongside its JS — bundling it
              // through Rollup loses the WASM asset. Keep external so Node
              // resolves from node_modules at runtime (electron-builder copies
              // dependencies into the packed app).
              // better-sqlite3 ships native bindings (.node) — must run
              // from node_modules unbundled, same reasoning as @rhwp/core
              external: ['@rhwp/core', 'better-sqlite3'],
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
