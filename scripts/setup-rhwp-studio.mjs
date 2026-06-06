#!/usr/bin/env node
/**
 * setup-rhwp-studio — vendor/rhwp/pkg/ 에 @rhwp/core WASM artifacts 준비.
 *
 * rhwp-studio 의 빌드 (`vendor/rhwp/rhwp-studio/vite.config.ts`) 는
 * `@wasm/rhwp.js` alias = `vendor/rhwp/pkg/` 를 기대한다. 정식으로는
 * `docker compose run --rm wasm` 으로 Rust → WASM 빌드를 거쳐 pkg/ 가
 * 생성되지만, 우리 fork 단계에선 IR 자체를 수정하지 않으므로 npm 에
 * 게시된 `@rhwp/core` 의 WASM 산출물을 그대로 재사용한다.
 *
 * 사용법:
 *   node scripts/setup-rhwp-studio.mjs    # idempotent — 이미 복사돼있으면 skip
 *
 * Phase A1 (chunk 100+) 의 일부.
 */
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const SRC = join(REPO_ROOT, 'node_modules', '@rhwp', 'core');
const DST = join(REPO_ROOT, 'vendor', 'rhwp', 'pkg');
const FILES = ['rhwp.js', 'rhwp.d.ts', 'rhwp_bg.wasm', 'rhwp_bg.wasm.d.ts'];

if (!existsSync(SRC)) {
  console.error(`[setup-rhwp-studio] source missing: ${SRC}`);
  console.error('  run `npm install` first.');
  process.exit(1);
}
if (!existsSync(join(REPO_ROOT, 'vendor', 'rhwp', '.git'))) {
  console.error('[setup-rhwp-studio] submodule not initialized:');
  console.error('  run `git submodule update --init --recursive`.');
  process.exit(1);
}

mkdirSync(DST, { recursive: true });

let copied = 0;
// Always copy — a size-based skip would silently leave a stale WASM in place if
// a future @rhwp/core release changed file CONTENT without changing byte size
// (causing a version skew between node_modules and the studio build). The files
// are small and this runs once per build, so an unconditional copy is cheap and
// correct.
for (const name of FILES) {
  copyFileSync(join(SRC, name), join(DST, name));
  copied++;
}
console.log(`[setup-rhwp-studio] ${copied} file(s) copied → ${DST}`);
