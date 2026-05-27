/**
 * getAhwpToolCatalog mode-slicing unit tests — 0.7.0.
 */
import { describe, expect, it } from 'vitest';
import { getAhwpToolCatalog } from './ai-tool-catalog';
import { MODE_REGISTRY, type TaskMode } from './ai-modes';

describe('getAhwpToolCatalog', () => {
  it('without modeContext → full catalog (0.6.20 compat)', () => {
    const cat = getAhwpToolCatalog();
    expect(cat.length).toBeGreaterThan(40);
  });

  it('with default (free-authoring) mode → full catalog (all tools)', () => {
    const cat = getAhwpToolCatalog({
      primary: 'free-authoring',
      addons: [],
      source: 'default',
    });
    const full = getAhwpToolCatalog();
    expect(cat.length).toBe(full.length);
  });

  it('with mode whose tools narrowed → filtered catalog', () => {
    // Mode 의 tools 를 일시 변경해 slicing 동작 확인.
    const target: TaskMode = 'form-fill';
    const original = MODE_REGISTRY[target].tools;
    (MODE_REGISTRY[target] as { tools: readonly string[] }).tools = [
      'insertTextInCell',
      'getEmptyFormFields',
    ];
    try {
      const cat = getAhwpToolCatalog({
        primary: target,
        addons: [],
        source: 'detected',
      });
      const names = cat.map((d) => d.name);
      expect(names).toContain('insertTextInCell');
      expect(names).toContain('getEmptyFormFields');
      expect(names).not.toContain('applyHtml');
      expect(names).not.toContain('insertText');
    } finally {
      (MODE_REGISTRY[target] as { tools: readonly string[] | 'all' }).tools =
        original;
    }
  });
});
