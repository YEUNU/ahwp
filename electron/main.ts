import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { PingRequest, PingResponse } from '../shared/api';
import { appendErrorLog, initCrashReporter } from './crash-reporter';
import { registerAiIpc } from './ipc/ai';
import { registerChatHistoryIpc } from './ipc/chat-history';
import { registerClipboardIpc } from './ipc/clipboard';
import { registerFileIpc, teardownTabsWatcher } from './ipc/file';
import { registerFolderIpc, shutdownFolderIpc } from './ipc/folder';
import { registerSecretsIpc } from './ipc/secrets';
import { registerSessionIpc } from './ipc/session';
import { initUpdater } from './ipc/updater';
import { registerWebIpc } from './ipc/web';
import { buildAppMenu } from './menu';
import {
  registerRhwpStudioProtocol,
  registerRhwpStudioSchemeAsPrivileged,
} from './rhwp-studio-protocol';

// chunk 63 — initialize crash reporter as early as possible. Native
// minidumps are wired before any window opens; the JS handlers catch
// errors that fire during startup.
initCrashReporter();

// Phase 7 — `ahwp-studio://` scheme privilege 등록은 반드시 app.ready
// 이전이어야 함. 실제 file 응답 handler 는 app.whenReady() 뒤에 install.
registerRhwpStudioSchemeAsPrivileged();

const isDev = !!process.env.VITE_DEV_SERVER_URL;

// chunk 65 — multi-window. We no longer treat any single window as
// "the" main window. The `mainWindow` ref is kept for activate
// fallback (clicking the dock icon reopens a window when none is
// open); menu actions and watcher channels target the focused window
// at the moment of dispatch instead.
let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: 'ahwp',
    // Custom titlebar — UI/UX revamp. macOS keeps the traffic-light
    // controls but hides the OS title strip; Win/Linux remove the OS
    // chrome entirely so our renderer-side bar paints edge-to-edge.
    // The renderer's TitleBar honors `paddingLeft:78` on macOS to make
    // room for the traffic lights.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay:
      process.platform === 'darwin'
        ? undefined
        : { color: '#efece5', symbolColor: '#1c1a16', height: 36 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'right' });
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  // First-created window seeds the dock-activate fallback; later
  // windows don't need to.
  if (mainWindow === null) mainWindow = win;
  return win;
}

function registerIpcHandlers(): void {
  ipcMain.handle('ipc:ping', (_event, req: PingRequest): PingResponse => {
    return {
      pong: req.message,
      at: Date.now(),
      platform: process.platform,
      electron: process.versions.electron,
    };
  });
  // chunk 65 — open a new window. Each window is a fresh React app
  // instance with its own session restore + chat history connection.
  ipcMain.handle('app:new-window', (): void => {
    createWindow();
  });
  // chunk 52 — About 창에서 사용. app/electron/node/chrome 버전 일괄 노출.
  // package.json 의 version 은 app.getVersion() 으로 읽음.
  // chunk 79 — `@rhwp/core` package.json 에서 version 읽어 About pane
  // 에 노출. cwd / __dirname 두 후보 path 시도 (packaged 와 dev 모두
  // 커버). asar 의 readFileSync 도 투명하게 동작.
  let rhwpCoreVersion = '?';
  try {
    const candidates = [
      path.join(process.cwd(), 'node_modules', '@rhwp', 'core', 'package.json'),
      path.join(
        __dirname,
        '..',
        'node_modules',
        '@rhwp',
        'core',
        'package.json',
      ),
    ];
    for (const p of candidates) {
      if (!existsSync(p)) continue;
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { version?: string };
      if (typeof pkg.version === 'string') {
        rhwpCoreVersion = pkg.version;
        break;
      }
    }
  } catch {
    /* fallback "?" — UI 에서도 "?" 로 표시. */
  }
  ipcMain.handle(
    'app:get-versions',
    (): {
      app: string;
      electron: string;
      chrome: string;
      node: string;
      platform: string;
      arch: string;
      rhwpCore: string;
    } => ({
      app: app.getVersion(),
      electron: process.versions.electron ?? '?',
      chrome: process.versions.chrome ?? '?',
      node: process.versions.node ?? '?',
      platform: process.platform,
      arch: process.arch,
      rhwpCore: rhwpCoreVersion,
    }),
  );
  // chunk 63 — renderer-side error bridge. window.onerror /
  // onunhandledrejection in the renderer call this IPC so JS errors
  // land in `userData/error.log` alongside main-process errors.
  ipcMain.handle(
    'app:log-error',
    async (
      _event,
      req: { origin?: string; message: string },
    ): Promise<void> => {
      if (!req || typeof req.message !== 'string') return;
      const origin = typeof req.origin === 'string' ? req.origin : 'renderer';
      await appendErrorLog(origin, req.message);
    },
  );
  // chunk 100 — Settings 의 "캐시 비우기" 진입점. 사용자가 명시적으로
  // 호출했을 때만 실행. 삭제 대상:
  //  - userData/outline-cache.json (chunk 96 워크스페이스 outline 캐시)
  //  - userData/model-cache.json   (chunk 48/70 provider 모델 목록 24h 캐시)
  // 채팅 히스토리 / 세션 / API 키 / recent.json 은 사용자 데이터 / 설정
  // 영역이라 본 IPC 가 건드리지 않는다 (실수로 날리면 손실 큰 데이터).
  ipcMain.handle(
    'app:clear-caches',
    async (): Promise<{ removed: string[]; failed: string[] }> => {
      const userData = app.getPath('userData');
      const targets = ['outline-cache.json', 'model-cache.json'];
      const removed: string[] = [];
      const failed: string[] = [];
      for (const name of targets) {
        const full = path.join(userData, name);
        try {
          await rm(full, { force: true });
          removed.push(name);
        } catch (err) {
          console.warn(`[clear-caches] ${name} failed:`, err);
          failed.push(name);
        }
      }
      return { removed, failed };
    },
  );
  registerFileIpc();
  registerSessionIpc();
  registerClipboardIpc();
  registerFolderIpc();
  registerSecretsIpc();
  registerAiIpc();
  registerChatHistoryIpc();
  registerWebIpc();

  // 0.6.12 — Windows / Linux 메뉴 접근성. titleBarStyle: 'hidden' 이
  // 네이티브 메뉴바도 같이 숨김 → 사용자가 File / Edit / View / 설정
  // 등에 접근 불가. TitleBar 의 햄버거 버튼이 본 IPC 를 호출하면
  // Menu.getApplicationMenu().popup({ window }) 로 정의된 메뉴를
  // context-menu 식으로 표시. 메뉴 정의 자체는 electron/menu.ts 단일
  // source.
  ipcMain.handle(
    'app-menu:popup',
    async (_event, pos?: { x?: number; y?: number }): Promise<void> => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return;
      const window =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().at(-1) ??
        null;
      if (!window) return;
      const x = typeof pos?.x === 'number' ? Math.round(pos.x) : undefined;
      const y = typeof pos?.y === 'number' ? Math.round(pos.y) : undefined;
      menu.popup({ window, x, y });
    },
  );
}

void app.whenReady().then(() => {
  // Phase 7 — file 응답 handler. scheme privilege 는 위쪽에서 사전 등록.
  registerRhwpStudioProtocol();
  registerIpcHandlers();
  // Menu actions target the currently-focused window (chunk 65 —
  // multi-window). Falls back to the most recent window when nothing
  // has focus (e.g. after the user clicked outside the app).
  Menu.setApplicationMenu(
    buildAppMenu(
      () =>
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().at(-1) ??
        mainWindow,
    ),
  );
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 0.6.2 — auto-updater 의 main-side state machine + IPC 등록. dev /
  // AHWP_DISABLE_UPDATER=1 시 enabled=false 로 noop, packaged 빌드만 실제
  // GitHub Releases 와 통신. 자세한 동작: electron/ipc/updater.ts.
  initUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', (e) => {
  // Release the chokidar watcher before exit. This is async so we
  // gate the quit with `e.preventDefault()` and re-call `app.quit()`
  // once teardown finishes. Also clear the userData/temp dir — file:new
  // creates `new-<timestamp>.hwp` files there as scratch buffers; the
  // user only persists them via Save As, after which the temp copy is
  // unreferenced.
  e.preventDefault();
  const tempDir = path.join(app.getPath('userData'), 'temp');
  void Promise.allSettled([
    shutdownFolderIpc(),
    teardownTabsWatcher(),
    rm(tempDir, { recursive: true, force: true }),
  ]).finally(() => {
    app.exit(0);
  });
});
