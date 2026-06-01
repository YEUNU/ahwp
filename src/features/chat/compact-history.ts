/**
 * Agent-loop history compaction — 0.7.27.
 *
 * The agent loop re-sends the ENTIRE message history to the provider every
 * turn (useChatStreaming builds `messages` from the full `history` each
 * fireChat). There is no compaction, so long form-fill turns grow the request
 * unbounded — and the 0.7.25 visual self-verification makes the model call
 * getPageSvg repeatedly, each result carrying a base64 PNG (tens–hundreds of
 * KB). Without pruning, turn N re-encodes and re-sends ALL N page images, so
 * cost/latency balloon quadratically over a verify-heavy turn.
 *
 * This module holds the pure transform (no React / no IO) applied to the
 * request messages right before send, so it stays unit-testable.
 *
 * What it does (safe, lossless-for-reasoning):
 * - Keep only the most recent `keepLatestImages` tool-result images. Older
 *   page renders are point-in-time snapshots SUPERSEDED by any newer render —
 *   the model only needs the latest visual state to verify/fix, and can always
 *   re-render an older page. For a stripped message we drop the heavy
 *   `imageBase64` AND replace its content with a compact marker: the only tool
 *   that attaches an image is getPageSvg, whose content is the page's SVG
 *   markup (up to ~16 KB), equally useless once superseded. The marker keeps a
 *   valid content string so the tool_call/tool_result pairing the provider
 *   APIs require stays intact.
 *
 * It deliberately does NOT touch text-only tool results (no image) — dropping
 * those is lossy and risks breaking reasoning. Text-result aging can come
 * later. Mode detection scans the original `history`, not these compacted
 * messages, so replacing getPageSvg content here is safe.
 */
import type { ChatMessage } from '@shared/ai';

/** Default: keep just the latest page image. Each getPageSvg supersedes. */
export const DEFAULT_KEEP_LATEST_IMAGES = 1;

const OMITTED_MARKER =
  '[page render omitted to save context — re-render with getPageSvg if needed]';

/**
 * Strip `imageBase64` from all but the most recent `keepLatestImages`
 * tool-result images. Returns a new array; input is not mutated. Messages
 * without an image attachment pass through untouched (same object reference).
 */
export function compactVisionImages(
  messages: ChatMessage[],
  keepLatestImages: number = DEFAULT_KEEP_LATEST_IMAGES,
): ChatMessage[] {
  const keep = Math.max(0, keepLatestImages);
  // Index every message that actually carries an image.
  const imageIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].toolResult?.imageBase64) imageIdxs.push(i);
  }
  if (imageIdxs.length <= keep) return messages;
  // The last `keep` image-bearing messages are retained; the rest are stripped.
  const stripSet = new Set(imageIdxs.slice(0, imageIdxs.length - keep));
  if (stripSet.size === 0) return messages;
  return messages.map((m, i) => {
    if (!stripSet.has(i) || !m.toolResult) return m;
    // Drop the heavy base64 + media type AND the now-useless SVG content;
    // replace content with a compact marker (a valid string keeps the
    // function_call_output / tool_result pairing the APIs require intact).
    const {
      imageBase64: _omit,
      imageMediaType: _omit2,
      ...restResult
    } = m.toolResult;
    void _omit;
    void _omit2;
    return {
      ...m,
      toolResult: { ...restResult, content: OMITTED_MARKER },
    };
  });
}
