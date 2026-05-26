/**
 * `RhwpBridge` 단위 테스트 — Phase 7 Phase B.
 *
 * iframe 을 직접 띄우지 않고 mock contentWindow 를 사용 — postMessage
 * 를 가로채서 동기 응답 / 이벤트를 simulate. e2e (Playwright) 에서는
 * 실제 rhwp-studio dist 를 띄워 round-trip 검증.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RhwpBridge } from './rhwp-bridge';
import type { RhwpResponse } from '@shared/rhwp-bridge';

interface CapturedRequest {
  type: string;
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface MockIframe {
  iframe: HTMLIFrameElement;
  /** parent → iframe 으로 보낸 postMessage 캡쳐. */
  sent: CapturedRequest[];
  /** parent 로 응답을 다시 던지는 헬퍼. setTimeout(0) 으로 microtask
   *  cycle 보존 — 실제 postMessage 와 같은 비동기 시그널. */
  respond: (msg: object) => Promise<void>;
}

function makeIframe(): MockIframe {
  const sent: CapturedRequest[] = [];
  const iframe = document.createElement('iframe');
  // iframe.contentWindow 는 read-only — 우리 mock 으로 덮기 위해
  // defineProperty 사용. postMessage 는 RhwpBridge 가 호출하는 hook.
  const fakeWindow = {
    postMessage: (msg: CapturedRequest) => {
      sent.push(msg);
    },
  };
  Object.defineProperty(iframe, 'contentWindow', {
    value: fakeWindow,
    configurable: true,
  });

  // RhwpBridge.onMessage 는 e.source 가 contentWindow 와 일치해야 메시지를
  // 처리. dispatchEvent 의 MessageEvent 에 source 를 박아준다.
  const respond = (msg: object): Promise<void> =>
    new Promise<void>((resolve) => {
      setTimeout(() => {
        const evt = new MessageEvent('message', {
          data: msg,
          source: fakeWindow as unknown as Window,
        });
        window.dispatchEvent(evt);
        resolve();
      }, 0);
    });

  return { iframe, sent, respond };
}

describe('RhwpBridge', () => {
  let mock: MockIframe;
  let bridge: RhwpBridge;

  beforeEach(() => {
    mock = makeIframe();
    bridge = new RhwpBridge(mock.iframe, {
      defaultTimeoutMs: 500,
      generateId: ((): (() => string) => {
        let n = 0;
        return () => `t${n++}`;
      })(),
    });
  });

  afterEach(() => {
    bridge.destroy();
  });

  it('invoke posts a rhwp-request and resolves on matching response', async () => {
    const p = bridge.invoke<number>('getSectionCount');
    expect(mock.sent).toHaveLength(1);
    const req = mock.sent[0];
    expect(req.type).toBe('rhwp-request');
    expect(req.method).toBe('getSectionCount');
    expect(req.id).toBe('t0');

    await mock.respond({
      type: 'rhwp-response',
      id: 't0',
      result: 3,
    } satisfies RhwpResponse);
    await expect(p).resolves.toBe(3);
  });

  it('invokeWasm wraps to method=wasm with fn+args', async () => {
    const p = bridge.invokeWasm<string>('getTextRange', [0, 0, 0, 100]);
    expect(mock.sent[0].method).toBe('wasm');
    expect(mock.sent[0].params).toEqual({
      fn: 'getTextRange',
      args: [0, 0, 0, 100],
    });
    await mock.respond({ type: 'rhwp-response', id: 't0', result: 'hello' });
    await expect(p).resolves.toBe('hello');
  });

  it('concurrent invokes do not cross-talk', async () => {
    const a = bridge.invoke<string>('a');
    const b = bridge.invoke<string>('b');
    expect(mock.sent.map((r) => [r.id, r.method])).toEqual([
      ['t0', 'a'],
      ['t1', 'b'],
    ]);
    // 응답을 일부러 역순으로.
    await mock.respond({ type: 'rhwp-response', id: 't1', result: 'B' });
    await mock.respond({ type: 'rhwp-response', id: 't0', result: 'A' });
    await expect(a).resolves.toBe('A');
    await expect(b).resolves.toBe('B');
  });

  it('error in response rejects the corresponding promise', async () => {
    const p = bridge.invoke('badMethod');
    await mock.respond({
      type: 'rhwp-response',
      id: 't0',
      error: 'Unknown method: badMethod',
    });
    await expect(p).rejects.toThrow(/Unknown method/);
  });

  it('timeout rejects pending invocation after defaultTimeoutMs', async () => {
    vi.useFakeTimers();
    const p = bridge.invoke('willStall');
    // expect microtask flush — promise is pending.
    expect(bridge.pendingCount).toBe(1);
    vi.advanceTimersByTime(600);
    await expect(p).rejects.toThrow(/timeout after 500ms: willStall/);
    expect(bridge.pendingCount).toBe(0);
    vi.useRealTimers();
  });

  it('on() subscribes to events and returns unsubscribe', async () => {
    const seen: unknown[] = [];
    const off = bridge.on<{ sec: number }>('caret-changed', (data) => {
      seen.push(data);
    });
    await mock.respond({
      type: 'rhwp-event',
      name: 'caret-changed',
      data: { sec: 0 },
    });
    await mock.respond({
      type: 'rhwp-event',
      name: 'caret-changed',
      data: { sec: 1 },
    });
    expect(seen).toEqual([{ sec: 0 }, { sec: 1 }]);

    off();
    await mock.respond({
      type: 'rhwp-event',
      name: 'caret-changed',
      data: { sec: 2 },
    });
    // 더 이상 받지 않음.
    expect(seen).toHaveLength(2);
  });

  it('event handler throwing does not break other listeners', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    bridge.on('x', () => {
      throw new Error('boom');
    });
    const ok = vi.fn();
    bridge.on('x', ok);
    await mock.respond({ type: 'rhwp-event', name: 'x', data: 1 });
    expect(ok).toHaveBeenCalledWith(1);
    consoleWarn.mockRestore();
  });

  it('ignores messages from other window sources', async () => {
    const p = bridge.invoke('x');
    // Wrong source.
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'rhwp-response', id: 't0', result: 'stolen' },
        source: window, // not the iframe's contentWindow
      }),
    );
    // Promise should still be pending — timeout out.
    vi.useFakeTimers();
    vi.advanceTimersByTime(600);
    await expect(p).rejects.toThrow(/timeout/);
    vi.useRealTimers();
  });

  it('destroy rejects all pending and stops listening', async () => {
    const a = bridge.invoke('a');
    const b = bridge.invoke('b');
    bridge.destroy();
    await expect(a).rejects.toThrow(/destroyed/);
    await expect(b).rejects.toThrow(/destroyed/);

    // 응답이 와도 무시되어야 함 (handler 가 unregistered).
    await mock.respond({ type: 'rhwp-response', id: 't99', result: 'late' });
    // Nothing to assert directly — just ensure no throw.
  });

  it('post-destroy invoke rejects synchronously (promise)', async () => {
    bridge.destroy();
    await expect(bridge.invoke('x')).rejects.toThrow(/destroyed/);
  });

  it('rejects when iframe.contentWindow is null', async () => {
    Object.defineProperty(mock.iframe, 'contentWindow', {
      value: null,
      configurable: true,
    });
    await expect(bridge.invoke('x')).rejects.toThrow(/contentWindow is null/);
  });

  it('loadFile converts ArrayBuffer/Uint8Array to number[]', async () => {
    const buf = new Uint8Array([1, 2, 3]);
    const p = bridge.loadFile(buf, 'a.hwp');
    const params = mock.sent[0].params as {
      data: number[];
      fileName?: string;
    };
    expect(params.data).toEqual([1, 2, 3]);
    expect(params.fileName).toBe('a.hwp');
    await mock.respond({
      type: 'rhwp-response',
      id: 't0',
      result: { pageCount: 5 },
    });
    await expect(p).resolves.toEqual({ pageCount: 5 });
  });
});
