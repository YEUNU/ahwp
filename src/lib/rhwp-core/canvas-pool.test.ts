/**
 * Unit tests for `CanvasPool` (chunk 102, Phase 6.2).
 *
 * Pool reuse + DOM lifecycle invariants. Smoke-level — the pool is a
 * thin wrapper around two collections; integration tests against a real
 * viewport happen in chunk 103+ e2e.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { CanvasPool } from './canvas-pool';

describe('CanvasPool', () => {
  let pool: CanvasPool;

  beforeEach(() => {
    pool = new CanvasPool();
  });

  it('acquire returns a fresh canvas the first time per page', () => {
    const c0 = pool.acquire(0);
    expect(c0.tagName).toBe('CANVAS');
    expect(pool.has(0)).toBe(true);
    expect(pool.activePages).toEqual([0]);
    expect(pool.totalCount).toBe(1);
  });

  it('release detaches from DOM and returns canvas to the idle pool', () => {
    const parent = document.createElement('div');
    const c0 = pool.acquire(0);
    parent.appendChild(c0);
    expect(c0.parentElement).toBe(parent);

    pool.release(0);
    expect(c0.parentElement).toBeNull();
    expect(pool.has(0)).toBe(false);
    expect(pool.activePages).toEqual([]);
    expect(pool.totalCount).toBe(1); // still alive in `available`
  });

  it('acquire after release reuses the same canvas instance', () => {
    const c0 = pool.acquire(0);
    pool.release(0);
    const c1 = pool.acquire(1);
    expect(c1).toBe(c0); // same instance, different page slot
    expect(pool.has(0)).toBe(false);
    expect(pool.has(1)).toBe(true);
    expect(pool.totalCount).toBe(1);
  });

  it('acquiring a different page while one is active allocates a new canvas', () => {
    const c0 = pool.acquire(0);
    const c1 = pool.acquire(1);
    expect(c0).not.toBe(c1);
    expect(pool.activePages.sort()).toEqual([0, 1]);
    expect(pool.totalCount).toBe(2);
  });

  it('releaseAll detaches every active canvas and returns them to idle', () => {
    pool.acquire(0);
    pool.acquire(1);
    pool.acquire(2);
    expect(pool.totalCount).toBe(3);
    pool.releaseAll();
    expect(pool.activePages).toEqual([]);
    expect(pool.totalCount).toBe(3); // all 3 in `available` now
  });

  it('release of an unknown page is a no-op', () => {
    pool.acquire(0);
    pool.release(99); // never acquired
    expect(pool.has(0)).toBe(true);
    expect(pool.activePages).toEqual([0]);
  });

  it('getCanvas returns the active canvas; undefined for non-active', () => {
    const c0 = pool.acquire(0);
    expect(pool.getCanvas(0)).toBe(c0);
    expect(pool.getCanvas(99)).toBeUndefined();
  });
});
