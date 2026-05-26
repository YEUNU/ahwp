/**
 * Auto-updater IPC + main-side state machine — 0.6.2.
 *
 * `electron-updater` 의 raw 이벤트를 normalized `UpdaterState` 로 변환하고
 * 모든 렌더러 윈도우에 broadcast. UI 는 `updater:event` 채널 + 4개 액션
 * IPC 만 알면 충분.
 *
 * Packaging 가드:
 * - `!app.isPackaged` → enabled=false, 모든 action 즉시 no-op resolve.
 *   dev 에선 latest.yml 도 없고 publish 채널도 안 잡혀 있어 호출하면
 *   "No published versions on GitHub" 같은 false-positive 에러가 남.
 * - `AHWP_DISABLE_UPDATER=1` → 동일하게 enabled=false.
 *
 * Fake event mode (e2e 전용):
 * - `AHWP_UPDATER_FAKE=available` → mount 직후 가짜 available 이벤트.
 * - `AHWP_UPDATER_FAKE=full` → available → downloading(50%) → downloaded
 *   순으로 자동 흘림. UI 의 3 state 전환을 검증.
 *
 * UpdaterApi 는 shared/api.ts 의 single source of truth.
 */
import { app, BrowserWindow, ipcMain } from 'electron';
import type { UpdaterState } from '../../shared/api';

let currentState: UpdaterState = {
  status: 'idle',
  enabled: false,
};

let updaterInstance: ElectronUpdater | null = null;

interface ElectronUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: () => void;
}

function broadcast(state: UpdaterState): void {
  currentState = state;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('updater:event', state);
  }
}

function setState(patch: Partial<UpdaterState>): void {
  broadcast({ ...currentState, ...patch });
}

/**
 * Fake event injector — packaged 전 / CI / e2e 환경에서 UI 회귀 검증.
 * `AHWP_UPDATER_FAKE` 만 보면 됨. 의도적으로 setTimeout 으로 펼쳐서 UI
 * 가 각 state 를 그릴 시간을 줌.
 */
function runFakeScript(scenario: string): void {
  currentState = { status: 'idle', enabled: true };
  if (scenario === 'available' || scenario === 'full') {
    setTimeout(() => {
      setState({ status: 'available', version: '99.0.0' });
      if (scenario !== 'full') return;
      setTimeout(() => {
        setState({
          status: 'downloading',
          version: '99.0.0',
          progressPercent: 50,
        });
        setTimeout(() => {
          setState({ status: 'downloaded', version: '99.0.0' });
        }, 400);
      }, 400);
    }, 400);
  }
}

async function initRealUpdater(): Promise<void> {
  try {
    const mod = (await import('electron-updater')) as unknown as {
      autoUpdater: ElectronUpdater;
    };
    const au = mod.autoUpdater;
    updaterInstance = au;
    au.autoDownload = false;
    au.autoInstallOnAppQuit = true;
    au.on('checking-for-update', () => {
      setState({ status: 'checking' });
    });
    au.on('update-available', (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined;
      setState({ status: 'available', version: info?.version });
    });
    au.on('update-not-available', () => {
      setState({ status: 'up-to-date' });
    });
    au.on('download-progress', (...args: unknown[]) => {
      const p = args[0] as { percent?: number } | undefined;
      setState({
        status: 'downloading',
        progressPercent: typeof p?.percent === 'number' ? p.percent : 0,
      });
    });
    au.on('update-downloaded', (...args: unknown[]) => {
      const info = args[0] as { version?: string } | undefined;
      setState({
        status: 'downloaded',
        version: info?.version ?? currentState.version,
      });
    });
    au.on('error', (...args: unknown[]) => {
      const err = args[0] as Error | undefined;
      setState({
        status: 'error',
        errorMessage: err?.message ?? 'unknown updater error',
      });
    });
    // 시작 5초 후 background check (chunk 53 기존 동작 유지).
    setTimeout(() => {
      void au.checkForUpdates().catch((err: Error) => {
        console.warn('[updater] initial check failed:', err.message);
      });
    }, 5000);
  } catch (err) {
    console.warn('[updater] init failed:', err);
    setState({
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

export function initUpdater(): void {
  const disabled = process.env.AHWP_DISABLE_UPDATER === '1';
  const fakeScenario = process.env.AHWP_UPDATER_FAKE;
  if (fakeScenario) {
    currentState = { status: 'idle', enabled: true };
    runFakeScript(fakeScenario);
  } else if (!app.isPackaged || disabled) {
    currentState = { status: 'idle', enabled: false };
  } else {
    currentState = { status: 'idle', enabled: true };
    void initRealUpdater();
  }

  ipcMain.handle('updater:get-state', (): UpdaterState => currentState);

  ipcMain.handle('updater:check-now', async (): Promise<void> => {
    if (!currentState.enabled) return;
    if (process.env.AHWP_UPDATER_FAKE) {
      // re-trigger fake script — UI tests 가 manual check 도 검증 가능.
      runFakeScript(process.env.AHWP_UPDATER_FAKE);
      return;
    }
    if (!updaterInstance) return;
    try {
      await updaterInstance.checkForUpdates();
    } catch (err) {
      setState({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ipcMain.handle('updater:download', async (): Promise<void> => {
    if (!currentState.enabled) return;
    if (process.env.AHWP_UPDATER_FAKE) {
      // fake: jump straight to downloaded.
      setState({ status: 'downloading', progressPercent: 50 });
      setTimeout(() => setState({ status: 'downloaded' }), 200);
      return;
    }
    if (!updaterInstance) return;
    try {
      await updaterInstance.downloadUpdate();
    } catch (err) {
      setState({
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  });

  ipcMain.handle('updater:quit-and-install', async (): Promise<void> => {
    if (!currentState.enabled) return;
    if (process.env.AHWP_UPDATER_FAKE) {
      // fake: noop — e2e 가 app 종료 없이 검증.
      return;
    }
    if (!updaterInstance) return;
    updaterInstance.quitAndInstall();
  });
}
