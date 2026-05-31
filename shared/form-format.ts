/**
 * Form-fill cell content format — 0.7.12.
 *
 * 0.7.6 까지의 문제: 모델이 `cellIdx` 만 보고 텍스트를 채워 컬럼 의미를
 * 무시. e.g. "도입여부 (O/X)" 컬럼에 "예지보전 솔루션" 같은 텍스트가
 * 박힘. cellIdx 는 모델에게 의미 없는 정수라 어느 컬럼·행인지 추론 불가.
 *
 * 해결: `getEmptyFormFields` 가 각 빈 셀에 대해 columnHeader (그 컬럼의
 * 헤더 셀 텍스트) + rowLabel (그 행의 첫 칸 텍스트) + expectedFormat
 * (헤더 텍스트 휴리스틱) 을 같이 반환. `insertTextInCell` /
 * `replaceTextInCell` 가 호출 시 text 가 expectedFormat 을 만족하는지
 * tool-level 에서 reject.
 *
 * **보수적 분류 원칙**: heuristic 이 확신할 때만 marker/number/currency
 * /date 로 분류하고, 그 외는 `text` (permissive). 잘못된 enforcement
 * (false positive) 보다 안전한 default.
 *
 * **system prompt 와의 분리**: 이 휴리스틱은 _tool 결과 데이터_ 에 들어
 * 가는 추론이지 LLM-facing prompt 가 아니다. CLAUDE.md 의 "No heuristic
 * prompts" 규칙 (system prompt 에 keyword enumeration 금지) 과 충돌하지
 * 않는다 — prompt 는 "expectedFormat 을 받으면 그 포맷에 맞게 쓰라" 정도
 * 의 원칙만 담는다.
 */

export type ExpectedFormat =
  /** O / X 같은 단일 char marker. "도입여부 (O/X)" 등. */
  | 'marker'
  /** 숫자 (단위/포맷 무관). 수량, 개수, %, 회수 등. */
  | 'number'
  /** 통화. "추정금액(백만원)", 비용, 예산 등. */
  | 'currency'
  /** 날짜. 일자, 날짜, 년월일 등. */
  | 'date'
  /** 자유 텍스트 (default). 검증 안 함. */
  | 'text';

export const VALID_EXPECTED_FORMATS: ReadonlySet<ExpectedFormat> =
  new Set<ExpectedFormat>(['marker', 'number', 'currency', 'date', 'text']);

/**
 * 0.7.16 — 라벨 텍스트 정규화. 표 헤더 / 행 라벨 셀의 raw 텍스트에서 의미
 * 없는 꼬리 기호를 제거해 labelHint / rowLabel / columnHeader 품질을 높임.
 * (모델이 읽는 _데이터_ 정규화이지 LLM-facing prompt 가 아님 — form-format
 * 모듈 docstring 의 prompt 분리 원칙 참조.)
 *
 * 차용: kordoc (MIT) https://github.com/chrisryugj/kordoc
 *   - src/form/recognize.ts `isLabelCell` — 각주 위첨자 strip
 *     (예: "등록기준지²" → "등록기준지")
 *   - src/form/recognize.ts `extractFromTable` — 꼬리 콜론 strip
 *     (예: "성명:" → "성명")
 *
 * 보수적: 꼬리(끝)에 붙은 것만 제거 — 문장 중간 콜론/기호는 보존.
 */
// 위첨자 글리프를 리터럴로 enumerate 하면 복붙/인코딩에 취약 (¹²³ 는
// Latin-1 U+00B9/B2/B3, ⁰⁴⁻⁹ 는 별도 블록 U+2070-2079 라 코드포인트가
// 흩어져 있음). 명시적 \u escape 로 모호성 제거.
const FOOTNOTE_SUFFIX_RE = /[¹²³⁰-⁹*※]+$/;
const TRAILING_COLON_RE = /\s*[:：]\s*$/;

export function normalizeLabelText(raw: string): string {
  // 꼬리 기호는 콜론 → 위첨자 순서가 섞여 나올 수 있어 ("금액¹:" 처럼
  // 콜론이 더 바깥) 한 번의 단방향 strip 으론 안쪽 기호를 놓친다. 더 이상
  // 줄지 않을 때까지 (콜론 / 위첨자 / 공백) 반복 제거 — 어떤 순서든 수렴.
  let s = raw.replace(/\s+/g, ' ').trim();
  for (;;) {
    const next = s
      .replace(TRAILING_COLON_RE, '')
      .replace(FOOTNOTE_SUFFIX_RE, '')
      .trim();
    if (next === s) return next;
    s = next;
  }
}

/**
 * 0.7.16 — 체크박스 / 마커 글리프 집합. 한국 공공 양식의 "□ 해당 ☐ 비해당"
 * 류 체크박스 셀을 marker 로 인식하기 위함. ahwp 기존 marker 감지는 명시적
 * "(O/X)" 표기만 봤어서 박스 글리프를 놓쳤다.
 *
 * 차용: kordoc (MIT) src/form/match.ts `fillInCellPatterns` 의 체크박스
 * 글리프 처리. (kordoc 의 truthy 치환 로직은 caller 가 값을 주는 fillForm
 * 용이라 N/A — 글리프 _집합_ 만 차용.)
 */
export const CHECKBOX_GLYPH_RE = /[□☐☑■✔✅]/;

/**
 * Column header (+ optional row label) 텍스트로부터 expectedFormat 추론.
 *
 * 우선순위: marker > date > currency > number > text. 한 헤더가 여러
 * 패턴에 매칭되면 가장 strict 한 쪽 (marker) 우선.
 *
 * Row label 은 보조 신호 — column header 가 ambiguous 한 경우에 한해
 * 함께 검사 (e.g. row="기간" 인데 column 이 비어있을 때).
 */
export function inferExpectedFormat(
  columnHeader: string,
  rowLabel?: string,
): ExpectedFormat {
  const ch = columnHeader ?? '';
  const rl = rowLabel ?? '';

  // marker: 명시적 (O/X) / (O,X) / (○/X) / O/X 표기, 또는 헤더에 체크박스
  // 글리프 (□ ☐ ☑ ...). 단순 "여부" / "유무" 만으로는 marker 단정 안 함.
  if (
    /\(\s*[Oo○●]\s*[/,]\s*[Xx✗]\s*\)/.test(ch) ||
    /\(\s*[Xx✗]\s*[/,]\s*[Oo○●]\s*\)/.test(ch) ||
    /\b[Oo]\s*\/\s*[Xx]\b/.test(ch) ||
    CHECKBOX_GLYPH_RE.test(ch) // 0.7.16 — 체크박스 글리프 헤더 (kordoc 차용)
  )
    return 'marker';

  // date: 일자 / 날짜 / 년월일 키워드.
  if (/일자|날짜|년월일|연월일/.test(ch) || /일자|날짜/.test(rl)) return 'date';

  // currency: 금액 / 단가 / 비용 / 예산 / 원 단위 표기.
  if (/금액|단가|비용|예산|백만원|만원|매출|매입|총액|소계/.test(ch))
    return 'currency';

  // number: 수량 / 개수 / 건수 / %. 단순 "수" 는 너무 광범위 → 제외.
  if (/수량|개수|건수|회수|횟수|회차|비율|점수|%|건\b/.test(ch))
    return 'number';

  return 'text';
}

/**
 * Text 가 expectedFormat 을 만족하는지 검증.
 *
 * 빈 문자열 / 공백-only 은 항상 통과 (clear / 초기화 허용).
 *
 * - marker: 1-2 chars + marker char (O/X/○/●/✓/✗/V/√/ㅇ/ㅁ/-/공백) 만
 * - number: 숫자 / 구분자 / 부호 / % / 공백
 * - currency: 숫자 / 구분자 / 부호 / 공백 (% 불가)
 * - date: 숫자 / 년월일 / 일반 날짜 구분자 (- / . /)
 * - text: 항상 통과
 *
 * Reason 코드는 dispatcher 가 tool_result.reason 으로 그대로 회신해서
 * 모델이 자기 mistake 를 인지하도록.
 */
export function validateTextForFormat(
  text: string,
  format: ExpectedFormat,
): { ok: true } | { ok: false; reason: string } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true };
  if (format === 'text') return { ok: true };

  if (format === 'marker') {
    if (trimmed.length > 2) return { ok: false, reason: 'marker-too-long' };
    // 0.7.16 — 체크박스 글리프 (□ ☐ ☑ ■ ✔ ✅) + ✔(U+2714) 를 marker char
    // class 에 추가 (kordoc 차용). 기존엔 ✓(U+2713) 만 있어 ☑/✔ 등이 거부됐음.
    if (!/^[OXox○●✓✗✔✅□☐☑■V√ㅇㅁ\-/\s]+$/.test(trimmed))
      return { ok: false, reason: 'marker-invalid-char' };
    return { ok: true };
  }
  if (format === 'number') {
    if (!/^[\d.,\s\-+%]+$/.test(trimmed))
      return { ok: false, reason: 'number-non-numeric' };
    return { ok: true };
  }
  if (format === 'currency') {
    if (!/^[\d.,\s\-+]+$/.test(trimmed))
      return { ok: false, reason: 'currency-non-numeric' };
    return { ok: true };
  }
  if (format === 'date') {
    if (!/^[\d년월일.\-/\s]+$/.test(trimmed))
      return { ok: false, reason: 'date-invalid-char' };
    return { ok: true };
  }
  return { ok: true };
}
