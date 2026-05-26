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
 * 의존성 lazy load — pdf-parse / mammoth / exceljs 는 첫 호출 시에만
 * import (Electron startup time 보호). 모든 추출은 main process 만 수행
 * (renderer sandbox 에서 Node API 접근 X).
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
  | 'spreadsheet' // .xlsx / .xls / .csv / .tsv
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
    lower.endsWith('.xls') ||
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
 * 파일 경로에서 텍스트 추출. 확장자 기반 dispatch. 실패하면 throw
 * (호출자가 `try/catch` 로 사용자에게 보여줄 메시지 결정).
 *
 * 5MB 상한 — folder.ts 의 기존 한도와 동일. PDF/Excel 같이 binary 가
 * 큰 포맷은 일찍 reject 해서 메인 프로세스 메모리 보호.
 */
export async function extractText(filePath: string): Promise<ExtractedText> {
  const stat = await fs.stat(filePath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error(
      `file too large: ${stat.size} bytes (max 5MB) — ${path.basename(filePath)}`,
    );
  }
  const family = detectFamily(filePath);
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

/** DOCX — mammoth 의 raw text + heading style 보존. */
async function extractDocx(
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
 * Spreadsheet — .csv / .tsv 는 가벼운 split, .xlsx / .xls 는 exceljs.
 * 시트 / 행 단위로 텍스트화. 시트 이름 = heading candidate.
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
  // .xlsx / .xls — exceljs
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
