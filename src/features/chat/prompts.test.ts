import { describe, expect, it } from 'vitest';
import {
  collectReferenceOutlines,
  buildReferenceSystemBlock,
  SYSTEM_PROMPT_AGENT_GUIDE,
} from './prompts';

/**
 * 0.7.19 — 참고자료 reference chip (Inserty 데모 참고) 가 의존하는 소비
 * 파이프라인 회귀 가드. ChatPanel 의 referencePaths state → 이 두 순수
 * 함수 → useChatStreaming 의 [Reference docs] 시스템 블록.
 */
describe('collectReferenceOutlines', () => {
  const openDocs = [
    { path: '/w/active.hwp', label: 'active.hwp', isActive: true },
    { path: '/w/ref-a.hwp', label: 'ref-a.hwp', isActive: false },
    { path: '/w/ref-b.pdf', label: 'ref-b.pdf', isActive: false },
  ];
  const outlineFor = (p: string): string =>
    p === '/w/ref-a.hwp'
      ? '# A heading\nbody a'
      : p === '/w/ref-b.pdf'
        ? 'pdf chunk 0'
        : '';

  it('collects outlines for opted-in non-active docs', () => {
    const out = collectReferenceOutlines(
      ['/w/ref-a.hwp', '/w/ref-b.pdf'],
      () => openDocs,
      outlineFor,
    );
    expect(out.map((r) => r.label)).toEqual(['ref-a.hwp', 'ref-b.pdf']);
    expect(out[0].outline).toContain('A heading');
  });

  it('drops the active doc even if opted in (target is implicit)', () => {
    const out = collectReferenceOutlines(
      ['/w/active.hwp', '/w/ref-a.hwp'],
      () => openDocs,
      outlineFor,
    );
    expect(out.map((r) => r.label)).toEqual(['ref-a.hwp']);
  });

  it('drops paths that are no longer open tabs (closed since toggled)', () => {
    const out = collectReferenceOutlines(
      ['/w/closed.hwp', '/w/ref-a.hwp'],
      () => openDocs,
      outlineFor,
    );
    expect(out.map((r) => r.label)).toEqual(['ref-a.hwp']);
  });

  it('skips docs whose outline is empty', () => {
    const out = collectReferenceOutlines(
      ['/w/ref-a.hwp', '/w/ref-b.pdf'],
      () => openDocs,
      (p) => (p === '/w/ref-a.hwp' ? '' : 'pdf chunk 0'),
    );
    expect(out.map((r) => r.label)).toEqual(['ref-b.pdf']);
  });

  it('returns [] when getters missing or no paths selected', () => {
    expect(collectReferenceOutlines([], () => openDocs, outlineFor)).toEqual(
      [],
    );
    expect(
      collectReferenceOutlines(['/w/ref-a.hwp'], undefined, outlineFor),
    ).toEqual([]);
    expect(
      collectReferenceOutlines(['/w/ref-a.hwp'], () => openDocs, undefined),
    ).toEqual([]);
  });
});

describe('buildReferenceSystemBlock', () => {
  it('emits a numbered, read-only [Reference docs] block', () => {
    const block = buildReferenceSystemBlock([
      { label: 'ref-a.hwp', outline: '# A heading' },
      { label: 'ref-b.pdf', outline: 'pdf chunk 0' },
    ]);
    expect(block).toContain('[Reference docs]:');
    expect(block).toContain('[ref 1] doc="ref-a.hwp" (read-only)');
    expect(block).toContain('[ref 2] doc="ref-b.pdf" (read-only)');
    expect(block).toContain('# A heading');
    // read-only contract must be stated so the model never targets refs.
    expect(block.toLowerCase()).toContain('never target it for modification');
  });
});

/**
 * Form-fill behavior contracts — 사용자 dogfooding 요청을 패턴화한 니즈가
 * 시스템 프롬프트에 인코딩돼 있는지 지키는 회귀 가드. 이 디렉티브들은 LLM
 * 행동을 좌우하는데 prose 라 리팩터링 시 조용히 사라질 수 있다. 각 it 는
 * 어떤 사용자 요청에서 온 니즈인지 추적한다. (원칙 기반·영어 — 특정 양식·
 * 필드명 enumeration 은 단언하지 않는다.)
 */
describe('SYSTEM_PROMPT_AGENT_GUIDE — form-fill behavior contracts', () => {
  const guide = SYSTEM_PROMPT_AGENT_GUIDE;
  const lower = guide.toLowerCase();

  // 니즈 N1 — "사용자가 제공한 정보를 넘지 않는 선에서 수정" (날조 금지).
  it('encodes grounding: fill only user-provided info, never fabricate figures', () => {
    expect(guide).toContain("Fill only what the user's information grounds");
    expect(lower).toContain('do not invent');
    expect(lower).toContain('fabricat'); // fabricate / fabricated
    // an empty cell is preferable to an invented value
    expect(lower).toMatch(/blank|empty/);
  });

  // 니즈 N2 — "내용이 부족하면 사용자한테 정보를 취득하고 작업 진행".
  it('encodes ask-when-insufficient: gather missing facts from the user', () => {
    expect(lower).toContain('ask the user for the missing facts');
    // fill what you can first, then one consolidated request
    expect(lower).toContain('consolidated');
    expect(lower).toMatch(/gather more from the user|supply them/);
  });

  // 니즈 N3 — "사용자가 창의성을 원하면 정보를 넘을 수는 있음" (opt-in 예외).
  it('encodes the creativity exception as explicit opt-in only', () => {
    expect(lower).toMatch(/draft|propose|expand|creative/);
    // must distinguish authored vs transcribed when generating beyond facts
    expect(lower).toMatch(/authored versus transcribed|authored vs/);
  });

  // 니즈 N4a — 한국 공문서: 보고/점검 같은 역할 분리 행은 비워둔다 (verified
  // by rendering — 점검 행이 빈 value-slot 이라 채울 위험).
  it('encodes role-scoped rows: leave reviewer-designated cells empty', () => {
    expect(guide).toContain('reserved for a different author');
    expect(lower).toMatch(/reviewer|evaluator|inspector/);
    expect(lower).toContain('leave');
  });

  // 니즈 N4b — 고정 높이 셀 overflow 클리핑 → 값은 셀 크기에 비례 (render 발견).
  it('encodes cell-sizing: keep values proportional, overflow gets clipped', () => {
    expect(guide).toContain('Size each value to its cell');
    expect(lower).toContain('clipped');
  });

  // 니즈 N4c — "(예시)"/instruction placeholder 는 append 가 아니라 replace.
  it('encodes placeholder replacement via replaceTextInCell, not append', () => {
    expect(guide).toContain('replaceTextInCell');
    expect(lower).toContain('instruction');
  });

  // 니즈 N4c' (0.7.38) — grounded 값이 없어 못 채우는 instruction placeholder
  // 는 그대로 두지 말고 CLEAR(`text: ""`). 라이브에서 "(예시)…" 예시 문구가
  // 최종 문서에 남던 회귀("placeholder 미제거")를 막는 가드.
  it('encodes clearing unfillable instruction placeholders (text: "") instead of leaving example text', () => {
    expect(guide).toContain('text: ""');
    // 비울 때도 CLEAR 라는 의미가 명시돼야 (그냥 남겨두기 금지).
    expect(lower).toContain('clear');
    // 최종 문서에 "(예시)" 류 예시 문구가 남으면 안 된다는 점이 명시돼야.
    expect(guide).toContain('(예시)');
  });

  // 니즈 N4d — 규정된 어휘/척도를 모르면 추측 말고 비워둔다 (0.7.21).
  it('encodes value-vocabulary adherence with leave-blank-when-unknown', () => {
    expect(lower).toContain('leave the cell blank rather than guessing');
  });

  // 니즈 N5 — vision self-verification (0.7.24, 한계 #3). getPageSvg 가
  // 렌더 이미지를 모델에 돌려주므로 "넌 SVG 못 본다(future)" 식 stale 안내가
  // 다시 끼어들지 않게 가드. 완료 전 시각 검증으로 의미 오류를 잡게.
  it('encodes vision self-verification via getPageSvg (model CAN see the page)', () => {
    expect(guide).toContain('getPageSvg');
    // 모델이 이미지를 본다는 점이 명시돼야 (못 본다는 stale 안내 금지).
    expect(lower).toMatch(
      /rendered image|see the (filled )?form|as an actual image|see the page/,
    );
    // outdated "you cannot parse the SVG" 문구가 다시 끼어들면 안 됨.
    expect(lower).not.toContain('cannot parse the svg');
  });
});
