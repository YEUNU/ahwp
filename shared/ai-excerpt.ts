/**
 * Excerpt drag attachments — chunk 20. The user picks a selection in
 * StudioViewer and surfaces it to ChatPanel as a portable, hash-keyed
 * structure. When excerpts are present on a turn, the chat pipeline
 * routes them into a `[발췌]:` system block *instead of* the whole-doc
 * HTML attach (chunk 18) — narrower context, better anchor accuracy,
 * fewer tokens.
 *
 * Drag-and-drop UX (HTML5 dataTransfer mime
 * `application/x-ahwp-excerpt`) is the eventual delivery surface.
 * Chunk 20 ships the data model + a button affordance ("📌 발췌
 * 첨부") that captures the active viewer selection without intrusive
 * changes to the SVG selection model. Drag wiring is a polish
 * follow-up — the wire format here doesn't change.
 *
 * Multi-document is chunk 21: every excerpt here is implicitly
 * `target` since the chat panel only knows about the active tab.
 */

export interface TextRange {
  /** IR section index. Always 0 for current chunks (single-section). */
  sectionIndex: number;
  /** Paragraph index within the section. */
  paragraphIndex: number;
  /** UTF-16 char offset where the excerpt starts. */
  startOffset: number;
  /** UTF-16 char offset where the excerpt ends (exclusive). */
  endOffset: number;
}

export type ExcerptStatus =
  /** Anchor still points at the original text byte-for-byte. */
  | 'fresh'
  /** Original anchor diverged but we found `text` elsewhere in the doc and rebound. */
  | 'stale-relocated'
  /** Original anchor diverged AND we couldn't find `text` anywhere — block send. */
  | 'stale-missing';

export interface ExcerptAttachment {
  /** Stable per-chip id. Used for React keys + remove. */
  id: string;
  /** Source file's absolute path. `null` for unsaved/new docs. */
  docPath: string | null;
  /** Display label — basename of docPath, or '(이름 없음)' for unsaved. */
  docLabel: string;
  /**
   * Tagging chunk 20-only constraint: every excerpt is `target` (the
   * editable doc). Chunk 21 will introduce `reference` (read-only).
   */
  role: 'target' | 'reference';
  /** Where in the doc this came from at capture time. */
  anchor: TextRange;
  /** The selected text, frozen at capture time. */
  text: string;
  /** Cheap deterministic checksum of `text` for stale detection. */
  hash: string;
  /** Latest verification verdict. Updated on send-time re-check. */
  status: ExcerptStatus;
}

/** djb2 hash — fast synchronous, deterministic. We don't need
 * cryptographic strength here; staleness detection just compares a
 * stored hash to a freshly computed one over the IR text at the
 * captured anchor. Same input → same 32-bit output. */
export function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  // Unsigned hex, padded for stable length.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Soft size warning — anything above this triggers a token-cost
 * notice in the UI. Hard cap is enforced separately at send time. */
export const EXCERPT_SOFT_CHAR_LIMIT = 2000;
/** Hard cap — refuse to capture excerpts larger than this. */
export const EXCERPT_HARD_CHAR_LIMIT = 16_000;
