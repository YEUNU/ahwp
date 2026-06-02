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
 * 0.7.33 — text-result aging 추가. 위(이미지)에 더해, 오래된 큰 read 결과
 * (getEmptyFormFields / getDocumentSummary / searchWorkspaceOutlines 등의
 * JSON, 수~수십 KB)도 매 턴 재전송돼 누적된다. 모델은 read → reason → write
 * 를 같은/다음 턴에 하므로, 최근 N개 tool-result 만 full 로 두고 그보다 오래된
 * 대형 결과는 prefix + 마커로 trim. form-fill 좌표는 "가장 최근 getEmptyForm
 * Fields" 가 authoritative (prompt 가 보장) 라 오래된 read 는 superseded.
 * 보수적: 최근 결과·작은 결과·에러는 건드리지 않는다. Mode 감지는 원본
 * history 를 스캔하므로 무영향.
 */
import type { ChatMessage } from '@shared/ai';

/** Default: keep just the latest page image. Each getPageSvg supersedes. */
export const DEFAULT_KEEP_LATEST_IMAGES = 1;
/** 0.7.33 — 최근 이만큼의 tool-result 는 full 보존(recency). */
export const DEFAULT_KEEP_RECENT_RESULTS = 6;
/** 0.7.33 — 이 바이트 초과 + 오래된 read 결과만 trim (작은 결과는 무시). */
export const DEFAULT_RESULT_SIZE_THRESHOLD = 4096;
/** trim 시 남기는 prefix 길이 (모델이 무엇이었는지는 알게). */
const TRIM_PREFIX = 400;

const OMITTED_MARKER =
  '[page render omitted to save context — re-render with getPageSvg if needed]';
const TRIM_MARKER =
  '\n…[older tool result trimmed to save context — re-run the read tool if you need the full data]';

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

/**
 * Trim the content of OLD large tool-result messages. The most recent
 * `keepRecentResults` tool-results stay full (recency); older ones whose
 * content exceeds `sizeThreshold` bytes are replaced with a prefix + marker.
 * Error results and small results are never touched. Already image-stripped
 * results (small marker content) pass through. Returns a new array (or the
 * same reference when nothing changed); input is not mutated.
 */
export function compactOldLargeReads(
  messages: ChatMessage[],
  keepRecentResults: number = DEFAULT_KEEP_RECENT_RESULTS,
  sizeThreshold: number = DEFAULT_RESULT_SIZE_THRESHOLD,
): ChatMessage[] {
  const keep = Math.max(0, keepRecentResults);
  const resultIdxs: number[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool' && messages[i].toolResult) {
      resultIdxs.push(i);
    }
  }
  if (resultIdxs.length <= keep) return messages;
  const oldIdxs = new Set(resultIdxs.slice(0, resultIdxs.length - keep));
  let changed = false;
  const next = messages.map((m, i) => {
    if (!oldIdxs.has(i) || !m.toolResult) return m;
    const tr = m.toolResult;
    // 에러 결과는 짧고 중요(재시도 판단) — 보존. 이미지/마커는 이미 작음.
    if (tr.isError || tr.imageBase64) return m;
    const content = tr.content ?? '';
    if (new TextEncoder().encode(content).length <= sizeThreshold) return m;
    changed = true;
    return {
      ...m,
      toolResult: {
        ...tr,
        content: content.slice(0, TRIM_PREFIX) + TRIM_MARKER,
      },
    };
  });
  return changed ? next : messages;
}

/**
 * 0.7.33 — request 직전 적용하는 통합 압축. 이미지 prune + 오래된 대형 read
 * 결과 trim. 순수 함수.
 */
export function compactAgentHistory(messages: ChatMessage[]): ChatMessage[] {
  return compactOldLargeReads(compactVisionImages(messages));
}
