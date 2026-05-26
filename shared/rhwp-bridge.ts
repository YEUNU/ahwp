/**
 * `shared/rhwp-bridge.ts` — postMessage 와이어 프로토콜 타입.
 *
 * Phase 7 의 ahwp ↔ rhwp-studio iframe 통신은 3 종 메시지로 구성된다.
 * 양쪽 (parent = ahwp renderer / iframe = vendor/rhwp/rhwp-studio main.ts)
 * 이 같은 타입을 본다 — submodule 측 main.ts 의 switch case 가 이 타입을
 * 어디까지 만족하는지는 `docs/PHASE7_PLAN.md` 의 method 매트릭스 참조.
 */

/** Parent → iframe — 메서드 호출 요청. */
export interface RhwpRequest {
  type: 'rhwp-request';
  /** Caller 가 생성하는 고유 id. iframe 은 응답에 그대로 echo. */
  id: string;
  /**
   * iframe 측 switch case 이름.
   *
   * - `'ready'` — WASM init 완료 시 `true` 반환 (race 가드).
   * - `'loadFile'` — `{ data: number[], fileName?, skipUnsavedGuard? }`.
   * - `'pageCount'` — number.
   * - `'getPageSvg'` — `{ page? }` → SVG string.
   * - `'exportHwp' | 'exportHwpx'` — Uint8Array as number[].
   * - `'exportHwpVerify'` — `HwpVerifyResult`.
   * - `'wasm'` — generic WasmBridge dispatcher (`params: { fn, args }`).
   *   ~230 method + getter 전부 노출. `dispose` / `free` 차단.
   * - convenience cases (`getSectionCount`/`getParagraphCount`/
   *   `getTextRange`/`searchAllText`/`insertText`/`getCaretPosition`) —
   *   `'wasm'` 와 동일 동작이지만 named params. Backward compat.
   */
  method: string;
  /** Method-specific. `'wasm'` 의 경우 `RhwpWasmParams`. */
  params?: Record<string, unknown>;
}

/** Iframe → parent — 요청에 대한 응답. */
export interface RhwpResponse<T = unknown> {
  type: 'rhwp-response';
  /** 요청의 id 를 echo. */
  id: string;
  /** 성공 시 결과 (method 별 타입 다름). */
  result?: T;
  /** 실패 시 사람 읽을 메시지. result 와 둘 중 하나만. */
  error?: string;
}

/**
 * Iframe → parent — 비동기 이벤트 (caret 이동 등).
 *
 * Phase A2 시점에는 미발행. Phase B 후속 또는 D 진입 시 추가 예정.
 * Diff Viewer / Plan mode 가 의존하지만 기본 tool 호출은 polling 으로
 * 충분하므로 우선순위는 낮다.
 */
export interface RhwpEvent<T = unknown> {
  type: 'rhwp-event';
  /** 이벤트 식별자 — `'caret-changed'` / `'selection-changed'` / `'doc-mutated'` 등. */
  name: string;
  /** 이벤트 페이로드. */
  data?: T;
}

export type RhwpMessage = RhwpRequest | RhwpResponse | RhwpEvent;

/**
 * `'wasm'` method 의 params 모양. iframe 측이 `wasm[fn](...args)` 를
 * 동적 호출. fn 이 getter 면 args 무시.
 */
export interface RhwpWasmParams {
  fn: string;
  args?: unknown[];
}

/**
 * `loadFile` 의 응답. `wasm.loadFile` 이 page count 만 돌려준다.
 */
export interface RhwpLoadResult {
  pageCount: number;
}

/**
 * `exportHwpVerify` 의 응답 (rhwp #178).
 */
export interface RhwpHwpVerifyResult {
  bytesLen: number;
  pageCountBefore: number;
  pageCountAfter: number;
  recovered: boolean;
}

/**
 * `getCaretPosition` 의 응답 모양 (rhwp `DocumentPosition`). 도큐먼트
 * 미로드 / caret 미정의 시 null.
 */
export interface RhwpCaretPosition {
  sectionIndex: number;
  paragraphIndex: number;
  charOffset: number;
}

/**
 * `searchAllText` 의 hit 모양. cellContext 가 있으면 표 셀 내부 매치.
 */
export interface RhwpSearchHit {
  sec: number;
  para: number;
  charOffset: number;
  length: number;
  cellContext?: {
    parentPara: number;
    ctrlIdx: number;
    cellIdx: number;
    cellPara: number;
  };
}
