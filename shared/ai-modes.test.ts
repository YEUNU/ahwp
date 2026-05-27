/**
 * Task-Mode infra unit tests — 0.7.0.
 *
 * 0.7.0 은 detection 비활성 (default 만) + 모든 mode 'all' tools 라
 * 동작이 0.6.20 과 동일. 회귀 방지 위주 + 인프라 정합성 검증.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODE_CONTEXT,
  MODE_REGISTRY,
  TASK_MODES,
  getModeDefinition,
  resolveAllowedTools,
  type TaskMode,
} from './ai-modes';
import { AHWP_TOOL_NAMES } from './ai-tools';

describe('MODE_REGISTRY', () => {
  it('defines every TaskMode', () => {
    for (const m of TASK_MODES) {
      expect(MODE_REGISTRY[m]).toBeDefined();
      expect(MODE_REGISTRY[m].mode).toBe(m);
      expect(MODE_REGISTRY[m].label.length).toBeGreaterThan(0);
    }
  });

  it('every mode in 0.7.0 exposes "all" tools (placeholder)', () => {
    // 0.7.1+ 에서 mode 별 subset 으로 좁아질 때 이 테스트는 mode 별
    // expected tool list 로 분기해야 함. 지금은 baseline.
    for (const m of TASK_MODES) {
      expect(MODE_REGISTRY[m].tools).toBe('all');
    }
  });
});

describe('resolveAllowedTools', () => {
  it('default context (free-authoring) → 전체 tool 노출', () => {
    const allowed = resolveAllowedTools(DEFAULT_MODE_CONTEXT, AHWP_TOOL_NAMES);
    expect(allowed.length).toBe(AHWP_TOOL_NAMES.length);
  });

  it('addons 가 있어도 "all" 끼리 합치면 전체', () => {
    const ctx = {
      primary: 'free-authoring' as TaskMode,
      addons: ['cross-doc-research' as TaskMode],
      source: 'default' as const,
    };
    const allowed = resolveAllowedTools(ctx, AHWP_TOOL_NAMES);
    expect(allowed.length).toBe(AHWP_TOOL_NAMES.length);
  });

  // 0.7.1 baseline — 실제 subset 좁힘이 시작되면 이 테스트가 의미를
  // 가짐. 현재는 'all' 만 있어 회귀 방지용.
  it('primary 가 가상의 subset 이면 그 subset 만 + addons 의 read tools 합쳐 반환 (스모크)', () => {
    const fakePrimary: TaskMode = 'form-fill';
    const original = MODE_REGISTRY[fakePrimary].tools;
    // 일시적으로 좁혀서 동작 확인 — readonly 회피 위해 type cast.
    (MODE_REGISTRY[fakePrimary] as { tools: readonly string[] }).tools = [
      'insertTextInCell',
      'getEmptyFormFields',
    ];
    try {
      const ctx = {
        primary: fakePrimary,
        addons: [],
        source: 'detected' as const,
      };
      const allowed = resolveAllowedTools(ctx, AHWP_TOOL_NAMES);
      expect(allowed).toContain('insertTextInCell');
      expect(allowed).toContain('getEmptyFormFields');
      // 다른 write tool 은 빠져야 함 (form-fill subset 시뮬레이션).
      expect(allowed).not.toContain('applyHtml');
      expect(allowed).not.toContain('insertText');
    } finally {
      (
        MODE_REGISTRY[fakePrimary] as { tools: readonly string[] | 'all' }
      ).tools = original;
    }
  });
});

describe('getModeDefinition', () => {
  it('returns registry entry for each TaskMode', () => {
    for (const m of TASK_MODES) {
      expect(getModeDefinition(m).mode).toBe(m);
    }
  });
});
