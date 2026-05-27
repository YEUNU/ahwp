/**
 * Form-Fill mode completion guard — 0.7.2.
 *
 * AI 가 form-fill 모드 중 tool 호출 없이 텍스트만 emit 하면 (finishReason
 * = 'stop') runtime 이 호출 이력을 검사해서 (a) tableInventory 의 빈 셀
 * 합 (b) getPageSvg 호출 여부를 확인. 미달이면 synthetic user message 로
 * 자동 nudge → fireChat 재진입. 이전 회귀 (cover-sheet 만 채우고 ~15
 * cells 후 조기 종료) 의 cap.
 *
 * 본 파일은 그 decision logic 만 pure function 으로 분리한다. side-effect
 * (refs 갱신 / setMessages / fireChat) 는 useChatStreaming 에서 처리.
 * pure 한 채로 단위 테스트 가능 — 회귀 lock-down.
 */

export interface FormGuardInput {
  /** 현재 ModeContext 의 primary mode. 'form-fill' 외엔 guard 비활성. */
  modePrimary: string;
  /** 가장 최근 getEmptyFormFields 의 tableInventory 요약. null = 한 번도
   *  호출 안 됨 (이 자체로 nudge 트리거 — getPageSvg 미호출 와 같이). */
  formState: { emptyCellsRemaining: number; tableSummary: string } | null;
  /** 이 user-task 동안 getPageSvg(ok=true) 호출 됐는지. */
  getPageSvgCalled: boolean;
  /** 이번 user-task 의 누적 nudge 횟수. cap 도달 시 비활성. */
  nudgeCount: number;
  /** Cap. 기본 2. 초과 시 무한 loop 방지. */
  maxNudges: number;
  /** 사용자가 stop 버튼 누른 경우. true 면 guard 비활성. */
  agentStopped: boolean;
}

export interface FormGuardDecision {
  shouldNudge: boolean;
  /** shouldNudge=true 일 때 사용자 메시지로 inject 할 텍스트. */
  nudgeText?: string;
  /** 디버그 / 텔레메트리. nudge 트리거 이유 — UI / log 에 표시 가능. */
  reason?: 'empty-cells-remain' | 'no-svg' | 'both';
}

/**
 * Form-Fill guard decision. 다음 조건 모두 만족 시 shouldNudge=true:
 * 1. modePrimary === 'form-fill'
 * 2. !agentStopped
 * 3. nudgeCount < maxNudges
 * 4. (emptyCellsRemaining > 0) || (!getPageSvgCalled)
 *
 * nudge 메시지는 이유에 따라 1~2 단락. 사용자 / AI 가 어떤 작업이 빠졌는지
 * 정확히 알 수 있게 — getEmptyFormFields tableInventory 의 요약 포함.
 */
export function decideFormGuardNudge(input: FormGuardInput): FormGuardDecision {
  if (input.modePrimary !== 'form-fill') return { shouldNudge: false };
  if (input.agentStopped) return { shouldNudge: false };
  if (input.nudgeCount >= input.maxNudges) return { shouldNudge: false };
  const emptyLeft = input.formState?.emptyCellsRemaining ?? 0;
  const needsSvg = !input.getPageSvgCalled;
  if (emptyLeft === 0 && !needsSvg) return { shouldNudge: false };

  const parts: string[] = [];
  if (emptyLeft > 0) {
    const tail = input.formState?.tableSummary
      ? ` — tables: ${input.formState.tableSummary}`
      : '';
    parts.push(
      `Form still has ${emptyLeft} empty cells remaining${tail}. ` +
        `Re-call getEmptyFormFields (use includeFilled: true if you also need to clear placeholders) ` +
        `and write the next batch with insertTextInCell / replaceTextInCell per slotKind.`,
    );
  }
  if (needsSvg) {
    parts.push(
      `Before announcing completion, call getPageSvg({pageIdx: 0}) on each key page ` +
        `(cover + detail tables) so the result can be visually verified.`,
    );
  }
  const reason: FormGuardDecision['reason'] =
    emptyLeft > 0 && needsSvg
      ? 'both'
      : emptyLeft > 0
        ? 'empty-cells-remain'
        : 'no-svg';
  return {
    shouldNudge: true,
    nudgeText: `[Auto-continue] ${parts.join(' ')} Then announce completion only when the form is actually done.`,
    reason,
  };
}
