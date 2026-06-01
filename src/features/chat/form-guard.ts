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
  /** 0.7.24 — 모델의 이번 turn 최종 텍스트 (text-only 'done' 시점의
   *  assistantBuffer). 양식을 파악한 뒤 모델이 사용자에게 부족 정보를
   *  물으며 멈췄으면, 빈 셀이 남아도 그 종료를 존중한다. 미지정 = '' =
   *  질문 아님 (기존 동작 보존). */
  assistantText?: string;
  /** 0.7.24 — 이번 user-task 에서 form-fill 쓰기(fillFormCells /
   *  insertTextInCell / replaceTextInCell)가 한 번이라도 성공했는지.
   *  시각 검증(getPageSvg) enforcement 를 "실제로 채웠을 때만" 발동시켜
   *  0.7.6 회귀(양식 아닌데 빈셀0 → svg nudge 반복)를 정확히 회피한다.
   *  미지정 = false (기존 동작 보존). */
  formWritesDone?: boolean;
}

/**
 * 모델 텍스트가 사용자에게 정보를 요청/질문하며 멈춘 것인지 판정. form-fill
 * 완료 맥락에서 물음표(`?` / `？`)는 "더 줄 정보가 있나요?" 식 요청의
 * 신뢰할 만한 cross-language 신호다 — 모델이 grounded 정보를 다 쓰고
 * 부족분을 물을 때 거의 항상 질문형으로 끝난다. 빈 텍스트는 질문 아님.
 *
 * 오탐(요약문 속 수사적 물음표)의 비용은 낮다 — nudge 한 번 생략될 뿐,
 * 사용자가 "계속" 하면 됨. 미탐(물음표 없이 질문)이어도 reworded nudge 가
 * "정보 부족하면 사용자에게 물어라"를 담아 모델이 다시 물을 수 있다.
 */
export function assistantRequestsInput(text: string | undefined): boolean {
  return /[?？]/.test(text ?? '');
}

export interface FormGuardDecision {
  shouldNudge: boolean;
  /** shouldNudge=true 일 때 사용자 메시지로 inject 할 텍스트. */
  nudgeText?: string;
  /** 디버그 / 텔레메트리. nudge 트리거 이유 — UI / log 에 표시 가능.
   *  'awaiting-user-input' 은 shouldNudge=false 와 함께 (모델이 사용자
   *  질문으로 정상 종료). */
  reason?:
    | 'no-form-discovery'
    | 'empty-cells-remain'
    | 'awaiting-user-input'
    | 'no-visual-verify';
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

  // Case 0 (0.7.24): 모델이 양식을 파악(discovery 완료)한 뒤 사용자에게
  // 부족 정보를 물으며 멈췄다면, 빈 셀이 남아도 그 종료를 존중한다.
  //
  // 완료 기준이 "빈 셀 0" 이면 grounding (제공 정보만 채움, 빈칸>날조) +
  // ask-when-insufficient 원칙과 런타임이 충돌한다 — 사용자가 정보를 조금만
  // 줬을 때 옳은 결과는 "채울 수 있는 것만 채우고 나머지는 질문하며 멈춤"
  // 인데, "아직 N개 남았으니 계속 채워" nudge 가 모델을 날조 쪽으로 떠민다.
  // 모델이 (양식을 안 뒤) 질문하는 것 = 유효한 종료 상태이므로 nudge 안 함.
  //
  // discovery 전(formState null) 의 질문은 존중하지 않는다 — 양식을 먼저
  // 파악해야 무엇을 물을지 구체적으로 알 수 있으므로 Case 1 로 넘어가
  // discovery 를 강제한다.
  if (formStateKnown && assistantRequestsInput(input.assistantText)) {
    return { shouldNudge: false, reason: 'awaiting-user-input' };
  }

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
        `If you have already used every fact the user gave you and the cells that are still empty ` +
        `need information you do NOT have, do NOT keep filling or guess — instead ASK the user for ` +
        `those specific missing facts (grouped by form section) and stop. An intentionally-incomplete ` +
        `form plus one clear question is the correct outcome; only announce completion when the form ` +
        `is genuinely done with the information available.`,
      reason: 'empty-cells-remain',
    };
  }

  // Case 2.5 (0.7.24): 빈 셀은 다 처리됐는데(emptyLeft===0) 실제 form-fill
  // 쓰기를 했고(formWritesDone) getPageSvg 로 시각 검증을 한 번도 안 했으면
  // → 완료 선언 전에 1회 nudge. 모델이 자기가 채운 결과를 "보고"(vision-
  // capable provider 는 렌더 이미지를 받음) 의미 오류 — 식별번호 칸에 주제,
  // 척도 칸에 서술, 셀 overflow 클리핑 등 — 를 직접 잡게 한다. 구조 read
  // (getEmptyFormFields) 로는 못 잡고 렌더를 봐야만 보이는 부류.
  //
  // 0.7.6 회귀(양식 아닌데 빈셀0 → svg nudge 무한 반복) 회피: formWritesDone
  // 이 false 면(=실제 채운 적 없음 = 양식 아니거나 채울 게 없었음) 발동 안
  // 함. nudgeCount cap(기본 2)도 상한. ai-modes.ts 의 form-fill 프롬프트와
  // getPageSvg 도구 설명이 약속하는 "완료 전 getPageSvg 강제"를 실제로 구현.
  if (input.formWritesDone && !input.getPageSvgCalled) {
    return {
      shouldNudge: true,
      nudgeText:
        `[Auto-continue] You filled the form but have not visually verified it yet. ` +
        `Before announcing completion, call getPageSvg({pageIdx}) on the page(s) you edited. ` +
        `If your model can see images, the rendered page is attached — read it and confirm each ` +
        `value sits in the cell its row-label × column-header implies. This is the only check that ` +
        `catches a value in the wrong slot (an identifier / number field holding descriptive text, ` +
        `a prescribed scale / level field holding a free-form sentence) or text clipped by a ` +
        `fixed-height cell — such a cell is non-empty and format-valid yet plainly wrong once you ` +
        `look. Fix any with replaceTextInCell, then announce completion.`,
      reason: 'no-visual-verify',
    };
  }

  // Case 3: AI 가 getEmptyFormFields 호출했고 결과가 빈 셀 0 + (시각 검증
  // 했거나 채운 게 없음) → 할 일 없음. AI 의 응답을 존중하고 nudge 안 함.
  return { shouldNudge: false };
}
