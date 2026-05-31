/**
 * Binary-format extraction tests — 0.6.0.
 *
 * 평문 dispatcher 는 `readable-formats.test.ts` 가 커버. 본 spec 은 실제
 * 라이브러리 API surface 가 우리 wrapping 과 정합하는지 검증 — pdf-parse,
 * mammoth, exceljs 의 런타임 behavior 를 actual binary 로 round-trip.
 *
 * 픽스처 생성 전략:
 * - **PDF**: hand-crafted minimal PDF 바이트 (Hello world 1 페이지). 외부
 *   dep 없이 raw bytes 로 충분. ~700 byte.
 * - **DOCX**: `jszip` (mammoth 의 transitive dep) 으로 minimal docx 구성 —
 *   [Content_Types].xml + _rels/.rels + word/document.xml 3 entry zip.
 * - **Excel**: `exceljs.Workbook` 직접 호출 — exceljs 가 자체 writer.
 *
 * 본 spec 가 통과하면: 사용자의 실제 PDF (사업비 실적 보고서 등) /
 * DOCX (중간보고서 등) / xlsx (예산표 등) 추출도 동작 가능. 라이브러리
 * 가정이 맞다는 가장 강한 검증.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractText } from './readable-formats';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwp-binary-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

// ── PDF ────────────────────────────────────────────────────────────────

/**
 * Hand-crafted minimal valid PDF. 1 페이지 + "Hello PDF World" 텍스트.
 * Cross-reference offsets 직접 계산. pdfjs / pdf-parse 가 파싱 가능.
 */
function buildMinimalPdf(): Buffer {
  const objects: string[] = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    '4 0 obj\n<< /Length 51 >>\nstream\nBT /F1 12 Tf 100 700 Td (Hello PDF World) Tj ET\nendstream\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
  ];
  const header = '%PDF-1.4\n%\xff\xff\xff\xff\n';
  let body = header;
  const offsets: number[] = [0]; // index 0 = free entry
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, 'binary');
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i++) {
    xref += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'binary');
}

describe('readable-formats — PDF (pdf-parse@2.4.x)', () => {
  it('extracts text from a minimal hand-crafted PDF', async () => {
    const fp = path.join(tmpDir, 'minimal.pdf');
    await fs.writeFile(fp, buildMinimalPdf());
    const r = await extractText(fp);
    expect(r.meta.family).toBe('pdf');
    expect(r.text).toContain('Hello PDF World');
    expect(r.chunks.length).toBeGreaterThanOrEqual(1);
    // page text → first chunk 에 "Hello PDF World" 포함.
    expect(r.chunks[0]).toContain('Hello PDF World');
  });
});

// ── DOCX ───────────────────────────────────────────────────────────────

interface JSZipModule {
  default: new () => {
    file: (name: string, content: string) => void;
    generateAsync: (opts: { type: 'nodebuffer' }) => Promise<Buffer>;
  };
}

/**
 * Minimal DOCX 구성 — 3 entry zip: [Content_Types].xml / _rels/.rels /
 * word/document.xml. 한 paragraph + 한 heading style.
 */
async function buildMinimalDocx(): Promise<Buffer> {
  const mod = (await import('jszip')) as unknown as JSZipModule;
  const zip = new mod.default();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>중간보고서 제목</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>사업비 항목 본문 문장.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`,
  );
  return await zip.generateAsync({ type: 'nodebuffer' });
}

describe('readable-formats — DOCX (kordoc primary)', () => {
  it('extracts non-empty text + chunks from a minimal hand-built docx', async () => {
    const fp = path.join(tmpDir, 'minimal.docx');
    await fs.writeFile(fp, await buildMinimalDocx());
    const r = await extractText(fp);
    expect(r.meta.family).toBe('word');
    // kordoc 성공 경로 — 본문 보존, fallback 안 함.
    expect(r.text).toContain('중간보고서 제목');
    expect(r.text).toContain('사업비 항목 본문');
    expect(r.chunks.length).toBeGreaterThan(0);
    expect(r.meta.warning).toBeUndefined();
    // 참고: 이 최소 픽스처는 styles.xml 이 없어 Heading1 매핑이 없으므로
    // kordoc 이 heading block 으로 승격하지 않을 수 있다 (text 에는 보존).
    // heading 추출 검증은 styles.xml 이 있는 colspan-table 픽스처에서 한다.
  });
});

/**
 * colspan 헤더가 있는 표 DOCX — kordoc 의 핵심 가치 (표 구조 보존).
 * 첫 행 첫 셀이 2 열 병합 (`<w:gridSpan w:val="2"/>`). mammoth 의 raw text
 * 는 표 격자를 잃지만 kordoc 은 markdown 파이프 표로 보존하고 colspan 헤더를
 * spanned 열에 걸쳐 반복한다 (`| 2025년 상반기 | 2025년 상반기 | 비고 |`).
 */
async function buildDocxWithColspanTable(): Promise<Buffer> {
  const mod = (await import('jszip')) as unknown as JSZipModule;
  const zip = new mod.default();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>예산 집행 내역</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>2025년 상반기</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>비고</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>사업비</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>500</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>중요</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
    <w:p><w:r><w:t>본문 마무리 문장.</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return await zip.generateAsync({ type: 'nodebuffer' });
}

describe('readable-formats — DOCX table structure (kordoc)', () => {
  it('preserves a colspan table structure (better than raw flatten)', async () => {
    const fp = path.join(tmpDir, 'table.docx');
    await fs.writeFile(fp, await buildDocxWithColspanTable());
    const r = await extractText(fp);
    expect(r.meta.family).toBe('word');
    // kordoc 성공 경로 — fallback 안 함.
    expect(r.meta.warning).toBeUndefined();
    // markdown(`text`) 은 표 구조를 보존한다: DOCX colspan 표는 순수 markdown
    // 으로 표현 불가라 HTML `<table>` + colspan 속성으로 나온다 (격자 보존 —
    // mammoth raw 는 표를 평면 텍스트로 무너뜨린다).
    expect(r.text).toContain('<table>');
    expect(r.text).toMatch(/colspan=["']?2/);
    expect(r.text).toContain('2025년 상반기');
    expect(r.text).toContain('사업비');
    expect(r.text).toContain('500');
    // kordoc 발견 (v2.9.0): HTML-table markdown 렌더러는 이 colspan 케이스에서
    // 트레일링 헤더 셀("비고")을 누락한다 (헤더 행이 그리드 폭보다 적은 셀을
    // 선언하고 첫 셀이 colSpan=2 일 때). 하지만 구조화된 blocks[].table.cells
    // 에는 모든 셀이 온전히 들어있다 — 그래서 우리는 chunks 를 markdown 파싱이
    // 아니라 cells 에서 직접 직렬화한다 (markdown 보다 손실이 적은 경로).
    // 따라서 "비고" 완전성은 chunk(=cells) 경로로 검증한다.
    const tableChunk = r.chunks.find(
      (c) => c.includes('사업비') && c.includes('500'),
    );
    expect(tableChunk).toBeDefined();
    expect(tableChunk).toContain('|');
    expect(tableChunk).toContain('비고'); // markdown 이 누락한 셀이 cells 엔 존재
    // 헤더행 = colSpan=2 라 "2025년 상반기" 가 두 열로 펼쳐지고 그 뒤 "비고".
    const headerLine = tableChunk!
      .split('\n')
      .find((line) => line.includes('2025년 상반기'));
    expect(headerLine).toBeDefined();
    expect(
      (headerLine!.match(/2025년 상반기/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
    expect(headerLine).toContain('비고');
    // 데이터행 = 3 열 (사업비 | 500 | 중요).
    const dataLine = tableChunk!
      .split('\n')
      .find((line) => line.includes('사업비'));
    expect(dataLine).toContain('| 사업비 | 500 | 중요 |');
    // 제목 "예산 집행 내역" 은 본문 어딘가에 보존된다 (이 최소 픽스처엔
    // styles.xml 이 없어 Heading1 → outline level 매핑이 없으므로 kordoc 이
    // paragraph 로 본다 — heading 승격은 sheet-name 이 명확한 XLSX 케이스에서
    // 검증). chunk 로는 노출됨.
    expect(r.chunks.some((c) => c.includes('예산 집행 내역'))).toBe(true);
  });
});

// ── Excel ──────────────────────────────────────────────────────────────

describe('readable-formats — xlsx (exceljs)', () => {
  it('extracts sheet name + rows from an exceljs-built workbook', async () => {
    interface ExcelJSMod {
      Workbook: new () => {
        addWorksheet: (name: string) => {
          addRow: (row: unknown[]) => unknown;
        };
        xlsx: { writeFile: (p: string) => Promise<void> };
      };
    }
    const mod = (await import('exceljs')) as unknown as ExcelJSMod;
    const wb = new mod.Workbook();
    const sheet = wb.addWorksheet('예산표');
    sheet.addRow(['항목', '금액', '비고']);
    sheet.addRow(['사업비', 500, '중요']);
    sheet.addRow(['교육비', 200, '']);
    sheet.addRow(['운영비', 300, '일상']);
    const fp = path.join(tmpDir, 'budget.xlsx');
    await wb.xlsx.writeFile(fp);

    const r = await extractText(fp);
    expect(r.meta.family).toBe('spreadsheet');
    // sheet 이름 = heading
    expect(r.headings).toContain('예산표');
    // markdown table 변환 — 시트 본문이 text 에 포함
    expect(r.text).toContain('예산표');
    expect(r.text).toContain('사업비');
    expect(r.text).toContain('500');
    expect(r.text).toContain('교육비');
    expect(r.text).toContain('운영비');
  });

  it('multi-sheet — each sheet name is a heading and rows are present (kordoc)', async () => {
    interface ExcelJSMod {
      Workbook: new () => {
        addWorksheet: (name: string) => {
          addRow: (row: unknown[]) => unknown;
        };
        xlsx: { writeFile: (p: string) => Promise<void> };
      };
    }
    const mod = (await import('exceljs')) as unknown as ExcelJSMod;
    const wb = new mod.Workbook();
    const s1 = wb.addWorksheet('예산표');
    s1.addRow(['항목', '금액', '비고']);
    s1.addRow(['사업비', 500, '중요']);
    const s2 = wb.addWorksheet('집행현황');
    s2.addRow(['월', '집행액']);
    s2.addRow(['1월', 100]);
    const fp = path.join(tmpDir, 'multi.xlsx');
    await wb.xlsx.writeFile(fp);

    const r = await extractText(fp);
    expect(r.meta.family).toBe('spreadsheet');
    // kordoc 성공 경로 — fallback 안 함.
    expect(r.meta.warning).toBeUndefined();
    // 두 시트 이름 모두 heading 으로.
    expect(r.headings).toContain('예산표');
    expect(r.headings).toContain('집행현황');
    // 두 시트의 행 모두 본문에.
    expect(r.text).toContain('사업비');
    expect(r.text).toContain('집행액');
    expect(r.text).toContain('1월');
    // markdown 파이프 표.
    expect(r.text).toContain('|');
  });
});

// ── Fallback path (kordoc → mammoth / exceljs) ───────────────────────────
//
// kordoc 은 churn-heavy (9주 / 44 버전) 라 정확성의 hard dependency 가
// 아니다 — throw 하거나 빈 출력을 내면 기존 mammoth/exceljs 로 fallback.
// 여기선 "유효한 DOCX/XLSX 이지만 kordoc 이 거부할 수 있는" 가짜 케이스 대신,
// kordoc 모듈 자체를 한시적으로 throw 하게 만들어 fallback 분기를 직접 검증한다
// (실파일 surprise = 이 분기. 안전망의 핵심).
describe('readable-formats — kordoc failure falls back with meta.warning', () => {
  it('DOCX — kordoc throws → mammoth fallback returns valid ExtractedText + warning', async () => {
    const fp = path.join(tmpDir, 'fallback.docx');
    await fs.writeFile(fp, await buildMinimalDocx());
    // kordoc 의 dynamic import 를 한시적으로 throw 시켜 fallback 강제.
    vi.doMock('kordoc', () => {
      throw new Error('simulated kordoc import failure');
    });
    vi.resetModules();
    try {
      const { extractText: freshExtract } = await import('./readable-formats');
      const r = await freshExtract(fp);
      expect(r.meta.family).toBe('word');
      // mammoth fallback 이 여전히 유효한 본문 + heading 반환.
      expect(r.text).toContain('중간보고서 제목');
      expect(r.text).toContain('사업비 항목 본문');
      expect(r.headings).toContain('중간보고서 제목');
      // fallback 신호.
      expect(r.meta.warning).toBeDefined();
      expect(r.meta.warning).toMatch(/kordoc.*fallback/);
    } finally {
      vi.doUnmock('kordoc');
      vi.resetModules();
    }
  });

  it('XLSX — kordoc throws → exceljs fallback returns valid ExtractedText + warning', async () => {
    interface ExcelJSMod {
      Workbook: new () => {
        addWorksheet: (name: string) => { addRow: (row: unknown[]) => unknown };
        xlsx: { writeFile: (p: string) => Promise<void> };
      };
    }
    const mod = (await import('exceljs')) as unknown as ExcelJSMod;
    const wb = new mod.Workbook();
    const sheet = wb.addWorksheet('예산표');
    sheet.addRow(['항목', '금액']);
    sheet.addRow(['사업비', 500]);
    const fp = path.join(tmpDir, 'fallback.xlsx');
    await wb.xlsx.writeFile(fp);

    vi.doMock('kordoc', () => {
      throw new Error('simulated kordoc import failure');
    });
    vi.resetModules();
    try {
      const { extractText: freshExtract } = await import('./readable-formats');
      const r = await freshExtract(fp);
      expect(r.meta.family).toBe('spreadsheet');
      // exceljs fallback — 시트 이름 + 행 보존.
      expect(r.headings).toContain('예산표');
      expect(r.text).toContain('사업비');
      expect(r.text).toContain('500');
      expect(r.meta.warning).toBeDefined();
      expect(r.meta.warning).toMatch(/kordoc.*fallback/);
    } finally {
      vi.doUnmock('kordoc');
      vi.resetModules();
    }
  });

  it('DOCX — corrupt OOXML buffer → kordoc throws → mammoth also rejects (clear error path)', async () => {
    // kordoc 의 corrupt-buffer throw 분기를 실제로 친다. 이 파일은 .docx 지만
    // 내용은 zip 이 아니라 kordoc 이 "missing word/document.xml" 로 throw →
    // fallback 진입 → mammoth 도 invalid zip 으로 throw → 최종 throw.
    // (안전망의 worst case = "오늘의 동작" = mammoth 가 던지던 에러 그대로.)
    const fp = path.join(tmpDir, 'corrupt.docx');
    await fs.writeFile(fp, Buffer.from('this is not a real docx zip'));
    await expect(extractText(fp)).rejects.toThrow();
  });
});
