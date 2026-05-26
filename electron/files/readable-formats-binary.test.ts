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
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

describe('readable-formats — DOCX (mammoth)', () => {
  it('extracts text + Heading1 from a minimal hand-built docx', async () => {
    const fp = path.join(tmpDir, 'minimal.docx');
    await fs.writeFile(fp, await buildMinimalDocx());
    const r = await extractText(fp);
    expect(r.meta.family).toBe('word');
    expect(r.text).toContain('중간보고서 제목');
    expect(r.text).toContain('사업비 항목 본문');
    // mammoth.convertToHtml 가 Heading1 을 <h1> 으로 변환 → headings 추출.
    expect(r.headings).toContain('중간보고서 제목');
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
});
