#!/usr/bin/env node
// Mirror the NEW BridgeIrHelper.getEmptyFormFields() against a real file.
// Uses @rhwp/core directly (no iframe) — handles the JSON-string returns
// the same way the helper does after the fix.
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const file = process.argv[2];
if (!file) { console.error('usage: probe-form-fields.mjs <file>'); process.exit(2); }

const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
const wasmBytes = await fs.readFile(wasmPath);
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
globalThis.measureTextWidth = (font, text) => text.length * 7;

const bytes = await fs.readFile(file);
const doc = new mod.HwpDocument(new Uint8Array(bytes));

const MAX_FIELDS = 100;
const MAX_CTRLS_PER_PARA = 4;
const LABEL_MAX = 100;

const parseDims = (raw) => {
  if (!raw) return null;
  let obj;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { return null; } }
  else obj = raw;
  if (!obj || obj.ok === false) return null;
  const cellCount = obj.cellCount ?? 0;
  if (cellCount === 0) return null;
  return { rowCount: obj.rowCount ?? 0, colCount: obj.colCount ?? 0, cellCount };
};

const fetchLabel = (s, p, ctrl, c) => {
  try {
    const t = doc.getTextInCell(s, p, ctrl, c, 0, 0, 200);
    const trimmed = t.replace(/\s+/g, ' ').trim();
    if (!trimmed) return null;
    return { text: trimmed.slice(0, LABEL_MAX), cellIdx: c };
  } catch { return null; }
};

const cellFields = [];
let truncated = false;
const sectionCount = doc.getSectionCount();

outer: for (let s = 0; s < sectionCount; s++) {
  const paraCount = doc.getParagraphCount(s);
  for (let p = 0; p < paraCount; p++) {
    for (let ctrl = 0; ctrl < MAX_CTRLS_PER_PARA; ctrl++) {
      let raw;
      try { raw = doc.getTableDimensions(s, p, ctrl); } catch { continue; }
      const dims = parseDims(raw);
      if (!dims) continue;
      const { colCount, cellCount } = dims;
      for (let c = 0; c < cellCount; c++) {
        if (cellFields.length >= MAX_FIELDS) { truncated = true; break outer; }
        let txt = '';
        try { txt = doc.getTextInCell(s, p, ctrl, c, 0, 0, 1024); } catch { continue; }
        const isEmpty = txt === '' || /^[\s_]*$/.test(txt) || /placeholder|<.*>/i.test(txt);
        if (!isEmpty) continue;

        let label = null;
        if (colCount > 0 && c % colCount > 0) label = fetchLabel(s, p, ctrl, c - 1);
        if (!label && colCount > 0 && c >= colCount) label = fetchLabel(s, p, ctrl, c - colCount);

        let labelCharShape;
        if (label) {
          try {
            const shapeRaw = doc.getCellCharPropertiesAt(s, p, ctrl, label.cellIdx, 0, 0);
            let shape;
            if (typeof shapeRaw === 'string') { try { shape = JSON.parse(shapeRaw); } catch {} }
            else if (shapeRaw && typeof shapeRaw === 'object') shape = shapeRaw;
            if (shape && shape.ok !== false) labelCharShape = shape;
          } catch {}
        }

        cellFields.push({
          location: { sectionIndex: s, paragraphIndex: p, controlIndex: ctrl, cellIndex: c, cellParagraphIndex: 0 },
          labelHint: label?.text ?? '',
          labelCharShape,
          currentText: txt,
        });
      }
    }
  }
}

console.log('FILE:', file);
console.log('SECTIONS:', sectionCount);
console.log('returned cellFields:', cellFields.length, ' truncated:', truncated);
console.log('with labelHint:    ', cellFields.filter(f => f.labelHint).length);
console.log('with labelCharShape:', cellFields.filter(f => f.labelCharShape).length);
console.log('');
console.log('First 15 fields (what the AI would see):');
cellFields.slice(0, 15).forEach((f, i) => {
  const loc = `s=${f.location.sectionIndex} p=${f.location.paragraphIndex} ctrl=${f.location.controlIndex} cell=${f.location.cellIndex}`;
  const shape = f.labelCharShape ? `shape={${Object.keys(f.labelCharShape).slice(0,3).join(',')},...}` : 'shape=null';
  console.log(`  [${i}] ${loc}  label="${f.labelHint}"  ${shape}`);
});

doc.free();
