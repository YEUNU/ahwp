/**
 * Form-Fill mode completion guard — 0.7.2 / tightened 0.7.6.
 *
 * AI 가 form-fill 모드 중 tool 호출 없이 텍스트만 emit 하면 (finishReason
 * = 'stop') runtime 이 호출 이력을 검사해서 적절한 경우 synthetic user
 * message 로 자동 nudge → fireChat 재진입. 이전 회귀 (cover-sheet 만
 * 채우고 ~15 cells 후 조기 종료) 의 cap.
 *
 * 본 파일은 그 decision logic 만 pure function 으로 분리한다. side-effect
 * (refs 갱신 / setMessages / fireChat) 는 useChatStreaming 에서 처리.
 * pure 한 채로 단위 테스트 가능 — 회귀 lock-down.
 */

export interface FormGuardInput {
  /** 현재 ModeContext 의 primary mode. 'form-fill' 외엔 guard 비활성. */
  modePrimary: string;
  /** 가장 최근 getEmptyFormFields 의 tableInventory 요약. null = 한 번도
   *  호출 안 됨 (discovery 미진행). */
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
  reason?: 'no-form-discovery' | 'empty-cells-remain';
}

/**
 * Form-Fill guard decision (0.7.6 — tightened).
 *
 * 0.7.5 까지의 standalone `no-svg` nudge 가 false-positive 의 직접 원인
 * 이었음:
 *
 *   - `getDocumentSummary` prefix 가 `[form: 9 tables, 212 empty cells]`
 *     이라 mode 는 form-fill 로 detect 되지만,
 *   - 실제 `getEmptyFormFields` 는 emptyCells=0 반환 (prefix count 의
 *     휴리스틱 카운트와 실제 cell scan 결과 사이의 데이터 불일치),
 *   - AI 가 "빈 셀 없어요, 어떻게 진행할까요?" 라고 정직 응답,
 *   - 그런데 0.7.5 의 guard 는 `no-svg` 만 보고 "getPageSvg 호출해" nudge,
 *   - AI 가 svg 호출해도 다음 turn 의 text-only 응답에서 guard 가 또 발화
 *     (StrictMode 중복 fire + 같은 case 재진입), 무한 loop.
 *
 * 새 logic:
 *
 *   1. `formState === null` (아직 getEmptyFormFields 호출 안 됨) → discovery
 *      필요. prefix 만 보고 임의 응답 막기 위해 1회 nudge.
 *   2. `emptyCellsRemaining > 0` → 채우기 계속하라 nudge. 메시지 안에
 *      getPageSvg 권고도 같이 (별도 turn 으로 분리하지 않음).
 *   3. `emptyCellsRemaining === 0` → **nudge 안 함**. AI 의 "이건 양식
 *      아니에요 / 이미 채워져 있어요" 응답이 정답. svg 단독 nudge 폐기.
 */
export function decideFormGuardNudge(input: FormGuardInput): FormGuardDecision {
  if (input.modePrimary !== 'form-fill') return { shouldNudge: false };
  if (input.agentStopped) return { shouldNudge: false };
  if (input.nudgeCount >= input.maxNudges) return { shouldNudge: false };

  const formStateKnown = input.formState !== null;
  const emptyLeft = input.formState?.emptyCellsRemaining ?? 0;

  // Case 1: AI 가 아직 getEmptyFormFields 한 번도 호출 안 함 → discovery
  // 강제. AI 가 prefix 만 보고 임의로 응답하는 회귀 방지.
  if (!formStateKnown) {
    return {
      shouldNudge: true,
      nudgeText:
        `[Auto-continue] Before responding, call ` +
        `getEmptyFormFields({includeFilled: true}) to discover the actual form structure. ` +
        `If it returns no empty cells (the document may already be filled or may not be a form), ` +
        `respond explaining that to the user and stop.`,
      reason: 'no-form-discovery',
    };
  }

  // Case 2: 실제 빈 셀 남아 있음 → 채우기 계속.
  if (emptyLeft > 0) {
    const tail = input.formState?.tableSummary
      ? ` — tables: ${input.formState.tableSummary}`
      : '';
    const svgHint = input.getPageSvgCalled
      ? ''
      : ' After filling, call getPageSvg({pageIdx: 0}) for visual verification.';
    return {
      shouldNudge: true,
      nudgeText:
        `[Auto-continue] Form still has ${emptyLeft} empty cells remaining${tail}. ` +
        `The coordinates from your last getEmptyFormFields response stay valid for every unfilled cell ` +
        `(writing text never shifts cellIdx / parentParaIdx), so fill the ones that have a real value in one fillFormCells ` +
        `call — its cells array takes one entry per cell, mode chosen by slotKind ('insert' for ` +
        `value-slots, 'replace' for instruction placeholders), not a few single calls at a time. ` +
        `Re-call getEmptyFormFields only if you exhausted ` +
        `that list (use includeFilled: true to also clear ` +
        `placeholders) or for the final verification pass.${svgHint} ` +
        `Leave a cell blank when the document's target has no real value for it — do NOT invent ` +
        `filler (O/X, 0, '-', 'N/A', '미운영') to look complete; intentionally-blank cells are fine. ` +
        `Then announce completion only when the form is actually done.`,
      reason: 'empty-cells-remain',
    };
  }

  // Case 3: AI 가 getEmptyFormFields 호출했고 결과가 빈 셀 0 → 할 일
  // 없음. AI 의 응답을 존중하고 nudge 안 함.
  return { shouldNudge: false };
}
