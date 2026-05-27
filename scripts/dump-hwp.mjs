#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

async function dump(label, file) {
  const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
  const wasmBytes = await fs.readFile(wasmPath);
  const mod = await import('@rhwp/core');
  await mod.default({ module_or_path: wasmBytes });
  mod.init_panic_hook();
  globalThis.measureTextWidth = (font, text) => text.length * 7;

  const bytes = await fs.readFile(file);
  const doc = new mod.HwpDocument(new Uint8Array(bytes));
  console.log(`\n=== ${label} ===`);
  console.log(`file: ${file}`);
  const secCount = doc.getSectionCount();
  console.log(`sections: ${secCount}`);

  for (let s = 0; s < secCount; s++) {
    const paraCount = doc.getParagraphCount(s);
    console.log(`-- section ${s}: ${paraCount} paragraphs --`);
    for (let p = 0; p < paraCount; p++) {
      const len = doc.getParagraphLength(s, p);
      const text = len > 0 ? doc.getTextRange(s, p, 0, len) : '';
      const trimmed = text.replace(/\s+/g, ' ').slice(0, 200);
      console.log(`  [${p}] (len=${len}) ${trimmed}`);
    }
  }
  doc.free();
}

const file = process.argv[2];
const label = process.argv[3] || file;
await dump(label, file);
