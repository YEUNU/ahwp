/**
 * `<RhwpEditor>` — Phase 7 Phase C.
 *
 * iframe 으로 `ahwp-studio://main/index.html` 을 로드하고 `RhwpBridge`
 * 인스턴스를 자동 마운트. ref API 로 부모가 bridge 에 접근.
 *
 * Phase D 가 AI tools 의 docRef.current.X() 호출을 이 컴포넌트의
 * bridge.invokeWasm() 으로 대체할 때, 부모 컴포넌트는 ref.current.bridge
 * 만 잡고 있으면 된다.
 *
 *     const ref = useRef<RhwpEditorHandle>(null);
 *     <RhwpEditor ref={ref} onReady={(b) => ...} />
 *     // 호출 시:
 *     await ref.current?.bridge?.invokeWasm('insertText', [0, 0, 0, '안녕']);
 *
 * unmount 시 bridge 자동 destroy. effect cleanup 에서 호출.
 */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type JSX,
} from 'react';
import { RhwpBridge } from '@/lib/rhwp-bridge';
import {
  dispatchForwardedKeydown,
  type ForwardedKeydown,
} from './keydown-forward';

/** ahwp-studio 프로토콜 — electron/rhwp-studio-protocol.ts 와 정합. */
const STUDIO_URL = 'ahwp-studio://main/index.html';

export interface RhwpEditorHandle {
  /** iframe.load + bridge.ready 가 둘 다 끝난 뒤에만 non-null. */
  bridge: RhwpBridge | null;
  /**
   * Phase D3 — 현재 문서를 HWP 바이트로 내보내기. AppShell 의 file:save
   * 흐름이 본 메서드 결과를 main 의 file:save IPC 로 보낼 수 있다.
   * bridge 미마운트 시 null.
   */
  exportHwp(): Promise<Uint8Array | null>;
}

export interface RhwpEditorProps {
  /**
   * iframe.load 이후 bridge.ready() 가 resolve 한 뒤 한 번 호출.
   * Caller 가 bridge 를 잡고 후속 작업.
   */
  onReady?: (bridge: RhwpBridge) => void;
  /** bridge.ready() 실패 (timeout 또는 응답 error) 시. */
  onError?: (err: Error) => void;
  /** Container 의 className. iframe 은 100% × 100% 채움. */
  className?: string;
  /** ready 대기 시간. CI / cold start 대비 기본 30s. */
  readyTimeoutMs?: number;
}

/**
 * RhwpEditor — iframe + bridge lifecycle 캡슐화.
 *
 * 마운트:
 *   1. iframe 요소 생성, src = STUDIO_URL.
 *   2. iframe.load 이벤트 → RhwpBridge 생성, ready() 대기.
 *   3. ready 성공 → onReady(bridge) 호출, ref.bridge 노출.
 *   4. unmount → bridge.destroy().
 *
 * 주의:
 * - `src` 는 절대 변경 안 함 (iframe reload 회피). doc 교체는 bridge.loadFile.
 * - StrictMode 의 double-mount 효과는 useEffect cleanup 의 destroy 로 안전.
 */
export const RhwpEditor = forwardRef<RhwpEditorHandle, RhwpEditorProps>(
  function RhwpEditor(
    { onReady, onError, className, readyTimeoutMs = 30_000 },
    ref,
  ): JSX.Element {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const [bridge, setBridge] = useState<RhwpBridge | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        bridge,
        async exportHwp(): Promise<Uint8Array | null> {
          if (!bridge) return null;
          // rhwp-studio main.ts 의 named 'exportHwp' case 가 Array.from(...)
          // 으로 number[] 반환. Uint8Array 로 다시 wrap.
          const arr = await bridge.invoke<number[]>(
            'exportHwp',
            undefined,
            60_000,
          );
          return Uint8Array.from(arr);
        },
      }),
      [bridge],
    );

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      let local: RhwpBridge | null = null;
      let cancelled = false;

      // 0.7.5 — iframe 안의 keydown 을 parent 로 forward. iframe 의 main.ts
      // 가 capture 단계에서 모디파이어 / F-key 만 골라 postMessage 로 전송.
      // 본 effect 가 그 event 를 받아 KeyboardEvent 합성 후 window 에 dispatch
      // → AppShell 의 글로벌 onKey 핸들러 (⌘K / ⌘W / ⌘⇧F / Alt+P) 가 iframe
      // 포커스 상태에서도 정상 동작. (F6 스타일 / Alt+L 글자모양 / Alt+T
      // 문단모양 등 편집 다이얼로그는 iframe 내부 studio 가 직접 처리.)
      let unsubKeydown: (() => void) | null = null;

      const handleLoad = (): void => {
        // iframe.load 가 여러 번 fire 될 수 있음 — 첫 번째만 받는다.
        if (local) return;
        local = new RhwpBridge(iframe, { defaultTimeoutMs: 15_000 });
        local.ready(readyTimeoutMs).then(
          () => {
            if (cancelled || !local) return;
            // bridge ready 이후 keydown 이벤트 구독 시작. iframe 의 main.ts
            // 가 modifier / F-key 만 골라 보내므로 noise 없음. dispatcher 는
            // 합성 KeyboardEvent 생성 + window dispatch — testable helper.
            unsubKeydown = local.on<ForwardedKeydown>('keydown', (data) => {
              if (!data) return;
              dispatchForwardedKeydown(data);
            });
            setBridge(local);
            try {
              onReady?.(local);
            } catch (err) {
              console.error('[RhwpEditor] onReady threw:', err);
            }
          },
          (err: unknown) => {
            if (cancelled) return;
            const e = err instanceof Error ? err : new Error(String(err));
            try {
              onError?.(e);
            } catch (cbErr) {
              console.error('[RhwpEditor] onError threw:', cbErr);
            }
          },
        );
      };

      iframe.addEventListener('load', handleLoad);

      return () => {
        cancelled = true;
        iframe.removeEventListener('load', handleLoad);
        if (unsubKeydown) {
          unsubKeydown();
          unsubKeydown = null;
        }
        if (local) {
          local.destroy();
          local = null;
        }
        setBridge(null);
      };
      // src 는 상수이고 콜백 identity 변화는 무시 (effect 가 매번 떨어지면
      // iframe reload 가 일어남). 의도적으로 deps 비움.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <iframe
        ref={iframeRef}
        src={STUDIO_URL}
        className={className}
        style={{ border: 0, width: '100%', height: '100%' }}
        title="rhwp-studio"
        data-testid="rhwp-editor-iframe"
      />
    );
  },
);
