/**
 * ModeDetector — 0.7.0.
 *
 * 한 turn 의 ModeContext 를 자동 결정. doc summary / user message /
 * 사용자 override 신호 → primary mode + addons.
 *
 * 0.7.0 전략: **항상 free-authoring 으로 fallback**. 단, 사용자가 UI
 * 토글로 명시 override 한 경우는 그 값 그대로. detection 휴리스틱
 * 자체는 stub (다음 chunk 부터 점진 활성화):
 *
 * - 0.7.1: form-fill detection — `[form: N tables, M empty cells]` 신호 +
 *   M >= threshold + (선택) 사용자 confirm.
 * - 0.7.2: body-edit detection — 기존 doc + "수정/다듬어/번역" intent.
 * - 0.7.5: 나머지 mode.
 *
 * 이 단계에서는 detection 무력화 = 현재 (0.6.20) 동작 100% 보존.
 */

import type { ModeContext, TaskMode } from '@shared/ai-modes';
import { DEFAULT_MODE_CONTEXT, MODE_REGISTRY } from '@shared/ai-modes';

export interface DetectInput {
  /** active doc summary prefix (e.g. `[form: 9 tables, 212 empty cells]`).
   *  없으면 빈 문자열. */
  docSummaryPrefix?: string;
  /** 마지막 사용자 메시지 (라우팅 의도 추정용). */
  lastUserMessage?: string;
  /** 사용자가 UI 에서 명시 override 한 mode. 있으면 detection 결과 무시. */
  userOverride?: TaskMode | null;
}

/**
 * Mode 결정. 0.7.0 은 override 만 반영, 나머지는 default.
 */
export function detectMode(input: DetectInput): ModeContext {
  if (input.userOverride && MODE_REGISTRY[input.userOverride]) {
    return {
      primary: input.userOverride,
      addons: [],
      source: 'user-override',
      reason: `사용자가 ${MODE_REGISTRY[input.userOverride].label} 로 고정`,
    };
  }
  // 0.7.0 placeholder: detection 휴리스틱 없음. 모든 케이스 default.
  // 0.7.1 부터 docSummaryPrefix 의 `[form: ...]` 패턴 → form-fill 진입.
  return DEFAULT_MODE_CONTEXT;
}
