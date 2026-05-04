/**
 * Excerpt relocation — chunk 20. Pure-ish helper extracted from
 * StudioViewer.tsx as part of Phase R1 (REFACTORING_PLAN.md).
 *
 * `verifyExcerpt` (ViewerHandle) calls this when the original anchor's
 * paragraph text no longer matches the captured excerpt. Returns a fresh
 * (single-paragraph) anchor when the excerpt's text is found verbatim
 * within the first N paragraphs, else null (chip falls to
 * `stale-missing`).
 *
 * No React / lib dependency — caller passes a `DocReadOnly` view of
 * `@rhwp/core`'s HwpDocument. Single-section docs only (matches
 * captureExcerpt). Multi-paragraph excerpts that contain `\n` are not
 * relocated — single-line search covers the common case.
 */

/** Paragraph scan cap — keeps send-time verification cheap on long docs.
 * Past this limit the chip falls to `stale-missing` rather than scanning
 * forever. */
export const RELOCATE_PARA_SCAN_LIMIT = 1000;

export interface DocReadOnly {
  getParagraphCount: (sectionIdx: number) => number;
  getParagraphLength: (sectionIdx: number, paraIdx: number) => number;
  getTextRange: (
    sectionIdx: number,
    paraIdx: number,
    startOffset: number,
    length: number,
  ) => string;
}

export interface ExcerptAnchor {
  sectionIndex: number;
  startParagraphIndex: number;
  startOffset: number;
  endParagraphIndex: number;
  endOffset: number;
}

export function relocateExcerpt(
  doc: DocReadOnly,
  expected: string,
): ExcerptAnchor | null {
  if (expected.length === 0) return null;
  const SECTION_INDEX = 0;
  let paraCount: number;
  try {
    paraCount = doc.getParagraphCount(SECTION_INDEX);
  } catch {
    return null;
  }
  const limit = Math.min(paraCount, RELOCATE_PARA_SCAN_LIMIT);
  for (let p = 0; p < limit; p++) {
    let paraText: string;
    try {
      const len = doc.getParagraphLength(SECTION_INDEX, p);
      if (len < expected.length) continue;
      paraText = doc.getTextRange(SECTION_INDEX, p, 0, len);
    } catch {
      continue;
    }
    const idx = paraText.indexOf(expected);
    if (idx >= 0) {
      return {
        sectionIndex: SECTION_INDEX,
        startParagraphIndex: p,
        startOffset: idx,
        endParagraphIndex: p,
        endOffset: idx + expected.length,
      };
    }
  }
  return null;
}
