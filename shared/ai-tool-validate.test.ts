/// <reference lib="dom" />
import { describe, expect, it } from 'vitest';
import { validateToolCall } from './ai-tool-validate';

describe('switchTargetDoc validator (chunk 99 follow-up)', () => {
  it('accepts an absolute-looking path', () => {
    const r = validateToolCall({
      tool: 'switchTargetDoc',
      args: { path: '/Users/sung/ahwp/examples/foo.hwp' },
    });
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value).toEqual({
        tool: 'switchTargetDoc',
        args: { path: '/Users/sung/ahwp/examples/foo.hwp' },
      });
  });

  it('rejects empty path', () => {
    const r = validateToolCall({
      tool: 'switchTargetDoc',
      args: { path: '' },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('path-not-string');
  });

  it('rejects non-string path', () => {
    const r = validateToolCall({
      tool: 'switchTargetDoc',
      args: { path: 123 } as unknown as { path: string },
    });
    expect(r.ok).toBe(false);
  });

  it('rejects 4 KiB+ path (sanity cap)', () => {
    const r = validateToolCall({
      tool: 'switchTargetDoc',
      args: { path: '/' + 'a'.repeat(5000) },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('path-too-large');
  });
});
