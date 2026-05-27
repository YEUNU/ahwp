/**
 * runAgent defineTool 단위 테스트 — 0.7.11.
 *
 * 검증 범위:
 *   - registry 등록 확인
 *   - prompt validation (빈 / 너무 김 / non-string)
 *   - mode enum 검증 (잘못된 값 거부)
 *   - maxTurns 범위 (1-30)
 *   - 정상 args 통과
 */
import { describe, expect, it } from 'vitest';
import { DEFINED_TOOL_REGISTRY } from './index';

describe('runAgent — 0.7.11 defineTool registry', () => {
  it('registry 에 등록', () => {
    expect(DEFINED_TOOL_REGISTRY.validators.has('runAgent')).toBe(true);
  });

  it('readonly: false (write 가능 — parent mode 에 따라)', () => {
    expect(DEFINED_TOOL_REGISTRY.readonlyNames.has('runAgent')).toBe(false);
  });
});

describe('runAgent validator', () => {
  const v = DEFINED_TOOL_REGISTRY.validators.get('runAgent')!;

  it('정상 prompt 만 → 통과', () => {
    const r = v({ prompt: '코렌스 회사 최근 보도자료 찾아서 정리해줘' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as { prompt: string };
      expect(args.prompt).toBe('코렌스 회사 최근 보도자료 찾아서 정리해줘');
    }
  });

  it('prompt 빈 → 거부', () => {
    expect(v({ prompt: '' }).ok).toBe(false);
    expect(v({ prompt: '   ' }).ok).toBe(false);
  });

  it('prompt non-string → 거부', () => {
    const r = v({ prompt: 123 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('prompt-not-string');
  });

  it('prompt trimmed', () => {
    const r = v({ prompt: '  task  ' });
    if (r.ok) {
      const args = r.args as { prompt: string };
      expect(args.prompt).toBe('task');
    }
  });

  it('mode: 정상 enum 통과', () => {
    const r = v({ prompt: 'x', mode: 'cross-doc-research' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as { mode?: string };
      expect(args.mode).toBe('cross-doc-research');
    }
  });

  it('mode: 잘못된 값 거부', () => {
    const r = v({ prompt: 'x', mode: 'invalid-mode' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('mode-invalid');
  });

  it('maxTurns 범위 (1-30)', () => {
    expect(v({ prompt: 'x', maxTurns: 5 }).ok).toBe(true);
    expect(v({ prompt: 'x', maxTurns: 0 }).ok).toBe(false);
    expect(v({ prompt: 'x', maxTurns: 31 }).ok).toBe(false);
    expect(v({ prompt: 'x', maxTurns: 30 }).ok).toBe(true);
  });

  it('maxTurns 미지정 → ok (default 사용)', () => {
    const r = v({ prompt: 'x' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as { maxTurns?: number };
      expect(args.maxTurns).toBeUndefined();
    }
  });
});

describe('runAgent — 6 mode 모두 지원', () => {
  const v = DEFINED_TOOL_REGISTRY.validators.get('runAgent')!;
  const modes = [
    'cross-doc-research',
    'free-authoring',
    'form-fill',
    'body-edit',
    'table-manipulation',
    'formatting',
  ];

  for (const m of modes) {
    it(`mode='${m}' 통과`, () => {
      const r = v({ prompt: 'x', mode: m });
      expect(r.ok).toBe(true);
    });
  }
});
