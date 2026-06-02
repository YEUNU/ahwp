#!/usr/bin/env node
/**
 * Dump every table in an HWP as a (cellIdx, row, col, span, text) grid.
 * Lets us see exactly what cell coordinates a form-fill must target.
 *
 * Usage: node scripts/dump-form-tables.mjs <file.hwp> [maxParaText]
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const file = process.argv[2];
if (!file) {
  console.error('usage: dump-form-tables.mjs <file.hwp>');
  process.exit(2);
}

const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
const wasmBytes = await fs.readFile(wasmPath);
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
globalThis.measureTextWidth = (_font, text) => text.length * 7;

const bytes = await fs.readFile(file);
const doc = new mod.HwpDocument(new Uint8Array(bytes));

const J = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};
const cellText = (s, p, ctrl, c) => {
  try {
    return (doc.getTextInCell(s, p, ctrl, c, 0, 0, 300) || '')
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  }
};

const MAX_CTRLS = 4;
const sectionCount = doc.getSectionCount();
let tableNo = 0;

for (let s = 0; s < sectionCount; s++) {
  const paraCount = doc.getParagraphCount(s);
  for (let p = 0; p < paraCount; p++) {
    for (let ctrl = 0; ctrl < MAX_CTRLS; ctrl++) {
      let dims;
      try {
        dims = J(doc.getTableDimensions(s, p, ctrl));
      } catch {
        continue; // control is not a table
      }
      if (!dims || !dims.cellCount) continue;
      tableNo++;
      const { rowCount, colCount, cellCount } = dims;
      console.log(
        `\n===== TABLE #${tableNo}  s=${s} p=${p} ctrl=${ctrl}  ${rowCount}x${colCount} cells=${cellCount} =====`,
      );
      // Build grid: for each cell, (row,col,rowSpan,colSpan) + text
      const grid = {};
      for (let c = 0; c < cellCount; c++) {
        const info = J(doc.getCellInfo(s, p, ctrl, c)) || {};
        const t = cellText(s, p, ctrl, c);
        const r = info.row ?? '?';
        const col = info.col ?? '?';
        const rs = info.rowSpan ?? 1;
        const cs = info.colSpan ?? 1;
        const span = rs > 1 || cs > 1 ? ` (${rs}x${cs})` : '';
        grid[`${r},${col}`] = { c, t };
        console.log(
          `  cell ${String(c).padStart(3)}  r${r} c${col}${span}  ${t ? '"' + t.slice(0, 60) + '"' : '·(empty)'}`,
        );
      }
    }
  }
}

doc.free();
console.log(`\nTotal tables: ${tableNo}`);
