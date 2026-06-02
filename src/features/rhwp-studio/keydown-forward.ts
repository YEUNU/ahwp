/**
 * Iframe → parent keydown 합성 dispatcher — 0.7.5.
 *
 * 가운데 메인 패널이 rhwp-studio iframe 으로 전환되면서 cross-frame
 * 경계 때문에 iframe 내부 keydown 이 parent window 까지 bubble 안 되는
 * 문제 해결.
 *
 * vendor/rhwp/rhwp-studio/src/main.ts 가 capture phase 에서 modifier
 * (meta/ctrl/alt) 또는 F1~F12 만 골라 postMessage({type:'rhwp-event',
 * name:'keydown', data}) 로 parent 에 전송. ahwp 측의 RhwpEditor 가
 * bridge.on('keydown', ...) 으로 받아 본 helper 로 KeyboardEvent 합성
 * + window.dispatchEvent → AppShell 의 글로벌 onKey 가 정상 발화.
 *
 * 본 helper 는 pure — KeyboardEvent 생성 + 지정된 target 에 dispatch.
 * 테스트 가능 surface 격리.
 */

export interface ForwardedKeydown {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * 받은 keydown payload 로 합성 KeyboardEvent 생성 후 target 에 dispatch.
 *
 * - `bubbles: true` — AppShell 의 window-level addEventListener('keydown')
 *   가 정상 수신.
 * - `cancelable: true` — handler 가 preventDefault 호출하면 다른 후속
 *   handler 의 isTrusted-aware 분기에 영향 (synthetic 이라 isTrusted=false
 *   지만 우리 코드 path 는 그 flag 검사 안 함).
 *
 * 반환: dispatch 한 KeyboardEvent — caller 가 preventDefault 여부 등을
 * inspect 가능 (테스트 / 디버깅 용).
 */
export function dispatchForwardedKeydown(
  payload: ForwardedKeydown,
  target: EventTarget = window,
): KeyboardEvent {
  const kev = new KeyboardEvent('keydown', {
    key: payload.key,
    code: payload.code,
    metaKey: payload.metaKey,
    ctrlKey: payload.ctrlKey,
    altKey: payload.altKey,
    shiftKey: payload.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(kev);
  return kev;
}
