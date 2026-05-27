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

  // marker: 명시적 (O/X) / (O,X) / (○/X) / O/X 표기.
  // 단순 "여부" / "유무" 만으로는 marker 단정 안 함 — 너무 광범위.
  if (
    /\(\s*[Oo○●]\s*[/,]\s*[Xx✗]\s*\)/.test(ch) ||
    /\(\s*[Xx✗]\s*[/,]\s*[Oo○●]\s*\)/.test(ch) ||
    /\b[Oo]\s*\/\s*[Xx]\b/.test(ch)
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
    if (!/^[OXox○●✓✗V√ㅇㅁ\-/\s]+$/.test(trimmed))
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
