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
