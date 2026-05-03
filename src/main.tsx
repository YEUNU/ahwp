import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ensureRhwpCore } from './lib/rhwp-core';
import './index.css';

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
