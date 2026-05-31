/**
 * Readable-format infrastructure — 0.6.0 chunk.
 *
 * ahwp 는 본래 .hwp/.hwpx 만 enumerate / read 했음 (`folder:list` /
 * `folder:list-outlines` / `folder:read-paragraph-by-path` 의 4 곳 필터).
 * 사용자가 한 워크스페이스에 PDF / DOCX / 노트 등을 섞어두고 AI 에게
 * "두 문서 비교해줘" 를 요청하는 자연스러운 흐름이 막혀 있었음.
 *
 * 이 모듈은:
 *
 * 1) **단일 source of truth** for 어떤 확장자를 (a) 트리에 노출하고
 *    (b) 편집 가능한지 (c) AI tool 이 텍스트로 추출 가능한지.
 * 2) **텍스트 추출 디스패처** `extractText(path)` — 확장자 → 적절한
 *    extractor. PDF (`pdf-parse`), DOCX (`mammoth`), Excel (`exceljs`),
 *    CSV / JSON / XML / HTML / TXT / MD 는 fs.readFile + 가벼운 변환.
 *
 * 편집은 여전히 .hwp / .hwpx 만 (rhwp-studio 의 한계 — 다른 포맷은 IR
 * 변형 불가). 다른 포맷은 **read-only context source** 로만 활용.
 *
 * UX 계약:
 * - 트리 좌측: readable 전부 노출 (편집 가능 여부와 무관).
 * - 클릭: editable 면 탭 mount, else `shell.openPath` 위임 (OS 기본 앱).
 * - AI workspace tools: readable 전부 enumerate / extract.
 *
 * 의존성 lazy load — kordoc / pdf-parse / mammoth / exceljs 는 첫 호출 시에만
 * import (Electron startup time 보호). 모든 추출은 main process 만 수행
 * (renderer sandbox 에서 Node API 접근 X).
 *
 * **DOCX / XLSX 는 kordoc 우선, mammoth / exceljs fallback** (0.7.17):
 * kordoc (exact-pin 2.9.0) 은 표/colspan/병합셀 구조를 마크다운 파이프 표로
 * 보존 — mammoth/exceljs 의 평면화보다 AI 컨텍스트 품질이 높다. 단 kordoc 은
 * 9 주 된 churn-heavy 라이브러리라 **정확성의 hard dependency 로 두지 않는다**:
 * kordoc 이 throw 하거나 빈/degenerate 출력을 내면 기존 mammoth/exceljs 경로로
 * fallback (console.warn + meta.warning). worst case 가 "오늘의 동작" 이라
 * 실파일 검증 게이트를 아직 못 돌리는 상황에서 안전망이 된다. PDF 는 kordoc
 * 경로에서 제외 (spike 결과 합성 PDF 에 빈 blocks 반환) — extractPdf 는
 * pdf-parse 유지. .xls (legacy BIFF8) 도 의도적 미지원 유지 (0.7.16).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Re-export shared predicates for backward compat — folder.ts 가 본 모듈에서
// isReadable 을 import 하던 기존 패턴 유지. 정의 자체는 shared/.
export {
  EDITABLE_EXTENSIONS,
  READABLE_EXTENSIONS,
  isEditable,
  isReadable,
} from '../../shared/file-formats';

/** Format family — UI 가 아이콘 / 라벨 선택할 때 활용. */
export type FormatFamily =
  | 'hwp' // .hwp / .hwpx — native, editable
  | 'pdf'
  | 'word' // .docx
  | 'spreadsheet' // .xlsx / .csv / .tsv (.xls 미지원 — file-formats.ts 주석 참조)
  | 'text' // .txt / .md / .markdown
  | 'data' // .json / .xml / .html / .htm
  | 'unknown';

export function detectFamily(name: string): FormatFamily {
  const lower = name.toLowerCase();
  if (lower.endsWith('.hwp') || lower.endsWith('.hwpx')) return 'hwp';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.docx')) return 'word';
  if (
    lower.endsWith('.xlsx') ||
    lower.endsWith('.csv') ||
    lower.endsWith('.tsv')
  )
    return 'spreadsheet';
  if (
    lower.endsWith('.txt') ||
    lower.endsWith('.md') ||
    lower.endsWith('.markdown')
  )
    return 'text';
  if (
    lower.endsWith('.json') ||
    lower.endsWith('.xml') ||
    lower.endsWith('.html') ||
    lower.endsWith('.htm')
  )
    return 'data';
  return 'unknown';
}

/**
 * 추출 결과 — 단일 평문 + (선택) 큰 문서를 단락 단위로 자른 chunks.
 * `searchWorkspaceOutlines` 가 outline 표시할 때 chunks 의 처음 N개를
 * paragraph-like 로 노출. `readParagraphByPath` 는 본문 전체를 반환.
 *
 * 모든 텍스트는 UTF-8 string. PDF/DOCX 의 시각 요소 (이미지/도형) 는
 * 무시 — 텍스트 only.
 */
export interface ExtractedText {
  /** 본문 전체 — 줄바꿈 보존, 페이지/시트 구분은 `\n\n--- <label> ---\n\n`. */
  text: string;
  /**
   * Paragraph-like chunks (PDF=페이지, DOCX/Excel=섹션/시트, TXT/MD=실제
   * paragraph). outline 표시용. 빈 배열이면 단일 평문으로 취급.
   */
  chunks: string[];
  /** Heading-like 강조 candidates — 짧고 다른 형식적 신호 (Markdown #, DOCX heading style 등). UI 의 outline 표시용. */
  headings: string[];
  /** Best-effort 추출 메타. 디버깅 / 사용자 메시지 용도. */
  meta: {
    family: FormatFamily;
    bytes: number;
    /** 추출 실패 / 부분 실패 사유. 성공이면 undefined. */
    warning?: string;
  };
}

/**
 * Per-family size cap. PDF / Excel 보고서는 보통 평문보다 크므로 차등.
 * 모두 main process 메모리 보호용 — 너무 큰 파일은 일찍 reject.
 */
const SIZE_CAPS: Record<FormatFamily, number> = {
  hwp: 5 * 1024 * 1024, // 5 MB — 기존 정책 유지
  pdf: 30 * 1024 * 1024, // 30 MB — 보고서급 PDF 도 커버
  word: 15 * 1024 * 1024, // 15 MB — 임베디드 이미지 포함 .docx 도 OK
  spreadsheet: 15 * 1024 * 1024, // 15 MB — 큰 .xlsx 도 OK
  text: 5 * 1024 * 1024, // 5 MB — 평문은 충분
  data: 5 * 1024 * 1024,
  unknown: 1 * 1024 * 1024,
};

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

// ── kordoc adapter (DOCX / XLSX quality upgrade behind a fallback) ────────
//
// kordoc 은 ESM-only (`"type": "module"`) 이고 .cjs 빌드가 `import.meta` 를
// 포함해 `require('kordoc')` 가 깨진다 → @rhwp/core 와 동일하게 dynamic
// `import('kordoc')` 사용 (vite.config.ts 에서 external 처리).
//
// API surface (node_modules/kordoc/dist/index.d.ts, v2.9.0 spike 로 확인):
// - parseDocx / parseXlsx(ArrayBuffer) → `ParseResult` = discriminated union.
//   성공: `{success:true, markdown, blocks: IRBlock[], metadata, ...}`.
//   실패: `{success:false, error, code}` — **kordoc 은 잘못된 입력에 throw 하지
//   않고 success:false 를 반환**한다. 그래서 어댑터는 success 를 체크해 false 면
//   fallback 을 트리거하고, 동시에 try/catch 로 감싸 throw 케이스도 커버한다.
// - 표는 `block.table.cells` (2D IRCell[][], 각 셀에 colSpan/rowSpan) 에 구조로
//   담긴다. markdown 의 표 표현은 포맷마다 다르다: DOCX 의 colspan 표는 순수
//   markdown 으로 표현 불가라 HTML `<table>` 로, XLSX 는 파이프 표(`| a | b |`)로
//   나온다. 따라서 chunks 는 markdown 파싱이 아니라 `cells` 에서 직접 직렬화한다
//   (colSpan 만큼 셀 텍스트를 반복해 열 정렬을 보존 — 다운스트림이 일관된 파이프
//   표를 본다).

/** kordoc IRCell — 병합 정보 포함 (index.d.ts IRCell). */
interface KordocCell {
  text: string;
  colSpan: number;
  rowSpan: number;
}
/** kordoc IRTable — cells 는 2D 배열 (index.d.ts IRTable). */
interface KordocTable {
  rows: number;
  cols: number;
  cells: KordocCell[][];
  hasHeader?: boolean;
}
/** kordoc IRBlock 의 우리가 쓰는 부분 (index.d.ts IRBlock). */
interface KordocBlock {
  type: 'paragraph' | 'table' | 'heading' | 'list' | 'image' | 'separator';
  text?: string;
  level?: number;
  table?: KordocTable;
}
/** kordoc ParseResult — discriminated union (index.d.ts ParseResult). */
type KordocParseResult =
  | {
      success: true;
      markdown: string;
      blocks?: KordocBlock[];
      metadata?: Record<string, unknown>;
    }
  | { success: false; error: string; code?: string };
interface KordocModule {
  parseDocx: (buffer: ArrayBuffer) => Promise<KordocParseResult>;
  parseXlsx: (buffer: ArrayBuffer) => Promise<KordocParseResult>;
}

let kordocPromise: Promise<KordocModule> | null = null;
async function loadKordoc(): Promise<KordocModule> {
  // Dynamic import — bypasses the CJS `require` ESM restriction (same pattern
  // as electron/hwp/converter.ts loadRhwpCore). Cached after first load.
  kordocPromise ??= import('kordoc') as unknown as Promise<KordocModule>;
  return kordocPromise;
}

/** Node Buffer → 정확한 슬라이스의 ArrayBuffer (kordoc parse 입력). */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  // 새 Uint8Array 로 복사 후 그 .buffer 를 반환 — Node Buffer 의 .buffer 는
  // 풀(pool) 공유라 slice 직접 사용 시 타입이 ArrayBuffer|SharedArrayBuffer 로
  // 넓어진다. 복사본의 buffer 는 정확히 ArrayBuffer.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return copy.buffer;
}

/**
 * kordoc table block → 파이프 표 문자열. colSpan 만큼 셀 텍스트를 반복해
 * 격자/열 정렬을 보존 (병합 헤더가 spanned 열에 걸쳐 반복됨).
 */
function kordocTableToPipes(table: KordocTable): string {
  return table.cells
    .map((row) => {
      const flat: string[] = [];
      for (const cell of row) {
        const span = Math.max(1, cell.colSpan || 1);
        for (let i = 0; i < span; i++) flat.push((cell.text ?? '').trim());
      }
      return '| ' + flat.join(' | ') + ' |';
    })
    .join('\n');
}

/** kordoc 단일 block → chunk 문자열. table 은 파이프 표로 직렬화. */
function kordocBlockToChunk(block: KordocBlock): string {
  if (block.type === 'table' && block.table && block.table.cells.length > 0) {
    return kordocTableToPipes(block.table);
  }
  return (block.text ?? '').trim();
}

/**
 * kordoc success 결과 → 우리 `ExtractedText`.
 *
 * - markdown → `text` (DOCX colspan 표는 HTML `<table>`, XLSX 는 파이프 표 —
 *   둘 다 표 구조를 보존. 평면화 X).
 * - heading-type block → `headings` (텍스트만, level 무시).
 * - block list → `chunks` (table 은 `cells` 에서 파이프 직렬화, 그 외는 text).
 *
 * `meta.family` 는 호출자가 넘긴 그대로. `warning` 은 fallback 시에만 set.
 */
function kordocToExtractedText(
  parsed: Extract<KordocParseResult, { success: true }>,
  meta: ExtractedText['meta'],
): ExtractedText {
  const text = (parsed.markdown ?? '').trim();
  const blocks = parsed.blocks ?? [];
  const headings = blocks
    .filter((b) => b.type === 'heading' && (b.text ?? '').trim().length > 0)
    .map((b) => (b.text ?? '').trim())
    .slice(0, 50);
  const chunks = blocks
    .map(kordocBlockToChunk)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 200);
  return { text, chunks, headings, meta };
}

/**
 * kordoc 출력이 비었거나 degenerate (텍스트 없음) 인지 판정. true 면 fallback.
 * "텍스트가 전혀 없다" 만 degenerate 로 본다 (markdown 도 비고 chunk 도 없음).
 */
function isDegenerateKordocResult(r: ExtractedText): boolean {
  return r.text.length === 0 && r.chunks.length === 0;
}

/**
 * 파일 경로에서 텍스트 추출. 확장자 기반 dispatch. 실패하면 throw
 * (호출자가 `try/catch` 로 사용자에게 보여줄 메시지 결정).
 *
 * Per-family size cap — PDF 30MB / DOCX 15MB / Excel 15MB / 평문 5MB.
 * 보고서급 PDF 도 받아주면서 메모리 보호.
 */
export async function extractText(filePath: string): Promise<ExtractedText> {
  const stat = await fs.stat(filePath);
  const family = detectFamily(filePath);
  const cap = SIZE_CAPS[family];
  if (stat.size > cap) {
    throw new Error(
      `file too large: ${formatMb(stat.size)} (max ${formatMb(cap)} for ${family}) — ${path.basename(filePath)}`,
    );
  }
  const meta = { family, bytes: stat.size } as ExtractedText['meta'];

  switch (family) {
    case 'pdf':
      return await extractPdf(filePath, meta);
    case 'word':
      return await extractDocx(filePath, meta);
    case 'spreadsheet':
      return await extractSpreadsheet(filePath, meta);
    case 'text':
      return await extractPlainText(filePath, meta);
    case 'data':
      return await extractPlainText(filePath, meta); // JSON/XML/HTML 도 일단 평문
    case 'hwp':
      throw new Error(
        'hwp/hwpx is handled by @rhwp/core path — use existing readParagraphByPath',
      );
    default:
      throw new Error(`unsupported format: ${path.basename(filePath)}`);
  }
}

/** PDF — pdf-parse v2 의 PDFParse class. 페이지별 text + 합쳐진 전체. */
async function extractPdf(
  filePath: string,
  meta: ExtractedText['meta'],
): Promise<ExtractedText> {
  // pdf-parse@2.4.x — class-based API. dynamic import 로 startup cost 회피.
  interface PageTextResult {
    text: string;
  }
  interface TextResult {
    text: string;
    pages: PageTextResult[];
  }
  interface PDFParseCtor {
    new (opts: { data: Uint8Array }): {
      getText(): Promise<TextResult>;
      destroy(): Promise<void>;
    };
  }
  const mod = (await import('pdf-parse')) as unknown as {
    PDFParse: PDFParseCtor;
  };
  const buf = await fs.readFile(filePath);
  const parser = new mod.PDFParse({ data: new Uint8Array(buf) });
  let text: string;
  let pageTexts: string[];
  try {
    const result = await parser.getText();
    text = result.text.trim();
    pageTexts = result.pages
      .map((p) => p.text.trim())
      .filter((p) => p.length > 0);
  } finally {
    await parser.destroy().catch(() => undefined);
  }
  // chunks = 페이지 (정확) ; 페이지가 너무 크면 paragraph 로 추가 분할.
  const chunks: string[] = [];
  for (const pageText of pageTexts) {
    if (pageText.length <= 800) {
      chunks.push(pageText);
    } else {
      const paras = pageText
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      chunks.push(...paras);
    }
    if (chunks.length >= 200) break;
  }
  // heading candidate — 짧고 (<= 60 chars) 마침표로 안 끝나는 것.
  const headings = chunks
    .filter((p) => p.length <= 60 && !/[.。]$/.test(p))
    .slice(0, 30);
  return {
    text,
    chunks,
    headings,
    meta,
  };
}

/**
 * DOCX — kordoc 우선 (표/colspan 보존), 실패 시 mammoth fallback.
 *
 * try { kordoc } catch { mammoth } — kordoc 이 throw 하거나 빈 출력을 내면
 * console.warn + meta.warning 후 mammoth 경로로. 정확성의 안전망.
 */
async function extractDocx(
  filePath: string,
  meta: ExtractedText['meta'],
): Promise<ExtractedText> {
  try {
    const { parseDocx } = await loadKordoc();
    const buf = await fs.readFile(filePath);
    const parsed = await parseDocx(toArrayBuffer(buf));
    if (!parsed.success) {
      throw new Error(`kordoc parseDocx failed: ${parsed.error}`);
    }
    const result = kordocToExtractedText(parsed, meta);
    if (isDegenerateKordocResult(result)) {
      throw new Error('kordoc returned empty/degenerate output (no text)');
    }
    return result;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(
      `[readable-formats] DOCX kordoc path failed (${reason}) — falling back to mammoth: ${path.basename(filePath)}`,
    );
    const fallback = await extractDocxMammoth(filePath, meta);
    fallback.meta.warning = `kordoc 추출 실패 → mammoth fallback (${reason})`;
    return fallback;
  }
}

/** DOCX (fallback) — mammoth 의 raw text + heading style 보존. */
async function extractDocxMammoth(
  filePath: string,
  meta: ExtractedText['meta'],
): Promise<ExtractedText> {
  const mammoth = (await import('mammoth')) as unknown as {
    extractRawText: (opts: {
      path: string;
    }) => Promise<{ value: string; messages: unknown[] }>;
    convertToHtml: (opts: {
      path: string;
    }) => Promise<{ value: string; messages: unknown[] }>;
  };
  const raw = await mammoth.extractRawText({ path: filePath });
  const text = raw.value.trim();
  // HTML 추출도 한 번 더 시도해서 heading style (`<h1>..<h6>`) 보존.
  // 실패해도 raw 만으로 fallback.
  let headings: string[] = [];
  try {
    const html = await mammoth.convertToHtml({ path: filePath });
    headings = Array.from(
      html.value.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi),
    )
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      .filter((s) => s.length > 0)
      .slice(0, 50);
  } catch {
    // ignore — raw text 만 사용
  }
  const paras = text
    .split(/\n{1,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 200);
  return { text, chunks: paras, headings, meta };
}

/**
 * Spreadsheet 디스패처.
 *
 * - .csv / .tsv → 가벼운 split (kordoc 은 OOXML 전용이라 해당 없음).
 * - .xlsx → kordoc 우선 (시트별 표 구조 + 병합셀 보존), 실패 시 exceljs fallback.
 * - .xls (legacy BIFF8) → 미지원 (명확한 throw).
 */
async function extractSpreadsheet(
  filePath: string,
  meta: ExtractedText['meta'],
): Promise<ExtractedText> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    const sep = lower.endsWith('.tsv') ? '\t' : ',';
    const raw = await fs.readFile(filePath, 'utf-8');
    const lines = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // 첫 줄 = header → heading candidate.
    const headings = lines.length > 0 ? lines[0].split(sep) : [];
    // markdown table 로 AI 친화 변환 — header + 처음 50 row 까지.
    const limited = lines.slice(0, 51);
    const text = limited
      .map((line) => '| ' + line.split(sep).join(' | ') + ' |')
      .join('\n');
    return {
      text,
      chunks: limited.slice(1, 51),
      headings,
      meta,
    };
  }
  // .xls (legacy BIFF8) 은 여기 닿으면 안 됨: detectFamily 가 .xls 를
  // spreadsheet 로 분류하지 않으므로 extractText 가 먼저 "unsupported format"
  // 으로 throw 한다. 직접 호출 등으로 우회된 경우 대비해 명확한 에러로 차단 —
  // exceljs/kordoc 에 넘기면 "not a zip" 같은 모호한 에러가 나서 디버깅이 어렵다.
  if (lower.endsWith('.xls')) {
    throw new Error(
      '.xls (legacy BIFF8) is not supported — the extractor reads OOXML .xlsx only. Convert to .xlsx.',
    );
  }
  // .xlsx — kordoc 우선 (시트별 표 + 병합셀 보존), 실패 시 exceljs fallback.
  try {
    const { parseXlsx } = await loadKordoc();
    const buf = await fs.readFile(filePath);
    const parsed = await parseXlsx(toArrayBuffer(buf));
    if (!parsed.success) {
      throw new Error(`kordoc parseXlsx failed: ${parsed.error}`);
    }
    const result = kordocToExtractedText(parsed, meta);
    if (isDegenerateKordocResult(result)) {
      throw new Error('kordoc returned empty/degenerate output (no text)');
    }
    return result;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.warn(
      `[readable-formats] XLSX kordoc path failed (${reason}) — falling back to exceljs: ${path.basename(filePath)}`,
    );
    const fallback = await extractSpreadsheetExcelJS(filePath, meta);
    fallback.meta.warning = `kordoc 추출 실패 → exceljs fallback (${reason})`;
    return fallback;
  }
}

/**
 * XLSX (fallback) — exceljs (OOXML 전용). 시트 / 행 단위로 텍스트화.
 * 시트 이름 = heading candidate.
 */
async function extractSpreadsheetExcelJS(
  filePath: string,
  meta: ExtractedText['meta'],
): Promise<ExtractedText> {
  const ExcelJSMod = (await import('exceljs')) as unknown as {
    Workbook: new () => {
      xlsx: { readFile: (p: string) => Promise<unknown> };
      eachSheet: (cb: (sheet: SheetLike, id: number) => void) => void;
    };
  };
  interface SheetLike {
    name: string;
    rowCount: number;
    eachRow: (cb: (row: RowLike, n: number) => void) => void;
  }
  interface RowLike {
    values: unknown[];
  }
  const workbook = new ExcelJSMod.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheetTexts: string[] = [];
  const headings: string[] = [];
  workbook.eachSheet((sheet) => {
    headings.push(sheet.name);
    const rows: string[] = [`### ${sheet.name}`];
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[])
        .slice(1) // exceljs index 0 은 항상 undefined
        .map((c) => (c == null ? '' : String(c).trim()));
      rows.push('| ' + cells.join(' | ') + ' |');
    });
    sheetTexts.push(rows.join('\n'));
  });
  const text = sheetTexts.join('\n\n');
  return {
    text,
    chunks: sheetTexts,
    headings,
    meta,
  };
}

/** TXT / MD / JSON / XML / HTML — 그냥 utf-8 평문 + 가벼운 heading 추출. */
async function extractPlainText(
  filePath: string,
  meta: ExtractedText['meta'],
): Promise<ExtractedText> {
  const text = (await fs.readFile(filePath, 'utf-8')).trim();
  const paras = text
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 200);
  let headings: string[] = [];
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    // Markdown # / ## / ### 헤더 캐치.
    headings = Array.from(text.matchAll(/^#{1,6}\s+(.+)$/gm))
      .map((m) => m[1].trim())
      .slice(0, 50);
  } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    headings = Array.from(text.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi))
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
      .filter((s) => s.length > 0)
      .slice(0, 50);
  }
  return { text, chunks: paras, headings, meta };
}
