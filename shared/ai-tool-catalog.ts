/**
 * Provider tool-use 카탈로그 — 0.7.4 thin wrapper.
 *
 * **0.7.3 까지**: 본 파일이 1100-line `TOOL_DESCRIPTORS` 배열을 직접 들고
 * `validateArgs` (별도 파일) 와 lockstep 유지해야 했다. 0.6.17 의
 * includeFilled strip 회귀는 정확히 이 lockstep 깨짐의 결과.
 *
 * **0.7.4**: 모든 55 도구가 `shared/ai-tools-defined/*.ts` 에서
 * `defineTool` 로 정의된다. 본 파일은 그 registry 의 descriptors 를 mode
 * filter 와 함께 노출하는 thin wrapper. legacy `TOOL_DESCRIPTORS` 배열
 * 완전 제거.
 *
 * 새 도구 추가 시: `shared/ai-tools-defined/<카테고리>.ts` 에 `defineTool`
 * 호출 한 번 — 본 파일은 손대지 않음.
 */
import type { AhwpToolDescriptor } from './ai-tools';
import { AHWP_TOOL_NAMES } from './ai-tools';
import type { ModeContext } from './ai-modes';
import { resolveAllowedTools } from './ai-modes';
import { DEFINED_TOOL_REGISTRY } from './ai-tools-defined';

/**
 * Phase 3 진입 — `ChatRequest.tools` 에 주입할 카탈로그를 한 번에
 * 가져오기. provider 어댑터에서 native 형식으로 변환 (OpenAI:
 * `{type:'function', function:{...}}`, Anthropic: `{name, description,
 * input_schema}`, Google: `{functionDeclarations:[...]}`).
 *
 * 0.7.0 — Task-Mode 진입. `modeContext` 가 있으면 그 mode 의 tool
 * whitelist 로 좁힌 카탈로그 반환. 없으면 전체.
 *
 * 0.7.4 — defineTool registry 가 single source. legacy `TOOL_DESCRIPTORS`
 * 배열 제거.
 */
export function getAhwpToolCatalog(
  modeContext?: ModeContext,
): AhwpToolDescriptor[] {
  const all: AhwpToolDescriptor[] = DEFINED_TOOL_REGISTRY.descriptors.map(
    (d) => ({
      name: d.name as AhwpToolDescriptor['name'],
      description: d.description,
      inputSchema: d.inputSchema as AhwpToolDescriptor['inputSchema'],
    }),
  );
  if (!modeContext) return all;
  const allowed = new Set<string>(
    resolveAllowedTools(modeContext, AHWP_TOOL_NAMES),
  );
  return all.filter((d) => allowed.has(d.name));
}
