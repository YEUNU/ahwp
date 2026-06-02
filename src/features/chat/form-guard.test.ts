/**
 * Form-Fill completion guard 단위 테스트 — 0.7.2 / tightened 0.7.6.
 *
 * 회귀 시나리오:
 *   - 0.7.2: AI 가 form-fill 모드에서 cover-sheet 만 채우고 ~15 셀 후 조기
 *     종료 + getPageSvg 한 번도 안 부름.
 *   - 0.7.5 회귀: prefix 가 form 신호 (예: `[form: 9 tables, 212 empty
 *     cells]`) 인데 실제 getEmptyFormFields 는 emptyCells=0 반환 → AI 가
 *     "빈 셀 없어요" 정직 응답인데 guard 가 standalone no-svg nudge 로
 *     무한 loop. 사용자 보고: "auto continue 무한히 시도하는데".
 *
 * 0.7.6 새 logic 검증:
 *   1. formState null → discovery nudge (1회)
 *   2. emptyCellsRemaining > 0 → fill nudge
 *   3. emptyCellsRemaining === 0 → **nudge 안 함** (svg 단독 nudge 폐기)
 */
import { describe, expect, it } from 'vitest';
import { decideFormGuardNudge, assistantRequestsInput } from './form-guard';

const BASE = {
  modePrimary: 'form-fill',
  formState: null,
  getPageSvgCalled: false,
  nudgeCount: 0,
  maxNudges: 2,
  agentStopped: false,
} as const;

describe('decideFormGuardNudge — Form-Fill 완료 guard (0.7.6 tightened)', () => {
  it('form-fill 외 mode 는 항상 비활성 (free-authoring 기존 동작 보존)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      modePrimary: 'free-authoring',
      formState: { emptyCellsRemaining: 50, tableSummary: '...' },
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('formState null (getEmptyFormFields 아직 호출 안 됨) → discovery nudge', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: null,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-form-discovery');
    expect(r.nudgeText).toContain('getEmptyFormFields');
  });

  it('빈 셀 100 → empty-cells-remain nudge (svg 권고 포함)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 100, tableSummary: 'p=10 (50 empty)' },
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('empty-cells-remain');
    expect(r.nudgeText).toContain('100 empty cells remaining');
    expect(r.nudgeText).toContain('p=10 (50 empty)');
    expect(r.nudgeText).toContain('getPageSvg');
    expect(r.nudgeText).toContain('slotKind');
  });

  it('빈 셀 5 + getPageSvg 이미 호출됨 → empty-cells-remain (svg 권고 생략)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 5, tableSummary: 'p=20 (5 empty)' },
      getPageSvgCalled: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('empty-cells-remain');
    expect(r.nudgeText).toContain('5 empty cells');
    // getPageSvg 안내는 없어야 함 (이미 호출됨).
    expect(r.nudgeText).not.toContain('call getPageSvg');
  });

  // 0.7.5 회귀의 직접 재현 — prefix 는 form 신호인데 실제 빈 셀 0.
  // 0.7.5 에서는 standalone no-svg nudge 로 무한 loop 발생. 0.7.6 은 정확히
  // 이 case 에서 nudge 안 함.
  it('빈 셀 0 + getPageSvg 미호출 → nudge 안 함 (0.7.5 회귀 차단)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: false,
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('빈 셀 0 + getPageSvg 호출됨 → nudge 안 함 (정상 종료)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('nudgeCount >= maxNudges → cap 도달, 비활성 (무한 loop 방지)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 200, tableSummary: '...' },
      nudgeCount: 2,
      maxNudges: 2,
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('agentStopped=true (사용자 stop 버튼) → 비활성', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 100, tableSummary: '...' },
      agentStopped: true,
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('formState 의 tableSummary 가 비어있을 때 메시지에서 깨끗하게 처리', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 7, tableSummary: '' },
      getPageSvgCalled: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.nudgeText).toContain('7 empty cells');
    // tableSummary 비어있으면 "— tables:" 단편 안 들어가야 함.
    expect(r.nudgeText).not.toContain('— tables:');
  });

  // cap 도달 시 어떤 case 든 비활성 (discovery / fill 모두).
  it('cap 도달: formState null 이라도 nudge 안 함', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: null,
      nudgeCount: 2,
      maxNudges: 2,
    });
    expect(r.shouldNudge).toBe(false);
  });

  // 0.7.14 — 원칙 3 (의도적 빈칸 / 노-filler). empty-cells-remain nudge 가
  // "전부 채워" 강제 대신 "값 없으면 빈칸, filler 금지" 정책을 담아야 함.
  it('빈 셀 nudge 는 의도적 빈칸 + 노-filler 정책 포함 (원칙 3)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 30, tableSummary: 'p=42 (30 empty)' },
      getPageSvgCalled: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('empty-cells-remain');
    expect(r.nudgeText).toContain('blank');
    expect(r.nudgeText).toContain('filler');
  });

  // 0.7.24 — 완료 기준 "빈 셀 0" → "grounded 소진 시 질문하며 종료".
  // 모델이 양식 파악 후 사용자에게 부족 정보를 물으며 멈추면 빈 셀이 남아도
  // 존중(nudge 안 함). grounding + ask-when-insufficient 원칙과 런타임 정합.
  it('discovery 후 모델이 질문하며 멈춤 → nudge 안 함 (grounded 소진 종료 존중)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: true,
      assistantText:
        '제공해주신 정보로 도입기업명·공급기업명·구축 목적을 채웠습니다. 나머지 설비 금액과 KPI 목표치는 정보가 없어 비워뒀어요. 추정금액과 KPI 목표 수치를 알려주실 수 있을까요?',
    });
    expect(r.shouldNudge).toBe(false);
    expect(r.reason).toBe('awaiting-user-input');
  });

  // 침묵 조기 종료(질문 없음)는 여전히 nudge — 원래 회귀(cover-sheet 만
  // 채우고 멈춤) 가드 유지. nudge 텍스트엔 ask-user 경로도 포함.
  it('빈 셀 남고 질문 없이 멈춤 → 여전히 nudge (조기종료 가드 유지)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: true,
      assistantText: '양식 작성을 완료했습니다.',
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('empty-cells-remain');
    // reworded nudge 는 "정보 부족 시 사용자에게 질문" 경로를 담아야.
    expect(r.nudgeText).toContain('ASK the user');
  });

  // discovery 전(formState null) 질문은 존중 안 함 — 먼저 양식 파악 강제.
  it('discovery 전 질문 → 존중 안 하고 discovery nudge (양식 먼저 파악)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: null,
      assistantText: '어떤 항목부터 채울까요?',
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-form-discovery');
  });

  // 0.7.24 — 한계 #3: 시각 self-verification enforcement. 채웠는데
  // getPageSvg 미호출이면 완료 전 1회 nudge (모델이 렌더를 보고 의미오류
  // — 식별번호 칸에 주제, 척도 칸에 서술 — 잡게). formWritesDone 으로
  // 0.7.6 회귀(양식 아닌데 빈셀0) 정확히 회피.
  it('채움 + 빈셀0 + getPageSvg 미호출 → visual-verify nudge', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: false,
      formWritesDone: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-visual-verify');
    expect(r.nudgeText).toContain('getPageSvg');
    expect(r.nudgeText).toContain('replaceTextInCell');
  });

  it('채움 + 빈셀0 + getPageSvg 호출됨 → nudge 안 함 (이미 검증)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
      formWritesDone: true,
    });
    expect(r.shouldNudge).toBe(false);
  });

  // 0.7.6 회귀 가드: 실제로 채운 적 없으면(양식 아님/채울 것 없음) 빈셀0 +
  // svg 미호출이어도 visual-verify nudge 안 함 (무한루프 차단).
  it('미채움 + 빈셀0 + getPageSvg 미호출 → nudge 안 함 (0.7.6 회귀 차단)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: false,
      formWritesDone: false,
    });
    expect(r.shouldNudge).toBe(false);
  });

  // 0.7.25 — visual-verify 가 질문보다 우선 (검증 전엔 묻기 전에 자기 작업
  // 부터 본다). 채웠는데 svg 미호출이면 질문 중이어도 verify nudge.
  it('채움 + svg 미호출 + 질문 → visual-verify 먼저 (묻기 전에 검증)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: false,
      formWritesDone: true,
      assistantText: '나머지 항목은 어떤 값을 넣을까요?',
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-visual-verify');
  });

  // 검증(svg 호출)을 마친 뒤 질문하며 멈추면 그 종료를 존중.
  it('채움 + svg 호출됨 + 질문 → awaiting-user-input (검증 후엔 질문 존중)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
      formWritesDone: true,
      assistantText: '나머지 항목은 어떤 값을 넣을까요?',
    });
    expect(r.shouldNudge).toBe(false);
    expect(r.reason).toBe('awaiting-user-input');
  });

  // 0.7.25 핵심 — grounded sparse fill: 빈 셀이 많이 남아도(emptyLeft>0)
  // 채웠고 svg 미호출이면 visual-verify 가 먼저 (Case 2 보다 우선). 빈셀0
  // gating 으로는 시각 검증이 영영 안 일어나던 0.7.24 실수 수정.
  it('채움 + 빈셀 많음 + svg 미호출 → visual-verify (빈셀 잔여 무관)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: false,
      formWritesDone: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-visual-verify');
  });

  // 0.7.30/0.7.37 — "일부러 비웠는데 '계속 채워' 강요"는 안 함(Case 2 좁힘).
  // 단 0.7.37: 채웠고 빈칸 남고 아직 안 물었으면 완료 전 1회 "모르는 값은
  // 사용자에게 물어라"(ask-for-missing) — "채우기 강요"(날조)와 "질문"(원하는
  // 행동)은 다르므로 후자만.
  it('채움 + 검증 + 빈셀 많음 + 안 물음 → ask-for-missing nudge (질문 유도)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: true,
      formWritesDone: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('ask-for-missing');
    expect(r.nudgeText).toMatch(/ASK(ING)? the user/); // 사용자에게 질문 유도
    expect(r.nudgeText).toContain('Do NOT'); // 날조 금지 명시
    expect(r.nudgeText).not.toContain('fillFormCells'); // "계속 채워" 강요 아님
  });

  // ask-for-missing 은 task 당 1회 — 이미 발화(askForMissingDone)했으면 존중.
  it('채움 + 빈셀 많음 + ask-for-missing 이미 발화 → 완료 존중 (반복 nag 방지)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: true,
      formWritesDone: true,
      askForMissingDone: true,
    });
    expect(r.shouldNudge).toBe(false);
  });

  // 모델이 이미 질문하며 멈췄으면 ask-for-missing 발동 안 함(중복 방지).
  it('채움 + 빈셀 + 모델이 이미 질문 → awaiting-user-input (ask-for-missing 아님)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: true,
      formWritesDone: true,
      assistantText: '나머지 칸 값을 알려주실 수 있나요?',
    });
    expect(r.shouldNudge).toBe(false);
    expect(r.reason).toBe('awaiting-user-input');
  });

  // 빈 셀 0 이면 물을 게 없으니 ask-for-missing 발동 안 함.
  it('채움 + 빈셀0 → ask-for-missing 발동 안 함', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
      formWritesDone: true,
    });
    expect(r.shouldNudge).toBe(false);
  });

  // 반면 쓴 게 전혀 없는데(=조기 give-up) 빈 셀 + 완료 선언이면 1회 nudge 유지.
  it('미채움 + 빈셀 많음 → empty-cells nudge 유지 (조기 give-up)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 180, tableSummary: 'p=42 (180 empty)' },
      getPageSvgCalled: true,
      formWritesDone: false,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('empty-cells-remain');
  });

  // 0.7.29 — plan(updatePlan) 미완료 항목 남으면 완료 차단 (한계 #6).
  it('plan 미완료(pending/in_progress) + 완료 선언 → plan-incomplete nudge', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
      formWritesDone: true,
      planPending: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('plan-incomplete');
    expect(r.nudgeText).toContain('updatePlan');
    expect(r.nudgeText).toContain('skipped');
  });

  it('plan 전부 완료/skipped(planPending=false) → plan nudge 안 함', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
      formWritesDone: true,
      planPending: false,
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('plan 미완료여도 모델이 질문하며 멈추면 질문 우선(사용자 입력 대기)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
      formWritesDone: true,
      planPending: true,
      assistantText: '이 항목 값을 알려주실 수 있나요?',
    });
    expect(r.shouldNudge).toBe(false);
    expect(r.reason).toBe('awaiting-user-input');
  });

  // 0.7.35 — 본문 편집 하이재킹 방지. 표-문서에서 form-fill mode 자동진입해도
  // 모델이 본문 쓰기만 했으면(셀 쓰기 없음) form-fill nudge suppress.
  it('본문 쓰기 + 셀 쓰기 없음 → nudge 안 함 (form-fill 아님)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 6, tableSummary: 'p=3 (6 empty)' },
      bodyWriteDone: true,
      formWritesDone: false,
    });
    expect(r.shouldNudge).toBe(false);
    expect(r.reason).toBe('body-edit-not-form-fill');
  });

  it('본문 쓰기 + 셀 쓰기 둘 다 → suppression 풀림 (실제 form-fill 진행 중)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 6, tableSummary: 'p=3 (6 empty)' },
      getPageSvgCalled: true,
      bodyWriteDone: true,
      formWritesDone: true,
    });
    // body+cell 둘 다 했고 검증도 했으니 빈칸 존중(완료) — 핵심은 'body-edit'
    // 으로 무조건 suppress 되지 않는다는 것.
    expect(r.reason).not.toBe('body-edit-not-form-fill');
  });

  // 감사 발견 — plan 미완료는 formWritesDone 와 무관하게 완료 차단.
  it('plan 미완료 + 채움 + 검증 → plan-incomplete (formWritesDone 무관)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 50, tableSummary: '...' },
      getPageSvgCalled: true,
      formWritesDone: true,
      planPending: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('plan-incomplete');
  });

  describe('assistantRequestsInput — 질문/요청 판정', () => {
    it('물음표(?, ？) 포함 → true', () => {
      expect(assistantRequestsInput('금액을 알려주실 수 있나요?')).toBe(true);
      expect(assistantRequestsInput('KPI 목표치는 무엇인가요？')).toBe(true);
    });
    it('물음표 없음 / 빈 텍스트 → false', () => {
      expect(assistantRequestsInput('양식을 모두 채웠습니다.')).toBe(false);
      expect(assistantRequestsInput('')).toBe(false);
      expect(assistantRequestsInput(undefined)).toBe(false);
    });
  });
});
