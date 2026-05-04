import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SessionState } from '../../shared/api';

const FILE_NAME = 'session.json';
const DEFAULT: SessionState = {
  lastActivePath: null,
  lastFolderPath: null,
  openTabPaths: [],
};

let cache: SessionState | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

export async function getSession(): Promise<SessionState> {
  if (cache) return { ...cache };
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    // chunk 99 follow-up — lastFolderPath / openTabPaths 도 복원.
    // 기존엔 setSession 이 통째로 쓰는데 getSession 이 lastActivePath
    // 만 파싱해서 폴더 트리 복원이 작동 안 했음 (재시작 후 폴더가
    // 항상 비어있는 듯 보였음).
    cache = {
      lastActivePath:
        typeof parsed.lastActivePath === 'string'
          ? parsed.lastActivePath
          : null,
      lastFolderPath:
        typeof parsed.lastFolderPath === 'string'
          ? parsed.lastFolderPath
          : null,
      openTabPaths: Array.isArray(parsed.openTabPaths)
        ? parsed.openTabPaths.filter(
            (p): p is string => typeof p === 'string' && p.length > 0,
          )
        : [],
    };
  } catch (err) {
    if (
      !(
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: unknown }).code === 'ENOENT'
      )
    ) {
      console.warn('[session] failed to load, starting empty:', err);
    }
    cache = { ...DEFAULT };
  }
  return { ...cache };
}

export async function setSession(state: SessionState): Promise<void> {
  cache = { ...state };
  const snapshot = { ...cache };
  writeChain = writeChain
    .then(async () => {
      const target = storePath();
      const tmp = `${target}.tmp`;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(snapshot), 'utf8');
      await fs.rename(tmp, target);
    })
    .catch((err) => {
      console.error('[session] write failed:', err);
    });
  return writeChain;
}
