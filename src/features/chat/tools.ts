/**
 * `ahwp-tools` dispatcher — chunk 19. Maps a parsed AhwpToolCall to a
 * `ViewerHandle` method. Explicit switch only — no dynamic method
 * lookup, no `eval`, no provider tool-use bridging here. The whitelist
 * is the union in `shared/ai-tools.ts`.
 */
import {
  isReadOnlyTool,
  type AhwpPreflightItem,
  type AhwpToolCall,
  type AhwpToolResult,
} from '@shared/ai-tools';
// Phase 7 E2 — 본 file 이 사용하는 ViewerHandle 은 legacy StudioViewer 의
// surface 였음. studio dir 폐기에 대비해 type 정의만 별도 file 로
// 분리해 vendored (`./viewer-handle-types.ts`). rhwp-mode 가 default 라
// 실 사용 시엔 NULL_VIEWER_STUB 으로 throw — bridge 경유만 의도.
import type { ViewerHandle } from './viewer-handle-types';
import type { BridgeIrHelper } from '@/features/rhwp-studio/bridge-ir-helper';

/** Run an op against the viewer. Returns a result describing what
 * happened — IR throws are caught and recorded as `ir-throw:<msg>` so
 * one bad op doesn't tear down the rest of the run.
 *
 * chunk 96 — async because the new `searchWorkspaceOutlines` /
 * `readParagraphByPath` tools dispatch through main-process IPC.
 * Existing IR-call tools wrap their sync result in Promise.resolve
 * via the natural async function semantics.
 *
 * Phase D2b — `helper` 가 non-null 이면 일부 case 는 BridgeIrHelper 로
 * 라우팅한다 (rhwp-studio iframe 의 IR 사용). null 이면 기존 viewer.irX
 * 경로 그대로. 단계적 마이그레이션 — 모든 case 가 helper 를 쓰는 건
 * D2c 이후. */
/**
 * viewer 가 null 일 때 (rhwp-mode + StudioViewer 미마운트) 사용하는 stub.
 * 어떤 메서드든 호출되면 throw — 호출자가 helper 우선 경로로 흐르도록
 * 강제. 단, 일부 ahwp-side 도구 (applyHtml / applyAlignment 등 composite
 * non-ir 케이스) 는 helper 커버리지 없음 → AI 가 호출 시 error 로 fail.
 */
const NULL_VIEWER_STUB = new Proxy({} as ViewerHandle, {
  get(_t, prop) {
    throw new Error(
      `viewer.${String(prop)} called in rhwp-mode (no StudioViewer). 도구는 bridge 경유 가능한 ir* 메서드만 지원합니다.`,
    );
  },
});

async function runOne(
  viewerOrNull: ViewerHandle | null,
  call: AhwpToolCall,
  helper: BridgeIrHelper | null = null,
): Promise<AhwpToolResult> {
  const viewer: ViewerHandle = viewerOrNull ?? NULL_VIEWER_STUB;
  try {
    switch (call.tool) {
      // Phase 7 E2-finalize — 이전 viewer composite 들을 helper 로 재구현.
      // helper 가 single serialization point — 객체 그대로 전달, ahwp 측
      // JSON.stringify 절대 X. helper 가 없으면 (legacy mode) NULL_VIEWER_STUB
      // throw — 사용자에게 명확한 에러.
      case 'applyHtml': {
        // 0.6.7 hard-guard — applyHtml 도 insertText (0,0,0) 와 동일한
        // 위험: caret 의존성 + default 위치 (0,0,0) 가 표 cell 안인 양식
        // 문서를 망가뜨림. tools.ts:327 의 insertText 가드와 parallel.
        //
        // 정책: caret 이 (0,0,0) AND 문서가 fresh-blank 가 아니면 (= 더
        // 많은 단락 또는 첫 단락에 텍스트 존재) reject. AI 가 anchor 를
        // findInDocument / searchAllText 로 찾고 moveCaret 으로 가서
        // 다시 시도하도록.
        if (helper) {
          try {
            const caret = await helper.getCaretPosition();
            if (
              caret &&
              caret.sectionIndex === 0 &&
              caret.paragraphIndex === 0 &&
              caret.charOffset === 0
            ) {
              const paraCount = await helper.getParagraphCount(0);
              const firstParaLen = await helper.getParagraphLength(0, 0);
              const isBlankFresh = paraCount === 1 && firstParaLen === 0;
              if (!isBlankFresh) {
                return {
                  ok: false,
                  tool: call.tool,
                  reason:
                    'applyHtml-at-doc-start-rejected: caret 이 (0,0,0) + 문서가 비어있지 않음. 양식 / 보고서 doc 의 표지 표 cell 안 또는 placeholder 섹션 위에 dump 되어 layout 파괴 위험. anchor 를 searchAllText / findInDocument 로 식별 → moveCaret 으로 이동 → applyHtml 재시도. 또는 sectionIndex/paragraphIndex 명시한 insertText/insertParagraph 사용.',
                };
              }
            }
          } catch (err) {
            // caret/structure 조회 실패는 가드 패스 (정상 흐름 진행).
            console.warn('[tools] applyHtml caret pre-check failed:', err);
          }
        }
        const ok = helper
          ? await helper.applyHtmlAtCaret(call.args.html)
          : (() => {
              viewer.applyHtmlAtCaret(call.args.html);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyHtml-failed' };
      }
      case 'applyAlignment': {
        const ok = helper
          ? await helper.applyAlignmentAtCaret(call.args.align)
          : (() => {
              viewer.applyAlignment(call.args.align);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyAlignment-failed' };
      }
      case 'applyFontSize': {
        const ok = helper
          ? await helper.applyFontSizePtAtCaret(call.args.pt)
          : (() => {
              viewer.applyFontSizePt(call.args.pt);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyFontSize-failed' };
      }
      case 'applyTextColor': {
        const ok = helper
          ? await helper.applyTextColorAtCaret(call.args.hex)
          : (() => {
              viewer.applyTextColor(call.args.hex);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyTextColor-failed' };
      }
      case 'toggleCharFormat': {
        const ok = helper
          ? await helper.toggleCharFormatAtCaret(call.args.key)
          : (() => {
              viewer.toggleCharFormat(call.args.key);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'toggleCharFormat-failed' };
      }
      case 'insertFootnote': {
        const ok = helper
          ? await helper.insertFootnoteAtCaret(call.args.text)
          : (() => {
              viewer.insertFootnoteAtCaret(call.args.text);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertFootnote-failed' };
      }
      case 'addBookmark': {
        const ok = helper
          ? await helper.addBookmarkAtCaret(call.args.name)
          : (() => {
              viewer.addBookmarkAtCaret(call.args.name);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'addBookmark-failed' };
      }
      case 'setHeaderFooterText': {
        const a = call.args;
        const ok = helper
          ? await helper.setHeaderFooterText(
              a.sectionIdx,
              a.isHeader,
              a.applyTo,
              a.text,
            )
          : (() => {
              viewer.setHeaderFooterText(
                a.sectionIdx,
                a.isHeader,
                a.applyTo,
                a.text,
              );
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'setHeaderFooterText-failed',
            };
      }
      case 'applyPageDef': {
        // applyPageDef tool args 의 sectionIdx 는 optional (전체 적용 시
        // undefined). helper.setPageDef 는 number 필요 — undefined 면 0.
        const sec = call.args.sectionIdx ?? 0;
        const ok = helper
          ? await helper.setPageDef(sec, call.args.props)
          : (() => {
              viewer.applyPageDef(call.args.props, call.args.sectionIdx);
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyPageDef-failed' };
      }
      case 'createNamedStyle': {
        // englishName 은 optional — undefined 면 빈 문자열.
        const englishName = call.args.englishName ?? '';
        if (helper) {
          const id = await helper.createNamedStyle(call.args.name, englishName);
          if (id <= 0)
            return { ok: false, tool: call.tool, reason: 'createStyle-failed' };
          return { ok: true, tool: call.tool };
        }
        const id = viewer.createNamedStyle(
          call.args.name,
          call.args.englishName,
        );
        if (id == null)
          return { ok: false, tool: call.tool, reason: 'createStyle-failed' };
        return { ok: true, tool: call.tool };
      }
      case 'createRectShape': {
        if (helper) {
          const r = await helper.createRectShapeAtCaret(
            call.args.widthHwpunit,
            call.args.heightHwpunit,
            call.args.opts,
          );
          if (!r.ok)
            return { ok: false, tool: call.tool, reason: 'createShape-failed' };
          return { ok: true, tool: call.tool };
        }
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
        const ok = helper
          ? await helper.applyCellStyle(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              a.styleId,
            )
          : viewer.applyCellStyle(
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
      // Phase D2b — helper 라우팅. helper 의 getTextInCell / insertTextInCell
      // 가 wasm-bridge 의 동명 메서드와 1:1 passthrough.
      case 'insertTextInCell': {
        const a = call.args;
        const before = helper
          ? await helper.getTextInCell(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              0,
              4096,
            )
          : (viewer.irGetTextInCell(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              0,
              4096,
            ) ?? '');
        const ok = helper
          ? await helper.insertTextInCell(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              a.charOffset,
              a.text,
            )
          : viewer.irInsertTextInCell(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              a.charOffset,
              a.text,
            );
        if (!ok)
          return {
            ok: false,
            tool: call.tool,
            reason: 'insertTextInCell-failed',
          };
        const after = helper
          ? await helper.getTextInCell(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              0,
              4096,
            )
          : (viewer.irGetTextInCell(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.cellParaIdx,
              0,
              4096,
            ) ?? '');
        return {
          ok: true,
          tool: call.tool,
          diff: {
            paragraphIdx: a.parentParaIdx,
            before,
            after,
            label: `cell #${a.cellIdx}`,
          },
        };
      }
      // === 0.6.15 — atomic cell replace (modify / placeholder 제거) ===
      case 'replaceTextInCell': {
        const a = call.args;
        if (!helper) {
          return {
            ok: false,
            tool: call.tool,
            reason: 'replaceTextInCell-no-helper',
          };
        }
        const before = await helper.getTextInCell(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
          a.cellParaIdx,
          0,
          4096,
        );
        const ok = await helper.replaceTextInCell(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
          a.cellParaIdx,
          a.text,
        );
        if (!ok)
          return {
            ok: false,
            tool: call.tool,
            reason: 'replaceTextInCell-failed',
          };
        const after = await helper.getTextInCell(
          a.sectionIdx,
          a.parentParaIdx,
          a.controlIdx,
          a.cellIdx,
          a.cellParaIdx,
          0,
          4096,
        );
        return {
          ok: true,
          tool: call.tool,
          diff: {
            paragraphIdx: a.parentParaIdx,
            before,
            after,
            label: `cell #${a.cellIdx} (replace)`,
          },
        };
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
        // 0.4.23 — synthetic diff. paragraph 텍스트 before/after snapshot.
        // Phase D2b — helper 가 있으면 bridge 라우팅, 없으면 viewer.irX.
        const before = helper
          ? await helper.getTextRange(
              a.sectionIdx,
              a.paragraphIdx,
              0,
              a.paragraphIdx,
              10_000,
            )
          : (viewer.irGetTextRange(
              a.sectionIdx,
              a.paragraphIdx,
              0,
              a.paragraphIdx,
              10_000,
            ) ?? '');
        const ok = helper
          ? await helper.insertText(
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
              a.text,
            )
          : viewer.irInsertText(
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
              a.text,
            );
        if (!ok)
          return { ok: false, tool: call.tool, reason: 'insertText-failed' };
        const after = helper
          ? await helper.getTextRange(
              a.sectionIdx,
              a.paragraphIdx,
              0,
              a.paragraphIdx,
              10_000,
            )
          : (viewer.irGetTextRange(
              a.sectionIdx,
              a.paragraphIdx,
              0,
              a.paragraphIdx,
              10_000,
            ) ?? '');
        return {
          ok: true,
          tool: call.tool,
          diff: {
            paragraphIdx: a.paragraphIdx,
            before,
            after,
            label: `섹션 ${a.sectionIdx} · 단락 ${a.paragraphIdx}`,
          },
        };
      }
      case 'deleteRange': {
        const a = call.args;
        const before = helper
          ? await helper.getTextRange(
              a.sectionIdx,
              a.startParagraphIdx,
              0,
              a.endParagraphIdx,
              10_000,
            )
          : (viewer.irGetTextRange(
              a.sectionIdx,
              a.startParagraphIdx,
              0,
              a.endParagraphIdx,
              10_000,
            ) ?? '');
        const ok = helper
          ? await helper.deleteRange(
              a.sectionIdx,
              a.startParagraphIdx,
              a.startOffset,
              a.endParagraphIdx,
              a.endOffset,
            )
          : viewer.irDeleteRange(
              a.sectionIdx,
              a.startParagraphIdx,
              a.startOffset,
              a.endParagraphIdx,
              a.endOffset,
            );
        if (!ok)
          return { ok: false, tool: call.tool, reason: 'deleteRange-failed' };
        const after = helper
          ? await helper.getTextRange(
              a.sectionIdx,
              a.startParagraphIdx,
              0,
              a.startParagraphIdx,
              10_000,
            )
          : (viewer.irGetTextRange(
              a.sectionIdx,
              a.startParagraphIdx,
              0,
              a.startParagraphIdx,
              10_000,
            ) ?? '');
        return {
          ok: true,
          tool: call.tool,
          diff: {
            paragraphIdx: a.startParagraphIdx,
            before,
            after,
            label: `섹션 ${a.sectionIdx} · 단락 ${a.startParagraphIdx}-${a.endParagraphIdx}`,
          },
        };
      }
      case 'insertParagraph': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('insertParagraph', [
              a.sectionIdx,
              a.paragraphIdx,
            ])
          : viewer.irInsertParagraph(a.sectionIdx, a.paragraphIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertParagraph-failed' };
      }
      case 'deleteParagraph': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('deleteParagraph', [
              a.sectionIdx,
              a.paragraphIdx,
            ])
          : viewer.irDeleteParagraph(a.sectionIdx, a.paragraphIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteParagraph-failed' };
      }
      case 'mergeParagraph': {
        const a = call.args;
        const ok = helper
          ? await helper.mergeParagraph(a.sectionIdx, a.paragraphIdx)
          : viewer.irMergeParagraph(a.sectionIdx, a.paragraphIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'mergeParagraph-failed' };
      }
      case 'applyCharFormat': {
        const a = call.args;
        const ok = helper
          ? await helper.applyCharFormat(
              a.sectionIdx,
              a.paragraphIdx,
              a.startOffset,
              a.endOffset,
              a.props,
            )
          : viewer.irApplyCharFormat(
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
        if (helper) {
          const caret = await helper.getCaretPosition();
          if (!caret)
            return {
              ok: false,
              tool: call.tool,
              reason: 'applyParaProps-no-caret',
            };
          const ok = await helper.applyParaProps(
            caret.sectionIndex,
            caret.paragraphIndex,
            call.args.props,
          );
          return ok
            ? { ok: true, tool: call.tool }
            : { ok: false, tool: call.tool, reason: 'applyParaProps-failed' };
        }
        viewer.applyParaProps(call.args.props);
        return { ok: true, tool: call.tool };
      }
      case 'applyStyle': {
        const a = call.args;
        const ok = helper
          ? await helper.applyStyle(a.sectionIdx, a.paragraphIdx, a.styleId)
          : viewer.irApplyStyle(a.sectionIdx, a.paragraphIdx, a.styleId);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'applyStyle-failed' };
      }
      // === Phase 3 chunk 46 — table structure ===
      case 'createTable': {
        const a = call.args;
        const args = [
          a.sectionIdx,
          a.paragraphIdx,
          a.charOffset,
          a.rowCount,
          a.colCount,
        ];
        const ok = helper
          ? await helper.invokeOk('createTable', args)
          : viewer.irCreateTable(
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
        const ok = helper
          ? await helper.invokeOk('insertTableRow', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.rowIdx,
              a.below,
            ])
          : viewer.irInsertTableRow(
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
        const ok = helper
          ? await helper.invokeOk('insertTableColumn', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.colIdx,
              a.right,
            ])
          : viewer.irInsertTableColumn(
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
        const ok = helper
          ? await helper.invokeOk('deleteTableRow', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.rowIdx,
            ])
          : viewer.irDeleteTableRow(
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
        const ok = helper
          ? await helper.invokeOk('deleteTableColumn', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.colIdx,
            ])
          : viewer.irDeleteTableColumn(
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
        const ok = helper
          ? await helper.invokeOk('mergeTableCells', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.startRow,
              a.startCol,
              a.endRow,
              a.endCol,
            ])
          : viewer.irMergeTableCells(
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
        const ok = helper
          ? await helper.invokeOk('splitTableCellInto', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.row,
              a.col,
              a.nRows,
              a.mCols,
              a.equalRowHeight,
              a.mergeFirst,
            ])
          : viewer.irSplitTableCellInto(
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
        const ok = helper
          ? await helper.invokeOk('unmergeCell', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.row,
              a.col,
            ])
          : viewer.irUnmergeCell(
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
        const ok = helper
          ? await helper.setTableProperties(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.props,
            )
          : (() => {
              viewer.setTableProps(
                a.sectionIdx,
                a.parentParaIdx,
                a.controlIdx,
                a.props,
              );
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'setTableProperties-failed' };
      }
      case 'setCellProperties': {
        const a = call.args;
        const ok = helper
          ? await helper.setCellProperties(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
              a.props,
            )
          : (() => {
              viewer.setCellProps(
                a.sectionIdx,
                a.parentParaIdx,
                a.controlIdx,
                a.cellIdx,
                a.props,
              );
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'setCellProperties-failed' };
      }
      case 'evaluateTableFormula': {
        const a = call.args;
        const r = helper
          ? await helper.evaluateTableFormula(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.targetRow,
              a.targetCol,
              a.formula,
              a.writeResult,
            )
          : viewer.evaluateTableFormula(
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
        const ok = helper
          ? await helper.invokeOk('deleteTableControl', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
            ])
          : viewer.irDeleteTableControl(
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
        const ok = helper
          ? await helper.setPictureProperties(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.props,
            )
          : (viewer.setPictureProps(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.props,
            ) as boolean);
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
        const ok = helper
          ? await helper.deletePictureControl(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
            )
          : (viewer.deletePictureControl(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
            ) as boolean);
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'deletePictureControl-failed',
            };
      }
      case 'setShapeProperties': {
        // 이중변환 fix — wasm-bridge.setShapeProperties 가 내부적으로
        // JSON.stringify(props) 수행. ahwp 측은 객체 그대로 전달.
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('setShapeProperties', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.props,
            ])
          : viewer.irSetShapeProperties(
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
        const ok = helper
          ? await helper.invokeOk('deleteShapeControl', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
            ])
          : viewer.irDeleteShapeControl(
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
        const ok = helper
          ? await helper.invokeOk('changeShapeZOrder', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.operation,
            ])
          : viewer.irChangeShapeZOrder(
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
        const ok = helper
          ? await helper.insertPictureAtCaret(
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
            )
          : viewer.irInsertPicture(
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
        const ok = helper
          ? await helper.invokeOk('insertPageBreak', [
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
            ])
          : viewer.irInsertPageBreak(
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
        const ok = helper
          ? await helper.invokeOk('insertColumnBreak', [
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
            ])
          : viewer.irInsertColumnBreak(
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
        const ok = helper
          ? await helper.invokeOk('setColumnDef', [
              a.sectionIdx,
              a.columnCount,
              a.columnType,
              a.sameWidth,
              a.spacingHu,
            ])
          : viewer.irSetColumnDef(
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
        // 이중변환 fix — wasm-bridge.setSectionDef 가 내부 JSON.stringify.
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('setSectionDef', [a.sectionIdx, a.props])
          : viewer.irSetSectionDef(a.sectionIdx, a.props);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'setSectionDef-failed' };
      }
      case 'setPageHide': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('setPageHide', [
              a.sectionIdx,
              a.paragraphIdx,
              a.hideHeader,
              a.hideFooter,
              a.hideMaster,
              a.hideBorder,
              a.hideFill,
              a.hidePageNum,
            ])
          : viewer.irSetPageHide(
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
        const ok = helper
          ? await helper.invokeOk('applyHfTemplate', [
              a.sectionIdx,
              a.isHeader,
              a.applyTo,
              a.templateId,
            ])
          : viewer.irApplyHfTemplate(
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
        const ok = helper
          ? await helper.invokeOk('createHeaderFooter', [
              a.sectionIdx,
              a.isHeader,
              a.applyTo,
            ])
          : viewer.irCreateHeaderFooter(a.sectionIdx, a.isHeader, a.applyTo);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'createHeaderFooter-failed' };
      }
      case 'deleteHeaderFooter': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('deleteHeaderFooter', [
              a.sectionIdx,
              a.isHeader,
              a.applyTo,
            ])
          : viewer.irDeleteHeaderFooter(a.sectionIdx, a.isHeader, a.applyTo);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteHeaderFooter-failed' };
      }
      case 'deleteBookmark': {
        const a = call.args;
        const ok = helper
          ? await helper.deleteBookmarkAt(
              a.sectionIdx,
              a.paragraphIdx,
              a.controlIdx,
            )
          : (() => {
              viewer.deleteBookmarkAt(
                a.sectionIdx,
                a.paragraphIdx,
                a.controlIdx,
              );
              return true;
            })();
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteBookmark-failed' };
      }
      // === Phase 3 chunk 51 — read-only Agent tools ===
      case 'getDocumentOutline': {
        const data = helper
          ? await helper.getDocumentOutline()
          : (viewer.getOutline() as unknown);
        return { ok: true, tool: call.tool, data };
      }
      case 'getDocumentSummary': {
        const data = helper
          ? await helper.getDocumentSummary()
          : (viewer.getDocumentSummary() as unknown);
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getDocumentSummary-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      case 'getStyleListJson': {
        const data = helper
          ? await helper.getStyleList()
          : (viewer.getStyleListJson() as unknown);
        return { ok: true, tool: call.tool, data };
      }
      case 'getStyleAt': {
        const a = call.args;
        const data = helper
          ? await helper.getStyleAt(a.sectionIdx, a.paragraphIdx)
          : viewer.irGetStyleAt(a.sectionIdx, a.paragraphIdx);
        if (data === null)
          return { ok: false, tool: call.tool, reason: 'getStyleAt-failed' };
        return { ok: true, tool: call.tool, data };
      }
      case 'getCharPropertiesAt': {
        const a = call.args;
        const data = helper
          ? await helper.getCharPropertiesAt(
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
            )
          : viewer.irGetCharPropertiesAt(
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
        const data = helper
          ? await helper.getParaPropertiesAt(a.sectionIdx, a.paragraphIdx)
          : viewer.irGetParaPropertiesAt(a.sectionIdx, a.paragraphIdx);
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
        const data = helper
          ? await helper.getTextRange(
              a.sectionIdx,
              a.startParagraphIdx,
              a.startOffset,
              a.endParagraphIdx,
              a.endOffset,
            )
          : viewer.irGetTextRange(
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
        const data = helper
          ? await helper.getCaretPosition()
          : viewer.irGetCaretPosition();
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
        // helper 경로: searchAllText (rhwp 0.7.12 native) 직접 호출 후
        // maxResults 자르기. viewer.irFindInDocument 는 동일 동작을
        // useViewerHandle 안에서 수행.
        //
        // 중요: helper.searchAllText 는 raw RhwpSearchHit
        // ({sec, para, charOffset, length, cellContext}) 를 반환하지만,
        // viewer-handle contract 와 AI 가 기대하는 shape 는
        // {sectionIdx, paragraphIdx, charOffset, length?, cellContext?}.
        // helper 경로일 때 필드명을 매핑하지 않으면 후속 insertText
        // 호출의 sectionIdx/paragraphIdx 가 undefined 가 됨.
        if (helper) {
          const hits = await helper.searchAllText(a.query, false, false);
          const sliced = hits.slice(0, a.maxResults ?? hits.length);
          const data = sliced.map((h) => ({
            sectionIdx: h.sec,
            paragraphIdx: h.para,
            charOffset: h.charOffset,
            length: h.length,
            cellContext: h.cellContext,
          }));
          return { ok: true, tool: call.tool, data };
        }
        const data = viewer.irFindInDocument(a.query, a.maxResults);
        return { ok: true, tool: call.tool, data };
      }
      case 'getCellInfo': {
        const a = call.args;
        const data = helper
          ? await helper.invokeRead('getCellInfo', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
            ])
          : viewer.irGetCellInfo(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
              a.cellIdx,
            );
        if (data === null)
          return { ok: false, tool: call.tool, reason: 'getCellInfo-failed' };
        return { ok: true, tool: call.tool, data };
      }
      // === 0.4.24 — @rhwp/core 0.7.11 신규 API ===
      case 'insertEquation': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('insertEquation', [
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
              a.script,
              a.fontSizeHwpunit,
              a.color,
            ])
          : viewer.irInsertEquation(
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
              a.script,
              a.fontSizeHwpunit,
              a.color,
            );
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'insertEquation-failed' };
      }
      case 'deleteFootnote': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('deleteFootnote', [
              a.sectionIdx,
              a.paragraphIdx,
              a.controlIdx,
            ])
          : viewer.irDeleteFootnote(a.sectionIdx, a.paragraphIdx, a.controlIdx);
        return ok
          ? { ok: true, tool: call.tool }
          : { ok: false, tool: call.tool, reason: 'deleteFootnote-failed' };
      }
      case 'deleteEquationControl': {
        const a = call.args;
        const ok = helper
          ? await helper.invokeOk('deleteEquationControl', [
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
            ])
          : viewer.irDeleteEquationControl(
              a.sectionIdx,
              a.parentParaIdx,
              a.controlIdx,
            );
        return ok
          ? { ok: true, tool: call.tool }
          : {
              ok: false,
              tool: call.tool,
              reason: 'deleteEquationControl-failed',
            };
      }
      case 'getColumnDef': {
        const a = call.args;
        const data = helper
          ? await helper.invokeRead('getColumnDef', [a.sectionIdx])
          : viewer.irGetColumnDef(a.sectionIdx);
        if (data === null)
          return { ok: false, tool: call.tool, reason: 'getColumnDef-failed' };
        return { ok: true, tool: call.tool, data };
      }
      case 'getFootnoteAtCursor': {
        const a = call.args;
        const data = helper
          ? await helper.invokeRead('getFootnoteAtCursor', [
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
              a.direction,
            ])
          : viewer.irGetFootnoteAtCursor(
              a.sectionIdx,
              a.paragraphIdx,
              a.charOffset,
              a.direction,
            );
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getFootnoteAtCursor-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      case 'getEmptyFormFields': {
        const a = call.args;
        const data = helper
          ? await helper.getEmptyFormFields({
              sectionIdx: a.sectionIdx,
              parentParaIdx: a.parentParaIdx,
              maxResults: a.maxResults,
              includeFilled: a.includeFilled,
            })
          : (viewer.getEmptyFormFields({
              sectionIdx: a.sectionIdx,
              parentParaIdx: a.parentParaIdx,
              maxResults: a.maxResults,
              includeFilled: a.includeFilled,
            }) as unknown);
        if (data === null)
          return {
            ok: false,
            tool: call.tool,
            reason: 'getEmptyFormFields-failed',
          };
        return { ok: true, tool: call.tool, data };
      }
      // === 0.6.17 — Phase B 시각 검증 MVP. 한 페이지 SVG 캡처 ===
      case 'getPageSvg': {
        const a = call.args;
        if (!helper) {
          return {
            ok: false,
            tool: call.tool,
            reason: 'getPageSvg-no-helper',
          };
        }
        try {
          const svg = await helper.getPageSvg(a.pageIdx);
          // SVG 자체가 클 수 있어 chat tool-result cap 고려. 매우 큰
          // 경우 (~64KB+) 는 잘라낸 사실을 반환해 AI 가 인지 가능.
          const MAX_SVG_BYTES = 64 * 1024;
          if (svg.length > MAX_SVG_BYTES) {
            return {
              ok: true,
              tool: call.tool,
              data: {
                pageIdx: a.pageIdx,
                svg: svg.slice(0, MAX_SVG_BYTES),
                truncated: true,
                originalBytes: svg.length,
              },
            };
          }
          return {
            ok: true,
            tool: call.tool,
            data: { pageIdx: a.pageIdx, svg, truncated: false },
          };
        } catch (err) {
          return {
            ok: false,
            tool: call.tool,
            reason: `getPageSvg-failed: ${(err as Error).message}`,
          };
        }
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
      // 0.7.7 — external world access. main process IPC 로 위임 (renderer
      // 의 CSP 우회 + Node fetch 사용). 모두 read-only, 사용자 confirm 게이트
      // 우회 (READONLY_TOOL_NAMES 에 포함).
      case 'webFetch': {
        const a = call.args;
        try {
          const r = await window.api.web.fetch({
            url: a.url,
            prompt: a.prompt,
            maxBytes: a.maxBytes,
          });
          return { ok: true, tool: call.tool, data: r };
        } catch (e) {
          return {
            ok: false,
            tool: call.tool,
            reason: `webFetch-failed:${(e as Error).message ?? String(e)}`,
          };
        }
      }
      case 'webSearch': {
        const a = call.args;
        try {
          const r = await window.api.web.search({
            query: a.query,
            maxResults: a.maxResults,
          });
          return { ok: true, tool: call.tool, data: r };
        } catch (e) {
          return {
            ok: false,
            tool: call.tool,
            reason: `webSearch-failed:${(e as Error).message ?? String(e)}`,
          };
        }
      }
      // 0.7.9 — Bash 명령 실행. main process 가 allowlist / blocklist /
      // cwd / timeout / output cap 모든 게이트 처리. dispatcher 는 단순
      // IPC 위임 + 결과 forward.
      case 'runCommand': {
        const a = call.args;
        try {
          const r = await window.api.bash.run({
            command: a.command,
            cwd: a.cwd,
            timeoutMs: a.timeoutMs,
          });
          // ok=false 인 경우도 data 로 통과 — reason 이 모델에게 의미
          // 있는 피드백 ("not-in-allowlist" → 사용자에게 등록 요청 등).
          return { ok: true, tool: call.tool, data: r };
        } catch (e) {
          return {
            ok: false,
            tool: call.tool,
            reason: `runCommand-failed:${(e as Error).message ?? String(e)}`,
          };
        }
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
  viewer: ViewerHandle | null,
  items: AhwpPreflightItem[],
  helper: BridgeIrHelper | null = null,
): Promise<AhwpToolResult[]> {
  const out: AhwpToolResult[] = [];
  // Phase 7 E2c — rhwp-mode 에선 viewer 가 null 일 수 있음 (StudioViewer
  // 미마운트). helper 가 있어야 의미 있는 동작 — undo group / snapshot 은
  // rhwp-studio 가 iframe 안에서 자체 관리하므로 skip.
  viewer?.beginUndoGroup();
  try {
    for (const item of items) {
      if (!item.ok) {
        out.push({ ok: false, tool: item.tool, reason: item.reason });
        continue;
      }
      out.push(await runOne(viewer, item.call, helper));
    }
  } finally {
    viewer?.endUndoGroup();
  }
  // 0.6.14 — canvas repaint notify. Bridge-routed write tools
  // (insertTextInCell / insertText / applyCharFormat / ...) bypass the
  // native input-handler's afterEdit() which is what fires
  // `document-changed` to trigger CanvasView.refreshPages(). Without
  // this manual notify the IR mutates correctly but the editor canvas
  // shows stale (pre-edit) content. Fire once per batch (idempotent).
  // Read-only batches skip the notify.
  if (helper) {
    const anyWrite = items.some((it) => it.ok && !isReadOnlyTool(it.call.tool));
    const anyOk = out.some((r) => r.ok);
    if (anyWrite && anyOk) {
      try {
        // Access bridge through helper (private field via cast). Cheap
        // call — just emits an event in the iframe.
        const bridge = (
          helper as unknown as {
            bridge: { invoke: (m: string, p?: unknown) => Promise<unknown> };
          }
        ).bridge;
        await bridge.invoke('notifyDocumentChanged', { reason: 'ahwp-tools' });
      } catch (err) {
        console.warn(
          '[tools] notifyDocumentChanged failed (older vendor build?):',
          err,
        );
      }
    }
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
    case 'replaceTextInCell': {
      const t = call.args.text.replace(/\s+/g, ' ').trim();
      const preview =
        t.length === 0 ? '(clear)' : t.length > 30 ? t.slice(0, 30) + '…' : t;
      return `cell=${call.args.cellIdx} ⇒ "${preview}"`;
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
    // === 0.4.24 — @rhwp/core 0.7.11 신규 ===
    case 'insertEquation':
      return `(${call.args.paragraphIdx},${call.args.charOffset})`;
    case 'deleteFootnote':
    case 'deleteEquationControl':
      return `ctrl=${call.args.controlIdx}`;
    case 'getColumnDef':
      return `sec=${call.args.sectionIdx}`;
    case 'getFootnoteAtCursor':
      return `(${call.args.paragraphIdx},${call.args.charOffset}) ${call.args.direction}`;
    case 'getEmptyFormFields':
      return call.args.sectionIdx !== undefined
        ? `sec=${call.args.sectionIdx}`
        : '(all)';
    case 'getPageSvg':
      return `page=${call.args.pageIdx}`;
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
    // 0.7.7 — external world access.
    case 'webFetch': {
      const u = call.args.url;
      try {
        const host = new URL(u).host;
        return host;
      } catch {
        return u.length > 40 ? u.slice(0, 40) + '…' : u;
      }
    }
    case 'webSearch': {
      const q = call.args.query.replace(/\s+/g, ' ').trim();
      return `"${q.length > 30 ? q.slice(0, 30) + '…' : q}"`;
    }
    // 0.7.9 — Bash.
    case 'runCommand': {
      const c = call.args.command;
      return c.length > 40 ? c.slice(0, 40) + '…' : c;
    }
  }
}
