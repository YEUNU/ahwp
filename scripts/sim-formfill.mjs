#!/usr/bin/env node
/**
 * Form-fill SIMULATION — drives the same IR write path the AI tools use
 * (insertTextInCell / delete+insert replace / reflowLinesegs) against the
 * real 중간보고서 form, then exports HWP so we can render + visually verify.
 *
 * This is NOT the agent; it's a hand-authored "golden" fill encoding what a
 * correct 이즈파크/다빈치렌스 예지보전 mid-term report should contain, so we
 * can check the mechanics (cell targeting, placeholder replacement, 보고/점검
 * row scoping, reflow visibility) end-to-end.
 *
 * Usage: node scripts/sim-formfill.mjs <form.hwp> <out.hwp>
 */
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const file = process.argv[2];
const out = process.argv[3] ?? '/tmp/filled.hwp';
if (!file) {
  console.error('usage: sim-formfill.mjs <form.hwp> <out.hwp>');
  process.exit(2);
}

const wasmPath = require.resolve('@rhwp/core/rhwp_bg.wasm');
const wasmBytes = await fs.readFile(wasmPath);
const mod = await import('@rhwp/core');
await mod.default({ module_or_path: wasmBytes });
mod.init_panic_hook();
// Korean-aware width so reflowLinesegs wraps lines the way the real Canvas
// app does (flat text.length*7 under-measures CJK → wrong line counts).
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

// --- write helpers (mirror the AI cell tools) -------------------------------
const SEC = 0;
// Non-italic, black char shape — clears the italic/blue placeholder typography
// when we replace example cells so the filled value reads like real data.
const VALUE_SHAPE = JSON.stringify({ italic: false, textColor: '#000000' });

function cellLen(p, ctrl, cell, cellPara = 0) {
  try {
    return doc.getCellParagraphLength(SEC, p, ctrl, cell, cellPara);
  } catch {
    return 0;
  }
}
/** Insert into an empty cell (value-slot). */
function fill(p, ctrl, cell, text) {
  doc.insertTextInCell(SEC, p, ctrl, cell, 0, 0, text);
  applyShape(p, ctrl, cell, text.length);
}
/** Replace a placeholder/example cell: delete existing para text, then insert.
 *  Normalizes the placeholder's italic/colored typography to upright black
 *  while preserving font family/size (full-shape capture → no height collapse). */
function replace(p, ctrl, cell, text) {
  let shape = null;
  try {
    shape = JSON.parse(doc.getCellCharPropertiesAt(SEC, p, ctrl, cell, 0, 0));
  } catch {
    /* ignore */
  }
  const len = cellLen(p, ctrl, cell);
  if (len > 0) doc.deleteTextInCell(SEC, p, ctrl, cell, 0, 0, len);
  doc.insertTextInCell(SEC, p, ctrl, cell, 0, 0, text);
  // Placeholder markers are italic + non-black; normalize to data styling.
  const isPlaceholder =
    shape &&
    (shape.italic === true ||
      (typeof shape.textColor === 'string' &&
        shape.textColor.toLowerCase() !== '#000000'));
  if (NORMALIZE_SHAPE && isPlaceholder) {
    const norm = { ...shape, italic: false, textColor: '#000000' };
    try {
      doc.applyCharFormatInCell(
        SEC,
        p,
        ctrl,
        cell,
        0,
        0,
        text.length,
        JSON.stringify(norm),
      );
    } catch {
      /* best-effort */
    }
  }
  applyShape(p, ctrl, cell, text.length);
}
const NORMALIZE_SHAPE = process.env.SIM_NORMALIZE_SHAPE === '1';
function applyShape(p, ctrl, cell, count) {
  if (!APPLY_SHAPE) return;
  try {
    doc.applyCharFormatInCell(SEC, p, ctrl, cell, 0, 0, count, VALUE_SHAPE);
  } catch {
    /* shape is best-effort */
  }
}
// Partial char-shape (no fontSize) collapses line height → disabled by default.
// The real AI tool passes the label's FULL char shape, preserving size.
const APPLY_SHAPE = process.env.SIM_APPLY_SHAPE === '1';

// ---------------------------------------------------------------------------
// CONTENT MAP — 이즈파크(공급기업) / 다빈치렌스(도입기업) · AI 기반 예지보전
// Korean-government-form conventions encoded explicitly:
//   · fill 보고 rows only, leave 점검 (점검위원 작성) rows empty
//   · replace "(예시)" / italic-placeholder cells, never append
//   · 구축수준 vocabulary: ICT미적용 / 기초 / 중간1 / 중간2 / 고도
//   · leave unknown fields (과제번호 등) blank — no fabrication
// ---------------------------------------------------------------------------

// TABLE #1 — header (p=1)
fill(1, 0, 2, '다빈치렌스'); // 도입기업명 value
fill(1, 0, 4, '이즈파크'); // 공급기업명 value
// cell6 과제번호 · cell8 컨소시엄 참여 공급기업명 → unknown, leave blank

// TABLE #2 — 1.1 구축 목표 (p=10)
replace(
  10,
  0,
  4, // italic instruction placeholder
  '렌즈 제조 핵심설비(사출성형기·연마기·코팅장비)에 진동·전류·온도 센서를 부착하고 AI 예지보전 모델로 고장을 사전 예측하여 비계획 정지와 품질불량을 최소화',
);
fill(10, 0, 5, '기초'); // 기존수준
fill(10, 0, 6, '중간2'); // 목표수준

// TABLE #3 — 1.3 주요 공정별 추진 목표 진행상황 (p=23)
// 성형 row carries the italic example → replace 보고 적용내용 + 진척도
replace(
  23,
  0,
  12,
  'AI 예지보전 시스템 구축 — 사출성형기에 진동·전류 센서 적용, 설비 상태를 실시간 모니터링하고 이상 징후를 자동 탐지·알림',
);
replace(23, 0, 14, '60'); // 성형 보고 진척도 (example "50" → real)
// 점검 row (cell19 "점검" / cell20 "70") → 점검위원 작성, leave example as-is? clear it.
// The 점검 진척도 example "70" belongs to 점검위원 → 수행기업 leaves blank.
const len20 = cellLen(23, 0, 20);
if (len20 > 0) doc.deleteTextInCell(SEC, 23, 0, 20, 0, 0, len20);

// 수발주관리 보고 (cell22 적용내용 / cell24 진척도)
fill(
  23,
  0,
  22,
  '설비 가동률·고장 예측 데이터를 생산계획에 연계하여 납기 준수율 관리',
);
fill(23, 0, 24, '55');
// 원가관리 보고 (cell32 / cell34)
fill(
  23,
  0,
  32,
  '비계획 정지·긴급 수리비 절감 효과를 예지보전 지표로 원가에 반영',
);
fill(23, 0, 34, '50');
// 자재관리 보고 (cell42 / cell44)
fill(
  23,
  0,
  42,
  '부품 잔여수명 예측 기반 예비품 적정 재고 운영 및 자동 발주 연계',
);
fill(23, 0, 44, '45');
// 설계 보고 (cell52 / cell54)
fill(
  23,
  0,
  52,
  '고장 이력·센서 데이터를 설비 개선 및 신규 설비 사양 설계에 피드백',
);
fill(23, 0, 54, '40');
// All 점검 rows (cell30, 40, 50, 60) → leave empty (점검위원 작성)

// TABLE #5 — 1.4 핵심성과지표(KPI) (p=32) — replace 5 "(예시)" rows
const kpi = [
  // [KPI, 단위, 기존, 목표, 가중치, 비고]  (분야 P/Q/C/D/E kept from template)
  [10, '설비 종합효율(OEE)', '%', '75', '85', '0.3', '사출성형 설비'],
  [18, '설비 고장 예측 정확도', '%', '0', '90', '0.2', '진동·전류 모델'],
  [26, '비계획 정지시간', '시간/월', '40', '15', '0.2', '전 설비'],
  [34, '예방정비 리드타임', '일', '5', '2', '0.2', '핵심설비'],
  [42, '설비 돌발고장 건수', '건/월', '8', '2', '0.1', '핵심설비'],
];
for (const [kpiCell, name, unit, base, target, weight, note] of kpi) {
  replace(32, 0, kpiCell, name); // c2 핵심성과지표
  replace(32, 0, kpiCell + 1, unit); // c3 단위
  replace(32, 0, kpiCell + 2, base); // c4 기존
  replace(32, 0, kpiCell + 3, target); // c5 목표
  replace(32, 0, kpiCell + 4, weight); // c6 가중치
  replace(32, 0, kpiCell + 5, note); // c7 비고
}

// --- finalize: reflow line segments so inserted text is visible (0.7.21) ----
try {
  doc.reflowLinesegs();
} catch (e) {
  console.error('reflowLinesegs failed:', e.message);
}

// Render the IN-MEMORY doc directly (no export/reload) — this is the faithful
// live-app path: the editor renders the just-reflowed doc, never round-tripping
// through exportHwp. Set SIM_RENDER_PAGES="1,2,3" to emit PNGs here.
const renderPagesEnv = process.env.SIM_RENDER_PAGES;
if (renderPagesEnv) {
  const { Resvg } = await import('@resvg/resvg-js');
  const outDir = process.env.SIM_RENDER_DIR || '/tmp/sim-live';
  await fs.mkdir(outDir, { recursive: true });
  const total = doc.pageCount();
  const pages = renderPagesEnv
    .split(',')
    .map((n) => parseInt(n.trim(), 10) - 1)
    .filter((n) => n >= 0 && n < total);
  for (const p of pages) {
    const svg = doc.renderPageSvg(p);
    const png = new Resvg(Buffer.from(svg, 'utf-8'), {
      fitTo: { mode: 'width', value: 1400 },
      background: '#ffffff',
      font: { loadSystemFonts: true, defaultFontFamily: 'Apple SD Gothic Neo' },
    })
      .render()
      .asPng();
    const f = `${outDir}/page-${String(p + 1).padStart(3, '0')}.png`;
    await fs.writeFile(f, png);
    console.log(`  🖼  in-memory page ${p + 1} → ${f}`);
  }
}

const exported = doc.exportHwp();
await fs.writeFile(out, Buffer.from(exported));
doc.free();
console.log(
  `✅ filled → ${out} (${(exported.byteLength / 1024 / 1024).toFixed(2)} MB)`,
);
