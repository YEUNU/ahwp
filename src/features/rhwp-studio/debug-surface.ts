/**
 * `window.__rhwpDebug` — Phase 7 Phase D1.
 *
 * renderer 안에 `RhwpEditor` 를 portal 로 마운트하고 그 bridge 를 외부
 * (e2e / 콘솔) 에서 잡을 수 있게 노출하는 디버그 surface. 본 UI 통합
 * (탭/뷰어 자체를 RhwpEditor 로 교체) 은 Phase D 후반 / E 의 일.
 *
 * 사용 (Playwright):
 *
 *     await page.evaluate(async () => {
 *       const bridge = await window.__rhwpDebug.mount();
 *       return bridge.invokeWasm('getSectionCount', []);
 *     });
 *     await page.evaluate(() => window.__rhwpDebug.unmount());
 *
 * 사용 (DevTools console):
 *
 *     window.__rhwpDebug.mount().then((b) =>
 *       b.invokeWasm('searchAllText', ['검색어', false, false]),
 *     );
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { RhwpBridge } from '@/lib/rhwp-bridge';
import { RhwpEditor } from './RhwpEditor';

interface RhwpDebugApi {
  /**
   * RhwpEditor 를 body 끝에 portal container 로 마운트하고 bridge.ready
   * 가 끝나면 그 bridge 를 resolve. 두 번째 호출은 기존 instance reuse.
   */
  mount(opts?: { hidden?: boolean }): Promise<RhwpBridge>;
  /** mounted bridge 를 destroy + DOM 제거. 마운트 안 됐으면 no-op. */
  unmount(): void;
  /** 현재 mounted bridge — `mount()` 가 resolve 된 뒤에만 non-null. */
  getBridge(): RhwpBridge | null;
}

declare global {
  interface Window {
    __rhwpDebug?: RhwpDebugApi;
  }
}

interface MountState {
  container: HTMLDivElement;
  root: Root;
  bridge: RhwpBridge | null;
  /** mount() 호출자들이 공유하는 ready Promise. */
  readyPromise: Promise<RhwpBridge>;
}

let state: MountState | null = null;

export function installRhwpDebugSurface(): void {
  if (typeof window === 'undefined') return;
  // hot reload / StrictMode double-init 안전.
  if (window.__rhwpDebug) return;

  const api: RhwpDebugApi = {
    mount({ hidden = true } = {}) {
      if (state) return state.readyPromise;

      const container = document.createElement('div');
      container.id = 'rhwp-debug-portal';
      // hidden 옵션이 true 면 layout 영향 없도록 off-screen.
      if (hidden) {
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        container.style.width = '1024px';
        container.style.height = '768px';
        container.style.pointerEvents = 'none';
      } else {
        container.style.position = 'fixed';
        container.style.inset = '0';
        container.style.zIndex = '99999';
        container.style.background = '#fff';
      }
      document.body.appendChild(container);

      const root = createRoot(container);

      const readyPromise = new Promise<RhwpBridge>((resolve, reject) => {
        const handleReady = (bridge: RhwpBridge): void => {
          if (state) state.bridge = bridge;
          resolve(bridge);
        };
        const handleError = (err: Error): void => {
          reject(err);
        };
        root.render(
          createElement(RhwpEditor, {
            onReady: handleReady,
            onError: handleError,
            readyTimeoutMs: 60_000,
          }),
        );
      });

      state = { container, root, bridge: null, readyPromise };
      return readyPromise;
    },

    unmount() {
      if (!state) return;
      try {
        state.root.unmount();
      } catch {
        /* React 9 unmount race — ignore */
      }
      state.container.remove();
      // RhwpEditor 의 cleanup effect 가 bridge.destroy 호출. 추가 작업 X.
      state = null;
    },

    getBridge() {
      return state?.bridge ?? null;
    },
  };

  Object.defineProperty(window, '__rhwpDebug', {
    value: api,
    configurable: true,
    writable: false,
  });
}
