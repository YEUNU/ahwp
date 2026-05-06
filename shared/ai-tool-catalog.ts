/**
 * Phase 3 — provider tool-use API 용 카탈로그 본체. R4 에서
 * `shared/ai-tools.ts` 로부터 분리. `getAhwpToolCatalog()` 가 반환하는
 * `ChatTool[]` 을 `ChatRequest.tools` 에 주입.
 *
 * description 은 모델에게 보내지므로 0.4.19 부터 영어로 작성 (memory:
 * feedback_english_prompts). JSON Schema (draft-07 호환) 는 각 tool 의
 * `validateArgs` switch 분기와 lockstep 이라 변경 시 양쪽 같이 갱신.
 */
import type { AhwpToolDescriptor } from './ai-tools';

const TOOL_DESCRIPTORS: AhwpToolDescriptor[] = [
  {
    name: 'applyHtml',
    description:
      'Apply an HTML fragment at the caret in the active document. Supports alignment, line spacing, indentation, paragraph spacing, character formatting, and table round-trip. Recognises <p>, <table>, and a subset of inline styles.',
    inputSchema: {
      type: 'object',
      properties: { html: { type: 'string', maxLength: 65536 } },
      required: ['html'],
    },
  },
  {
    name: 'applyAlignment',
    description:
      'Change the alignment of the active selection / caret paragraph.',
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
    description:
      'Change the font size (pt) of the active selection / caret. 1-999.',
    inputSchema: {
      type: 'object',
      properties: { pt: { type: 'number', minimum: 1, maximum: 999 } },
      required: ['pt'],
    },
  },
  {
    name: 'applyTextColor',
    description:
      'Change the text color of the active selection / caret to a #RRGGBB hex value.',
    inputSchema: {
      type: 'object',
      properties: { hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' } },
      required: ['hex'],
    },
  },
  {
    name: 'toggleCharFormat',
    description:
      'Toggle bold / italic / underline on the active selection / caret.',
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
    description: 'Insert a footnote at the caret and fill its body text.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', maxLength: 4096 } },
      required: ['text'],
    },
  },
  {
    name: 'addBookmark',
    description: 'Add a bookmark at the caret. Name ≤ 256 bytes.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', minLength: 1, maxLength: 256 } },
      required: ['name'],
    },
  },
  {
    name: 'setHeaderFooterText',
    description:
      'Set the header / footer text of a section. applyTo: 0=both / 1=odd / 2=even.',
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
      'Apply page definition (margin / orientation / size etc.). props is the lib pageDef JSON.',
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
    description:
      'Add an empty user-defined style shell to the document styleList (name only).',
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
      'Insert a rectangle shape control at the caret. width / height in HWPUNIT (1mm ≈ 28.35 HWPUNIT).',
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
      'Apply a previously registered named style to a specific cell. Lib does not support direct cell background-color setting — must go through a style (KNOWN_ISSUES L-006).',
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
      'Insert text into a specific cell + cellParagraph + charOffset of a table control. Cell-scoped, safe even where body-level insertText would break table layout. Prereq: call getCellInfo first to confirm cellParaCount and that cellParaIdx is within range. For the first insertion into an empty cell use cellParaIdx=0, charOffset=0. cellParaIdx out of range returns out-of-range. Use \\n for multi-paragraph content within one cell.',
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
      'Insert raw text at a coordinate (sectionIdx, paragraphIdx, charOffset). Do NOT call at (0,0,0) on a form / report document — the runtime hard-rejects multi-paragraph text there because it dumps into the cover-page table cell and destroys layout. Inserted text only inherits the surrounding paragraph char-shape; new styles / headings do not apply. Use applyHtml for multi-paragraph + heading + body mixed content. Use insertTextInCell when the target lives inside a table cell. Safe uses: empty document, empty paragraph, or verified plain-text spots.',
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
    description:
      'Delete text in a paragraph / offset range (may cross paragraphs).',
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
    description:
      'Insert a new paragraph break at paragraphIdx (splits the caret paragraph).',
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
    description:
      'Delete a paragraph entirely (merges into the previous paragraph).',
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
    description:
      'Merge this paragraph with the next one (removes the paragraph break).',
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
      'Apply char formatting over a range. props keys: bold / italic / underline (boolean), strikeThrough, subscript / superscript, name (font family string), size_hu (HWPUNIT, pt×100), color (#RRGGBB int), shadeColor, etc. Passes through to lib applyCharFormat props_json. Note: no-ops on empty paragraphs — insert text first, then format.',
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
      'Apply paragraph props to the active caret / selection paragraph. props keys (all optional): alignment (left / center / right / justify), lineSpacing (percent), lineSpacingType (Percent / Fixed / AtLeast), spacingBefore / spacingAfter (HWPUNIT), marginLeft / marginRight (HWPUNIT), indent (HWPUNIT; positive = first-line indent, negative = hanging indent).',
    inputSchema: {
      type: 'object',
      properties: { props: { type: 'object' } },
      required: ['props'],
    },
  },
  {
    name: 'applyStyle',
    description:
      'Apply a named style to a paragraph. styleId comes from getStyleListJson.',
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
    description:
      'Create an N-row × M-column table at the given location. Rows 1-100, cols 1-50.',
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
      'Insert one row into a table. below=true inserts below rowIdx, false inserts above.',
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
      'Insert one column into a table. right=true inserts to the right of colIdx, false to the left.',
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
    description:
      'Delete one table row. Lib rejects deleting the last remaining row.',
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
    description: 'Delete one table column.',
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
      'Merge cells across the rectangular region (startRow, startCol) to (endRow, endCol).',
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
      'Split one cell into nRows × mCols. equalRowHeight / mergeFirst options available.',
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
    description:
      'Unmerge a merged cell back into its original row × col layout.',
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
      'Update whole-table properties (border, width, etc.). props is lib setTableProperties JSON.',
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
      'Update properties of a single cell (border; background color must go through a style). props is lib setCellProperties JSON.',
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
      'Evaluate a table cell formula in HWP syntax (e.g. =SUM(A1:A5), =A1*B2). writeResult=true also writes the result into the target cell.',
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
    description: 'Delete a table control entirely.',
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
      'Update picture properties (width / height HWPUNIT, treatAsChar, etc.). props is lib JSON.',
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
    description: 'Delete a picture control.',
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
    description:
      'Update shape properties (width / height / position / color, etc.). props is lib JSON.',
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
    description: 'Delete a shape control.',
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
    description:
      'Change a shape Z-order. operation: top / bottom / forward / backward.',
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
      'Insert a picture. base64Data is PNG / JPEG / GIF / BMP bytes encoded as base64. width / height in HWPUNIT (1mm ≈ 28.35).',
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
    description: 'Insert a page break at the given location.',
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
    description:
      'Insert a column break at the given location (only meaningful in multi-column layouts).',
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
      'Define section columns. columnCount 1-10, columnType 0=Newspaper / 1=BalancedNewspaper / 2=Parallel, sameWidth 1=equal / 0=unequal, spacingHu = column gap in HWPUNIT.',
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
    description: 'Update section definition (props is lib SectionDef JSON).',
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
      'Toggle visibility of header / footer / border / fill / page number on a specific page.',
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
      'Apply a header / footer template. applyTo: 0=both / 1=odd / 2=even. templateId is the lib enum.',
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
    description:
      'Create an empty header / footer slot (applyTo 0=both / 1=odd / 2=even).',
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
    description: 'Delete a header / footer slot entirely.',
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
    description: 'Delete a bookmark at the given coordinate.',
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
      'Return the document outline (heading paragraphs as paragraphIndex / level / text). Use when deciding where to insert a new paragraph. **An empty outline means the doc has no heading styles (제목 N / 개요 N / Heading N); fall back to `getDocumentSummary` in that case.**',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getDocumentSummary',
    description:
      'Document structure overview — sectionCount plus, for each section, paragraphCount / non-empty count / first and last filled paragraph samples (text, capped at 200 chars). Use to gauge how filled a heading-less doc is and to decide insertion locations. Read-only, cheap per turn.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getStyleListJson',
    description:
      'List all named styles registered on the document (id / name / englishName). Use to look up a styleId to feed applyStyle.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'getStyleAt',
    description:
      'Return the active styleId plus style detail (charShape / paraShape) at a paragraph. Call first when matching the formatting of an adjacent paragraph.',
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
      'Return the active char formatting (font / size / color / bold etc.) at coordinate (sectionIdx, paragraphIdx, charOffset). Call before applyCharFormat to match an existing range.',
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
      'Return the active paragraph props (alignment / lineSpacing / indent / spacing etc.) at a paragraph. Use as input to applyParaProps when matching another paragraph.',
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
      'Read the text within a coordinate range. Useful for citation or grounding. Result capped at 4096 bytes (trimmed beyond).',
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
      'Return the current caret position (sectionIndex, paragraphIndex, charOffset, optional cell). Use to translate intents like "add here" into a concrete coordinate.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'findInDocument',
    description:
      'Return matching coordinates for a query within the body. Case-sensitive substring. maxResults 1-200 (default 50). Query capped at 1024 bytes.',
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
      "Return a cell's coordinates, merge state, row / col, rowSpan / colSpan, and neighbor cellIdx. Use before table edits (mergeTableCells, splitTableCellInto etc.) to validate.",
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
      'Inventory every .hwp / .hwpx in the current folder tree (workspace): filename plus heading-paragraph outline (paragraphIndex / level / text) for each. Use when the user refers to a doc that is not attached and only describes it conceptually — identify candidate docs / paragraphs here, then call readParagraphByPath to fetch the bodies. maxDocs 1-200 (default 50). Response scales with folder size — call only when needed.',
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
      'Fetch a specific paragraph body + surrounding context from any .hwp / .hwpx file. Pass path / paragraphIndex from a searchWorkspaceOutlines response directly. The active doc IR is not modified (no mutation, no caret movement). contextParagraphs 0-10 (default 2 — fetches 2 paragraphs on each side). Per-paragraph cap 4KB.',
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
      'Cross-doc write routing. Switch the active target for subsequent write tools to another open document. path is an absolute path (must be one of the currently open tabs — the same path that appears in `searchWorkspaceOutlines` results or in the `[Reference docs]` block of the system message). Closed / unopened files are rejected. May be called multiple times within a turn. The runtime does not auto-restore the original active doc at turn end — call switchTargetDoc again to switch back, or finish as is. Read tools are unaffected: they take an explicit path argument independently of this routing.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          description:
            'Absolute path of the target to switch to (.hwp or .hwpx). Must be one of the currently open tabs.',
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
