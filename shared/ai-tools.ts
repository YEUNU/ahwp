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
  // Phase 3 chunk 51 — read-only Agent tools (양식 매칭 / 위치 결정)
  'getDocumentOutline',
  'getStyleListJson',
  'getStyleAt',
  'getCharPropertiesAt',
  'getParaPropertiesAt',
  'getTextRange',
  'getCaretPosition',
  'findInDocument',
  'getCellInfo',
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
  // === Phase 3 chunk 45 — body edit primitives + char/para format ===
  {
    name: 'insertText',
    description:
      '특정 위치 (sectionIdx, paragraphIdx, charOffset) 에 텍스트 삽입. applyHtml 우회 없이 raw 텍스트만 추가할 때 사용.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
        text: { type: 'string', maxLength: 4096 },
      },
      required: ['sectionIdx', 'paragraphIdx', 'charOffset', 'text'],
    },
  },
  {
    name: 'deleteRange',
    description: '특정 paragraph/offset 범위의 텍스트 삭제 (단락 across 가능).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        startParagraphIdx: { type: 'integer', minimum: 0 },
        startOffset: { type: 'integer', minimum: 0 },
        endParagraphIdx: { type: 'integer', minimum: 0 },
        endOffset: { type: 'integer', minimum: 0 },
      },
      required: [
        'sectionIdx',
        'startParagraphIdx',
        'startOffset',
        'endParagraphIdx',
        'endOffset',
      ],
    },
  },
  {
    name: 'insertParagraph',
    description: 'paragraphIdx 위치에 새 단락을 삽입 (분리). 캐럿 단락 분리.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx'],
    },
  },
  {
    name: 'deleteParagraph',
    description: '단락 통째 삭제 (앞 단락에 합쳐짐).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx'],
    },
  },
  {
    name: 'mergeParagraph',
    description: '이 단락을 다음 단락과 합치기 (단락 break 제거).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx'],
    },
  },
  {
    name: 'applyCharFormat',
    description:
      '특정 범위 글자 서식 통합 적용. props 키: bold/italic/underline (boolean), strikeThrough, subscript/superscript, name (font family string), size_hu (HWPUNIT, pt×100), color (#RRGGBB int), shadeColor 등. lib applyCharFormat 의 props_json 을 그대로 받음.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        startOffset: { type: 'integer', minimum: 0 },
        endOffset: { type: 'integer', minimum: 0 },
        props: { type: 'object' },
      },
      required: [
        'sectionIdx',
        'paragraphIdx',
        'startOffset',
        'endOffset',
        'props',
      ],
    },
  },
  {
    name: 'applyParaProps',
    description:
      '활성 caret/selection 단락에 props 일괄 적용. props 키 (모두 optional): alignment (left/center/right/justify), lineSpacing (percent), lineSpacingType (Percent/Fixed/AtLeast), spacingBefore/spacingAfter (HWPUNIT), marginLeft/marginRight (HWPUNIT), indent (HWPUNIT, +첫줄 / -hanging).',
    inputSchema: {
      type: 'object',
      properties: { props: { type: 'object' } },
      required: ['props'],
    },
  },
  {
    name: 'applyStyle',
    description: '명명된 스타일을 단락에 적용. styleId 는 styleList 에서 조회.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        styleId: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx', 'styleId'],
    },
  },
  // === Phase 3 chunk 46 — table structure ===
  {
    name: 'createTable',
    description: '특정 위치에 N행 M열 표 생성. 행/열 1~100/50.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
        rowCount: { type: 'integer', minimum: 1, maximum: 100 },
        colCount: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: [
        'sectionIdx',
        'paragraphIdx',
        'charOffset',
        'rowCount',
        'colCount',
      ],
    },
  },
  {
    name: 'insertTableRow',
    description:
      '표에 행 1개 삽입. below=true 면 rowIdx 아래, false 면 위에 삽입.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        rowIdx: { type: 'integer', minimum: 0 },
        below: { type: 'boolean' },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'rowIdx',
        'below',
      ],
    },
  },
  {
    name: 'insertTableColumn',
    description:
      '표에 열 1개 삽입. right=true 면 colIdx 오른쪽, false 면 왼쪽.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        colIdx: { type: 'integer', minimum: 0 },
        right: { type: 'boolean' },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'colIdx',
        'right',
      ],
    },
  },
  {
    name: 'deleteTableRow',
    description: '표 행 1개 제거. 마지막 행 시도 시 lib 가 거절.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        rowIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'rowIdx'],
    },
  },
  {
    name: 'deleteTableColumn',
    description: '표 열 1개 제거.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        colIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'colIdx'],
    },
  },
  {
    name: 'mergeTableCells',
    description:
      '표 영역 (startRow,startCol)~(endRow,endCol) 셀 일괄 병합. 사각 영역.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        startRow: { type: 'integer', minimum: 0 },
        startCol: { type: 'integer', minimum: 0 },
        endRow: { type: 'integer', minimum: 0 },
        endCol: { type: 'integer', minimum: 0 },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'startRow',
        'startCol',
        'endRow',
        'endCol',
      ],
    },
  },
  {
    name: 'splitTableCellInto',
    description:
      '특정 셀 하나를 nRows × mCols 로 분할. equalRowHeight/mergeFirst 옵션.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        row: { type: 'integer', minimum: 0 },
        col: { type: 'integer', minimum: 0 },
        nRows: { type: 'integer', minimum: 1 },
        mCols: { type: 'integer', minimum: 1 },
        equalRowHeight: { type: 'boolean' },
        mergeFirst: { type: 'boolean' },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'row',
        'col',
        'nRows',
        'mCols',
        'equalRowHeight',
        'mergeFirst',
      ],
    },
  },
  {
    name: 'unmergeCell',
    description: '병합된 셀을 unmerge (원래 row×col 로 되돌림).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        row: { type: 'integer', minimum: 0 },
        col: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'row', 'col'],
    },
  },
  {
    name: 'setTableProperties',
    description:
      '표 전체 속성 변경 (테두리/너비 등). props 는 lib setTableProperties JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        props: { type: 'object' },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'props'],
    },
  },
  {
    name: 'setCellProperties',
    description:
      '셀 1개 속성 변경 (테두리/배경색-스타일 경유). props 는 lib setCellProperties JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        cellIdx: { type: 'integer', minimum: 0 },
        props: { type: 'object' },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
        'props',
      ],
    },
  },
  {
    name: 'evaluateTableFormula',
    description:
      '표 셀 수식 평가. formula HWP 문법 (예: =SUM(A1:A5), =A1*B2). writeResult=true 면 셀에 결과 작성.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        targetRow: { type: 'integer', minimum: 0 },
        targetCol: { type: 'integer', minimum: 0 },
        formula: { type: 'string', maxLength: 4096 },
        writeResult: { type: 'boolean' },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'targetRow',
        'targetCol',
        'formula',
        'writeResult',
      ],
    },
  },
  {
    name: 'deleteTableControl',
    description: '표 컨트롤 통째 삭제.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx'],
    },
  },
  // === Phase 3 chunk 47 — image/shape ===
  {
    name: 'setPictureProperties',
    description:
      '이미지 속성 변경 (width/height HWPUNIT, treatAsChar 등). props lib JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        props: { type: 'object' },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'props'],
    },
  },
  {
    name: 'deletePictureControl',
    description: '이미지 컨트롤 삭제.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx'],
    },
  },
  {
    name: 'setShapeProperties',
    description: '도형 속성 변경 (width/height/위치/색상 등). props lib JSON.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        props: { type: 'object' },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'props'],
    },
  },
  {
    name: 'deleteShapeControl',
    description: '도형 컨트롤 삭제.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx'],
    },
  },
  {
    name: 'changeShapeZOrder',
    description: '도형 Z 순서 변경. operation: top/bottom/forward/backward.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        operation: {
          type: 'string',
          enum: ['top', 'bottom', 'forward', 'backward'],
        },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'operation'],
    },
  },
  {
    name: 'insertPicture',
    description:
      '이미지 삽입. base64Data 는 PNG/JPEG/GIF/BMP 바이트 base64. width/height HWPUNIT (1mm ≈ 28.35).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
        base64Data: { type: 'string' },
        widthHwpunit: { type: 'integer', minimum: 1, maximum: 283500 },
        heightHwpunit: { type: 'integer', minimum: 1, maximum: 283500 },
        naturalWidthPx: { type: 'integer', minimum: 1 },
        naturalHeightPx: { type: 'integer', minimum: 1 },
        extension: { type: 'string' },
        description: { type: 'string' },
      },
      required: [
        'sectionIdx',
        'paragraphIdx',
        'charOffset',
        'base64Data',
        'widthHwpunit',
        'heightHwpunit',
        'naturalWidthPx',
        'naturalHeightPx',
        'extension',
        'description',
      ],
    },
  },
  // === Phase 3 chunk 48 — page/section ===
  {
    name: 'insertPageBreak',
    description: '특정 위치에 페이지 나누기 삽입.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx', 'charOffset'],
    },
  },
  {
    name: 'insertColumnBreak',
    description: '특정 위치에 단 나누기 삽입 (다단 layout 시).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx', 'charOffset'],
    },
  },
  {
    name: 'setColumnDef',
    description:
      '섹션 다단 정의. columnCount 1~10, columnType 0=Newspaper/1=BalancedNewspaper/2=Parallel, sameWidth 1=균등/0=비균등, spacingHu 단 간격 HWPUNIT.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        columnCount: { type: 'integer', minimum: 1, maximum: 10 },
        columnType: { type: 'integer', minimum: 0, maximum: 2 },
        sameWidth: { type: 'integer', minimum: 0, maximum: 1 },
        spacingHu: { type: 'integer', minimum: 0 },
      },
      required: [
        'sectionIdx',
        'columnCount',
        'columnType',
        'sameWidth',
        'spacingHu',
      ],
    },
  },
  {
    name: 'setSectionDef',
    description: '섹션 정의 변경 (props lib SectionDef JSON).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        props: { type: 'object' },
      },
      required: ['sectionIdx', 'props'],
    },
  },
  {
    name: 'setPageHide',
    description:
      '특정 페이지의 머리말/꼬리말/테두리/배경/페이지 번호 등 숨김 토글.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        hideHeader: { type: 'boolean' },
        hideFooter: { type: 'boolean' },
        hideMaster: { type: 'boolean' },
        hideBorder: { type: 'boolean' },
        hideFill: { type: 'boolean' },
        hidePageNum: { type: 'boolean' },
      },
      required: [
        'sectionIdx',
        'paragraphIdx',
        'hideHeader',
        'hideFooter',
        'hideMaster',
        'hideBorder',
        'hideFill',
        'hidePageNum',
      ],
    },
  },
  // === Phase 3 chunk 49 — header/footer + bookmark ===
  {
    name: 'applyHfTemplate',
    description:
      '머리/꼬리말 템플릿 적용. applyTo: 0=both / 1=odd / 2=even. templateId lib enum.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        isHeader: { type: 'boolean' },
        applyTo: { type: 'integer', minimum: 0, maximum: 2 },
        templateId: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'isHeader', 'applyTo', 'templateId'],
    },
  },
  {
    name: 'createHeaderFooter',
    description: '빈 머리/꼬리말 슬롯 생성 (applyTo 0=both/1=odd/2=even).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        isHeader: { type: 'boolean' },
        applyTo: { type: 'integer', minimum: 0, maximum: 2 },
      },
      required: ['sectionIdx', 'isHeader', 'applyTo'],
    },
  },
  {
    name: 'deleteHeaderFooter',
    description: '머리/꼬리말 슬롯 통째 삭제.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        isHeader: { type: 'boolean' },
        applyTo: { type: 'integer', minimum: 0, maximum: 2 },
      },
      required: ['sectionIdx', 'isHeader', 'applyTo'],
    },
  },
  {
    name: 'deleteBookmark',
    description: '특정 좌표의 책갈피 삭제.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx', 'controlIdx'],
    },
  },
  // === Phase 3 chunk 51 — read-only Agent tools (양식 매칭 / 위치 결정) ===
  {
    name: 'getDocumentOutline',
    description:
      '문서의 제목 단락 outline 조회 (paragraphIndex/level/text). Agent 가 새 단락을 어디에 넣을지 결정할 때 사용.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getStyleListJson',
    description:
      '문서에 등록된 모든 named style 목록 (id/name/englishName). Agent 가 applyStyle 로 매칭할 styleId 를 찾을 때 사용.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getStyleAt',
    description:
      '특정 단락의 활성 styleId + 스타일 detail (charShape/paraShape) 조회. 인접 단락과 양식 매칭하려면 먼저 호출.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx'],
    },
  },
  {
    name: 'getCharPropertiesAt',
    description:
      '좌표 (sectionIdx, paragraphIdx, charOffset) 위치의 활성 글자 서식 (font/size/color/bold 등) 조회. applyCharFormat 으로 매칭하려면 먼저 호출.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx', 'charOffset'],
    },
  },
  {
    name: 'getParaPropertiesAt',
    description:
      '특정 단락의 활성 단락 서식 (alignment/lineSpacing/indent/spacing 등) 조회. applyParaProps 매칭용.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'paragraphIdx'],
    },
  },
  {
    name: 'getTextRange',
    description:
      '좌표 범위의 텍스트 읽기. 인용/근거 찾기. 결과 4096B 상한 (초과 시 trim).',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        startParagraphIdx: { type: 'integer', minimum: 0 },
        startOffset: { type: 'integer', minimum: 0 },
        endParagraphIdx: { type: 'integer', minimum: 0 },
        endOffset: { type: 'integer', minimum: 0 },
      },
      required: [
        'sectionIdx',
        'startParagraphIdx',
        'startOffset',
        'endParagraphIdx',
        'endOffset',
      ],
    },
  },
  {
    name: 'getCaretPosition',
    description:
      '현재 caret 위치 조회 (sectionIndex, paragraphIndex, charOffset, cell). "여기 추가" 의미를 좌표로 변환할 때.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'findInDocument',
    description:
      '본문 내 검색어 매칭 좌표 list. case-sensitive substring. maxResults 1~200 (기본 50). 검색어 1024B 상한.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 1024 },
        maxResults: { type: 'integer', minimum: 1, maximum: 200 },
      },
      required: ['query'],
    },
  },
  {
    name: 'getCellInfo',
    description:
      '셀의 좌표 / 병합 상태 / row/col / rowSpan/colSpan / 이웃 cellIdx 조회. 표 편집 (mergeTableCells, splitTableCellInto 등) 전 검증용.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        cellIdx: { type: 'integer', minimum: 0 },
      },
      required: ['sectionIdx', 'parentParaIdx', 'controlIdx', 'cellIdx'],
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
  // Phase 3 chunk 51 — read-only Agent tools
  getDocumentOutline: Record<string, never>;
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

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Phase 3 chunk 45+ — common pattern: validate a list of keys as
 * non-negative integers. Returns a typed object on success. */
function nonNegInts(
  args: Record<string, unknown>,
  keys: readonly string[],
): { ok: true; value: Record<string, number> } | { ok: false; reason: string } {
  const out: Record<string, number> = {};
  for (const k of keys) {
    const v = args[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0)
      return { ok: false, reason: `${k}-not-non-negative-int` };
    out[k] = v;
  }
  return { ok: true, value: out };
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
    // === Phase 3 chunk 45 — body edit primitives ===
    case 'insertText': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'charOffset']);
      if (!v.ok) return v;
      const text = args.text;
      if (typeof text !== 'string')
        return { ok: false, reason: 'text-not-string' };
      if (byteLen(text) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'text-too-large' };
      return { ok: true, value: { ...v.value, text } as AhwpToolArgs[T] };
    }
    case 'deleteRange': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'startParagraphIdx',
        'startOffset',
        'endParagraphIdx',
        'endOffset',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'insertParagraph':
    case 'deleteParagraph':
    case 'mergeParagraph': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'applyCharFormat': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'paragraphIdx',
        'startOffset',
        'endOffset',
      ]);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'applyParaProps': {
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return { ok: true, value: { props } as AhwpToolArgs[T] };
    }
    case 'applyStyle': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'styleId']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    // === Phase 3 chunk 46 — table structure ===
    case 'createTable': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'paragraphIdx',
        'charOffset',
        'rowCount',
        'colCount',
      ]);
      if (!v.ok) return v;
      const o = v.value;
      if (o.rowCount < 1 || o.rowCount > 100)
        return { ok: false, reason: 'rowCount-out-of-range' };
      if (o.colCount < 1 || o.colCount > 50)
        return { ok: false, reason: 'colCount-out-of-range' };
      return { ok: true, value: o as AhwpToolArgs[T] };
    }
    case 'insertTableRow': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'rowIdx',
      ]);
      if (!v.ok) return v;
      const below = args.below;
      if (typeof below !== 'boolean')
        return { ok: false, reason: 'below-not-bool' };
      return { ok: true, value: { ...v.value, below } as AhwpToolArgs[T] };
    }
    case 'insertTableColumn': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'colIdx',
      ]);
      if (!v.ok) return v;
      const right = args.right;
      if (typeof right !== 'boolean')
        return { ok: false, reason: 'right-not-bool' };
      return { ok: true, value: { ...v.value, right } as AhwpToolArgs[T] };
    }
    case 'deleteTableRow':
    case 'deleteTableColumn': {
      const ki =
        tool === 'deleteTableRow'
          ? ['sectionIdx', 'parentParaIdx', 'controlIdx', 'rowIdx']
          : ['sectionIdx', 'parentParaIdx', 'controlIdx', 'colIdx'];
      const v = nonNegInts(args, ki);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'mergeTableCells': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'startRow',
        'startCol',
        'endRow',
        'endCol',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'splitTableCellInto': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'row',
        'col',
        'nRows',
        'mCols',
      ]);
      if (!v.ok) return v;
      const equalRowHeight = args.equalRowHeight;
      const mergeFirst = args.mergeFirst;
      if (typeof equalRowHeight !== 'boolean')
        return { ok: false, reason: 'equalRowHeight-not-bool' };
      if (typeof mergeFirst !== 'boolean')
        return { ok: false, reason: 'mergeFirst-not-bool' };
      return {
        ok: true,
        value: {
          ...v.value,
          equalRowHeight,
          mergeFirst,
        } as AhwpToolArgs[T],
      };
    }
    case 'unmergeCell': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'row',
        'col',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'setTableProperties':
    case 'setShapeProperties':
    case 'setPictureProperties': {
      const v = nonNegInts(args, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'setCellProperties': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
      ]);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'evaluateTableFormula': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'targetRow',
        'targetCol',
      ]);
      if (!v.ok) return v;
      const formula = args.formula;
      const writeResult = args.writeResult;
      if (typeof formula !== 'string')
        return { ok: false, reason: 'formula-not-string' };
      if (byteLen(formula) > AHWP_TOOL_LIMITS.maxTextBytes)
        return { ok: false, reason: 'formula-too-large' };
      if (typeof writeResult !== 'boolean')
        return { ok: false, reason: 'writeResult-not-bool' };
      return {
        ok: true,
        value: {
          ...v.value,
          formula,
          writeResult,
        } as AhwpToolArgs[T],
      };
    }
    case 'deleteTableControl':
    case 'deletePictureControl':
    case 'deleteShapeControl': {
      const v = nonNegInts(args, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'changeShapeZOrder': {
      const v = nonNegInts(args, ['sectionIdx', 'parentParaIdx', 'controlIdx']);
      if (!v.ok) return v;
      const op = args.operation;
      if (
        op !== 'top' &&
        op !== 'bottom' &&
        op !== 'forward' &&
        op !== 'backward'
      )
        return { ok: false, reason: 'operation-not-enum' };
      return {
        ok: true,
        value: { ...v.value, operation: op } as AhwpToolArgs[T],
      };
    }
    case 'insertPicture': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'paragraphIdx',
        'charOffset',
        'widthHwpunit',
        'heightHwpunit',
        'naturalWidthPx',
        'naturalHeightPx',
      ]);
      if (!v.ok) return v;
      const o = v.value;
      if (
        o.widthHwpunit > AHWP_TOOL_LIMITS.maxShapeHwpunit ||
        o.heightHwpunit > AHWP_TOOL_LIMITS.maxShapeHwpunit
      )
        return { ok: false, reason: 'dimension-too-large' };
      const base64Data = args.base64Data;
      const extension = args.extension;
      const description = args.description;
      if (typeof base64Data !== 'string' || base64Data.length === 0)
        return { ok: false, reason: 'base64Data-not-string' };
      if (base64Data.length > 4 * 1024 * 1024)
        return { ok: false, reason: 'base64Data-too-large' };
      if (typeof extension !== 'string' || extension.length === 0)
        return { ok: false, reason: 'extension-not-string' };
      if (typeof description !== 'string')
        return { ok: false, reason: 'description-not-string' };
      return {
        ok: true,
        value: {
          ...o,
          base64Data,
          extension,
          description,
        } as AhwpToolArgs[T],
      };
    }
    case 'insertPageBreak':
    case 'insertColumnBreak': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'charOffset']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'setColumnDef': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'columnCount',
        'columnType',
        'sameWidth',
        'spacingHu',
      ]);
      if (!v.ok) return v;
      const o = v.value;
      if (o.columnCount < 1 || o.columnCount > 10)
        return { ok: false, reason: 'columnCount-out-of-range' };
      return { ok: true, value: o as AhwpToolArgs[T] };
    }
    case 'setSectionDef': {
      const v = nonNegInts(args, ['sectionIdx']);
      if (!v.ok) return v;
      const props = args.props;
      if (!isObj(props)) return { ok: false, reason: 'props-not-object' };
      return {
        ok: true,
        value: { ...v.value, props } as AhwpToolArgs[T],
      };
    }
    case 'setPageHide': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      const flags = [
        'hideHeader',
        'hideFooter',
        'hideMaster',
        'hideBorder',
        'hideFill',
        'hidePageNum',
      ] as const;
      const out: Record<string, unknown> = { ...v.value };
      for (const k of flags) {
        const x = args[k];
        if (typeof x !== 'boolean')
          return { ok: false, reason: `${k}-not-bool` };
        out[k] = x;
      }
      return { ok: true, value: out as AhwpToolArgs[T] };
    }
    case 'applyHfTemplate': {
      const v = nonNegInts(args, ['sectionIdx', 'applyTo', 'templateId']);
      if (!v.ok) return v;
      const isHeader = args.isHeader;
      if (typeof isHeader !== 'boolean')
        return { ok: false, reason: 'isHeader-not-bool' };
      return {
        ok: true,
        value: { ...v.value, isHeader } as AhwpToolArgs[T],
      };
    }
    case 'createHeaderFooter':
    case 'deleteHeaderFooter': {
      const v = nonNegInts(args, ['sectionIdx', 'applyTo']);
      if (!v.ok) return v;
      const isHeader = args.isHeader;
      if (typeof isHeader !== 'boolean')
        return { ok: false, reason: 'isHeader-not-bool' };
      return {
        ok: true,
        value: { ...v.value, isHeader } as AhwpToolArgs[T],
      };
    }
    case 'deleteBookmark': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'controlIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    // === Phase 3 chunk 51 — read-only Agent tools ===
    case 'getDocumentOutline':
    case 'getStyleListJson':
    case 'getCaretPosition':
      return { ok: true, value: {} as AhwpToolArgs[T] };
    case 'getStyleAt':
    case 'getParaPropertiesAt': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'getCharPropertiesAt': {
      const v = nonNegInts(args, ['sectionIdx', 'paragraphIdx', 'charOffset']);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'getTextRange': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'startParagraphIdx',
        'startOffset',
        'endParagraphIdx',
        'endOffset',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
    }
    case 'findInDocument': {
      const query = args.query;
      if (typeof query !== 'string')
        return { ok: false, reason: 'query-not-string' };
      if (query.length === 0) return { ok: false, reason: 'query-empty' };
      if (byteLen(query) > 1024)
        return { ok: false, reason: 'query-too-large' };
      const maxResults = args.maxResults;
      if (
        maxResults !== undefined &&
        (typeof maxResults !== 'number' ||
          !Number.isInteger(maxResults) ||
          maxResults < 1 ||
          maxResults > 200)
      )
        return { ok: false, reason: 'maxResults-out-of-range' };
      return {
        ok: true,
        value: { query, maxResults } as AhwpToolArgs[T],
      };
    }
    case 'getCellInfo': {
      const v = nonNegInts(args, [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
      ]);
      if (!v.ok) return v;
      return { ok: true, value: v.value as AhwpToolArgs[T] };
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
