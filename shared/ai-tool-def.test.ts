/**
 * defineTool / DEFINED_TOOL_REGISTRY 통합 테스트 — 0.7.4.
 *
 * 회귀 가드:
 * - registry 가 `AHWP_TOOL_NAMES` 와 완전 일치 (누락 / 잉여 도구 차단)
 * - registry 의 readonly set 이 `READONLY_TOOL_NAMES` 와 일치
 *   (drift 시 사일런트 권한 회귀)
 * - 한 tool name 이 두 번 정의되지 않음 (registry 가 마지막 것만 보존)
 * - 각 도구의 validator 가 빈 args 에 대해 결정적 응답
 *   (throw 안 함, 항상 ok or reason)
 */
import { describe, expect, it } from 'vitest';
import { AHWP_TOOL_NAMES, READONLY_TOOL_NAMES } from './ai-tools';
import { DEFINED_TOOL_REGISTRY } from './ai-tools-defined';

describe('DEFINED_TOOL_REGISTRY 회귀 가드', () => {
  it('등록 도구 이름이 AHWP_TOOL_NAMES 와 완전 일치', () => {
    const namesInRegistry = new Set(
      DEFINED_TOOL_REGISTRY.descriptors.map((d) => d.name),
    );
    const expected = new Set<string>(AHWP_TOOL_NAMES);
    const missingFromRegistry = [...expected].filter(
      (n) => !namesInRegistry.has(n),
    );
    const extraInRegistry = [...namesInRegistry].filter(
      (n) => !expected.has(n),
    );
    expect(missingFromRegistry).toEqual([]);
    expect(extraInRegistry).toEqual([]);
  });

  it('registry 의 readonly set 이 READONLY_TOOL_NAMES 와 일치 (drift 방지)', () => {
    const inRegistry = new Set(DEFINED_TOOL_REGISTRY.readonlyNames);
    const inStatic = new Set<string>(READONLY_TOOL_NAMES);
    const onlyRegistry = [...inRegistry].filter((n) => !inStatic.has(n));
    const onlyStatic = [...inStatic].filter((n) => !inRegistry.has(n));
    expect(onlyRegistry).toEqual([]);
    expect(onlyStatic).toEqual([]);
  });

  it('중복 등록 도구 이름 없음', () => {
    const names = DEFINED_TOOL_REGISTRY.descriptors.map((d) => d.name);
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const n of names) {
      if (seen.has(n)) dups.push(n);
      seen.add(n);
    }
    expect(dups).toEqual([]);
  });

  it('모든 validator 가 빈 args 에 대해 결정적 응답 (throw 안 함)', () => {
    for (const [name, validate] of DEFINED_TOOL_REGISTRY.validators) {
      const r = validate({});
      if (r.ok) {
        // OK — args 가 모두 optional 인 read 도구 (e.g. getDocumentOutline,
        // getEmptyFormFields, getCaretPosition, searchWorkspaceOutlines).
        expect(r.args).toBeDefined();
      } else {
        // reason 이 비어있지 않은 문자열.
        expect(typeof r.reason).toBe('string');
        expect(r.reason.length).toBeGreaterThan(0);
      }
      // throw 발생하지 않으므로 여기까지 도달.
      void name;
    }
  });

  it('insertTextInCell validator: 정상 args 통과', () => {
    const v = DEFINED_TOOL_REGISTRY.validators.get('insertTextInCell')!;
    const r = v({
      sectionIdx: 0,
      parentParaIdx: 10,
      controlIdx: 0,
      cellIdx: 4,
      cellParaIdx: 0,
      charOffset: 0,
      text: '코렌스',
    });
    expect(r.ok).toBe(true);
  });

  it('insertTextInCell validator: 누락 필드 거부 (단일 source 보장)', () => {
    const v = DEFINED_TOOL_REGISTRY.validators.get('insertTextInCell')!;
    const r = v({
      sectionIdx: 0,
      parentParaIdx: 10,
      // controlIdx 누락
      cellIdx: 4,
      cellParaIdx: 0,
      charOffset: 0,
      text: 'x',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('controlIdx');
  });

  it('getEmptyFormFields validator: includeFilled boolean 통과 (0.6.17 회귀 방지)', () => {
    // 0.6.17 회귀의 직접 재현 — includeFilled 가 strip 되어 dispatcher
    // 까지 전달 안 됐던 버그. defineTool 의 single source 가 이를 차단.
    const v = DEFINED_TOOL_REGISTRY.validators.get('getEmptyFormFields')!;
    const r = v({ includeFilled: true });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const args = r.args as { includeFilled?: boolean };
      expect(args.includeFilled).toBe(true);
    }
  });

  it('getEmptyFormFields validator: includeFilled 가 non-boolean 이면 거부', () => {
    const v = DEFINED_TOOL_REGISTRY.validators.get('getEmptyFormFields')!;
    const r = v({ includeFilled: 'true' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('includeFilled');
  });
});
