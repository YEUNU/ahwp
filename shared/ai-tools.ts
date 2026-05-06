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
  // chunk 19 — manual mode dispatcher (Phase 2)
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
  // Phase 3 chunk 45 — body edit primitives + char/para format
  'insertText',
  'deleteRange',
  'insertParagraph',
  'deleteParagraph',
  'mergeParagraph',
  'applyCharFormat',
  'applyParaProps',
  'applyStyle',
  // Phase 3 chunk 46 — table structure
  'createTable',
  'insertTableRow',
  'insertTableColumn',
  'deleteTableRow',
  'deleteTableColumn',
  'mergeTableCells',
  'splitTableCellInto',
  'unmergeCell',
  'setTableProperties',
  'setCellProperties',
  'evaluateTableFormula',
  'deleteTableControl',
  // Phase 3 chunk 47 — image/shape
  'setPictureProperties',
  'deletePictureControl',
  'setShapeProperties',
  'deleteShapeControl',
  'changeShapeZOrder',
  'insertPicture',
  // Phase 3 chunk 48 — page/section
  'insertPageBreak',
  'insertColumnBreak',
  'setColumnDef',
  'setSectionDef',
  'setPageHide',
  // Phase 3 chunk 49 — header/footer + bookmark
  'applyHfTemplate',
  'createHeaderFooter',
  'deleteHeaderFooter',
  'deleteBookmark',
  // 0.4.16 — cell-level write (양식 표지 cell 채우기)
  'insertTextInCell',
  // Phase 3 chunk 51 — read-only Agent tools (양식 매칭 / 위치 결정)
  'getDocumentOutline',
  'getDocumentSummary',
  'getStyleListJson',
  'getStyleAt',
  'getCharPropertiesAt',
  'getParaPropertiesAt',
  'getTextRange',
  'getCaretPosition',
  'findInDocument',
  'getCellInfo',
  // Phase 5 chunk 96 — outline-as-router workspace search
  'searchWorkspaceOutlines',
  'readParagraphByPath',
  // chunk 99 follow-up — cross-doc write routing. switchTargetDoc 가
  // turn 의 활성 write target 을 절대 경로로 변경. read-only 분류 (실제
  // IR 변경 없음 — 그냥 라우팅 ref 갱신).
  'switchTargetDoc',
] as const;

export type AhwpToolName = (typeof AHWP_TOOL_NAMES)[number];

/**
 * Phase 5 chunk 97 — Manual/Agent 통합. 읽기 전용 도구 set. 활성 doc /
 * 워크스페이스 의 IR 을 변경하지 않으니 사용자 승인 없이 즉시 실행해도
 * 안전하다. 쓰기 도구는 기본 검토 게이트 통과 후 실행 (Settings 의
 * "쓰기 도구 자동 승인" 토글로 우회 가능).
 */
export const READONLY_TOOL_NAMES = new Set<AhwpToolName>([
  'getDocumentOutline',
  'getDocumentSummary',
  'getStyleListJson',
  'getStyleAt',
  'getCharPropertiesAt',
  'getParaPropertiesAt',
  'getTextRange',
  'getCaretPosition',
  'findInDocument',
  'getCellInfo',
  'searchWorkspaceOutlines',
  'readParagraphByPath',
  // chunk 99 follow-up — switchTargetDoc 는 IR 을 변경하지 않으므로
  // read-only 게이트로 분류 (즉시 실행, 사용자 승인 불필요).
  'switchTargetDoc',
]);

export function isReadOnlyTool(name: string): boolean {
  return READONLY_TOOL_NAMES.has(name as AhwpToolName);
}

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
  // Phase 3 chunk 45 — body edit primitives
  insertText: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
    text: string;
  };
  deleteRange: {
    sectionIdx: number;
    startParagraphIdx: number;
    startOffset: number;
    endParagraphIdx: number;
    endOffset: number;
  };
  insertParagraph: { sectionIdx: number; paragraphIdx: number };
  deleteParagraph: { sectionIdx: number; paragraphIdx: number };
  mergeParagraph: { sectionIdx: number; paragraphIdx: number };
  applyCharFormat: {
    sectionIdx: number;
    paragraphIdx: number;
    startOffset: number;
    endOffset: number;
    /** lib applyCharFormat 의 props_json 를 그대로 받음. 키:
     *  bold/italic/underline (boolean), strikeThrough (boolean),
     *  subscript/superscript (boolean), name (font family string),
     *  size_hu (HWPUNIT, 1pt=100), color/shadeColor (#RRGGBB), etc.
     *  추가 키는 lib quirk 에 따라 무시됨. */
    props: Record<string, unknown>;
  };
  applyParaProps: {
    /** alignment / lineSpacing / lineSpacingType / spacingBefore /
     *  spacingAfter / marginLeft / marginRight / indent — 모두 optional.
     *  ViewerHandle.applyParaProps 와 동일 schema. */
    props: Record<string, unknown>;
  };
  applyStyle: {
    sectionIdx: number;
    paragraphIdx: number;
    styleId: number;
  };
  // Phase 3 chunk 46 — table structure
  createTable: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
    rowCount: number;
    colCount: number;
  };
  insertTableRow: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    rowIdx: number;
    below: boolean;
  };
  insertTableColumn: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    colIdx: number;
    right: boolean;
  };
  deleteTableRow: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    rowIdx: number;
  };
  deleteTableColumn: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    colIdx: number;
  };
  mergeTableCells: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  };
  splitTableCellInto: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    row: number;
    col: number;
    nRows: number;
    mCols: number;
    equalRowHeight: boolean;
    mergeFirst: boolean;
  };
  unmergeCell: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    row: number;
    col: number;
  };
  setTableProperties: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    props: Record<string, unknown>;
  };
  setCellProperties: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
    props: Record<string, unknown>;
  };
  evaluateTableFormula: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    targetRow: number;
    targetCol: number;
    formula: string;
    writeResult: boolean;
  };
  deleteTableControl: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
  };
  // Phase 3 chunk 47 — image/shape
  setPictureProperties: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    props: Record<string, unknown>;
  };
  deletePictureControl: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
  };
  setShapeProperties: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    props: Record<string, unknown>;
  };
  deleteShapeControl: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
  };
  changeShapeZOrder: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    operation: 'top' | 'bottom' | 'forward' | 'backward';
  };
  insertPicture: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
    /** Base64-encoded image bytes (PNG/JPEG/GIF/BMP). */
    base64Data: string;
    widthHwpunit: number;
    heightHwpunit: number;
    naturalWidthPx: number;
    naturalHeightPx: number;
    extension: string;
    description: string;
  };
  // Phase 3 chunk 48 — page/section
  insertPageBreak: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
  };
  insertColumnBreak: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
  };
  setColumnDef: {
    sectionIdx: number;
    columnCount: number;
    /** 0=Newspaper, 1=BalancedNewspaper, 2=Parallel (lib enum). */
    columnType: number;
    /** 1 if columns share equal width, else 0. */
    sameWidth: number;
    /** Spacing between columns in HWPUNIT (1mm ≈ 567). */
    spacingHu: number;
  };
  setSectionDef: {
    sectionIdx: number;
    props: Record<string, unknown>;
  };
  setPageHide: {
    sectionIdx: number;
    paragraphIdx: number;
    hideHeader: boolean;
    hideFooter: boolean;
    hideMaster: boolean;
    hideBorder: boolean;
    hideFill: boolean;
    hidePageNum: boolean;
  };
  // Phase 3 chunk 49 — header/footer + bookmark
  applyHfTemplate: {
    sectionIdx: number;
    isHeader: boolean;
    applyTo: number;
    templateId: number;
  };
  createHeaderFooter: {
    sectionIdx: number;
    isHeader: boolean;
    applyTo: number;
  };
  deleteHeaderFooter: {
    sectionIdx: number;
    isHeader: boolean;
    applyTo: number;
  };
  deleteBookmark: {
    sectionIdx: number;
    paragraphIdx: number;
    controlIdx: number;
  };
  // 0.4.16 — cell-level write
  insertTextInCell: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
    cellParaIdx: number;
    charOffset: number;
    text: string;
  };
  // Phase 3 chunk 51 — read-only Agent tools
  getDocumentOutline: Record<string, never>;
  getDocumentSummary: Record<string, never>;
  getStyleListJson: Record<string, never>;
  getStyleAt: { sectionIdx: number; paragraphIdx: number };
  getCharPropertiesAt: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
  };
  getParaPropertiesAt: { sectionIdx: number; paragraphIdx: number };
  getTextRange: {
    sectionIdx: number;
    startParagraphIdx: number;
    startOffset: number;
    endParagraphIdx: number;
    endOffset: number;
  };
  getCaretPosition: Record<string, never>;
  findInDocument: { query: string; maxResults?: number };
  getCellInfo: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
  };
  // Phase 5 chunk 96 — outline-as-router workspace search
  searchWorkspaceOutlines: { maxDocs?: number };
  readParagraphByPath: {
    path: string;
    sectionIdx: number;
    paragraphIdx: number;
    contextParagraphs?: number;
  };
  // chunk 99 follow-up — switchTargetDoc args.
  switchTargetDoc: { path: string };
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
 * `reason`).
 *
 * Phase 3 chunk 51 — read tool 의 결과는 `data` 에 JSON 으로 담음.
 * Agent loop 가 다음 turn 의 tool_result 메시지에 stringify 해서 모델
 * 에 회신. write tool 은 `data` 미사용 (success/failure 만 의미). */
export type AhwpToolResult =
  | { ok: true; tool: AhwpToolName; data?: unknown }
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

// R4 — TOOL_DESCRIPTORS / getAhwpToolCatalog / validateToolCall /
// parseToolBlock 은 ai-tool-{catalog,validate,parse}.ts 로 분리.
// 본 파일은 이름 / 타입 / 한도 만 정의하고 나머지는 re-export.
export { getAhwpToolCatalog } from './ai-tool-catalog';
export { validateToolCall } from './ai-tool-validate';
export { parseToolBlock, type AhwpPreflightItem } from './ai-tool-parse';
