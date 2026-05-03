#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const SEED =
  '/Users/yunu/ahwp/examples/4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp';

const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
const wasmBytes = await fs.readFile(wasmPath);
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
globalThis.measureTextWidth = (f, t) => t.length * 7;

const doc = new mod.HwpDocument(new Uint8Array(await fs.readFile(SEED)));
const svg = doc.renderPageSvg(1);
// Extract first <image> tag with full attributes (truncate href value)
const m = svg.match(/<image\b[^>]*>/);
if (m) {
  const trunc = m[0].replace(
    /(href|xlink:href)=["']([^"']+)["']/,
    (_full, attr, val) => `${attr}="${val.slice(0, 60)}…"`,
  );
  console.log('first image tag (attrs only):');
  console.log(trunc);
}
// Also: count image tags in pages 0-9 quickly + scan for any non-data href
let totalImages = 0;
let nonDataHrefs = 0;
const pageCount = doc.pageCount();
for (let p = 0; p < Math.min(pageCount, 10); p++) {
  const s = doc.renderPageSvg(p);
  const matches = s.matchAll(
    /<image\b[^>]*?(href|xlink:href)=["']([^"']+)["']/g,
  );
  for (const x of matches) {
    totalImages += 1;
    if (!x[2].startsWith('data:')) nonDataHrefs += 1;
  }
}
console.log(`pages 0-9: ${totalImages} images, ${nonDataHrefs} non-data hrefs`);
doc.free();
