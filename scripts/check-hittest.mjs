#!/usr/bin/env node
// Inspect hitTest / getCaretPosition return shapes
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
console.log('getCaretPosition() →', doc.getCaretPosition());
console.log('hitTest(0, 100, 100) →', doc.hitTest(0, 100, 100));
console.log('hitTest(0, 50, 50) →', doc.hitTest(0, 50, 50));
console.log('hitTest(0, 200, 300) →', doc.hitTest(0, 200, 300));
console.log('hitTest(0, 1000, 1000) →', doc.hitTest(0, 1000, 1000));

console.log('--- caret advance after insertText ---');
console.log('before:', doc.getCaretPosition());
doc.insertText(0, 0, 0, 'AB');
console.log('after insert(0,0,0,"AB"):', doc.getCaretPosition());
doc.insertText(0, 0, 2, 'CD');
console.log('after insert(0,0,2,"CD"):', doc.getCaretPosition());
doc.deleteText(0, 0, 0, 1);
console.log('after delete(0,0,0,1):', doc.getCaretPosition());
doc.free();
