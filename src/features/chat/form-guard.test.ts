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
import { decideFormGuardNudge } from './form-guard';

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
});
