/**
 * `defineTool` — 0.7.4.
 *
 * 한 도구의 스키마 + 검증 + 메타데이터를 한 곳에 모은다. 이전 분산
 * 구조 (3-file lockstep) 의 깨짐 사례 — 0.6.17 의 includeFilled
 * validator strip 회귀 — 가 반복되지 않도록 single source of truth 강제.
 *
 * **분산 구조 (0.7.3 까지) 의 문제:**
 *
 * 새 도구 / 새 args 필드를 추가할 때 4 파일을 lockstep 으로 갱신:
 *
 *  - `shared/ai-tools.ts` — `AHWP_TOOL_NAMES`, `AhwpToolArgs[name]`,
 *    `READONLY_TOOL_NAMES`
 *  - `shared/ai-tool-catalog.ts` — `TOOL_DESCRIPTORS` 의 schema + desc
 *  - `shared/ai-tool-validate.ts` — `validateArgs` switch case
 *  - `src/features/chat/tools.ts` — dispatcher switch case
 *
 * 한 파일 빼먹으면 사일런트 회귀. 0.6.17 의 `includeFilled` 가 catalog
 * 에는 있고 validator 가 강제 strip 하던 버그가 정확히 이 패턴.
 *
 * **defineTool 의 책임 범위:**
 *
 * - schema (provider 에 전달되는 JSON Schema)
 * - validate (preflight — args 정규화 + 거부 사유)
 * - mode metadata (form-fill / body-edit / ... 에 노출되는지)
 * - readonly metadata (IR mutation 없음 → user 승인 불필요)
 *
 * dispatcher 는 여전히 `src/features/chat/tools.ts` 의 switch — viewer
 * / helper 의존성 (renderer-side) 이 있어 shared/ 에 둘 수 없음. 단,
 * 도구를 추가할 때 dispatcher 한 곳만 손대면 되며 schema / validator
 * 둘 다 자동 derive.
 *
 * **점진 migration:**
 *
 * 0.7.4 — 인프라 + form-fill mode 의 핵심 2 도구 (insertTextInCell,
 * getEmptyFormFields) migration. 나머지 53 도구는 follow-up chunk 에서
 * 점진 이전. legacy `TOOL_DESCRIPTORS` / `validateArgs` switch 가
 * 공존하는 동안 어느 쪽에 있든 동일 ChatRequest.tools / validateToolCall
 * surface 노출.
 */

/**
 * JSON Schema (draft-07 호환). 실제 검증은 `validate` 함수가 책임 —
 * 본 schema 는 provider 에게 전달되어 모델이 args 모양을 알게 하는 용도.
 * 둘 사이 어긋남이 0.6.17 회귀의 원인 → defineTool 가 두 surface 를
 * 같이 묶어 mismatch 발생 자체가 어려워짐.
 */
export interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  enum?: readonly (string | number | boolean)[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  description?: string;
  // 추가 키워드는 확장 가능 — provider 어댑터가 알아서 매핑.
  [key: string]: unknown;
}

/**
 * Per-tool 검증 결과. 성공 시 narrow 된 args 반환. caller (dispatcher)
 * 가 그 type 으로 IR call.
 */
export type ValidateResult<TArgs> =
  | { ok: true; args: TArgs }
  | { ok: false; reason: string };

/**
 * 한 도구의 완전한 정의.
 *
 * `name`: 도구 식별자. `AhwpToolName` union 의 멤버여야 함 (legacy
 * 호환). defineTool 은 generic name 으로 declare 하고 registry 가 union
 * 으로 narrow.
 *
 * `description`: 모델 prompt 에 들어감. **영어** (memory:
 * feedback_english_prompts).
 *
 * `inputSchema`: JSON Schema. provider 별로 변환 (OpenAI function /
 * Anthropic input_schema / Gemini functionDeclarations).
 *
 * `validate`: dispatch 직전 args 정규화 + 거부. coerceNonNegInt 류
 * helper 는 `shared/ai-tool-validate.ts` 에서 import 권장 — 중복 구현
 * 회피.
 *
 * `readonly`: true 면 IR mutation 없음 (READONLY_TOOL_NAMES set 에
 * 자동 가입). 기본 false.
 *
 * `modes`: 이 도구가 노출되는 TaskMode subset. 빈 배열 또는 omit 시
 * 전체 mode 노출 (legacy 동작 — 0.7.0 default). mode 별 catalog filter
 * 에서 `MODE_REGISTRY[mode].tools` 가 'all' 아닌 array 면 자동 통합.
 *
 * `tags`: 임의 라벨. 디버깅 / future analytics. (0.7.4 에서는 미사용.)
 */
export interface ToolDef<TName extends string, TArgs> {
  readonly name: TName;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly validate: (raw: Record<string, unknown>) => ValidateResult<TArgs>;
  readonly readonly?: boolean;
  readonly modes?: readonly string[];
  readonly tags?: readonly string[];
}

/**
 * Identity helper — type inference 만. `defineTool({...})` 호출만으로
 * `ToolDef<name-literal, args-shape>` 타입이 narrow 됨. 등록은 registry
 * (`shared/ai-tools-defined/index.ts`) 가 모아서 export 하는 array.
 */
export function defineTool<TName extends string, TArgs>(
  def: ToolDef<TName, TArgs>,
): ToolDef<TName, TArgs> {
  return def;
}

/**
 * Registry — defs 배열을 받아 catalog / validator-map / readonly-set /
 * mode-map 을 한 번에 derive. legacy 시스템 (`ai-tool-catalog.ts`,
 * `ai-tool-validate.ts`) 가 이 결과를 합쳐서 최종 surface 노출.
 */
export interface ToolRegistry {
  /** provider tools catalog 용. name + description + inputSchema. */
  descriptors: { name: string; description: string; inputSchema: JsonSchema }[];
  /** tool name → validator. validateToolCall 의 fast-path. */
  validators: Map<
    string,
    (raw: Record<string, unknown>) => ValidateResult<unknown>
  >;
  /** readonly 인 도구 이름 집합. READONLY_TOOL_NAMES 와 union. */
  readonlyNames: Set<string>;
  /** name → ToolDef (full). 필요 시 mode / tags 조회용. */
  byName: Map<string, ToolDef<string, unknown>>;
  /** Migrated 도구 이름 집합. legacy 시스템이 이걸 보고 자기 entry 를
   *  skip — 충돌 방지. */
  migratedNames: Set<string>;
}

export function buildToolRegistry<
  Defs extends readonly ToolDef<string, unknown>[],
>(defs: Defs): ToolRegistry {
  const descriptors: ToolRegistry['descriptors'] = [];
  const validators: ToolRegistry['validators'] = new Map();
  const readonlyNames: ToolRegistry['readonlyNames'] = new Set();
  const byName: ToolRegistry['byName'] = new Map();
  const migratedNames: ToolRegistry['migratedNames'] = new Set();
  for (const d of defs) {
    descriptors.push({
      name: d.name,
      description: d.description,
      inputSchema: d.inputSchema,
    });
    validators.set(
      d.name,
      d.validate as (raw: Record<string, unknown>) => ValidateResult<unknown>,
    );
    if (d.readonly) readonlyNames.add(d.name);
    byName.set(d.name, d as ToolDef<string, unknown>);
    migratedNames.add(d.name);
  }
  return { descriptors, validators, readonlyNames, byName, migratedNames };
}
