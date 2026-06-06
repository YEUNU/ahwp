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

import type { ExpectedFormat } from './form-format';

export const AHWP_TOOL_NAMES = [
  // chunk 19 — manual mode dispatcher (Phase 2)
  'applyHtml',
  'applyAlignment',
  'applyFontSize',
  'applyTextColor',
  'toggleCharFormat',
  'insertFootnote',
  'insertEndnote',
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
  // 0.6.15 — atomic replace (placeholder/예시문 제거 + 새 값) + modify workflow
  'replaceTextInCell',
  // 0.7.13 — bulk cell fill (다수 셀 1 call = 1 turn)
  'fillFormCells',
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
  // 0.4.24 — @rhwp/core 0.7.11 신규 API
  'insertEquation',
  'deleteFootnote',
  'deleteEquationControl',
  'getColumnDef',
  // 0.7.14 — 쪽 테두리/배경 (@rhwp/core get/setPageBorderFill)
  'getPageBorderFill',
  'setPageBorderFill',
  'getFootnoteAtCursor',
  // 0.4.21 — empty form-field discovery (양식 채우기 baseline)
  'getEmptyFormFields',
  // 0.6.17 — Phase B 시각 검증 MVP. 한 페이지를 SVG 로 캡처.
  'getPageSvg',
  // Phase 5 chunk 96 — outline-as-router workspace search
  'searchWorkspaceOutlines',
  'readParagraphByPath',
  // chunk 99 follow-up — cross-doc write routing. switchTargetDoc 가
  // turn 의 활성 write target 을 절대 경로로 변경. read-only 분류 (실제
  // IR 변경 없음 — 그냥 라우팅 ref 갱신).
  'switchTargetDoc',
  // 0.7.7 — external world access (cross-doc-research mode 의 핵심).
  // 워크스페이스 외 정보 (URL / 검색결과) 조회. 모두 read-only — IR 변경
  // 없음. 사용자 confirm 게이트 없이 즉시 실행.
  'webFetch',
  'webSearch',
  // 0.7.9 — Bash 명령 실행. Default OFF (사용자 명시 enable 필요).
  // Allowlist 기반 (사용자 등록 prefix 만 허용) + workspace cwd 강제 +
  // 60s timeout + 32KB output cap + hardcoded blocklist (rm -rf, sudo 등).
  // catalog 노출은 enable 토글 ON + allowlist 비어있지 않을 때만.
  'runCommand',
  // 0.7.11 — Sub-agent dispatch. AI 가 자기 turn 안에서 별도 sub-agent
  // 호출. sub-agent 는 다른 mode / 도구 set 으로 자유롭게 작업 후 final
  // text 만 parent 에 반환. context window 보존 + 복잡한 다단계 작업
  // 위임. 재귀 차단 (sub-agent 의 catalog 에서 runAgent 제외).
  'runAgent',
  // 0.7.29 — Claude Code TodoWrite analog. 다단계 작업(특히 대형 양식)의
  // 진행을 모델이 명시 추적 → 섹션 누락/중복 방지 + 사용자 진행 가시성.
  // doc IR 미변경 (read-only 분류) — 즉시 실행, 승인 게이트 없음.
  'updatePlan',
] as const;

export type AhwpToolName = (typeof AHWP_TOOL_NAMES)[number];

/** 0.7.29 — `updatePlan` 의 작업 항목. Claude Code TodoWrite 와 동형. */
export type PlanItemStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'skipped';
export interface PlanItem {
  /** 한 줄 작업 설명 (대형 양식이면 보통 섹션/표 단위). */
  title: string;
  status: PlanItemStatus;
}

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
  'getColumnDef',
  'getPageBorderFill',
  'getFootnoteAtCursor',
  'getEmptyFormFields',
  'getPageSvg',
  'searchWorkspaceOutlines',
  'readParagraphByPath',
  // chunk 99 follow-up — switchTargetDoc 는 IR 을 변경하지 않으므로
  // read-only 게이트로 분류 (즉시 실행, 사용자 승인 불필요).
  'switchTargetDoc',
  // 0.7.7 — external world read-only.
  'webFetch',
  'webSearch',
  // 0.7.29 — plan 갱신은 doc IR 미변경 (app 상태만). read-only 게이트로
  // 즉시 실행 + write 배치의 reflow 트리거 안 함.
  'updatePlan',
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
  insertEndnote: { text: string };
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
    /** 0.7.14 — optional: insert into a TABLE CELL instead of the body.
     *  Path from the table control down: [{controlIndex, cellIndex,
     *  cellParaIndex}, ...] (controlIndex/cellIndex come from
     *  getEmptyFormFields). paragraphIdx is the table's own paragraph. */
    cellPath?: {
      controlIndex: number;
      cellIndex: number;
      cellParaIndex: number;
    }[];
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
  setPageBorderFill: {
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
  // 0.4.16 — cell-level write.
  // 0.7.12 — optional expectedFormat 로 컬럼 의미 미준수 reject.
  insertTextInCell: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
    cellParaIdx: number;
    charOffset: number;
    text: string;
    /** 셀의 expectedFormat (getEmptyFormFields 결과에서 그대로 echo).
     *  지정 시 text 가 포맷을 위반하면 dispatch 전 reject. */
    expectedFormat?: ExpectedFormat;
  };
  // 0.6.15 — atomic replace. 기존 셀 내용을 모두 지우고 text 로 교체.
  // text='' 는 effectively clear. charOffset 인자가 없는 이유:
  // replace 의미상 "셀 전체" 가 대상이라 offset 이 무의미.
  // 0.7.12 — optional expectedFormat (insertTextInCell 과 동일 의미).
  replaceTextInCell: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
    cellIdx: number;
    cellParaIdx: number;
    text: string;
    /** 셀의 expectedFormat (getEmptyFormFields 결과에서 그대로 echo). */
    expectedFormat?: ExpectedFormat;
  };
  // 0.7.13 — bulk cell fill. form-fill turn 예산 보호: 다수 셀을 한 tool
  // call 로 채워 단일 insert/replace N회(= N turn)를 1회로 압축. 각 cell 이
  // 자기 좌표를 모두 보유 (한 form 이 여러 표/control 에 걸쳐 hoist 불가).
  fillFormCells: {
    cells: {
      sectionIdx: number;
      parentParaIdx: number;
      controlIdx: number;
      cellIdx: number;
      cellParaIdx: number;
      text: string;
      /** 'insert' (default; value-slot 채우기) | 'replace' (instruction
       *  placeholder 교체 / 기존값 수정; atomic delete+insert). */
      mode?: 'insert' | 'replace';
      /** insert 시 삽입 위치. default 0. mode='replace' 에선 무시. */
      charOffset?: number;
      /** 셀의 expectedFormat (getEmptyFormFields 결과에서 echo). */
      expectedFormat?: ExpectedFormat;
    }[];
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
  // 0.4.24 — @rhwp/core 0.7.11 신규 API
  insertEquation: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
    script: string;
    fontSizeHwpunit?: number;
    color?: number;
  };
  deleteFootnote: {
    sectionIdx: number;
    paragraphIdx: number;
    controlIdx: number;
  };
  deleteEquationControl: {
    sectionIdx: number;
    parentParaIdx: number;
    controlIdx: number;
  };
  getColumnDef: { sectionIdx: number };
  getPageBorderFill: { sectionIdx: number };
  getFootnoteAtCursor: {
    sectionIdx: number;
    paragraphIdx: number;
    charOffset: number;
    direction: 'forward' | 'backward';
  };
  // 0.4.21 — empty form-field enumeration.
  // parentParaIdx scopes to a single table (composable with sectionIdx).
  // Use the tableInventory entries returned from the first call to pick.
  // 0.6.15 — includeFilled 옵션: true 면 채워진 셀도 반환 (각 셀에
  // isEmpty + contentCharShape 포함). 수정 / placeholder 제거 workflow 용.
  getEmptyFormFields: {
    sectionIdx?: number;
    parentParaIdx?: number;
    maxResults?: number;
    includeFilled?: boolean;
  };
  // 0.6.17 — Phase B 시각 검증. 한 페이지 SVG 캡처.
  getPageSvg: { pageIdx: number };
  // 0.7.29 — TodoWrite analog. 작업 계획 전체를 매번 통째로 전달(replace).
  updatePlan: { items: PlanItem[] };
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
  // 0.7.7 — external world access.
  webFetch: {
    /** http:// or https:// URL. 그 외 scheme 거부. */
    url: string;
    /** 선택. AI 가 받은 본문에서 요약 / 추출하고 싶은 의도 hint
     *  (응답에 그대로 echo — 모델이 자기 prompt 에서 활용). */
    prompt?: string;
    /** 응답 본문의 최대 byte 수. 기본 32768 (32 KB). 큰 페이지는 trim. */
    maxBytes?: number;
  };
  webSearch: {
    /** 검색어. 1024 bytes 이하. */
    query: string;
    /** 결과 최대 개수. 1-20, 기본 10. */
    maxResults?: number;
  };
  // 0.7.9 — Bash 명령 실행 (allowlist 기반).
  runCommand: {
    /** 실행할 명령 문자열. allowlist 의 prefix 와 매치해야 함. */
    command: string;
    /** 작업 디렉토리 (workspace root 기준 상대 경로). 절대 경로 거부. */
    cwd?: string;
    /** Timeout (ms). 기본 60000, 최대 300000. */
    timeoutMs?: number;
  };
  // 0.7.11 — Sub-agent dispatch.
  runAgent: {
    /** Sub-agent 가 받는 task instruction. parent 가 명확한 목표 명시. */
    prompt: string;
    /** Sub-agent 의 mode. 없으면 parent mode 사용.
     *  - 'cross-doc-research': 외부 검색 / 워크스페이스 read-only
     *  - 'free-authoring': 모든 도구 사용 가능 (write 포함)
     *  - 'form-fill': 셀 write 만 (양식 전용)
     *  - 'body-edit': body text 편집 도구
     */
    mode?:
      | 'cross-doc-research'
      | 'free-authoring'
      | 'form-fill'
      | 'body-edit'
      | 'table-manipulation'
      | 'formatting';
    /** Max turns (1-30, 기본 10). parent 의 agentMaxTurns 와 독립. */
    maxTurns?: number;
  };
}

/** A single op as it appears inside the model-authored block. */
export type AhwpToolCall = {
  [K in AhwpToolName]: { tool: K; args: AhwpToolArgs[K] };
}[AhwpToolName];

/** Outcome of running a single op. `ok=false` covers both pre-flight
 * validation failures and IR-side throws (caller distinguishes via
 * `reason`).
 *
 * Phase 3 chunk 51 — read tool 의 결과는 `data` 에 JSON 으로 담음.
 * Agent loop 가 다음 turn 의 tool_result 메시지에 stringify 해서 모델
 * 에 회신. write tool 은 `data` 미사용 (success/failure 만 의미).
 *
 * 0.4.23 — write tool 의 synthetic diff. dispatcher 가 호출 전/후 영향
 * paragraph 의 텍스트를 snapshot 하면 `diff` 에 담는다. UI 가 tool entry
 * 옆에 inline DiffCard 로 렌더. 모델에는 전달 안 함 (UI 전용). */
export interface ToolResultDiff {
  paragraphIdx: number;
  before: string;
  after: string;
  /** Display-only label. */
  label?: string;
}
export type AhwpToolResult =
  | { ok: true; tool: AhwpToolName; data?: unknown; diff?: ToolResultDiff }
  | { ok: false; tool: string; reason: string };

/** Hard ceilings — anything bigger is rejected before dispatch. */
export const AHWP_TOOL_LIMITS = {
  maxOpsPerBlock: 50,
  /** 0.7.13 — fillFormCells 한 호출당 셀 수 상한. getEmptyFormFields 의
   *  default maxResults(200) 와 맞춰 큰 표도 한 read→한 fill 로 처리. */
  maxFormCellsPerCall: 200,
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
