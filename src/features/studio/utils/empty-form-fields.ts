/**
 * 0.4.21 — empty form-field discovery helper. Walks every paragraph in
 * the section, finds table controls via getControlTextPositions, walks
 * each table's cells, and emits coords for every cell whose only
 * paragraph is empty (length 0, paragraph count 1). Adds a label hint
 * (text of the left-then-top sibling cell) and the label's char-shape.
 * Deterministic, read-only.
 *
 * Shared by `useViewerHandle.getEmptyFormFields` (AI dispatch path) and
 * `useDebugSurface.getEmptyFormFields` (deterministic e2e path) so the
 * two surfaces can never drift.
 */
import type { RhwpDoc } from '@/lib/rhwp-core';

export interface EmptyFormFieldsResult {
  cellFields: {
    location: {
      sectionIndex: number;
      paragraphIndex: number;
      controlIndex: number;
      cellIndex: number;
      cellParagraphIndex: number;
    };
    labelHint: string;
    labelCharShape?: Record<string, unknown>;
  }[];
  truncated: boolean;
}

interface CellMeta {
  row: number;
  col: number;
  empty: boolean;
  text: string;
  charShape?: Record<string, unknown>;
}

interface TableDims {
  rowCount?: number;
  cellCount?: number;
}

interface CellRC {
  row?: number;
  col?: number;
}

export function enumerateEmptyFormFields(
  doc: RhwpDoc,
  opts: { sectionIdx?: number; maxResults?: number } = {},
): EmptyFormFieldsResult {
  const wantSec = opts.sectionIdx;
  const max = opts.maxResults ?? 100;
  const cellFields: EmptyFormFieldsResult['cellFields'] = [];
  let truncated = false;

  const secCount = doc.getSectionCount();
  const sections =
    wantSec !== undefined && wantSec < secCount
      ? [wantSec]
      : Array.from({ length: secCount }, (_, i) => i);

  outer: for (const sec of sections) {
    const paraCount = doc.getParagraphCount(sec);
    const paraCap = Math.min(paraCount, 5000);
    for (let p = 0; p < paraCap; p++) {
      if (cellFields.length >= max) {
        truncated = true;
        break outer;
      }
      // lib `getControlTextPositions` 반환: paragraph 안의 각 control 의
      // CHAR OFFSET 배열 (object 가 아니라 number[]). 즉 array index 가
      // controlIndex, value 가 char offset.
      let controlCount = 0;
      try {
        const raw = doc.getControlTextPositions(sec, p);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) controlCount = parsed.length;
      } catch {
        continue;
      }
      if (controlCount === 0) continue;
      for (let ctrlIdx = 0; ctrlIdx < controlCount; ctrlIdx++) {
        let dims: TableDims;
        try {
          dims = JSON.parse(
            doc.getTableDimensions(sec, p, ctrlIdx),
          ) as TableDims;
        } catch {
          continue;
        }
        if (typeof dims.cellCount !== 'number' || dims.cellCount <= 0) continue;
        const cellTotal = dims.cellCount;

        const cellMeta = new Map<number, CellMeta>();
        for (let ci = 0; ci < cellTotal; ci++) {
          let info: CellRC;
          try {
            info = JSON.parse(doc.getCellInfo(sec, p, ctrlIdx, ci)) as CellRC;
          } catch {
            continue;
          }
          if (typeof info.row !== 'number' || typeof info.col !== 'number')
            continue;
          const cellRow = info.row;
          const cellCol = info.col;
          let cellParaCount: number;
          try {
            cellParaCount = doc.getCellParagraphCount(sec, p, ctrlIdx, ci);
          } catch {
            continue;
          }
          let len0: number;
          try {
            len0 = doc.getCellParagraphLength(sec, p, ctrlIdx, ci, 0);
          } catch {
            continue;
          }
          let text = '';
          let charShape: Record<string, unknown> | undefined;
          if (len0 > 0) {
            try {
              text = doc.getTextInCell(
                sec,
                p,
                ctrlIdx,
                ci,
                0,
                0,
                Math.min(len0, 80),
              );
            } catch {
              /* ignore */
            }
            try {
              charShape = JSON.parse(
                doc.getCellCharPropertiesAt(sec, p, ctrlIdx, ci, 0, 0),
              ) as Record<string, unknown>;
            } catch {
              /* ignore */
            }
          }
          cellMeta.set(ci, {
            row: cellRow,
            col: cellCol,
            empty: cellParaCount === 1 && len0 === 0,
            text,
            charShape,
          });
        }

        const rcToIdx = new Map<string, number>();
        for (const [ci, m] of cellMeta) {
          rcToIdx.set(`${m.row},${m.col}`, ci);
        }
        const findLabel = (
          row: number,
          col: number,
        ): { text: string; charShape?: Record<string, unknown> } | null => {
          const idx = rcToIdx.get(`${row},${col}`);
          if (idx === undefined) return null;
          const m = cellMeta.get(idx);
          if (!m || m.empty || m.text.trim().length === 0) return null;
          return { text: m.text.trim(), charShape: m.charShape };
        };

        for (const [ci, m] of cellMeta) {
          if (cellFields.length >= max) {
            truncated = true;
            break outer;
          }
          if (!m.empty) continue;
          const left = findLabel(m.row, m.col - 1);
          const top = !left ? findLabel(m.row - 1, m.col) : null;
          const label = left ?? top;
          cellFields.push({
            location: {
              sectionIndex: sec,
              paragraphIndex: p,
              controlIndex: ctrlIdx,
              cellIndex: ci,
              cellParagraphIndex: 0,
            },
            labelHint: label?.text ?? '',
            labelCharShape: label?.charShape,
          });
        }
      }
    }
  }

  return { cellFields, truncated };
}
