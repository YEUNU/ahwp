/**
 * outline-aware section replace 매칭 — chunk 99 의 markdown fallback 이
 * 기존 섹션 옆에 중복으로 붙는 문제 fix.
 *
 * 모델이 "### 2.7.4 데이터 유효성 검증 방안" 같은 heading 으로 시작하는
 * markdown 을 응답하면, viewer outline 에서 같은 section 번호 ("2.7.4")
 * 를 찾아 그 섹션 영역 (해당 heading paragraph ~ 다음 동등/상위 heading
 * 직전) 을 delete-and-replace 한다.
 *
 * 이 모듈은 순수 로직 — viewer outline 과 HTML 문자열만 받아 매칭 결과를
 * 반환. 실제 IR mutation 은 StudioViewer 의 applyHtmlReplaceSection 이.
 */

export interface OutlineEntry {
  paragraphIndex: number;
  level: number;
  text: string;
}

export interface SectionMatch {
  /** 매치된 outline 의 paragraph index (heading 문단). */
  startParaIdx: number;
  /** 섹션 끝 (exclusive) — 다음 동등/상위 heading 의 paragraph index, 또는
   *  outline 끝까지면 last entry 의 paragraphIndex + 1 (호출 측에서 doc
   *  paragraph count 로 cap). */
  endParaIdxExclusive: number;
  /** 매치된 섹션 번호 ("2.7.4"). */
  sectionNumber: string;
  /** 매치된 outline 의 텍스트 (그대로). */
  headingText: string;
  /** 매치된 outline 의 level. */
  level: number;
}

/** 텍스트 첫 부분에서 "X.Y.Z" 형태의 섹션 번호 추출. 허용 패턴:
 *  "2.7.4" / "2.7.4." / "(2.7.4)" / "3." (chapter with trailing dot).
 *  단일 숫자 + 공백 ("2 데이터") 은 ambiguous 라 reject.
 *  추출된 번호에서 trailing dot 은 제거 — "2.7.4." / "2.7.4" 모두 "2.7.4"
 *  로 정규화해서 양쪽 비교 일관성 보장.
 *  Returns null 이면 매칭 시도 안 함 (자유 텍스트 heading). */
export function extractSectionNumber(text: string): string | null {
  const trimmed = text.trim();
  // 선두 괄호 / 마커 제거.
  const cleaned = trimmed.replace(/^[([【「]\s*/, '');
  // 매칭: 숫자(.숫자)+ (multi-level) 또는 숫자. (chapter with trailing dot).
  const m = cleaned.match(/^(\d+(?:\.\d+)+\.?|\d+\.)/);
  if (!m) return null;
  return m[1].replace(/\.$/, '');
}

/** HTML 문자열의 첫 heading 의 텍스트 + level 추출. 매칭 우선순위:
 *   1. `<h1>~<h6>` 직접 (표준 HTML).
 *   2. `<p style="font-weight:bold;font-size:Npt;...">...</p>` —
 *      markdownToHtml 이 `# H1` ~ `### H3` 를 변환하는 한컴 호환 형식.
 *      font-size 에서 markdownToHtml 의 공식 (`max(11, 22 - level*2)`)
 *      을 역산해 level 복원: 11→6, 13→5, 15→4, 17→3, 19→2, 21→1.
 *   3. `<p><strong>...</strong></p>` — 일반 굵은 첫 단락 fallback.
 *  매칭 못하면 null. */
export function extractFirstHeading(
  html: string,
): { text: string; level: number } | null {
  const headingMatch = html.match(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/i);
  if (headingMatch) {
    const tag = headingMatch[1].toLowerCase();
    const level = parseInt(tag.charAt(1), 10);
    const text = stripTags(headingMatch[2]).trim();
    if (text) return { text, level };
  }
  // markdownToHtml 의 한컴 호환 형식 — 첫 <p> 의 inline style 에
  // font-weight:bold 가 있으면 heading 으로 간주. font-size 에서 level 역산.
  const styledP = html.match(
    /<p\s+style\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/p>/i,
  );
  if (styledP) {
    const styleAttr = styledP[1].toLowerCase();
    if (/font-weight\s*:\s*bold/.test(styleAttr)) {
      const fontSizeMatch = styleAttr.match(/font-size\s*:\s*(\d+)\s*pt/);
      let level = 2; // 기본 fallback.
      if (fontSizeMatch) {
        const fontSize = parseInt(fontSizeMatch[1], 10);
        // markdownToHtml: fontSize = max(11, 22 - level*2) → level = (22 - fontSize) / 2.
        const guessed = Math.round((22 - fontSize) / 2);
        if (guessed >= 1 && guessed <= 6) level = guessed;
      }
      const text = stripTags(styledP[2]).trim();
      if (text) return { text, level };
    }
  }
  // 일반 <p><strong>...</strong></p> fallback.
  const strongMatch = html.match(/<p[^>]*><strong>([\s\S]*?)<\/strong><\/p>/i);
  if (strongMatch) {
    const text = stripTags(strongMatch[1]).trim();
    if (text) return { text, level: 2 };
  }
  return null;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * outline 안에서 html 첫 heading 의 섹션 번호와 일치하는 항목을 찾고
 * 섹션 끝 (다음 동등/상위 heading 의 paragraph index) 을 계산.
 *
 * 매칭 실패 (heading 없음 / 섹션 번호 없음 / outline 에 같은 번호 없음)
 * 면 null — 호출 측은 기존 paste-at-caret 흐름으로 fallback.
 *
 * 매칭은 **섹션 번호 prefix 동일** 만 본다. heading 의 한글 본문이 outline
 * 과 정확히 같지 않아도 (e.g. AI 가 "2.7.4 데이터 유효성" / outline 이
 * "2.7.4 데이터 유효성 검증 방안") 매치 — 사용자가 의도한 게 같은 번호
 * 의 섹션이라는 가정이 합리적.
 */
export function findSectionToReplace(
  outline: readonly OutlineEntry[],
  html: string,
  /** outline 끝 다음의 paragraph 위치. doc.getParagraphCount(SECTION) 를
   *  넘기면 마지막 섹션이 doc 끝까지 차지하도록 cap. */
  paragraphCountCap?: number,
): SectionMatch | null {
  const heading = extractFirstHeading(html);
  if (!heading) return null;
  const num = extractSectionNumber(heading.text);
  if (!num) return null;

  // outline 에서 같은 prefix 항목 검색.
  const matchedIdx = outline.findIndex((entry) => {
    const entryNum = extractSectionNumber(entry.text);
    return entryNum === num;
  });
  if (matchedIdx < 0) return null;

  const matched = outline[matchedIdx];
  // 섹션 끝: 같은/상위 level 의 다음 heading 직전. 못 찾으면 outline 끝.
  let endParaIdxExclusive: number | null = null;
  for (let i = matchedIdx + 1; i < outline.length; i++) {
    if (outline[i].level <= matched.level) {
      endParaIdxExclusive = outline[i].paragraphIndex;
      break;
    }
  }
  if (endParaIdxExclusive == null) {
    // outline 끝까지면 doc paragraph count 로 cap.
    endParaIdxExclusive =
      paragraphCountCap != null && paragraphCountCap > matched.paragraphIndex
        ? paragraphCountCap
        : matched.paragraphIndex + 1;
  }

  return {
    startParaIdx: matched.paragraphIndex,
    endParaIdxExclusive,
    sectionNumber: num,
    headingText: matched.text,
    level: matched.level,
  };
}
