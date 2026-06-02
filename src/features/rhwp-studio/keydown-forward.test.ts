/**
 * dispatchForwardedKeydown 단위 테스트 — 0.7.5.
 *
 * 회귀 시나리오: 사용자가 가운데 패널 (rhwp-studio iframe) 에 포커스
 * 상태에서 ⌘K / ⌘W / ⌘⇧F / F6 / Alt+L 같은 글로벌 단축키를 눌렀을 때
 * AppShell 의 window-level handler 가 발화 안 함. iframe 의 main.ts 가
 * postMessage 로 forward, RhwpEditor 가 bridge.on('keydown') 으로 받아
 * 본 helper 로 합성 KeyboardEvent 를 window 에 dispatch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchForwardedKeydown } from './keydown-forward';

describe('dispatchForwardedKeydown — iframe → parent 합성 KeyboardEvent', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.();
  });

  function captureKeydown(): {
    events: KeyboardEvent[];
    target?: EventTarget;
  } {
    const events: KeyboardEvent[] = [];
    const target = new EventTarget();
    const handler = (e: Event): void => {
      events.push(e as KeyboardEvent);
    };
    target.addEventListener('keydown', handler);
    cleanup.push(() => target.removeEventListener('keydown', handler));
    return { events, target };
  }

  it('⌘K — 모든 modifier / key / code 가 정확히 전달', () => {
    const { events, target } = captureKeydown();
    dispatchForwardedKeydown(
      {
        key: 'k',
        code: 'KeyK',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      target,
    );
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.key).toBe('k');
    expect(e.code).toBe('KeyK');
    expect(e.metaKey).toBe(true);
    expect(e.ctrlKey).toBe(false);
    expect(e.altKey).toBe(false);
    expect(e.shiftKey).toBe(false);
  });

  it('⌘⇧F — shift modifier 도 정확히 통과', () => {
    const { events, target } = captureKeydown();
    dispatchForwardedKeydown(
      {
        key: 'F',
        code: 'KeyF',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      },
      target,
    );
    const e = events[0];
    expect(e.metaKey).toBe(true);
    expect(e.shiftKey).toBe(true);
  });

  it('F6 — F-key 처리 (스타일 다이얼로그 reflex)', () => {
    const { events, target } = captureKeydown();
    dispatchForwardedKeydown(
      {
        key: 'F6',
        code: 'F6',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      target,
    );
    const e = events[0];
    expect(e.key).toBe('F6');
  });

  it('Alt+L — Hancom reflex (글자 모양)', () => {
    const { events, target } = captureKeydown();
    dispatchForwardedKeydown(
      {
        key: 'l',
        code: 'KeyL',
        metaKey: false,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      },
      target,
    );
    const e = events[0];
    expect(e.altKey).toBe(true);
    expect(e.key).toBe('l');
  });

  it('합성 event 가 bubbles + cancelable — AppShell window listener 가 받음', () => {
    const { events, target } = captureKeydown();
    dispatchForwardedKeydown(
      {
        key: 'k',
        code: 'KeyK',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      target,
    );
    const e = events[0];
    expect(e.bubbles).toBe(true);
    expect(e.cancelable).toBe(true);
  });

  it('target 미지정 시 window 가 default — 글로벌 dispatch 보장', () => {
    const events: KeyboardEvent[] = [];
    const handler = (e: Event): void => {
      events.push(e as KeyboardEvent);
    };
    window.addEventListener('keydown', handler);
    cleanup.push(() => window.removeEventListener('keydown', handler));

    dispatchForwardedKeydown({
      key: 'k',
      code: 'KeyK',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    });
    expect(events).toHaveLength(1);
    expect(events[0].metaKey).toBe(true);
  });

  it('handler 가 preventDefault 호출 가능 (cancelable=true 효과)', () => {
    const target = new EventTarget();
    target.addEventListener('keydown', (e) => {
      (e as KeyboardEvent).preventDefault();
    });
    const e = dispatchForwardedKeydown(
      {
        key: 'k',
        code: 'KeyK',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      },
      target,
    );
    expect(e.defaultPrevented).toBe(true);
  });
});

// vi 안 쓰는 케이스 — eslint unused import 회피.
void vi;
