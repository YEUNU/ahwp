/**
 * Defined tools registry — 0.7.4 full migration.
 *
 * 모든 55 도구가 본 dir 안의 카테고리별 파일에 defineTool 로 정의됨.
 * 이전 분산 구조 (TOOL_DESCRIPTORS array + validateArgs switch + per-tool
 * AhwpToolArgs entries) 는 본 chunk 에서 단일 source 로 통합되었다.
 *
 * **카테고리 (6 파일):**
 *
 * - `format.ts` (13) — caret-based 서식 / 본문 텍스트 primitive /
 *   paragraph 서식 (applyHtml, applyAlignment, applyFontSize,
 *   applyTextColor, toggleCharFormat, insertText, deleteRange,
 *   insertParagraph, deleteParagraph, mergeParagraph, applyCharFormat,
 *   applyParaProps, applyStyle).
 * - `cell.ts` (5) — 셀-level read / write (insertTextInCell,
 *   replaceTextInCell, applyCellStyle, getCellInfo, getEmptyFormFields).
 * - `table.ts` (12) — 표 구조 변경 / properties / 수식 (createTable,
 *   insertTableRow / Column, deleteTableRow / Column, mergeTableCells,
 *   splitTableCellInto, unmergeCell, setTableProperties,
 *   setCellProperties, evaluateTableFormula, deleteTableControl).
 * - `shape.ts` (7) — 도형 / 그림 (createRectShape, setShapeProperties,
 *   deleteShapeControl, changeShapeZOrder, setPictureProperties,
 *   deletePictureControl, insertPicture).
 * - `page.ts` (19) — page / section / header-footer / bookmark /
 *   footnote / equation / style (applyPageDef, insertPageBreak,
 *   insertColumnBreak, setColumnDef, setSectionDef, setPageHide,
 *   getColumnDef, setHeaderFooterText, applyHfTemplate,
 *   createHeaderFooter, deleteHeaderFooter, addBookmark, deleteBookmark,
 *   insertFootnote, deleteFootnote, getFootnoteAtCursor, insertEquation,
 *   deleteEquationControl, createNamedStyle, getStyleListJson,
 *   getStyleAt).
 * - `read.ts` (10) — read-only 조회 / 시각 캡처 / 워크스페이스 검색 /
 *   라우팅 (getDocumentOutline, getDocumentSummary, getCaretPosition,
 *   getCharPropertiesAt, getParaPropertiesAt, getTextRange,
 *   findInDocument, getPageSvg, searchWorkspaceOutlines,
 *   readParagraphByPath, switchTargetDoc).
 *
 * **단일 source 보장:**
 *
 * 새 도구 추가 시 카테고리 파일에 `defineTool({...})` 한 번 호출하고
 * 본 index 의 `DEFINED_TOOLS` 배열에 import — schema / validate /
 * readonly / mode 메타가 한 곳에 모임. legacy 분산 구조에서 반복적으로
 * 보였던 lockstep drift (0.6.17 의 includeFilled strip 등) 는 본
 * registry 로 구조적으로 차단.
 */
import { buildToolRegistry, type ToolDef } from '../ai-tool-def';

import * as formatTools from './format';
import * as cellTools from './cell';
import * as tableTools from './table';
import * as shapeTools from './shape';
import * as pageTools from './page';
import * as readTools from './read';
import * as webTools from './web';

// 각 module 의 모든 named export 를 단일 배열로. Object.values 사용 +
// 타입 narrow.
function collect(
  mod: Record<string, unknown>,
): readonly ToolDef<string, unknown>[] {
  return Object.values(mod).filter(
    (v): v is ToolDef<string, unknown> =>
      typeof v === 'object' &&
      v !== null &&
      'name' in v &&
      'validate' in v &&
      'inputSchema' in v,
  );
}

export const DEFINED_TOOLS: readonly ToolDef<string, unknown>[] = [
  ...collect(formatTools),
  ...collect(cellTools),
  ...collect(tableTools),
  ...collect(shapeTools),
  ...collect(pageTools),
  ...collect(readTools),
  ...collect(webTools),
];

export const DEFINED_TOOL_REGISTRY = buildToolRegistry(DEFINED_TOOLS);
