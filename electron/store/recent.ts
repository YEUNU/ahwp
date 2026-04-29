import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RecentFile } from '../../shared/api';

const FILE_NAME = 'recent.json';
const MAX_ENTRIES = 20;

interface Persisted {
  files: RecentFile[];
}

let cache: RecentFile[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

function storePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME);
}

async function load(): Promise<RecentFile[]> {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const files = Array.isArray(parsed.files)
      ? parsed.files.filter(
          (f): f is RecentFile =>
            typeof f === 'object' &&
            f !== null &&
            typeof f.path === 'string' &&
            typeof f.lastOpenedAt === 'number',
        )
      : [];
    cache = files;
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: unknown }).code === 'ENOENT'
    ) {
      cache = [];
    } else {
      console.warn('[recent] failed to load, starting empty:', err);
      cache = [];
    }
  }
  return cache;
}

function persist(files: RecentFile[]): void {
  // Serialize writes to avoid interleaving on rapid updates.
  writeChain = writeChain
    .then(async () => {
      const tmp = `${storePath()}.tmp`;
      await fs.mkdir(path.dirname(storePath()), { recursive: true });
      await fs.writeFile(
        tmp,
        JSON.stringify({ files } satisfies Persisted),
        'utf8',
      );
      await fs.rename(tmp, storePath());
    })
    .catch((err) => {
      console.error('[recent] write failed:', err);
    });
}

export async function listRecent(): Promise<RecentFile[]> {
  return [...(await load())];
}

export async function addRecent(filePath: string): Promise<void> {
  const files = await load();
  const now = Date.now();
  const filtered = files.filter((f) => f.path !== filePath);
  filtered.unshift({ path: filePath, lastOpenedAt: now });
  cache = filtered.slice(0, MAX_ENTRIES);
  persist(cache);
}
