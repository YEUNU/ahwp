/**
 * Auto-updater 사용자 설정 — 0.6.8.
 *
 * `userData/updater-prefs.json` 에 영구 저장. 현재 옵션 1개:
 * - `autoDownload`: 새 버전 발견 시 다운로드까지 자동으로 진행 (default true).
 *   false 면 사용자가 banner 의 "지금 받기" 클릭 시에만 다운로드.
 *
 * 설치 (`quitAndInstall`) 는 항상 사용자 명시적 동의 필요 — 자동 다운로드
 * 가 끝나도 banner 의 "재시작해서 설치" 버튼을 눌러야 진행. 이유: 작업 중
 * 손실 위험을 사용자 통제 하에 둠.
 */
import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface UpdaterPrefs {
  autoDownload: boolean;
}

const FILE_NAME = 'updater-prefs.json';

const DEFAULT_PREFS: UpdaterPrefs = {
  autoDownload: true,
};

function prefsPath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

let cached: UpdaterPrefs | null = null;

export async function loadUpdaterPrefs(): Promise<UpdaterPrefs> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(prefsPath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpdaterPrefs>;
    cached = {
      autoDownload:
        typeof parsed.autoDownload === 'boolean'
          ? parsed.autoDownload
          : DEFAULT_PREFS.autoDownload,
    };
  } catch {
    // 파일 없음 / 손상 → defaults.
    cached = { ...DEFAULT_PREFS };
  }
  return cached;
}

export async function saveUpdaterPrefs(
  patch: Partial<UpdaterPrefs>,
): Promise<UpdaterPrefs> {
  const current = await loadUpdaterPrefs();
  const next: UpdaterPrefs = { ...current, ...patch };
  cached = next;
  try {
    await fs.mkdir(path.dirname(prefsPath()), { recursive: true });
    await fs.writeFile(prefsPath(), JSON.stringify(next), 'utf8');
  } catch (err) {
    console.warn('[updater-prefs] save failed:', err);
  }
  return next;
}
