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

  it('0.7.1 — form-fill 만 real subset, 나머지는 "all" placeholder', () => {
    for (const m of TASK_MODES) {
      if (m === 'form-fill') {
        expect(Array.isArray(MODE_REGISTRY[m].tools)).toBe(true);
      } else {
        expect(MODE_REGISTRY[m].tools).toBe('all');
      }
    }
  });

  it('form-fill subset 가 본문 write tool 을 제외, 셀 tool 은 포함', () => {
    const tools = MODE_REGISTRY['form-fill'].tools as readonly string[];
    expect(tools).toContain('insertTextInCell');
    expect(tools).toContain('replaceTextInCell');
    expect(tools).toContain('getEmptyFormFields');
    expect(tools).toContain('getPageSvg');
    // 본문 write 류 절대 포함 X — easy-path 회귀 원천 차단.
    expect(tools).not.toContain('insertText');
    expect(tools).not.toContain('applyHtml');
    expect(tools).not.toContain('deleteRange');
    expect(tools).not.toContain('insertParagraph');
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
