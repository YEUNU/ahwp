/**
 * `ahwp-tools` dispatcher — chunk 19. Maps a parsed AhwpToolCall to a
 * `ViewerHandle` method. Explicit switch only — no dynamic method
 * lookup, no `eval`, no provider tool-use bridging here. The whitelist
 * is the union in `shared/ai-tools.ts`.
 */
import type {
  AhwpPreflightItem,
  AhwpToolCall,
  AhwpToolResult,
} from '@shared/ai-tools';
import type { ViewerHandle } from '@/features/studio/types';

/** Run an op against the viewer. Returns a result describing what
 * happened — IR throws are caught and recorded as `ir-throw:<msg>` so
 * one bad op doesn't tear down the rest of the run.
 *
 * chunk 96 — async because the new `searchWorkspaceOutlines` /
 * `readParagraphByPath` tools dispatch through main-process IPC.
 * Existing IR-call tools wrap their sync result in Promise.resolve
 * via the natural async function semantics. */
async function runOne(
  viewer: ViewerHandle,
  call: AhwpToolCall,
): Promise<AhwpToolResult> {
  try {
    switch (call.tool) {
      case 'applyHtml': {
        viewer.applyHtmlAtCaret(call.args.html);
        return { ok: true, tool: call.tool };
      }
      case 'applyAlignment': {
        viewer.applyAlignment(call.args.align);
        return { ok: true, tool: call.tool };
      }
      case 'applyFontSize': {
        viewer.applyFontSizePt(call.args.pt);
        return { ok: true, tool: call.tool };
      }
      case 'applyTextColor': {
        viewer.applyTextColor(call.args.hex);
        return { ok: true, tool: call.tool };
      }
      case 'toggleCharFormat': {
        viewer.toggleCharFormat(call.args.key);
        return { ok: true, tool: call.tool };
      }
      case 'insertFootnote': {
        viewer.insertFootnoteAtCaret(call.args.text);
        return { ok: true, tool: call.tool };
      }
      case 'addBookmark': {
        viewer.addBookmarkAtCaret(call.args.name);
        return { ok: true, tool: call.tool };
      }
      case 'setHeaderFooterText': {
        const a = call.args;
        viewer.setHeaderFooterText(a.sectionIdx, a.isHeader, a.applyTo, a.text);
        return { ok: true, tool: call.tool };
      }
      case 'applyPageDef': {
        viewer.applyPageDef(call.args.props, call.args.sectionIdx);
        return { ok: true, tool: call.tool };
      }
      case 'createNamedStyle': {
        const id = viewer.createNamedStyle(
          call.args.name,
          call.args.englishName,
        );
        if (id == null)
          return { ok: false, tool: call.tool, reason: 'createStyle-failed' };
        return { ok: true, tool: call.tool };
      }
      case 'createRectShape': {
        const r = viewer.createRectShapeAtCaret(
          call.args.widthHwpunit,
          call.args.heightHwpunit,
          call.args.opts,
        );
        if (r == null)
          return { ok: false, tool: call.tool, reason: 'createShape-failed' };
        return { ok: true, tool: call.tool };
      }
      case 'applyCellStyle': {
        const a = call.args;
        const ok = viewer.applyCellStyle(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
          a.cellParaIdx,
          a.styleId,
        );
        if (!ok)
          return {
            ok: false,
            tool: call.tool,
            reason: 'applyCellStyle-failed',
          };
        return { ok: true, tool: call.tool };
      }
      // === 0.4.16 — cell-level text insert (양식 표지 cell 채우기) ===
      case 'insertTextInCell': {
        const a = call.args;
        const ok = viewer.irInsertTextInCell(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
          a.cellParaIdx,
          a.charOffset,
          a.text,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertTextInCell-failed' };
      }
      // === Phase 3 chunk 45 — body edit primitives + char/para format ===
      case 'insertText': {
        const a = call.args;
        // 0.4.12 hard guard — `insertText(0, 0, 0, "<multi-paragraph>")` 는
        // 양식 / 보고서 doc 의 표지 표 cell 안에 dump 되어 layout 파손.
        // 0.4.9 prompt 가이드만으론 일부 model 이 무시 (반복 보고). 다중
        // paragraph (\n 포함) + 문서 시작 위치 조합은 거의 100% 의도와
        // 다른 결과 → 거절. AI 는 error 받고 다음 turn 에 applyHtml 또는
        // verified anchor (findInDocument) 로 재시도.
        if (
          a.sectionIdx === 0 &&
          a.paragraphIdx === 0 &&
          a.charOffset === 0 &&
          a.text.includes('\n')
        ) {
          return {
            ok: false,
            tool: call.tool,
            reason:
              'insertText-at-doc-start-with-multiline-rejected: (sectionIdx=0, paragraphIdx=0, charOffset=0) + multi-paragraph 조합은 거부. 다중 paragraph + heading 혼합은 applyHtml 사용. 위치 한정 raw 텍스트면 findInDocument 로 anchor 먼저 식별. 단일 paragraph (no \\n) 짧은 텍스트는 동일 위치 재호출 OK.',
          };
        }
        const ok = viewer.irInsertText(
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
          a.text,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertText-failed' };
      }
      case 'deleteRange': {
        const a = call.args;
        const ok = viewer.irDeleteRange(
          a.sectionIdx,
          a.startParagraphIdx,
          a.startOffset,
          a.endParagraphIdx,
          a.endOffset,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteRange-failed' };
      }
      case 'insertParagraph': {
        const a = call.args;
        const ok = viewer.irInsertParagraph(a.sectionIdx, a.paragraphIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertParagraph-failed' };
      }
      case 'deleteParagraph': {
        const a = call.args;
        const ok = viewer.irDeleteParagraph(a.sectionIdx, a.paragraphIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteParagraph-failed' };
      }
      case 'mergeParagraph': {
        const a = call.args;
        const ok = viewer.irMergeParagraph(a.sectionIdx, a.paragraphIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'mergeParagraph-failed' };
      }
      case 'applyCharFormat': {
        const a = call.args;
        const ok = viewer.irApplyCharFormat(
          a.sectionIdx,
          a.paragraphIdx,
          a.startOffset,
          a.endOffset,
          a.props,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyCharFormat-failed' };
      }
      case 'applyParaProps': {
        viewer.applyParaProps(call.args.props);
        return { ok: true, tool: call.tool };
      }
      case 'applyStyle': {
        const a = call.args;
        const ok = viewer.irApplyStyle(a.sectionIdx, a.paragraphIdx, a.styleId);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyStyle-failed' };
      }
      // === Phase 3 chunk 46 — table structure ===
      case 'createTable': {
        const a = call.args;
        const ok = viewer.irCreateTable(
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
          a.rowCount,
          a.colCount,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'createTable-failed' };
      }
      case 'insertTableRow': {
        const a = call.args;
        const ok = viewer.irInsertTableRow(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.rowIdx,
          a.below,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertTableRow-failed' };
      }
      case 'insertTableColumn': {
        const a = call.args;
        const ok = viewer.irInsertTableColumn(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.colIdx,
          a.right,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertTableColumn-failed' };
      }
      case 'deleteTableRow': {
        const a = call.args;
        const ok = viewer.irDeleteTableRow(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.rowIdx,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteTableRow-failed' };
      }
      case 'deleteTableColumn': {
        const a = call.args;
        const ok = viewer.irDeleteTableColumn(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.colIdx,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteTableColumn-failed' };
      }
      case 'mergeTableCells': {
        const a = call.args;
        const ok = viewer.irMergeTableCells(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.startRow,
          a.startCol,
          a.endRow,
          a.endCol,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'mergeTableCells-failed' };
      }
      case 'splitTableCellInto': {
        const a = call.args;
        const ok = viewer.irSplitTableCellInto(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.row,
          a.col,
          a.nRows,
          a.mCols,
          a.equalRowHeight,
          a.mergeFirst,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'splitTableCellInto-failed' };
      }
      case 'unmergeCell': {
        const a = call.args;
        const ok = viewer.irUnmergeCell(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.row,
          a.col,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'unmergeCell-failed' };
      }
      case 'setTableProperties': {
        const a = call.args;
        viewer.setTableProps(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.props,
        );
        return { ok: true, tool: call.tool };
      }
      case 'setCellProperties': {
        const a = call.args;
        viewer.setCellProps(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
          a.props,
        );
        return { ok: true, tool: call.tool };
      }
      case 'evaluateTableFormula': {
        const a = call.args;
        const r = viewer.evaluateTableFormula(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.targetRow,
          a.targetCol,
          a.formula,
          a.writeResult,
        );
        if (r === null)
          return { ok: false, tool: call.tool, reason: 'formula-failed' };
        return { ok: true, tool: call.tool };
      }
      case 'deleteTableControl': {
        const a = call.args;
        const ok = viewer.irDeleteTableControl(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteTableControl-failed' };
      }
      // === Phase 3 chunk 47 — image/shape ===
      case 'setPictureProperties': {
        const a = call.args;
        const ok = viewer.setPictureProps(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.props,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'setPictureProperties-failed',
            };
      }
      case 'deletePictureControl': {
        const a = call.args;
        const ok = viewer.deletePictureControl(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'deletePictureControl-failed',
            };
      }
      case 'setShapeProperties': {
        const a = call.args;
        const ok = viewer.irSetShapeProperties(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.props,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'setShapeProperties-failed',
            };
      }
      case 'deleteShapeControl': {
        const a = call.args;
        const ok = viewer.irDeleteShapeControl(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'deleteShapeControl-failed',
            };
      }
      case 'changeShapeZOrder': {
        const a = call.args;
        const ok = viewer.irChangeShapeZOrder(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.operation,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'changeShapeZOrder-failed' };
      }
      case 'insertPicture': {
        const a = call.args;
        const ok = viewer.irInsertPicture(
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
          a.base64Data,
          a.widthHwpunit,
          a.heightHwpunit,
          a.naturalWidthPx,
          a.naturalHeightPx,
          a.extension,
          a.description,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertPicture-failed' };
      }
      // === Phase 3 chunk 48 — page/section ===
      case 'insertPageBreak': {
        const a = call.args;
        const ok = viewer.irInsertPageBreak(
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertPageBreak-failed' };
      }
      case 'insertColumnBreak': {
        const a = call.args;
        const ok = viewer.irInsertColumnBreak(
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertColumnBreak-failed' };
      }
      case 'setColumnDef': {
        const a = call.args;
        const ok = viewer.irSetColumnDef(
          a.sectionIdx,
          a.columnCount,
          a.columnType,
          a.sameWidth,
          a.spacingHu,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'setColumnDef-failed' };
      }
      case 'setSectionDef': {
        const a = call.args;
        const ok = viewer.irSetSectionDef(a.sectionIdx, a.props);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'setSectionDef-failed' };
      }
      case 'setPageHide': {
        const a = call.args;
        const ok = viewer.irSetPageHide(
          a.sectionIdx,
          a.paragraphIdx,
          a.hideHeader,
          a.hideFooter,
          a.hideMaster,
          a.hideBorder,
          a.hideFill,
          a.hidePageNum,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'setPageHide-failed' };
      }
      // === Phase 3 chunk 49 — header/footer + bookmark ===
      case 'applyHfTemplate': {
        const a = call.args;
        const ok = viewer.irApplyHfTemplate(
          a.sectionIdx,
          a.isHeader,
          a.applyTo,
          a.templateId,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyHfTemplate-failed' };
      }
      case 'createHeaderFooter': {
        const a = call.args;
        const ok = viewer.irCreateHeaderFooter(
          a.sectionIdx,
          a.isHeader,
          a.applyTo,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'createHeaderFooter-failed' };
      }
      case 'deleteHeaderFooter': {
        const a = call.args;
        const ok = viewer.irDeleteHeaderFooter(
          a.sectionIdx,
          a.isHeader,
          a.applyTo,
        );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteHeaderFooter-failed' };
      }
      case 'deleteBookmark': {
        const a = call.args;
        viewer.deleteBookmarkAt(a.sectionIdx, a.paragraphIdx, a.controlIdx);
        return { ok: true, tool: call.tool };
      }
      // === Phase 3 chunk 51 — read-only Agent tools ===
      case 'getDocumentOutline': {
        const data = viewer.getOutline();
        return { ok: true, tool: call.tool, data };
      }
      case 'getDocumentSummary': {
        const data = viewer.getDocumentSummary();
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getDocumentSummary-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      case 'getStyleListJson': {
        const data = viewer.getStyleListJson();
        return { ok: true, tool: call.tool, data };
      }
      case 'getStyleAt': {
        const a = call.args;
        const data = viewer.irGetStyleAt(a.sectionIdx, a.paragraphIdx);
        if (data === null)
          return { ok: false, tool: call.tool, reason: 'getStyleAt-failed' };
        return { ok: true, tool: call.tool, data };
      }
      case 'getCharPropertiesAt': {
        const a = call.args;
        const data = viewer.irGetCharPropertiesAt(
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
        );
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getCharPropertiesAt-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      case 'getParaPropertiesAt': {
        const a = call.args;
        const data = viewer.irGetParaPropertiesAt(a.sectionIdx, a.paragraphIdx);
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getParaPropertiesAt-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      case 'getTextRange': {
        const a = call.args;
        const data = viewer.irGetTextRange(
          a.sectionIdx,
          a.startParagraphIdx,
          a.startOffset,
          a.endParagraphIdx,
          a.endOffset,
        );
        if (data === null)
          return { ok: false, tool: call.tool, reason: 'getTextRange-failed' };
        return { ok: true, tool: call.tool, data };
      }
      case 'getCaretPosition': {
        const data = viewer.irGetCaretPosition();
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getCaretPosition-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      case 'findInDocument': {
        const a = call.args;
        const data = viewer.irFindInDocument(a.query, a.maxResults);
        return { ok: true, tool: call.tool, data };
      }
      case 'getCellInfo': {
        const a = call.args;
        const data = viewer.irGetCellInfo(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
        );
        if (data === null)
          return { ok: false, tool: call.tool, reason: 'getCellInfo-failed' };
        return { ok: true, tool: call.tool, data };
      }
      // === Phase 5 chunk 96 — outline-as-router workspace search ===
      case 'searchWorkspaceOutlines': {
        // Resolve workspace root through session.lastFolderPath. The
        // IPC walks the tree + reuses the outline cache.
        const session = await window.api.session.get();
        const rootPath = session?.lastFolderPath ?? '';
        if (!rootPath) {
          return {
            ok: false,
            tool: call.tool,
            reason: 'no-workspace-folder',
          };
        }
        const data = await window.api.folder.listOutlines({
          rootPath,
          maxDocs: call.args.maxDocs,
        });
        return { ok: true, tool: call.tool, data };
      }
      case 'readParagraphByPath': {
        const a = call.args;
        const data = await window.api.folder.readParagraph({
          path: a.path,
          sectionIdx: a.sectionIdx,
          paragraphIdx: a.paragraphIdx,
          contextParagraphs: a.contextParagraphs,
        });
        if (!data.ok) {
          return {
            ok: false,
            tool: call.tool,
            reason: `readParagraphByPath-${data.reason ?? 'failed'}`,
          };
        }
        return { ok: true, tool: call.tool, data };
      }
      case 'switchTargetDoc': {
        // chunk 99 follow-up — switchTargetDoc 는 chat hook (advanceAgent
        // Loop) 에서 가로채 turnTargetPathRef 만 갱신하므로 viewer
        // dispatcher 로 도달하지 않는 게 정상. 회귀 가드 차원에서 분기만
        // 남기고 ok 반환 (no-op). 만약 여기 도달했다면 hook intercept
        // 누락 — 동작은 무해.
        return { ok: true, tool: call.tool, data: { noop: true } };
      }
      default: {
        // The pre-flight validator narrows AhwpToolCall to the union, so
        // this is unreachable without a registry/type drift.
        const _exhaustive: never = call;
        return {
          ok: false,
          tool: 'unknown',
          reason: `unhandled:${JSON.stringify(_exhaustive)}`,
        };
      }
    }
  } catch (err) {
    return {
      ok: false,
      tool: call.tool,
      reason: `ir-throw:${(err as Error).message ?? String(err)}`,
    };
  }
}

/** Sequentially run pre-flighted items. Items that failed validation
 * pre-flight pass through unchanged — they are surfaced to the user as
 * failed ops without an IR call.
 *
 * chunk 27 — wraps the whole run in `beginUndoGroup` / `endUndoGroup`
 * so the user gets ONE undo entry for the whole AI-applied turn
 * (rather than N entries, one per op). The bracket holds even if some
 * ops throw — we always end the group in a finally. */
export async function runTools(
  viewer: ViewerHandle,
  items: AhwpPreflightItem[],
): Promise<AhwpToolResult[]> {
  const out: AhwpToolResult[] = [];
  viewer.beginUndoGroup();
  try {
    for (const item of items) {
      if (!item.ok) {
        out.push({ ok: false, tool: item.tool, reason: item.reason });
        continue;
      }
      out.push(await runOne(viewer, item.call));
    }
  } finally {
    viewer.endUndoGroup();
  }
  return out;
}

/** Compact tally for the post-run toast. */
export function summarizeResults(results: AhwpToolResult[]): {
  total: number;
  ok: number;
  failed: number;
} {
  let ok = 0;
  for (const r of results) if (r.ok) ok += 1;
  return { total: results.length, ok, failed: results.length - ok };
}

/** Short human-readable args summary for the preview list. Trimmed to
 * keep the preview row tight even when html/text payloads are huge. */
export function previewArgs(call: AhwpToolCall): string {
  switch (call.tool) {
    case 'applyHtml': {
      const trimmed = call.args.html.replace(/\s+/g, ' ').trim();
      return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    }
    case 'applyAlignment':
      return call.args.align;
    case 'applyFontSize':
      return `${call.args.pt}pt`;
    case 'applyTextColor':
      return call.args.hex;
    case 'toggleCharFormat':
      return call.args.key;
    case 'insertFootnote': {
      const t = call.args.text.replace(/\s+/g, ' ').trim();
      return t.length > 40 ? `${t.slice(0, 40)}…` : t;
    }
    case 'addBookmark':
      return call.args.name;
    case 'setHeaderFooterText':
      return `sec=${call.args.sectionIdx} ${call.args.isHeader ? 'header' : 'footer'} applyTo=${call.args.applyTo}`;
    case 'applyPageDef':
      return Object.keys(call.args.props).join(', ') || '(empty)';
    case 'createNamedStyle':
      return call.args.englishName
        ? `${call.args.name} (${call.args.englishName})`
        : call.args.name;
    case 'createRectShape':
      return `${call.args.widthHwpunit}×${call.args.heightHwpunit} HWPUNIT`;
    case 'applyCellStyle':
      return `cell=${call.args.cellIdx} → styleId=${call.args.styleId}`;
    case 'insertText': {
      const t = call.args.text.replace(/\s+/g, ' ').trim();
      return `(${call.args.paragraphIdx},${call.args.charOffset}) "${t.length > 30 ? t.slice(0, 30) + '…' : t}"`;
    }
    case 'insertTextInCell': {
      const t = call.args.text.replace(/\s+/g, ' ').trim();
      return `cell=${call.args.cellIdx} "${t.length > 30 ? t.slice(0, 30) + '…' : t}"`;
    }
    case 'deleteRange':
      return `(${call.args.startParagraphIdx},${call.args.startOffset})~(${call.args.endParagraphIdx},${call.args.endOffset})`;
    case 'insertParagraph':
    case 'deleteParagraph':
    case 'mergeParagraph':
      return `para=${call.args.paragraphIdx}`;
    case 'applyCharFormat':
      return `(${call.args.paragraphIdx},${call.args.startOffset}~${call.args.endOffset}) ${Object.keys(call.args.props).join(',')}`;
    case 'applyParaProps':
      return Object.keys(call.args.props).join(', ') || '(empty)';
    case 'applyStyle':
      return `para=${call.args.paragraphIdx} → styleId=${call.args.styleId}`;
    case 'createTable':
      return `${call.args.rowCount}×${call.args.colCount} at para=${call.args.paragraphIdx}`;
    case 'insertTableRow':
      return `row=${call.args.rowIdx} ${call.args.below ? '아래' : '위'}`;
    case 'insertTableColumn':
      return `col=${call.args.colIdx} ${call.args.right ? '오른쪽' : '왼쪽'}`;
    case 'deleteTableRow':
      return `row=${call.args.rowIdx}`;
    case 'deleteTableColumn':
      return `col=${call.args.colIdx}`;
    case 'mergeTableCells':
      return `(${call.args.startRow},${call.args.startCol})~(${call.args.endRow},${call.args.endCol})`;
    case 'splitTableCellInto':
      return `(${call.args.row},${call.args.col}) → ${call.args.nRows}×${call.args.mCols}`;
    case 'unmergeCell':
      return `(${call.args.row},${call.args.col})`;
    case 'setTableProperties':
    case 'setShapeProperties':
    case 'setPictureProperties':
    case 'setSectionDef':
      return Object.keys(call.args.props).join(', ') || '(empty)';
    case 'setCellProperties':
      return `cell=${call.args.cellIdx} ${Object.keys(call.args.props).join(',')}`;
    case 'evaluateTableFormula':
      return `(${call.args.targetRow},${call.args.targetCol}) ${call.args.formula}`;
    case 'deleteTableControl':
    case 'deletePictureControl':
    case 'deleteShapeControl':
      return `ctrl=${call.args.controlIdx}`;
    case 'changeShapeZOrder':
      return `ctrl=${call.args.controlIdx} ${call.args.operation}`;
    case 'insertPicture':
      return `${call.args.extension} ${call.args.widthHwpunit}×${call.args.heightHwpunit}`;
    case 'insertPageBreak':
      return `(${call.args.paragraphIdx},${call.args.charOffset})`;
    case 'insertColumnBreak':
      return `(${call.args.paragraphIdx},${call.args.charOffset})`;
    case 'setColumnDef':
      return `${call.args.columnCount} columns`;
    case 'setPageHide': {
      const f: string[] = [];
      const a = call.args;
      if (a.hideHeader) f.push('header');
      if (a.hideFooter) f.push('footer');
      if (a.hideBorder) f.push('border');
      if (a.hideFill) f.push('fill');
      if (a.hidePageNum) f.push('pageNum');
      if (a.hideMaster) f.push('master');
      return f.join(',') || '(none)';
    }
    case 'applyHfTemplate':
      return `${call.args.isHeader ? 'header' : 'footer'} applyTo=${call.args.applyTo} template=${call.args.templateId}`;
    case 'createHeaderFooter':
    case 'deleteHeaderFooter':
      return `${call.args.isHeader ? 'header' : 'footer'} applyTo=${call.args.applyTo}`;
    case 'deleteBookmark':
      return `(${call.args.paragraphIdx},${call.args.controlIdx})`;
    // === Phase 3 chunk 51 — read tools ===
    case 'getDocumentOutline':
    case 'getDocumentSummary':
    case 'getStyleListJson':
    case 'getCaretPosition':
      return '(read)';
    case 'getStyleAt':
    case 'getParaPropertiesAt':
      return `para=${call.args.paragraphIdx}`;
    case 'getCharPropertiesAt':
      return `(${call.args.paragraphIdx},${call.args.charOffset})`;
    case 'getTextRange':
      return `(${call.args.startParagraphIdx},${call.args.startOffset})~(${call.args.endParagraphIdx},${call.args.endOffset})`;
    case 'findInDocument': {
      const q = call.args.query.replace(/\s+/g, ' ').trim();
      return `"${q.length > 30 ? q.slice(0, 30) + '…' : q}"`;
    }
    case 'getCellInfo':
      return `cell=${call.args.cellIdx}`;
    case 'searchWorkspaceOutlines':
      return call.args.maxDocs ? `max=${call.args.maxDocs}` : '';
    case 'readParagraphByPath': {
      const base = call.args.path.split(/[\\/]/).pop() ?? call.args.path;
      return `${base}#${call.args.sectionIdx}/${call.args.paragraphIdx}`;
    }
    case 'switchTargetDoc': {
      const base = call.args.path.split(/[\\/]/).pop() ?? call.args.path;
      return `→ ${base}`;
    }
  }
}
