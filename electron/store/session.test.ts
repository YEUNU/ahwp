/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// `electron.app.getPath('userData')` is unavailable in Node tests. Stub
// it to a per-test temp dir so the store reads/writes there.
let tmpDir: string;
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir },
}));

// Import AFTER the mock.
const { getSession, setSession } = await import('./session');

// Each test gets a fresh module-level cache by resetting modules + re-
// importing. vitest does this if we use `vi.resetModules()` between
// tests.
beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ahwp-session-test-'));
  vi.resetModules();
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('session store — getSession parsing (chunk 99 follow-up bug fix)', () => {
  it('round-trips lastActivePath + lastFolderPath + openTabPaths', async () => {
    await setSession({
      lastActivePath: '/tmp/doc.hwp',
      lastFolderPath: '/Users/foo/projects',
      openTabPaths: ['/tmp/a.hwp', '/tmp/b.hwp'],
    });
    // Force a fresh module so `cache` re-reads from disk.
    vi.resetModules();
    const fresh = await import('./session');
    const restored = await fresh.getSession();
    expect(restored.lastActivePath).toBe('/tmp/doc.hwp');
    expect(restored.lastFolderPath).toBe('/Users/foo/projects');
    expect(restored.openTabPaths).toEqual(['/tmp/a.hwp', '/tmp/b.hwp']);
  });

  it('returns defaults when file does not exist', async () => {
    vi.resetModules();
    const fresh = await import('./session');
    const empty = await fresh.getSession();
    expect(empty.lastActivePath).toBeNull();
    expect(empty.lastFolderPath).toBeNull();
    expect(empty.openTabPaths).toEqual([]);
  });

  it('drops malformed openTabPaths entries (non-string)', async () => {
    // Write raw JSON with corrupt array entries.
    const target = path.join(tmpDir, 'session.json');
    await fs.writeFile(
      target,
      JSON.stringify({
        lastActivePath: '/p/x.hwp',
        openTabPaths: ['/p/a.hwp', null, 42, '', '/p/b.hwp'],
      }),
      'utf8',
    );
    vi.resetModules();
    const fresh = await import('./session');
    const restored = await fresh.getSession();
    expect(restored.openTabPaths).toEqual(['/p/a.hwp', '/p/b.hwp']);
  });

  // Smoke for legacy session.json shape (only lastActivePath present) —
  // pre-fix store wrote this.
  it('handles legacy shape (only lastActivePath)', async () => {
    const target = path.join(tmpDir, 'session.json');
    await fs.writeFile(
      target,
      JSON.stringify({ lastActivePath: '/p/legacy.hwp' }),
      'utf8',
    );
    vi.resetModules();
    const fresh = await import('./session');
    const restored = await fresh.getSession();
    expect(restored.lastActivePath).toBe('/p/legacy.hwp');
    expect(restored.lastFolderPath).toBeNull();
    expect(restored.openTabPaths).toEqual([]);
  });

  // ensure getSession is referenced.
  void getSession;
});
