/**
 * Form-Fill completion guard 단위 테스트 — 0.7.2.
 *
 * 회귀 시나리오: AI 가 form-fill 모드에서 cover-sheet 만 채우고 ~15 셀
 * 후 조기 종료 + getPageSvg 한 번도 안 부름. decideFormGuardNudge 가
 * runtime 에서 fireChat done event 시점에 (a) empty cells 잔여 (b)
 * getPageSvg 호출 여부 보고 nudge 결정.
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

describe('decideFormGuardNudge — Form-Fill 완료 guard', () => {
  it('form-fill 외 mode 는 항상 비활성 (free-authoring 기존 동작 보존)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      modePrimary: 'free-authoring',
      formState: { emptyCellsRemaining: 50, tableSummary: '...' },
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('빈 셀 100 + getPageSvg 미호출 → both reason 으로 nudge', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 100, tableSummary: 'p=10 (50 empty)' },
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('both');
    expect(r.nudgeText).toContain('100 empty cells remaining');
    expect(r.nudgeText).toContain('p=10 (50 empty)');
    expect(r.nudgeText).toContain('getPageSvg');
    expect(r.nudgeText).toContain('slotKind');
  });

  it('빈 셀 0 + getPageSvg 호출됨 → 정상 종료 (nudge 없음)', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: true,
    });
    expect(r.shouldNudge).toBe(false);
  });

  it('빈 셀 5 + getPageSvg 호출됨 → empty-cells-remain 만 nudge', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 5, tableSummary: 'p=20 (5 empty)' },
      getPageSvgCalled: true,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('empty-cells-remain');
    expect(r.nudgeText).toContain('5 empty cells');
    // getPageSvg 안내는 없어야 함 (이미 호출됨).
    expect(r.nudgeText).not.toContain(
      'Before announcing completion, call getPageSvg',
    );
  });

  it('빈 셀 0 + getPageSvg 미호출 → no-svg 만 nudge', () => {
    const r = decideFormGuardNudge({
      ...BASE,
      formState: { emptyCellsRemaining: 0, tableSummary: '' },
      getPageSvgCalled: false,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-svg');
    expect(r.nudgeText).toContain('getPageSvg');
    // 빈 셀 안내는 없어야 함.
    expect(r.nudgeText).not.toContain('empty cells remaining');
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

  it('formState=null (getEmptyFormFields 호출 안 됨) + getPageSvg 미호출 → no-svg 로 nudge', () => {
    // formState=null 은 emptyCellsRemaining=0 으로 평가 — empty 셀 정보
    // 없으면 work-remaining 판단 불가. 단, getPageSvg 미호출은 여전히 trigger.
    const r = decideFormGuardNudge({
      ...BASE,
      formState: null,
      getPageSvgCalled: false,
    });
    expect(r.shouldNudge).toBe(true);
    expect(r.reason).toBe('no-svg');
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
});
