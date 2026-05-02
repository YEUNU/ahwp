/**
 * Renderer-side 플랫폼 분기.
 *
 * `process.platform`은 sandbox renderer에서 undefined라 사용 불가
 * (CLAUDE.md 규칙). `navigator.userAgent` / `navigator.platform`으로 sniff.
 *
 * 플랫폼별 단축키 컨벤션:
 *   - Mac: ⌘ (Cmd, `e.metaKey`)
 *   - Windows / Linux: Ctrl (`e.ctrlKey`)
 *
 * `primaryModifier(e)`는 둘 중 OS 표준에 해당하는 모디파이어만 true 반환.
 * 이러면 Mac에서 Ctrl+click이 secondary click(=우클릭)이라 OS가
 * `contextmenu` 이벤트로 변환하는 문제를 회피 — Mac에선 Cmd+click만
 * primary modifier로 인식, Ctrl+click은 무시 (우클릭 핸들러가 처리).
 */

const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
const platform =
  typeof navigator !== 'undefined' && 'platform' in navigator
    ? navigator.platform
    : '';

export const isMac =
  /Mac/i.test(ua) || /Mac/i.test(platform) || /Darwin/i.test(ua);

/**
 * Returns true when the OS-standard primary modifier is held:
 *   - Mac: `e.metaKey` (⌘)
 *   - Win/Linux: `e.ctrlKey` (Ctrl)
 *
 * Use this anywhere existing code uses `(e.metaKey || e.ctrlKey)` —
 * the OR pattern accepts both modifiers regardless of platform, which
 * causes the Mac Ctrl+click ↔ contextmenu conflict.
 */
export function primaryModifier(
  e: KeyboardEvent | MouseEvent | { metaKey: boolean; ctrlKey: boolean },
): boolean {
  return isMac ? e.metaKey : e.ctrlKey;
}

/**
 * Returns true when the OS-standard primary modifier is held AND
 * `Shift`/`Alt` are NOT — useful for "plain ⌘X / Ctrl+X" patterns.
 */
export function plainPrimaryModifier(e: {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return primaryModifier(e) && !e.shiftKey && !e.altKey;
}
