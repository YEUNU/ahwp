#!/usr/bin/env node
/**
 * Same as render-hwp-pages.mjs but with a Korean-aware measureTextWidth so
 * line-wrapping in the SVG matches the real (Canvas) app far more closely.
 * The flat `text.length*7` heuristic under-measures CJK width → text that
 * should wrap stays on one line and gets clipped, producing false "clipping".
 *
 * Usage: node scripts/render-hwp-pages-cjk.mjs <file.hwp> <pages> <out-dir>
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
  console.error('usage: render-hwp-pages-cjk.mjs <file.hwp> <pages> <out-dir>');
  process.exit(1);
}
await fs.mkdir(outDir, { recursive: true });

const wasmBytes = await fs.readFile(require.resolve('@rhwp/core/rhwp_bg.wasm'));
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();

// Parse px size from the CSS font shorthand; weight CJK ~0.98em, ASCII ~0.52em.
globalThis.measureTextWidth = (font, text) => {
  const m = /(\d+(?:\.\d+)?)px/.exec(font || '');
  const sz = m ? parseFloat(m[1]) : 13;
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    const cjk = c >= 0x1100 && c <= 0xffef && !(c >= 0x2000 && c <= 0x206f);
    w += cjk ? sz * 0.98 : sz * 0.52;
  }
  return w;
};

const bytes = await fs.readFile(file);
const doc = new mod.HwpDocument(new Uint8Array(bytes));
const total = doc.pageCount();
function parsePages(arg) {
  if (arg === 'all') return Array.from({ length: total }, (_, i) => i);
  const out = new Set();
  for (const part of arg.split(',')) {
    const t = part.trim();
    if (t.includes('-')) {
      const [a, b] = t.split('-').map((n) => parseInt(n, 10));
      for (let i = a; i <= b; i++) out.add(i - 1);
    } else out.add(parseInt(t, 10) - 1);
  }
  return [...out].filter((n) => n >= 0 && n < total).sort((a, b) => a - b);
}
const pages = parsePages(pagesArg);
console.log(
  `📄 ${path.basename(file)} pages=${total} → rendering ${pages.map((n) => n + 1).join(',')}`,
);
for (const p of pages) {
  const svg = doc.renderPageSvg(p);
  const resvg = new Resvg(Buffer.from(svg, 'utf-8'), {
    fitTo: { mode: 'width', value: 1400 },
    background: '#ffffff',
    font: { loadSystemFonts: true, defaultFontFamily: 'Apple SD Gothic Neo' },
  });
  const png = resvg.render().asPng();
  const f = path.join(outDir, `page-${String(p + 1).padStart(3, '0')}.png`);
  await fs.writeFile(f, png);
  console.log(
    `  ✓ page ${p + 1} → ${f} (${(png.length / 1024).toFixed(0)} KB)`,
  );
}
doc.free();
console.log('✅ done');
