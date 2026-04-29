#!/usr/bin/env node
/**
 * Pinpoint where images disappear in the pipeline:
 *   user.hwp → ensureHwpxBytes → HwpDocument → renderPageSvg
 *
 * Replicates exactly what main process + renderer do, in Node.
 */
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

// Renderer-style measureTextWidth — node-canvas would be ideal but we don't
// want a native dep. The point is: this differs from a real Canvas.
globalThis.measureTextWidth = (font, text) => text.length * 7;

const hwp = new Uint8Array(await fs.readFile(SEED));
console.log(`[1] HWP size: ${(hwp.byteLength / 1024 / 1024).toFixed(2)} MB`);

// Stage A: HWP → direct render (no exportHwpx round-trip)
console.log('\n--- A: directly load HWP, count <image> in SVGs ---');
const docA = new mod.HwpDocument(hwp);
const totalA = docA.pageCount();
let imgsA = 0;
for (let p = 0; p < totalA; p++) {
  imgsA += (docA.renderPageSvg(p).match(/<image\b/g) ?? []).length;
}
console.log(`  pages: ${totalA}, total <image>: ${imgsA}`);

// Stage B: HWP → exportHwpx → load → render (mimics our pipeline)
console.log('\n--- B: HWP → exportHwpx round-trip → render ---');
const hwpxBytes = docA.exportHwpx();
console.log(`  HWPX size: ${(hwpxBytes.byteLength / 1024 / 1024).toFixed(2)} MB`);
docA.free();

const docB = new mod.HwpDocument(hwpxBytes);
const totalB = docB.pageCount();
let imgsB = 0;
for (let p = 0; p < totalB; p++) {
  imgsB += (docB.renderPageSvg(p).match(/<image\b/g) ?? []).length;
}
console.log(`  pages: ${totalB}, total <image>: ${imgsB}`);
docB.free();

// Stage C: also dump the HWPX zip member listing to see if image binaries
// are present (BinData/ in HWPX)
console.log('\n--- C: HWPX zip member list ---');
const decoder = new TextDecoder();
const sig = decoder.decode(hwpxBytes.slice(0, 4));
console.log(`  zip magic (PK..): ${[...hwpxBytes.slice(0, 4)].map((b) => b.toString(16)).join(' ')}`);

// Quick zip walk: scan central directory entries
// Local file header: PK\x03\x04 (50 4b 03 04) — file name follows after offset 30 (variable)
// We just count occurrences and grep "BinData"
const text = new TextDecoder('latin1').decode(hwpxBytes);
const binDataMatches = [...text.matchAll(/BinData\/[^\x00\r\n]{1,80}/g)];
console.log(`  BinData/* references: ${binDataMatches.length}`);
binDataMatches.slice(0, 5).forEach((m) => console.log(`    ${m[0]}`));

console.log('\n--- summary ---');
console.log(`  A (HWP direct):    ${imgsA} <image> across ${totalA} pages`);
console.log(`  B (round-trip):    ${imgsB} <image> across ${totalB} pages`);
console.log(`  C (BinData refs):  ${binDataMatches.length}`);
