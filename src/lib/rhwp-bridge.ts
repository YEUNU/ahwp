/**
 * `RhwpBridge` — ahwp ↔ rhwp-studio iframe 의 postMessage 클라이언트.
 *
 * Phase 7 의 핵심 wiring. parent (ahwp Electron renderer) 가 iframe
 * (vendor/rhwp/rhwp-studio dist) 에 method 호출을 보내고 응답·이벤트를
 * Promise / listener 로 받는다.
 *
 * - 요청 id 추적 → 동시 호출이 서로 cross-talk 하지 않음.
 * - 타임아웃 → 응답 누락된 호출이 영원히 stuck 되지 않음.
 * - 이벤트 구독 → `caret-changed` 등의 future 채널 (Phase D Diff Viewer
 *   가 의존). Phase A2 시점에는 미발행이지만 wiring 만 준비.
 * - destroy → 모든 pending Promise reject + listener 제거. 탭 close /
 *   iframe unmount 시 호출.
 *
 * 사용 예:
 *
 *     const bridge = new RhwpBridge(iframeEl);
 *     await bridge.ready();
 *     const n = await bridge.invokeWasm<number>('getSectionCount', []);
 *     const off = bridge.on('caret-changed', (data) => { ... });
 *     off();      // unsubscribe
 *     bridge.destroy();
 */
import type {
  RhwpEvent,
  RhwpLoadResult,
  RhwpMessage,
  RhwpResponse,
} from '@shared/rhwp-bridge';

/** RhwpBridge 의 외부 설정. */
export interface RhwpBridgeOptions {
  /**
   * 응답 누락 시 reject 까지의 대기 시간 (ms). 메서드별 override 가능.
   * 기본 15s — vite build / WASM init 가 느린 환경에서도 첫 ready 가
   * 30s 이내면 ok 인데, ready 만은 별도로 더 길게 부른다.
   */
  defaultTimeoutMs?: number;
  /**
   * postMessage targetOrigin. iframe 이 같은 출처면 origin string,
   * cross-origin (file:// + http://) 인 경우 `'*'`. 기본 `'*'` —
   * frame-src 가 우리 자산만 받도록 CSP 가 강제하므로 안전.
   */
  targetOrigin?: string;
  /**
   * `window.crypto.randomUUID` 미가용 환경 (구식 browser context)
   * 대비. 기본 자동 — crypto 가 있으면 사용, 없으면 timestamp+counter.
   */
  generateId?: () => string;
}

interface PendingEntry {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  /** setTimeout handle. */
  timer: ReturnType<typeof setTimeout>;
  /** Debug — 어떤 method 가 stuck 인지 timeout 메시지에 포함. */
  method: string;
}

type EventListener<T = unknown> = (data: T | undefined) => void;

export class RhwpBridge {
  private readonly iframe: HTMLIFrameElement;
  private readonly opts: Required<RhwpBridgeOptions>;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly listeners = new Map<string, Set<EventListener<unknown>>>();
  private readonly boundOnMessage: (e: MessageEvent) => void;
  private destroyed = false;

  constructor(iframe: HTMLIFrameElement, options: RhwpBridgeOptions = {}) {
    this.iframe = iframe;
    this.opts = {
      defaultTimeoutMs: options.defaultTimeoutMs ?? 15_000,
      targetOrigin: options.targetOrigin ?? '*',
      generateId: options.generateId ?? defaultIdGen(),
    };
    this.boundOnMessage = (e) => this.onMessage(e);
    window.addEventListener('message', this.boundOnMessage);
  }

  /**
   * iframe 의 WASM init 가 완료될 때까지 대기. 기본 30s — vite preview
   * / e2e 의 cold start 가 평균 1~2s 지만 CI ubuntu 환경에서 늦어질 수
   * 있어 여유.
   */
  async ready(timeoutMs = 30_000): Promise<true> {
    const v = await this.invoke('ready', undefined, timeoutMs);
    return v as true;
  }

  /**
   * Named method 호출. ready / loadFile / pageCount / exportHwp 등.
   *
   * `wasm` 같은 generic dispatcher 는 `invokeWasm` 을 권장 — params
   * 모양이 다르다.
   */
  invoke<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error('RhwpBridge is destroyed'));
    }
    if (!this.iframe.contentWindow) {
      return Promise.reject(
        new Error('iframe.contentWindow is null — not mounted yet'),
      );
    }
    const id = this.opts.generateId();
    const effectiveTimeout = timeoutMs ?? this.opts.defaultTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(
            new Error(
              `RhwpBridge timeout after ${effectiveTimeout}ms: ${method}`,
            ),
          );
        }
      }, effectiveTimeout);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
        method,
      });
      const req = { type: 'rhwp-request' as const, id, method, params };
      this.iframe.contentWindow!.postMessage(req, this.opts.targetOrigin);
    });
  }

  /**
   * Generic WasmBridge dispatcher. iframe 의 `wasm` switch case 가
   * `wasm[fn](...args)` 를 동적 호출. ~230 method + getter 전부.
   * `dispose` / `free` 만 iframe 측에서 차단.
   */
  invokeWasm<T = unknown>(
    fn: string,
    args: unknown[] = [],
    timeoutMs?: number,
  ): Promise<T> {
    return this.invoke<T>('wasm', { fn, args }, timeoutMs);
  }

  /**
   * Convenience — 파일 로드. 기본 timeout 60s (큰 .hwp 의 WASM 파싱이
   * 수십 초 갈 수 있음).
   */
  async loadFile(
    data: ArrayBuffer | Uint8Array | number[],
    fileName?: string,
    skipUnsavedGuard?: boolean,
    timeoutMs = 60_000,
  ): Promise<RhwpLoadResult> {
    const arr =
      data instanceof ArrayBuffer
        ? Array.from(new Uint8Array(data))
        : data instanceof Uint8Array
          ? Array.from(data)
          : data;
    return this.invoke<RhwpLoadResult>(
      'loadFile',
      { data: arr, fileName, skipUnsavedGuard },
      timeoutMs,
    );
  }

  /**
   * 이벤트 구독. 반환 함수 호출 시 unsubscribe.
   */
  on<T = unknown>(name: string, fn: EventListener<T>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn as EventListener<unknown>);
    return () => {
      set!.delete(fn as EventListener<unknown>);
    };
  }

  /**
   * pending 호출 수 — 테스트 / 디버깅용.
   */
  get pendingCount(): number {
    return this.pending.size;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('message', this.boundOnMessage);
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error('RhwpBridge destroyed'));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  private onMessage(e: MessageEvent): void {
    if (this.destroyed) return;
    // contentWindow 미마운트 시점의 메시지 (다른 출처) 는 무시.
    if (e.source !== this.iframe.contentWindow) return;
    const msg = e.data as RhwpMessage | undefined;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'rhwp-response') {
      this.handleResponse(msg);
    } else if (msg.type === 'rhwp-event') {
      this.handleEvent(msg);
    }
  }

  private handleResponse(msg: RhwpResponse): void {
    const entry = this.pending.get(msg.id);
    if (!entry) return; // 이미 timeout 됐거나 unknown id — 무시.
    clearTimeout(entry.timer);
    this.pending.delete(msg.id);
    if (msg.error !== undefined && msg.error !== null) {
      entry.reject(new Error(msg.error));
    } else {
      entry.resolve(msg.result);
    }
  }

  private handleEvent(msg: RhwpEvent): void {
    const set = this.listeners.get(msg.name);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn(msg.data);
      } catch (err) {
        console.warn(`[RhwpBridge] listener for '${msg.name}' threw:`, err);
      }
    }
  }
}

function defaultIdGen(): () => string {
  if (
    typeof crypto !== 'undefined' &&
    typeof (crypto as Crypto).randomUUID === 'function'
  ) {
    return () => `rhwp-${(crypto as Crypto).randomUUID()}`;
  }
  let n = 0;
  return () => `rhwp-${Date.now().toString(36)}-${(n++).toString(36)}`;
}
