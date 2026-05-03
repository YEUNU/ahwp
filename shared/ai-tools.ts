/**
 * Manual 모드 도구 디스패치 — chunk 19. AI가 평문 응답에 단일
 * `\`\`\`ahwp-tools\`\`\`` JSON 블록을 작성하면 렌더러가 화이트리스트
 * 핸들러로 라우팅해 활성 문서 IR을 mutate. provider tool-use API
 * (Anthropic / OpenAI function calling) 바인딩은 Phase 3 Agent 모드로
 * 분리 — 이 모듈은 결정론적 텍스트-기반 디스패처의 contract만 정의한다.
 *
 * 설계 메모 (docs/AI_INTEGRATION.md §Manual 모드 — 도구 디스패치 참조):
 * - 응답 한 개에 블록 하나, 한 블록에 ops 50개 상한
 * - ops는 IR 호출 순서대로 실행 (부분 성공 모델 — 한 op 실패해도 다음 계속)
 * - 검증 실패는 dispatch에 도달 전 거절 (`invalid_args`)
 * - 등록되지 않은 tool은 dispatch 거절 (`unknown_tool`)
 * - eval 절대 금지 — 핸들러는 명시적 switch 분기로만 등록 (chat/tools.ts)
 */

export const AHWP_TOOL_NAMES = [
  'applyHtml',
  'applyAlignment',
  'applyFontSize',
  'applyTextColor',
  'toggleCharFormat',
  'insertFootnote',
  'addBookmark',
  'setHeaderFooterText',
  'applyPageDef',
  'createNamedStyle',
  'createRectShape',
  'applyCellStyle',
] as const;

export type AhwpToolName = (typeof AHWP_TOOL_NAMES)[number];

/**
 * Phase 3 — provider tool-use API 용 카탈로그. `getAhwpToolCatalog()` 가
 * 반환하는 `ChatTool[]` 을 `ChatRequest.tools` 에 주입. JSON Schema (draft-07
 * 호환) 는 각 tool 의 `validateArgs` switch 분기와 lockstep이라 변경 시
 * 양쪽 같이 갱신.
 *
 * description 은 모델이 보는 문자열 — 실제 IR 호출의 의도/제약 (한글 OK).
 * 현재는 chunk 19의 system prompt에 박힌 가이드와 동일한 톤으로 간결하게.
 */
export interface AhwpToolDescriptor {
  name: AhwpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

const TOOL_DESCRIPTORS: AhwpToolDescriptor[] = [
  {
    name: 'applyHtml',
    description:
      '활성 문서 caret 위치에 HTML 조각을 적용. 정렬·줄간격·들여쓰기·문단간격·글자 서식·표 round-trip 가능. <p>, <table>, 인라인 스타일 일부 인식.',
    inputSchema: {
      type: 'object',
      properties: { html: { type: 'string', maxLength: 65536 } },
      required: ['html'],
    },
  },
  {
    name: 'applyAlignment',
    description: '활성 selection / caret 단락의 정렬을 변경.',
    inputSchema: {
      type: 'object',
      properties: {
        align: {
          type: 'string',
          enum: ['left', 'center', 'right', 'justify'],
        },
      },
      required: ['align'],
    },
  },
  {
    name: 'applyFontSize',
    description: '활성 selection / caret 의 글자 크기 (pt) 변경. 1~999.',
    inputSchema: {
      type: 'object',
      properties: { pt: { type: 'number', minimum: 1, maximum: 999 } },
      required: ['pt'],
    },
  },
  {
    name: 'applyTextColor',
    description: '활성 selection / caret 의 글자 색을 #RRGGBB hex 로 변경.',
    inputSchema: {
      type: 'object',
      properties: { hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
      required: ['hex'],
    },
  },
  {
    name: 'toggleCharFormat',
    description: '활성 selection / caret 의 진하게/기울임/밑줄 토글.',
    inputSchema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          enum: ['bold', 'italic', 'underline'],
        },
      },
      required: ['key'],
    },
  },
  {
    name: 'insertFootnote',
    description: '현재 caret 위치에 각주 삽입 + 본문 텍스트 채움.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 4096 } },
      required: ['text'],
    },
  },
  {
    name: 'addBookmark',
    description: '현재 caret 위치에 책갈피 추가. 이름 256B 이하.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 256 } },
      required: ['name'],
    },
  },
  {
    name: 'setHeaderFooterText',
    description:
      '특정 section 의 머리말/꼬리말 텍스트 설정. applyTo: 0=both / 1=odd / 2=even.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        isHeader: { type: 'boolean' },
        applyTo: { type: 'integer', minimum: 0, maximum: 2 },
        text: { type: 'string', maxLength: 4096 },
      },
      required: ['sectionIdx', 'isHeader', 'applyTo', 'text'],
    },
  },
  {
    name: 'applyPageDef',
    description:
      '페이지 설정 (margin/orientation/size 등) 적용. props 는 lib pageDef JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        props: { type: 'object' },
        sectionIdx: { type: 'integer', minimum: 0 },
      },
      required: ['props'],
    },
  },
  {
    name: 'createNamedStyle',
    description: '문서 styleList 에 빈 사용자 스타일 셸 추가 (이름만).',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 256 },
        englishName: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'createRectShape',
    description:
      '현재 caret 위치에 직사각형 도형 컨트롤 삽입. width/height 단위 HWPUNIT (1mm ≈ 28.35 HWPUNIT).',
    inputSchema: {
      type: 'object',
      properties: {
        widthHwpunit: { type: 'number', exclusiveMinimum: 0, maximum: 283500 },
        heightHwpunit: { type: 'number', exclusiveMinimum: 0, maximum: 283500 },
        opts: {
          type: 'object',
          properties: { treatAsChar: { type: 'boolean' } },
        },
      },
      required: ['widthHwpunit', 'heightHwpunit'],
    },
  },
  {
    name: 'applyCellStyle',
    description:
      '특정 셀에 기 등록된 named style 적용. lib 한계로 셀 배경색 직접 설정 불가 — 스타일 경유 필수 (KNOWN_ISSUES L-006).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        cellIdx: { type: 'integer', minimum: 0 },
        cellParaIdx: { type: 'integer', minimum: 0 },
        styleId: { type: 'integer', minimum: 0 },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
        'cellParaIdx',
        'styleId',
      ],
    },
  },
];

/**
 * Phase 3 진입 — `ChatRequest.tools` 에 주입할 카탈로그를 한 번에
 * 가져오기. provider 어댑터에서 native 형식으로 변환 (OpenAI:
 * `{type:'function', function:{...}}`, Anthropic: `{name, description,
 * input_schema}`, Google: `{functionDeclarations:[...]}`).
 */
export function getAhwpToolCatalog(): AhwpToolDescriptor[] {
  return TOOL_DESCRIPTORS;
}

/** Per-tool args. Keep narrow — extra unknown keys are tolerated by the
 * validators but the dispatcher only reads the fields it knows. */
export interface AhwpToolArgs {
  applyHtml: { html: string };
  applyAlignment: { align: 'left' | 'center' | 'right' | 'justify' };
  applyFontSize: { pt: number };
  applyTextColor: { hex: string };
  toggleCharFormat: { key: 'bold' | 'italic' | 'underline' };
  insertFootnote: { text: string };
  addBookmark: { name: string };
  setHeaderFooterText: {
    sectionIdx: number;
    isHeader: boolean;
    applyTo: number;
    text: string;
  };
  applyPageDef: {
    props: Record<string, unknown>;
    sectionIdx?: number;
  };
  createNamedStyle: {
    name: string;
    englishName?: string;
  };
  createRectShape: {
    widthHwpunit: number;
    heightHwpunit: number;
    opts?: { treatAsChar?: boolean };
  };
  /** Apply a pre-existing named style to a cell — chunk 23. The
   * library has no direct cell background-color setter; the only
   * route is via styles. See KNOWN_ISSUES L-006. */
  applyCellStyle: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
    cellParaIdx: number;
    styleId: number;
  };
}

/** A single op as it appears inside the model-authored block. */
export type AhwpToolCall = {
  [K in AhwpToolName]: { tool: K; args: AhwpToolArgs[K] };
}[AhwpToolName];

/** Top-level shape of a parsed `ahwp-tools` block. */
export interface AhwpToolBlock {
  ops: AhwpToolCall[];
}

/** Outcome of running a single op. `ok=false` covers both pre-flight
 * validation failures and IR-side throws (caller distinguishes via
 * `reason`). */
export type AhwpToolResult =
  | { ok: true; tool: AhwpToolName }
  | { ok: false; tool: string; reason: string };

/** Hard ceilings — anything bigger is rejected before dispatch. */
export const AHWP_TOOL_LIMITS = {
  maxOpsPerBlock: 50,
  maxHtmlBytes: 64 * 1024,
  maxTextBytes: 4 * 1024,
  maxNameBytes: 256,
  maxFontSizePt: 999,
  maxShapeHwpunit: 283_500,
} as const;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Validate an op's args. Returns the typed args on success, or a
 * machine-readable failure reason. The dispatcher consults this before
 * the IR call — no validator means the tool is unsupported. */
export function validateToolCall(
  call: unknown,
):
  | { ok: true; value: AhwpToolCall }
  | { ok: false; tool: string; reason: string } {
  if (!isObj(call))
    return { ok: false, tool: '<root>', reason: 'op-not-object' };
  const tool = call.tool;
  if (typeof tool !== 'string')
    return { ok: false, tool: '<missing>', reason: 'tool-not-string' };
  if (!(AHWP_TOOL_NAMES as readonly string[]).includes(tool))
    return { ok: false, tool, reason: 'unknown_tool' };
  const args = call.args;
  if (!isObj(args)) return { ok: false, tool, reason: 'args-not-object' };
  const v = validateArgs(tool as AhwpToolName, args);
  if (!v.ok) return { ok: false, tool, reason: v.reason };
  return { ok: true, value: { tool, args: v.value } as AhwpToolCall };
}

function validateArgs<T extends AhwpToolName>(
  tool: T,
  args: Record<string, unknown>,
): { ok: true; value: AhwpToolArgs[T] } | { ok: false; reason: string } {
  switch (tool) {
    case 'applyHtml': {
      const html = args.html;
      if (typeof html !== 'string')
        return { ok: false, reason: 'html-not-string' };
      if (byteLen(html) > AHWP_TOOL_LIMITS.maxHtmlBytes)
        return { ok: false, reason: 'html-too-large' };
      return {
        ok: true,
        value: { html } as AhwpToolArgs[T],
      };
    }
    case 'applyAlignment': {
      const align = args.align;
      if (
        align !== 'left' &&
        align !== 'center' &&
        align !== 'right' &&
        align !== 'justify'
      )
        return { ok: false, reason: 'align-not-enum' };
      return { ok: true, value: { align } as AhwpToolArgs[T] };
    }
    case 'applyFontSize': {
      const pt = args.pt;
      if (typeof pt !== 'number' || !Number.isFinite(pt))
        return { ok: false, reason: 'pt-not-number' };
      if (pt < 1 || pt > AHWP_TOOL_LIMITS.maxFontSizePt)
        return { ok: false, reason: 'pt-out-of-range' };
      return { ok: true, value: { pt } as AhwpToolArgs[T] };
    }
    case 'applyTextColor': {
      const hex = args.hex;
      if (typeof hex !== 'string')
        return { ok: false, reason: 'hex-not-string' };
      if (!HEX_COLOR_RE.test(hex))
        return { ok: false, reason: 'hex-not-rrggbb' };
      return { ok: true, value: { hex } as AhwpToolArgs[T] };
    }
    case 'toggleCharFormat': {
      const key = args.key;
      if (key !== 'bold' && key !== 'italic' && key !== 'underline')
        return { ok: false, reason: 'key-not-enum' };
      return { ok: true, value: { key } as AhwpToolArgs[T] };
    }
    case 'insertFootnote': {
      const text = args.text;
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return { ok: true, value: { text } as AhwpToolArgs[T] };
    }
    case 'addBookmark': {
      const name = args.name;
      if (typeof name !== 'string')
        return { ok: false, reason: 'name-not-string' };
      if (name.length === 0) return { ok: false, reason: 'name-empty' };
      if (byteLen(name) > AHWP_TOOL_LIMITS.maxNameBytes)
        return { ok: false, reason: 'name-too-large' };
      return { ok: true, value: { name } as AhwpToolArgs[T] };
    }
    case 'setHeaderFooterText': {
      const sectionIdx = args.sectionIdx;
      const isHeader = args.isHeader;
      const applyTo = args.applyTo;
      const text = args.text;
      if (typeof sectionIdx !== 'number' || !Number.isInteger(sectionIdx))
        return { ok: false, reason: 'sectionIdx-not-int' };
      if (typeof isHeader !== 'boolean')
        return { ok: false, reason: 'isHeader-not-bool' };
      if (typeof applyTo !== 'number' || !Number.isInteger(applyTo))
        return { ok: false, reason: 'applyTo-not-int' };
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return {
        ok: true,
        value: { sectionIdx, isHeader, applyTo, text } as AhwpToolArgs[T],
      };
    }
    case 'applyPageDef': {
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      const sectionIdx = args.sectionIdx;
      if (
        sectionIdx !== undefined &&
        (typeof sectionIdx !== 'number' || !Number.isInteger(sectionIdx))
      )
        return { ok: false, reason: 'sectionIdx-not-int' };
      return {
        ok: true,
        value: { props, sectionIdx } as AhwpToolArgs[T],
      };
    }
    case 'createNamedStyle': {
      const name = args.name;
      const englishName = args.englishName;
      if (typeof name !== 'string')
        return { ok: false, reason: 'name-not-string' };
      if (name.length === 0) return { ok: false, reason: 'name-empty' };
      if (byteLen(name) > AHWP_TOOL_LIMITS.maxNameBytes)
        return { ok: false, reason: 'name-too-large' };
      if (englishName !== undefined && typeof englishName !== 'string')
        return { ok: false, reason: 'englishName-not-string' };
      return {
        ok: true,
        value: { name, englishName } as AhwpToolArgs[T],
      };
    }
    case 'createRectShape': {
      const w = args.widthHwpunit;
      const h = args.heightHwpunit;
      if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0)
        return { ok: false, reason: 'width-not-positive' };
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0)
        return { ok: false, reason: 'height-not-positive' };
      if (w > AHWP_TOOL_LIMITS.maxShapeHwpunit)
        return { ok: false, reason: 'width-too-large' };
      if (h > AHWP_TOOL_LIMITS.maxShapeHwpunit)
        return { ok: false, reason: 'height-too-large' };
      const opts = args.opts;
      if (opts !== undefined && !isObj(opts))
        return { ok: false, reason: 'opts-not-object' };
      const treatAsChar = opts?.treatAsChar;
      if (treatAsChar !== undefined && typeof treatAsChar !== 'boolean')
        return { ok: false, reason: 'treatAsChar-not-bool' };
      return {
        ok: true,
        value: {
          widthHwpunit: w,
          heightHwpunit: h,
          opts: opts === undefined ? undefined : { treatAsChar },
        } as AhwpToolArgs[T],
      };
    }
    case 'applyCellStyle': {
      const keys = [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
        'cellParaIdx',
        'styleId',
      ] as const;
      const out: Record<string, number> = {};
      for (const k of keys) {
        const v = args[k];
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
          return { ok: false, reason: `${k}-not-non-negative-int` };
        out[k] = v;
      }
      return { ok: true, value: out as AhwpToolArgs[T] };
    }
    default: {
      // Exhaustiveness — the AHWP_TOOL_NAMES guard above already filters
      // unknown names, so this branch is unreachable unless the registry
      // and the type drift apart.
      const _exhaustive: never = tool;
      return { ok: false, reason: `unknown_tool:${String(_exhaustive)}` };
    }
  }
}

/** Pre-flight item: per-op validation result. Both arms are kept (the
 * preview lists failures in red so the user sees what the model got
 * wrong); the dispatcher only runs the `ok: true` arm. */
export type AhwpPreflightItem =
  | { ok: true; call: AhwpToolCall }
  | { ok: false; tool: string; reason: string };

/** Parse a model-authored block. Block-level failures (parse error,
 * not-an-array, over op limit) reject the whole thing. Per-op
 * validation failures are kept as `ok: false` items so the preview can
 * show them — the dispatcher runs only the successful ones. */
export function parseToolBlock(
  raw: string,
): { ok: true; items: AhwpPreflightItem[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, reason: `parse:${(err as Error).message}` };
  }
  if (!isObj(parsed)) return { ok: false, reason: 'root-not-object' };
  const ops = parsed.ops;
  if (!Array.isArray(ops)) return { ok: false, reason: 'ops-not-array' };
  if (ops.length === 0) return { ok: false, reason: 'ops-empty' };
  if (ops.length > AHWP_TOOL_LIMITS.maxOpsPerBlock)
    return { ok: false, reason: 'ops-over-limit' };
  const items: AhwpPreflightItem[] = ops.map((op) => {
    const v = validateToolCall(op);
    if (v.ok) return { ok: true, call: v.value };
    return { ok: false, tool: v.tool, reason: v.reason };
  });
  return { ok: true, items };
}
