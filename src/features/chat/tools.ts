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
 * one bad op doesn't tear down the rest of the run. */
function runOne(viewer: ViewerHandle, call: AhwpToolCall): AhwpToolResult {
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
 * failed ops without an IR call. */
export function runTools(
  viewer: ViewerHandle,
  items: AhwpPreflightItem[],
): AhwpToolResult[] {
  const out: AhwpToolResult[] = [];
  for (const item of items) {
    if (!item.ok) {
      out.push({ ok: false, tool: item.tool, reason: item.reason });
      continue;
    }
    out.push(runOne(viewer, item.call));
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
  }
}
