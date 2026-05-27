#!/usr/bin/env node
/**
 * HWP 파일의 페이지들을 PNG 로 렌더링 — 디버그 / 시각 검증 용.
 *
 * Usage: node scripts/render-hwp-pages.mjs <hwp-file> <pages> <out-dir>
 *   <pages>: "1-5" (1~5쪽) | "1,3,5" (특정 쪽) | "all" (전체) — 1-based
 *
 * @rhwp/core 의 renderPageSvg(pageNum) 로 SVG 받고, @resvg/resvg-js (Rust)
 * 로 래스터화. 결과는 out-dir/page-N.png.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';

const require = createRequire(import.meta.url);

const file = process.argv[2];
const pagesArg = process.argv[3] ?? 'all';
const outDir = process.argv[4] ?? '/tmp/hwp-render';

if (!file) {
  console.error('Usage: render-hwp-pages.mjs <file.hwp> <pages> <out-dir>');
  process.exit(1);
}

await fs.mkdir(outDir, { recursive: true });

// Init WASM
const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
const wasmBytes = await fs.readFile(wasmPath);
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
globalThis.measureTextWidth = (_font, text) => text.length * 7;

// Load HWP
const bytes = await fs.readFile(file);
const doc = new mod.HwpDocument(new Uint8Array(bytes));
const pageCount = doc.pageCount();
console.log(`📄 ${path.basename(file)} — pages=${pageCount}`);

// Parse pages arg
function parsePages(arg, total) {
  if (arg === 'all') return Array.from({ length: total }, (_, i) => i);
  const out = new Set();
  for (const part of arg.split(',')) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map((n) => parseInt(n, 10));
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else {
      out.add(parseInt(trimmed, 10) - 1);
    }
  }
  return [...out].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
}
const pages = parsePages(pagesArg, pageCount);
console.log(`🎯 rendering ${pages.length} page(s): ${pages.map((n) => n + 1).join(', ')}`);

// Render each
for (const pageIdx of pages) {
  let svg;
  try {
    svg = doc.renderPageSvg(pageIdx);
  } catch (e) {
    console.error(`  ✗ page ${pageIdx + 1}: ${e.message}`);
    continue;
  }
  if (typeof svg !== 'string' || svg.length === 0) {
    console.error(`  ✗ page ${pageIdx + 1}: empty SVG`);
    continue;
  }

  // SVG → PNG via @resvg/resvg-js (Rust). Native canvas 와 달리 Node 에서
  // SVG <text> / fill / stroke / path 등을 제대로 rasterize. fit-width 로
  // 1240px 고정 — A4 비율 자동 계산.
  let pngBuf;
  try {
    const resvg = new Resvg(Buffer.from(svg, 'utf-8'), {
      fitTo: { mode: 'width', value: 1240 },
      background: '#ffffff',
      font: {
        // 시스템 폰트 fallback. macOS 의 한글 글꼴 (AppleSDGothicNeo / 함초롬바탕 등)
        // 자동 탐색. fontDirs 추가로 지정 가능.
        loadSystemFonts: true,
        defaultFontFamily: 'Apple SD Gothic Neo',
      },
    });
    const rendered = resvg.render();
    pngBuf = rendered.asPng();
    var renderedW = rendered.width;
    var renderedH = rendered.height;
  } catch (e) {
    console.error(`  ✗ page ${pageIdx + 1} resvg: ${e.message}`);
    continue;
  }
  const outFile = path.join(outDir, `page-${String(pageIdx + 1).padStart(3, '0')}.png`);
  await fs.writeFile(outFile, pngBuf);
  console.log(`  ✓ page ${pageIdx + 1} → ${outFile} (${(pngBuf.length / 1024).toFixed(1)} KB, ${renderedW}×${renderedH})`);
}

doc.free();
console.log('✅ done');
