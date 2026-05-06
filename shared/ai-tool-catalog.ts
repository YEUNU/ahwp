/**
 * Phase 3 — provider tool-use API 용 카탈로그 본체. R4 에서
 * `shared/ai-tools.ts` 로부터 분리. `getAhwpToolCatalog()` 가 반환하는
 * `ChatTool[]` 을 `ChatRequest.tools` 에 주입.
 *
 * description 은 모델이 보는 문자열 — 실제 IR 호출의 의도/제약 (한글 OK).
 * JSON Schema (draft-07 호환) 는 각 tool 의 `validateArgs` switch 분기와
 * lockstep 이라 변경 시 양쪽 같이 갱신.
 */
import type { AhwpToolDescriptor } from './ai-tools';

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
    name: 'insertTextInCell',
    description:
      '표 control 안의 특정 cell + cellParagraph + charOffset 에 텍스트 삽입. body-level insertText 가 표 layout 을 깨는 위치에서도 cell-scoped 로 안전. 사전 단계: getCellInfo 로 cellParaCount 확인 후 cellParaIdx 가 그 범위 안인지 검증. 빈 cell 에 첫 텍스트 넣을 땐 cellParaIdx=0, charOffset=0. cellParaIdx 가 범위 밖이면 out-of-range. 한 cell 에 여러 paragraph 필요 시 \\n 으로 분할.',
    inputSchema: {
      type: 'object',
      properties: {
        sectionIdx: { type: 'integer', minimum: 0 },
        parentParaIdx: { type: 'integer', minimum: 0 },
        controlIdx: { type: 'integer', minimum: 0 },
        cellIdx: { type: 'integer', minimum: 0 },
        cellParaIdx: { type: 'integer', minimum: 0 },
        charOffset: { type: 'integer', minimum: 0 },
        text: { type: 'string', maxLength: 4096 },
      },
      required: [
        'sectionIdx',
        'parentParaIdx',
        'controlIdx',
        'cellIdx',
        'cellParaIdx',
        'charOffset',
        'text',
      ],
    },
  },
  {
    name: 'insertText',
    description:
      '특정 위치 (sectionIdx, paragraphIdx, charOffset) 에 raw 텍스트 삽입. **양식 / 보고서 doc 의 (0,0,0) 호출 금지** — 표지 표 cell 안에 dump 되어 layout 파손. 인접 paragraph 의 char-shape 만 상속, 새 스타일·heading 적용 안 됨. 다중 paragraph + heading + 본문 혼합 시 applyHtml 사용. 표 cell 내부면 insertTextInCell / insertTextInCellByPath 사용. 안전 사용처: 빈 문서·빈 단락·verified 위치의 plain text 추가.',
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
      '문서의 제목 단락 outline 조회 (paragraphIndex/level/text). Agent 가 새 단락을 어디에 넣을지 결정할 때 사용. **outline 이 비어있으면 doc 가 heading 스타일 (제목 N / 개요 N / Heading N) 미사용임 — 그땐 `getDocumentSummary` 로 fallback**.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getDocumentSummary',
    description:
      '문서 구조 개요 — sectionCount + 각 section 의 paragraphCount / 비어있지 않은 단락 수 / 첫·마지막 채워진 단락 샘플 (text, 200자 cap). heading 스타일이 없는 doc 의 채움 비율 판정 / 위치 결정에 사용. read-only, 매 turn 1~2번 비용 미미.',
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
  // === Phase 5 chunk 96 — outline-as-router workspace search ===
  {
    name: 'searchWorkspaceOutlines',
    description:
      '현재 폴더 트리(워크스페이스) 안의 모든 .hwp/.hwpx 의 파일명 + 제목 단락 outline (paragraphIndex/level/text) 인벤토리를 회수. 사용자가 특정 문서를 지칭하지 않고 개념적 질의 ("매출 항목 기준으로 ~~ 수정해줘") 만 한 경우, 이 도구로 후보 문서/단락을 식별한 뒤 readParagraphByPath 로 본문을 회수해 의사결정 근거로 사용. maxDocs 1~200 (기본 50). 응답 크기는 폴더 규모에 비례하니 필요할 때만 호출.',
    inputSchema: {
      type: 'object',
      properties: {
        maxDocs: { type: 'integer', minimum: 1, maximum: 200 },
      },
    },
  },
  {
    name: 'readParagraphByPath',
    description:
      '임의 .hwp/.hwpx 파일의 특정 단락 본문 + 주변 단락(context)을 회수. searchWorkspaceOutlines 응답의 path/paragraphIndex 를 그대로 넘기면 됨. 활성 문서 IR 은 변경되지 않음 (mutation 없음, caret 이동 없음). contextParagraphs 0~10 (기본 2 — 앞뒤 2개씩 부가 회수). 단락당 4KB 상한.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        sectionIdx: { type: 'integer', minimum: 0 },
        paragraphIdx: { type: 'integer', minimum: 0 },
        contextParagraphs: { type: 'integer', minimum: 0, maximum: 10 },
      },
      required: ['path', 'sectionIdx', 'paragraphIdx'],
    },
  },
  {
    name: 'switchTargetDoc',
    description:
      'Cross-doc write routing. 후속 write tool 들의 활성 target 을 다른 열린 문서로 전환. path 는 절대 경로 (현재 열린 탭 중 하나 — `searchWorkspaceOutlines` 응답이나 chat 시스템 메시지의 `[참조 문서]` path 와 동일). 닫힌 / 미열린 파일은 reject. 한 turn 안에서 여러 번 호출 가능. turn 종료 시점에 자동으로 원래 active doc 으로 복귀하지는 않으니, 작업 완료 후 명시적으로 다시 switchTargetDoc 으로 돌아가거나 그대로 마무리. read tool 은 이 라우팅과 무관하게 explicit path arg 를 받으니 영향 없음.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description:
            '전환할 활성 target 의 절대 경로 (.hwp 또는 .hwpx). 현재 열린 탭 중 하나여야 함.',
        },
      },
      required: ['path'],
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
