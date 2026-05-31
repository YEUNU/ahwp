/**
 * `shared/form-format.ts` 단위 테스트 — 0.7.12.
 *
 * 두 함수 커버:
 *   - inferExpectedFormat: 컬럼 헤더 → ExpectedFormat 휴리스틱
 *   - validateTextForFormat: text 가 포맷을 만족하는지 검증
 *
 * 의도: false positive (잘못된 reject) 가 사용자 경험을 망치므로
 * permissive 한 default 와 strict 한 marker/number/currency/date 분류
 * 모두 직접 케이스로 확인. 한국어 양식 패턴 (백만원, 일자, O/X) 위주.
 */
import { describe, expect, it } from 'vitest';
import {
  inferExpectedFormat,
  validateTextForFormat,
  normalizeLabelText,
  type ExpectedFormat,
} from './form-format';

describe('inferExpectedFormat', () => {
  // 우리가 실제로 잡으려는 코어 케이스 — 사용자 transcript 에서 본
  // "도입여부 (O/X)" 같은 컬럼.
  it.each<[string, ExpectedFormat]>([
    ['도입여부 (O/X)', 'marker'],
    ['도입여부(O/X)', 'marker'],
    ['Y/N (O/X)', 'marker'],
    ['(○/X)', 'marker'],
    ['O/X', 'marker'],
  ])('marker: %s → %s', (header, expected) => {
    expect(inferExpectedFormat(header)).toBe(expected);
  });

  it.each<[string, ExpectedFormat]>([
    ['추정금액(백만원)', 'currency'],
    ['총 금액', 'currency'],
    ['연간 비용', 'currency'],
    ['예산(만원)', 'currency'],
    ['단가', 'currency'],
    ['매출액', 'currency'],
  ])('currency: %s → %s', (header, expected) => {
    expect(inferExpectedFormat(header)).toBe(expected);
  });

  it.each<[string, ExpectedFormat]>([
    ['체결일자', 'date'],
    ['보고 날짜', 'date'],
    ['생년월일', 'date'],
    ['시행 연월일', 'date'],
  ])('date: %s → %s', (header, expected) => {
    expect(inferExpectedFormat(header)).toBe(expected);
  });

  it.each<[string, ExpectedFormat]>([
    ['수량', 'number'],
    ['개수', 'number'],
    ['건수', 'number'],
    ['처리 횟수', 'number'],
    ['진척률(%)', 'number'],
  ])('number: %s → %s', (header, expected) => {
    expect(inferExpectedFormat(header)).toBe(expected);
  });

  it.each<[string, ExpectedFormat]>([
    ['구분', 'text'],
    ['운영방식 (독립/클라우드)', 'text'], // enum 비슷하지만 O/X 가 아님
    ['제조사', 'text'],
    ['신규 도입', 'text'],
    ['기능 개선', 'text'],
    ['', 'text'], // 빈 헤더
  ])('text (default): %s → %s', (header, expected) => {
    expect(inferExpectedFormat(header)).toBe(expected);
  });

  it('marker 우선순위: O/X 가 다른 키워드와 동시 등장해도 marker', () => {
    // "도입여부 (O/X)" — "여부" 단어로 인한 false positive 방지 + marker 우선
    expect(inferExpectedFormat('도입여부 (O/X) 입력')).toBe('marker');
  });

  it('row label 폴백: column 이 비고 row 가 일자 → date', () => {
    expect(inferExpectedFormat('', '제출일자')).toBe('date');
  });

  it('row label 폴백: 둘 다 비면 text', () => {
    expect(inferExpectedFormat('', '')).toBe('text');
  });
});

describe('validateTextForFormat', () => {
  it('text 포맷은 항상 통과', () => {
    expect(validateTextForFormat('아무거나', 'text').ok).toBe(true);
    expect(validateTextForFormat('123', 'text').ok).toBe(true);
    expect(validateTextForFormat('', 'text').ok).toBe(true);
  });

  it('모든 포맷에서 빈/공백 문자열은 통과 (clear 허용)', () => {
    for (const fmt of [
      'marker',
      'number',
      'currency',
      'date',
      'text',
    ] as const) {
      expect(validateTextForFormat('', fmt).ok).toBe(true);
      expect(validateTextForFormat('   ', fmt).ok).toBe(true);
    }
  });

  describe('marker', () => {
    it.each(['O', 'X', 'o', 'x', '○', '●', '✓', '✗', 'V', '√', '-', '/'])(
      '%s 통과',
      (s) => {
        expect(validateTextForFormat(s, 'marker').ok).toBe(true);
      },
    );

    it('한글 reject', () => {
      const r = validateTextForFormat('예지보전 솔루션', 'marker');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('marker-too-long');
    });

    it('숫자 reject', () => {
      const r = validateTextForFormat('85', 'marker');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('marker-invalid-char');
    });

    it('3 char 이상 reject', () => {
      const r = validateTextForFormat('OXX', 'marker');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('marker-too-long');
    });
  });

  describe('number', () => {
    it.each(['85', '1,234', '12.5', '100%', '0', ' 42 ', '-5'])(
      '%s 통과',
      (s) => {
        expect(validateTextForFormat(s, 'number').ok).toBe(true);
      },
    );

    it('한글 reject', () => {
      const r = validateTextForFormat('백오십', 'number');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('number-non-numeric');
    });

    it('영문 reject', () => {
      const r = validateTextForFormat('one hundred', 'number');
      expect(r.ok).toBe(false);
    });
  });

  describe('currency', () => {
    it.each(['120', '1,000', '1,234.56', '0', '-100'])('%s 통과', (s) => {
      expect(validateTextForFormat(s, 'currency').ok).toBe(true);
    });

    it('% 는 currency 에서 reject', () => {
      const r = validateTextForFormat('50%', 'currency');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('currency-non-numeric');
    });

    it('한글 reject', () => {
      const r = validateTextForFormat('백만원', 'currency');
      expect(r.ok).toBe(false);
    });
  });

  describe('date', () => {
    it.each([
      '2026-05-27',
      '2026.05.27',
      '2026/05/27',
      '2026년 5월 27일',
      '26.05.27',
      '2026',
    ])('%s 통과', (s) => {
      expect(validateTextForFormat(s, 'date').ok).toBe(true);
    });

    it('한글 (날짜 키워드 외) reject', () => {
      const r = validateTextForFormat('어제', 'date');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('date-invalid-char');
    });
  });
});

// 0.7.16 — P1: 라벨 정규화 (kordoc 차용). 꼬리 콜론 / 각주 위첨자 strip.
describe('normalizeLabelText (P1 — kordoc)', () => {
  it('꼬리 콜론 제거 (반각/전각)', () => {
    expect(normalizeLabelText('성명:')).toBe('성명');
    expect(normalizeLabelText('성명：')).toBe('성명');
    expect(normalizeLabelText('주소 :')).toBe('주소');
  });

  it('각주 위첨자 제거', () => {
    expect(normalizeLabelText('등록기준지²')).toBe('등록기준지');
    expect(normalizeLabelText('비고※')).toBe('비고');
    expect(normalizeLabelText('항목*')).toBe('항목');
  });

  it('위첨자 + 콜론 동시', () => {
    expect(normalizeLabelText('금액¹:')).toBe('금액');
  });

  it('공백 정규화 + trim', () => {
    expect(normalizeLabelText('  사  업   명  ')).toBe('사 업 명');
  });

  it('문장 중간 콜론은 보존 (꼬리만 제거)', () => {
    expect(normalizeLabelText('구분: A')).toBe('구분: A');
  });

  it('빈 / 기호-only → 빈 문자열', () => {
    expect(normalizeLabelText('   ')).toBe('');
    expect(normalizeLabelText('：')).toBe('');
  });
});

// 0.7.16 — P2: 체크박스 글리프 marker 인식 (kordoc 차용).
describe('inferExpectedFormat — 체크박스 글리프 (P2)', () => {
  it.each(['해당 □', '□ 동의', '☐ 비해당', '☑ 확인', '점검 ■', '완료 ✔'])(
    '%s → marker',
    (header) => {
      expect(inferExpectedFormat(header)).toBe('marker');
    },
  );

  it('체크박스 글리프 없는 평범한 헤더는 그대로 text', () => {
    expect(inferExpectedFormat('내용')).toBe('text');
    expect(inferExpectedFormat('추진 계획')).toBe('text');
  });
});

describe('validateTextForFormat — marker 체크박스 글리프 (P2)', () => {
  it.each(['☑', '□', '☐', '■', '✔', '✅', 'O', 'X', '✓'])(
    '%s 는 marker 통과',
    (s) => {
      expect(validateTextForFormat(s, 'marker').ok).toBe(true);
    },
  );

  it('이전엔 거부되던 ☑ / ✔ 가 이제 통과 (회귀 가드)', () => {
    expect(validateTextForFormat('☑', 'marker').ok).toBe(true);
    expect(validateTextForFormat('✔', 'marker').ok).toBe(true);
  });

  it('marker 에 자유 텍스트는 여전히 reject', () => {
    const r = validateTextForFormat('해당없음', 'marker');
    expect(r.ok).toBe(false);
  });
});
