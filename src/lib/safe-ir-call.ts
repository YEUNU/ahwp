/**
 * `safeIrCall` / `tryIgnore` — Phase R5 refactor (REFACTORING_PLAN.md).
 *
 * @rhwp/core 호출은 lib 내부에서 throw 할 수 있어 거의 모든 호출이
 * `try { ... } catch { console.warn(...) }` 로 감싸진다 (코드베이스 전반
 * 200+ 곳). 이 helper 들이 그 보일러플레이트를 일원화 — 표준화된 로그
 * 라벨 + fallback 값 반환.
 *
 * 사용 패턴:
 *   const dims = safeIrCall('getCursorRect',
 *     () => JSON.parse(doc.getCursorRect(s, p, o)) as CursorRect,
 *     null,
 *   );
 *
 *   const text = tryIgnore(() => doc.getTextRange(s, p, 0, 100), '');
 */

/**
 * Run `fn`, returning `fallback` on throw. Logs the failure with the
 * given label so the renderer console keeps a record. Use for IR calls
 * where a failure is a real signal worth investigating.
 */
export function safeIrCall<T>(label: string, fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.warn(`[studio] ${label} failed:`, err);
    return fallback;
  }
}

/**
 * Run `fn`, returning `fallback` on throw with NO logging. Use only for
 * speculative reads where a throw is expected (e.g. probing whether a
 * paragraph has a control of a specific kind, or fetching cursor rect
 * from a freshly-restored snapshot before layout finishes).
 */
export function tryIgnore<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
