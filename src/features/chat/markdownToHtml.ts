/**
 * 모델이 도구 호출 대신 마크다운으로 응답할 때 fallback 변환 — chunk 99.
 *
 * gpt-5.4-mini 가 한국어 conversational 프롬프트 ("첫 단락 굵게 해줘")
 * 에 도구 호출 대신 markdown 텍스트 ("첫 단락을 **굵게** 처리합니다.")
 * 로 응답하는 경우가 있다. 그 마크다운을 HTML 로 변환해서 기존
 * `applyHtml` 도구 흐름 (사용자 클릭 → 적용) 으로 보낸다.
 *
 * **범위**: 단순 인라인 / 블록 마크다운만 (한 줄 함수). 풀 commonmark
 * 파서 아님. 검출 못하면 null 반환 → "마크다운 적용" 버튼 미노출.
 *
 * **검출 패턴**:
 *  - `**bold**` / `*italic*` / `~~strike~~` / `__under__`
 *  - `# H1` / `## H2` / `### H3` (라인 시작)
 *  - `- item` / `* item` / `1. item` (불릿/번호 리스트)
 *  - `| col | col |` (마크다운 표)
 *
 * "그냥 대화" (코드 / 마크다운 없음) 는 null 반환해서 fallback 미적용.
 */

export interface MarkdownConvertResult {
  html: string;
  /** 어떤 패턴이 매치됐는지 — UI 에 표시 / 디버깅 용도. */
  matchedPatterns: string[];
}

/** Escape minimal HTML special chars in plain text fragments. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Apply inline patterns ( **bold**, *italic*, ~~strike~~, __under__ ).
 *  순서가 중요: ~~ 먼저, ** 다음, * 마지막 (greedy 충돌 회피). */
function applyInline(text: string): string {
  let out = text;
  // ~~strike~~
  out = out.replace(/~~([^~]+)~~/g, (_m, x) => `<s>${esc(x)}</s>`);
  // **bold** — non-greedy.
  out = out.replace(
    /\*\*([^*\n]+)\*\*/g,
    (_m, x) => `<strong>${esc(x)}</strong>`,
  );
  // __under__ — non-greedy.
  out = out.replace(/__([^_\n]+)__/g, (_m, x) => `<u>${esc(x)}</u>`);
  // *italic* — single star, ensure not part of ** (already replaced) and
  // not surrounded by alpha (e.g. multiplication). simple heuristic: only
  // match when preceded by space / start AND followed by content + close.
  out = out.replace(
    /(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g,
    (_m, pre, x) => `${pre}<em>${esc(x)}</em>`,
  );
  // No esc on the rest — inline replacements already escaped their inner
  // content. The non-replaced parts are still raw text needing esc, but
  // we'd double-escape if we applied esc to the whole result. Per-block
  // wrapping handles outer escape.
  return out;
}

/** Detect a markdown table block: 헤더 라인 + delimiter (---|---) + 본문
 *  라인들. Returns parsed rows or null. */
function tryParseTable(
  lines: string[],
  startIdx: number,
): { rows: string[][]; consumed: number } | null {
  const isPipe = (s: string) => s.trim().startsWith('|') || /\|/.test(s);
  if (!isPipe(lines[startIdx] ?? '')) return null;
  const sep = lines[startIdx + 1] ?? '';
  if (!/^\s*\|?[\s|:-]+\|?\s*$/.test(sep)) return null;
  const rows: string[][] = [];
  const splitRow = (s: string): string[] =>
    s
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim());
  rows.push(splitRow(lines[startIdx]));
  let consumed = 2; // header + sep
  for (let i = startIdx + 2; i < lines.length; i++) {
    const ln = lines[i];
    if (!isPipe(ln)) break;
    rows.push(splitRow(ln));
    consumed += 1;
  }
  return rows.length >= 2 ? { rows, consumed } : null;
}

export function markdownToHtml(input: string): MarkdownConvertResult | null {
  const text = input.trim();
  if (text.length === 0) return null;

  const patterns: string[] = [];
  const lines = text.split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];

    // 빈 줄 → 그대로 (단락 분리).
    if (ln.trim().length === 0) {
      i += 1;
      continue;
    }

    // 헤딩.
    const h = /^(#{1,6})\s+(.+)$/.exec(ln);
    if (h) {
      patterns.push('heading');
      const level = h[1].length;
      // 한컴 양식에 맞춰 큰 글자 + 굵게 → applyHtml 가 hancom 으로 round
      // trip 하면 제목 스타일에 가까운 시각 효과. 추후 스타일 매핑 가능.
      const fontSize = Math.max(11, 22 - level * 2);
      out.push(
        `<p style="font-weight:bold;font-size:${fontSize}pt;">${esc(h[2].trim())}</p>`,
      );
      i += 1;
      continue;
    }

    // 표.
    const tab = tryParseTable(lines, i);
    if (tab) {
      patterns.push('table');
      const cells = (row: string[]) =>
        row.map((c) => `<td>${applyInline(c)}</td>`).join('');
      // 첫 줄 헤더로 — th 대신 <td><strong>...</strong></td> (한컴 호환).
      const head = tab.rows[0]
        .map((c) => `<td><strong>${applyInline(c)}</strong></td>`)
        .join('');
      const body = tab.rows
        .slice(1)
        .map((r) => `<tr>${cells(r)}</tr>`)
        .join('');
      out.push(`<table><tr>${head}</tr>${body}</table>`);
      i += tab.consumed;
      continue;
    }

    // 불릿 / 번호 리스트 — 연속 라인 묶어서 한 <ul>/<ol>.
    const bulletRe = /^\s*[-*]\s+(.+)$/;
    const numberRe = /^\s*\d+\.\s+(.+)$/;
    if (bulletRe.test(ln) || numberRe.test(ln)) {
      const ordered = numberRe.test(ln);
      patterns.push(ordered ? 'ordered-list' : 'bullet-list');
      const items: string[] = [];
      const re = ordered ? numberRe : bulletRe;
      while (i < lines.length) {
        const m = re.exec(lines[i]);
        if (!m) break;
        items.push(`<li>${applyInline(m[1].trim())}</li>`);
        i += 1;
      }
      out.push(
        `<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`,
      );
      continue;
    }

    // 그 외 — 인라인 마크다운 적용 후 <p>.
    if (/(\*\*|~~|__|\*[^*\n]+\*)/.test(ln)) {
      patterns.push('inline');
    }
    out.push(`<p>${applyInline(ln)}</p>`);
    i += 1;
  }

  if (patterns.length === 0) return null;
  return { html: out.join(''), matchedPatterns: patterns };
}
