#!/usr/bin/env node
/**
 * One-shot builder for tests/e2e/fixtures/blank.hwpx.
 *
 * Approach:
 *   1. Read any HWP/HWPX seed (we use the user's local example).
 *   2. Construct HwpDocument(seedBytes) — @rhwp/core 0.7.x requires bytes
 *      input; there's no zero-arg factory.
 *   3. Call createBlankDocument() to reset the IR to an empty document.
 *   4. exportHwpx() — yields a small valid HWPX (~few KB).
 *
 * Run once locally, commit the output. Re-run only if the seed format /
 * @rhwp/core changes meaningfully.
 *
 * Usage:
 *   node scripts/build-fixture.mjs [seedPath]
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const DEFAULT_SEED = path.join(
  repoRoot,
  'examples',
  '4. [사업계획서] 제조AI특화 스마트공장 사업계획서_양식_260326_01_데이터수집검증 중복화.hwp',
);
const OUT = path.join(repoRoot, 'tests', 'e2e', 'fixtures', 'blank.hwpx');

async function main() {
  const seedPath = process.argv[2] || DEFAULT_SEED;
  console.log(`[fixture] seed: ${seedPath}`);
  const seedBytes = await fs.readFile(seedPath);

  const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
  const wasmBytes = await fs.readFile(wasmPath);
  const mod = await import('@rhwp/core');
  await mod.default({ module_or_path: wasmBytes });
  mod.init_panic_hook();
  console.log(`[fixture] @rhwp/core v${mod.version()} initialized`);

  const doc = new mod.HwpDocument(new Uint8Array(seedBytes));
  try {
    const result = doc.createBlankDocument();
    console.log(`[fixture] createBlankDocument result: ${result}`);
    const out = doc.exportHwpx();
    await fs.mkdir(path.dirname(OUT), { recursive: true });
    await fs.writeFile(OUT, out);
    console.log(
      `[fixture] wrote ${OUT} (${(out.byteLength / 1024).toFixed(1)} KB)`,
    );
  } finally {
    doc.free();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
