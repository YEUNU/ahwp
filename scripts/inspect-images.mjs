#!/usr/bin/env node
/**
 * Render a page from the user's example HWP, dump image-related elements
 * from the resulting SVG, and report counts/sizes/URLs to figure out why
 * images aren't showing in the renderer.
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const SEED = '/Users/yunu/ahwp/examples/4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp';
const PAGES_TO_INSPECT = [0, 1, 2, 3, 4, 5];

async function main() {
  const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
  const wasmBytes = await fs.readFile(wasmPath);
  const mod = await import('@rhwp/core');
  await mod.default({ module_or_path: wasmBytes });
  mod.init_panic_hook();
  globalThis.measureTextWidth = (font, text) => text.length * 7; // rough fallback

  const seed = await fs.readFile(SEED);
  const doc = new mod.HwpDocument(new Uint8Array(seed));
  console.log('total pages:', doc.pageCount());

  for (const p of PAGES_TO_INSPECT) {
    const svg = doc.renderPageSvg(p);
    const imgMatches = [
      ...svg.matchAll(/<image\b[^>]*?(?:href|xlink:href)=["']([^"']+)["'][^>]*>/g),
    ];
    const useMatches = [...svg.matchAll(/<use\b[^>]*>/g)];
    console.log(
      `page ${p}: ${imgMatches.length} <image>, ${useMatches.length} <use>, ${svg.length} chars`,
    );
    imgMatches.forEach((m, i) => {
      const href = m[1];
      const preview =
        href.length > 80 ? href.slice(0, 80) + '... (' + href.length + ' chars)' : href;
      console.log(`  image[${i}]: ${preview}`);
    });
    if (imgMatches.length === 0 && p === 0) {
      // Dump first 500 chars of svg head for diagnostic
      console.log('  svg head:', svg.slice(0, 400));
    }
  }
  doc.free();
}
main().catch((e) => { console.error(e); process.exit(1); });
