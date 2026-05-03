import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './lib/i18n'; // chunk 89 — i18next side-effect init
import { ensureRhwpCore } from './lib/rhwp-core';
import './index.css';

// chunk 63 — renderer-side global error bridge. Catches errors that
// escape React error boundaries (event handlers, async callbacks,
// resource load failures) and unhandled promise rejections, then
// forwards them through `app:log-error` so they land in the same
// `userData/error.log` as main-process errors. Best-effort — failures
// here are swallowed (we don't want logging to recurse).
function logToFile(origin: string, message: string): void {
  try {
    void window.api.logError({ origin, message });
  } catch {
    /* preload not yet bound or main is gone — drop */
  }
}
window.addEventListener('error', (ev) => {
  const err = ev.error as Error | undefined;
  const text = err?.stack ?? err?.message ?? ev.message ?? '(no message)';
  logToFile('renderer:error', text);
});
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason as unknown;
  const text =
    reason instanceof Error
      ? (reason.stack ?? reason.message)
      : typeof reason === 'string'
        ? reason
        : (() => {
            try {
              return JSON.stringify(reason);
            } catch {
              return String(reason);
            }
          })();
  logToFile('renderer:unhandledrejection', text);
});

// Kick off WASM compilation in parallel with React mount. The first
// file open used to show a 100-200ms "@rhwp/core 초기화 중…" stall
// because the StudioViewer's mount effect was the first caller of
// ensureRhwpCore. Pre-initing here means the cached promise is
// already resolved (or close to it) by the time a viewer mounts.
void ensureRhwpCore();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
