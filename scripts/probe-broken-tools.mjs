#!/usr/bin/env node
// Demonstrate each silent-failure bug against the real template HWP.
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const file = process.argv[2];
if (!file) { console.error('usage: probe-broken-tools.mjs <file>'); process.exit(2); }

const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
const wasmBytes = await fs.readFile(wasmPath);
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
globalThis.measureTextWidth = (font, text) => text.length * 7;
const bytes = await fs.readFile(file);
const doc = new mod.HwpDocument(new Uint8Array(bytes));

console.log('FILE:', file, '\n');

// ── BUG #3: getStyleListJson does not exist ──────────────
console.log('--- BUG #3: getStyleListJson (phantom name) ---');
console.log('  doc.getStyleListJson exists?', typeof doc.getStyleListJson);
console.log('  doc.getStyleList exists?    ', typeof doc.getStyleList);
const styles = JSON.parse(doc.getStyleList());
console.log(`  CORRECT getStyleList: ${styles.length} styles, first 3:`, styles.slice(0,3).map(s => `${s.id}=${s.name}`).join(', '));
const headingStyles = styles.filter(s => /제목|개요|Heading/i.test(s.name ?? '') || /heading/i.test(s.englishName ?? ''));
console.log(`  heading-like styles: ${headingStyles.length} → ${headingStyles.map(s=>`${s.id}=${s.name}`).join(', ')}`);

// ── BUG #4: getDocumentOutline reads styleId from ParaProperties (doesn't exist) ──
console.log('\n--- BUG #4: getDocumentOutline path ---');
const sample = JSON.parse(doc.getParaPropertiesAt(0, 5));
console.log('  ParaProperties keys at (0,5):', Object.keys(sample).join(', '));
console.log('  ParaProperties.styleId (what helper reads):     ', sample.styleId, '← always undefined');
console.log('  ParaProperties.paraShapeId (what actually exists):', sample.paraShapeId);
const styleAt = JSON.parse(doc.getStyleAt(0, 5));
console.log('  getStyleAt(0,5) returns the actual styleId:', styleAt);

// ── BUG #1: insertFootnote arity ───────────────
console.log('\n--- BUG #1: insertFootnote arity ---');
console.log('  insertFootnote.length =', doc.insertFootnote.length, '(takes 3 args, helper passes 4 — text dropped)');

// ── BUG #2: setHeaderFooterText doesn't exist ───
console.log('\n--- BUG #2: setHeaderFooterText (phantom) ---');
console.log('  doc.setHeaderFooterText exists?     ', typeof doc.setHeaderFooterText);
console.log('  doc.insertTextInHeaderFooter exists?', typeof doc.insertTextInHeaderFooter);
console.log('  doc.deleteTextInHeaderFooter exists?', typeof doc.deleteTextInHeaderFooter);

// ── BUG #5: findInDocument shape mismatch ──────
console.log('\n--- BUG #5: findInDocument shape (helper vs viewer) ---');
const hitsRaw = doc.searchAllText('도입기업명', false, true);
const hits = JSON.parse(hitsRaw);
console.log('  raw searchAllText hit[0]:', JSON.stringify(hits[0]));
console.log('  helper passes this through unchanged → AI gets {sec, para, charOffset, length, ...}');
console.log('  viewer.irFindInDocument contract says {sectionIdx, paragraphIdx, charOffset}');
console.log('  AI chain "insertText({sectionIdx: hit.sectionIdx, ...})" sees undefined');

// ── BUG #6: applyHtmlAtCaret false-success ─────
console.log('\n--- BUG #6: pasteHtml return is a string, helper treats !object as success ---');
console.log('  pasteHtml expected return type:', 'string (per rhwp.d.ts)');
console.log('  helper branch typeof r === "object" never matches → always returns true');

doc.free();
