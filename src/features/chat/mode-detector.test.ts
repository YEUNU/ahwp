/**
 * ModeDetector unit tests — 0.7.0.
 *
 * 0.7.0 은 detection 휴리스틱 없음 — userOverride 만 반영, 나머지는
 * default. 0.7.1 부터 docSummaryPrefix → form-fill 자동 진입 등.
 */
import { describe, expect, it } from 'vitest';
import { detectMode } from './mode-detector';

describe('detectMode (0.7.0)', () => {
  it('without any input → default (free-authoring)', () => {
    const ctx = detectMode({});
    expect(ctx.primary).toBe('free-authoring');
    expect(ctx.source).toBe('default');
  });

  it('with form summary prefix → still default (0.7.0 placeholder)', () => {
    // 0.7.1 에서 이 케이스는 'form-fill' 로 진입해야 함. 그때 expect 갱신.
    const ctx = detectMode({
      docSummaryPrefix: '[form: 9 tables, 212 empty cells]',
    });
    expect(ctx.primary).toBe('free-authoring');
    expect(ctx.source).toBe('default');
  });

  it('userOverride 가 있으면 그 mode 로 진입 + source=user-override', () => {
    const ctx = detectMode({ userOverride: 'form-fill' });
    expect(ctx.primary).toBe('form-fill');
    expect(ctx.source).toBe('user-override');
    expect(ctx.reason).toContain('양식');
  });

  it('알 수 없는 override → default', () => {
    // 미래에 mode 추가하기 전 잘못된 string 이 stash 되어 있는 케이스.
    const ctx = detectMode({
      // @ts-expect-error — invalid runtime input for test
      userOverride: 'unknown-mode',
    });
    expect(ctx.primary).toBe('free-authoring');
    expect(ctx.source).toBe('default');
  });
});
