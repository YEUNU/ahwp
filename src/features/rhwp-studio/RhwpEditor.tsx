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

/** ahwp-studio 프로토콜 — electron/rhwp-studio-protocol.ts 와 정합. */
const STUDIO_URL = 'ahwp-studio://main/index.html';

export interface RhwpEditorHandle {
  /** iframe.load + bridge.ready 가 둘 다 끝난 뒤에만 non-null. */
  bridge: RhwpBridge | null;
  /** iframe DOM 직접 접근 (테스트 / 디버깅). */
  iframe: HTMLIFrameElement | null;
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
        iframe: iframeRef.current,
      }),
      [bridge],
    );

    useEffect(() => {
      const iframe = iframeRef.current;
      if (!iframe) return;

      let local: RhwpBridge | null = null;
      let cancelled = false;

      const handleLoad = (): void => {
        // iframe.load 가 여러 번 fire 될 수 있음 — 첫 번째만 받는다.
        if (local) return;
        local = new RhwpBridge(iframe, { defaultTimeoutMs: 15_000 });
        local.ready(readyTimeoutMs).then(
          () => {
            if (cancelled || !local) return;
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
