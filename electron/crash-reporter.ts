import { app, crashReporter } from 'electron';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Crash reporting — chunk 63. Self-contained, **local-only** sink. We
 * intentionally do NOT ship Sentry / external collectors:
 *
 *   - ahwp's security model is "no external origin dependency 0".
 *     Every byte that leaves the user's machine is BYOK provider
 *     traffic — AI keys + prompts + responses. Anything else is
 *     a privacy regression.
 *   - Beta usage is small. A self-hosted error log + native crash
 *     dumps are enough to triage incidents the user reports through
 *     GitHub Issues (the user attaches the relevant lines).
 *
 * Three layers:
 *
 *   1. Native `crashReporter.start({ uploadToServer: false, ... })`
 *      captures GPU / renderer / utility process native crashes to
 *      `userData/Crashpad/` (mac/win) or `userData/Crashes/` (linux)
 *      as Crashpad minidumps.
 *
 *   2. `process.on('uncaughtException')` + `unhandledRejection` in
 *      main → append to `userData/error.log` with ISO timestamp +
 *      stack. Avoids losing background-thread JS errors that don't
 *      trigger the native crashReporter path.
 *
 *   3. Renderer-side: `window.onerror` / `window.onunhandledrejection`
 *      bridge through `app:log-error` IPC to the same file. Without
 *      this, renderer JS errors stay in DevTools console and never
 *      surface for non-developers.
 *
 * Disable via `AHWP_DISABLE_CRASH_REPORTER=1` for tests / debug
 * scenarios.
 */

let initialized = false;

export function initCrashReporter(): void {
  if (initialized) return;
  initialized = true;
  if (process.env.AHWP_DISABLE_CRASH_REPORTER === '1') return;

  // Native minidumps go to userData. uploadToServer: false makes this
  // a strictly local sink — Electron won't try to POST anywhere.
  try {
    crashReporter.start({
      productName: 'ahwp',
      companyName: 'ahwp',
      submitURL: '',
      uploadToServer: false,
      ignoreSystemCrashHandler: false,
      compress: false,
    });
  } catch (err) {
    // crashReporter.start can throw on unsupported platforms (older
    // linux distros without breakpad libs). Don't let init fail.
    console.warn('[crash-reporter] crashReporter.start failed:', err);
  }

  process.on('uncaughtException', (err: Error) => {
    void appendErrorLog('main:uncaughtException', err.stack ?? String(err));
  });
  process.on('unhandledRejection', (reason: unknown) => {
    const text =
      reason instanceof Error
        ? (reason.stack ?? reason.message)
        : typeof reason === 'string'
          ? reason
          : JSON.stringify(reason);
    void appendErrorLog('main:unhandledRejection', text);
  });
}

/** Append a single error entry to `userData/error.log`. Best-effort —
 *  failures here are silently swallowed (we don't want a logging error
 *  to mask the original crash). */
export async function appendErrorLog(
  origin: string,
  body: string,
): Promise<void> {
  try {
    const dir = app.getPath('userData');
    await mkdir(dir, { recursive: true });
    const logPath = path.join(dir, 'error.log');
    const entry = `[${new Date().toISOString()}] [${origin}] ${body}\n`;
    await appendFile(logPath, entry, 'utf8');
  } catch {
    /* noop — see comment above */
  }
}
