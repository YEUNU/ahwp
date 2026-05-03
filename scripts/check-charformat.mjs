#!/usr/bin/env node
// Probe applyCharFormat / getStyleList / getStyleAt / getStyleDetail.
// Goal: discover the props_json schema and surface what's available.
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const SEED = '/Users/yunu/ahwp/tests/e2e/fixtures/blank.hwpx';

const wasmBytes = await fs.readFile(require.resolve('@rhwp/core/rhwp_bg.wasm'));
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
globalThis.measureTextWidth = (f, t) => t.length * 7;

const doc = new mod.HwpDocument(new Uint8Array(await fs.readFile(SEED)));

console.log('--- getStyleList() ---');
const styles = JSON.parse(doc.getStyleList());
console.log(JSON.stringify(styles, null, 2));

console.log('--- getStyleAt(0,0) ---');
console.log(doc.getStyleAt(0, 0));

if (Array.isArray(styles) && styles.length > 0) {
  for (const s of styles.slice(0, 3)) {
    const id = s.id ?? s.styleId ?? s.style_id ?? 0;
    console.log(`--- getStyleDetail(${id}) ---`);
    try {
      console.log(doc.getStyleDetail(id));
    } catch (e) {
      console.log('error:', e.message);
    }
  }
}

// Insert some text so we have a range to format
doc.insertText(0, 0, 0, 'HELLO WORLD');
console.log('caret after insert:', doc.getCaretPosition());

console.log('--- applyCharFormat probes ---');
const tries = [
  { bold: true },
  { italic: true },
  { underline: true },
  { fontSize: 20 },
  { Bold: true },
  { boldFlag: 1 },
  { isBold: true },
  { fontFace: '맑은 고딕' },
  { textColor: '#FF0000' },
  { color: 0xff0000 },
  { fontFamily: '맑은 고딕' },
  { face: '맑은 고딕' },
  { size: 20 },
  { height: 2000 },
];
for (const props of tries) {
  try {
    const r = doc.applyCharFormat(0, 0, 0, 5, JSON.stringify(props));
    console.log('OK', JSON.stringify(props), '→', r.slice(0, 200));
  } catch (e) {
    console.log('ERR', JSON.stringify(props), '→', String(e).slice(0, 200));
  }
}

// Verify the SVG actually changes when bold is applied
const doc2 = new mod.HwpDocument(new Uint8Array(await fs.readFile(SEED)));
doc2.insertText(0, 0, 0, 'HELLO WORLD');
const before = doc2.renderPageSvg(0);
doc2.applyCharFormat(0, 0, 0, 11, JSON.stringify({ bold: true, fontSize: 2000 }));
const after = doc2.renderPageSvg(0);
console.log('--- SVG change ---');
console.log('byteLen before:', before.length, 'after:', after.length);
console.log('changed?', before !== after);
// Look for tspan font-weight attribute
const m = after.match(/font-weight[^"]*"[^"]+"/g);
console.log('font-weight attrs in after:', m?.slice(0, 3));
const f = after.match(/font-size[^"]*"[^"]+"/g);
console.log('font-size attrs in after:', f?.slice(0, 3));

// Re-export and reload, verify formatting persists
const exported = doc2.exportHwp();
const reloaded = new mod.HwpDocument(new Uint8Array(exported));
const reSvg = reloaded.renderPageSvg(0);
console.log('roundtrip preserves bold?', /font-weight[^"]*"(bold|700)"/.test(reSvg));

doc.free();
doc2.free();
reloaded.free();
