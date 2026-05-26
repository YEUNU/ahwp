/**
 * `extractText` 의 plain-text dispatcher 테스트 — 0.6.0.
 *
 * PDF / DOCX / Excel 추출은 binary fixture 가 필요해서 vitest 단위에선
 * 다루지 않음 (별도 e2e + manual). 본 spec 은 fs 기반 평문 포맷 (TXT /
 * MD / CSV / TSV / JSON / XML / HTML) 의 dispatch 정확성을 검증.
 *
 * 추출 자체는 deterministic — heading 추출 (MD #, HTML h1-6) + chunk
 * 분할 (\n\n) + meta.family 정확성에 초점.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectFamily, extractText } from './readable-formats';

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwp-readable-'));
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
});

async function writeTemp(name: string, content: string): Promise<string> {
  const full = path.join(tmpDir, name);
  await fs.writeFile(full, content, 'utf-8');
  return full;
}

describe('readable-formats — detectFamily', () => {
  it('maps each extension family correctly', () => {
    expect(detectFamily('a.hwp')).toBe('hwp');
    expect(detectFamily('a.hwpx')).toBe('hwp');
    expect(detectFamily('a.pdf')).toBe('pdf');
    expect(detectFamily('a.docx')).toBe('word');
    expect(detectFamily('a.xlsx')).toBe('spreadsheet');
    expect(detectFamily('a.csv')).toBe('spreadsheet');
    expect(detectFamily('a.tsv')).toBe('spreadsheet');
    expect(detectFamily('a.txt')).toBe('text');
    expect(detectFamily('a.md')).toBe('text');
    expect(detectFamily('a.json')).toBe('data');
    expect(detectFamily('a.xml')).toBe('data');
    expect(detectFamily('a.html')).toBe('data');
    expect(detectFamily('a.unknown')).toBe('unknown');
  });
});

describe('readable-formats — extractText (plain text family)', () => {
  it('TXT — paragraph split on \\n\\n', async () => {
    const fp = await writeTemp(
      'note.txt',
      'first paragraph\nsame para line 2\n\nsecond para\n\nthird para',
    );
    const r = await extractText(fp);
    expect(r.text).toContain('first paragraph');
    expect(r.chunks.length).toBe(3);
    expect(r.chunks[1]).toBe('second para');
    expect(r.meta.family).toBe('text');
    expect(r.meta.bytes).toBeGreaterThan(0);
    expect(r.headings).toEqual([]); // .txt = no heading extraction
  });

  it('MD — extracts # headings', async () => {
    const fp = await writeTemp(
      'doc.md',
      '# Title 1\n\nbody text\n\n## Section 2\n\nmore body\n\n### Detail',
    );
    const r = await extractText(fp);
    expect(r.headings).toEqual(['Title 1', 'Section 2', 'Detail']);
    expect(r.chunks.length).toBeGreaterThanOrEqual(3);
    expect(r.meta.family).toBe('text');
  });

  it('HTML — extracts <h1>..<h6> headings', async () => {
    const fp = await writeTemp(
      'page.html',
      '<h1>Main</h1><p>body</p><h2>Sub</h2><p>more</p><h3 class="x">Deep</h3>',
    );
    const r = await extractText(fp);
    expect(r.headings).toContain('Main');
    expect(r.headings).toContain('Sub');
    expect(r.headings).toContain('Deep');
    expect(r.meta.family).toBe('data');
  });

  it('JSON — single chunk, no heading (data family)', async () => {
    const fp = await writeTemp('config.json', '{"foo": "bar", "n": 42}');
    const r = await extractText(fp);
    expect(r.text).toContain('"foo"');
    expect(r.chunks.length).toBe(1);
    expect(r.meta.family).toBe('data');
    expect(r.headings).toEqual([]);
  });
});

describe('readable-formats — extractText (spreadsheet family — CSV/TSV)', () => {
  it('CSV — markdown table + header heading + chunks per row', async () => {
    const fp = await writeTemp(
      'data.csv',
      'name,value,note\n사업비,500,important\n교육비,200,\n운영비,300,routine',
    );
    const r = await extractText(fp);
    expect(r.meta.family).toBe('spreadsheet');
    expect(r.headings).toEqual(['name', 'value', 'note']);
    // text is markdown table — | header | ... |
    expect(r.text).toContain('| name | value | note |');
    expect(r.text).toContain('| 사업비 | 500 | important |');
    // chunks (excluding header) = 3 data rows
    expect(r.chunks).toHaveLength(3);
  });

  it('TSV — same as CSV but with tab separator', async () => {
    const fp = await writeTemp('data.tsv', 'a\tb\tc\nx\ty\tz');
    const r = await extractText(fp);
    expect(r.headings).toEqual(['a', 'b', 'c']);
    expect(r.text).toContain('| x | y | z |');
  });
});

describe('readable-formats — file size guard', () => {
  it('rejects files > 5MB with explicit error', async () => {
    // 5MB + 1 byte. Use sparse zero buffer.
    const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20);
    const fp = path.join(tmpDir, 'huge.txt');
    await fs.writeFile(fp, huge);
    await expect(extractText(fp)).rejects.toThrow(/too large/);
  });
});

describe('readable-formats — HWP routing', () => {
  it('throws "use existing readParagraphByPath" for .hwp', async () => {
    // Don't actually need a valid HWP — the guard fires before fs read.
    // Create a tiny placeholder so stat succeeds.
    const fp = await writeTemp('fake.hwp', 'x');
    await expect(extractText(fp)).rejects.toThrow(/@rhwp\/core/);
  });
});

describe('readable-formats — unknown extension', () => {
  it('throws "unsupported format" for unknown extension', async () => {
    const fp = await writeTemp('mystery.xyz', 'whatever');
    await expect(extractText(fp)).rejects.toThrow(/unsupported format/);
  });
});
