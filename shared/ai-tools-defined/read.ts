/**
 * Read-only 도구들 — defineTool migration (0.7.4).
 *
 * IR mutation 없는 조회 / 시각 캡처 / 워크스페이스 검색 / 라우팅. 모두
 * `readonly: true` 로 표시되어 사용자 승인 게이트 우회.
 *
 * 도구 (10):
 * - getDocumentOutline / getDocumentSummary
 * - getCaretPosition / getCharPropertiesAt / getParaPropertiesAt
 * - getTextRange / findInDocument
 * - getPageSvg (시각 캡처 SVG)
 * - searchWorkspaceOutlines / readParagraphByPath (cross-doc)
 * - switchTargetDoc (IR mutation 없음 — 라우팅 ref 만 갱신)
 */
import type { AhwpToolArgs } from '../ai-tools';
import { defineTool } from '../ai-tool-def';
import { byteLen, coerceNonNegInt, nonNegInts } from '../ai-tool-validate';

export const getDocumentOutline = defineTool<
  'getDocumentOutline',
  AhwpToolArgs['getDocumentOutline']
>({
  name: 'getDocumentOutline',
  description:
    'Return the document outline (heading paragraphs as paragraphIndex / level / text). Use when deciding where to insert a new paragraph. **An empty outline means the doc has no heading styles (제목 N / 개요 N / Heading N); fall back to `getDocumentSummary` in that case.**',
  inputSchema: { type: 'object', properties: {} },
  readonly: true,
  validate() {
    return { ok: true, args: {} as AhwpToolArgs['getDocumentOutline'] };
  },
});

export const getDocumentSummary = defineTool<
  'getDocumentSummary',
  AhwpToolArgs['getDocumentSummary']
>({
  name: 'getDocumentSummary',
  description:
    'Document structure overview — sectionCount plus, for each section, paragraphCount / non-empty count / first and last filled paragraph samples (text, capped at 200 chars). Use to gauge how filled a heading-less doc is and to decide insertion locations. Read-only, cheap per turn.',
  inputSchema: { type: 'object', properties: {} },
  readonly: true,
  validate() {
    return { ok: true, args: {} as AhwpToolArgs['getDocumentSummary'] };
  },
});

export const getCaretPosition = defineTool<
  'getCaretPosition',
  AhwpToolArgs['getCaretPosition']
>({
  name: 'getCaretPosition',
  description:
    'Return the current caret position (sectionIndex, paragraphIndex, charOffset, optional cell). Use to translate intents like "add here" into a concrete coordinate.',
  inputSchema: { type: 'object', properties: {} },
  readonly: true,
  validate() {
    return { ok: true, args: {} as AhwpToolArgs['getCaretPosition'] };
  },
});

export const getCharPropertiesAt = defineTool<
  'getCharPropertiesAt',
  AhwpToolArgs['getCharPropertiesAt']
>({
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
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx', 'charOffset']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['getCharPropertiesAt'] };
  },
});

export const getParaPropertiesAt = defineTool<
  'getParaPropertiesAt',
  AhwpToolArgs['getParaPropertiesAt']
>({
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
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['getParaPropertiesAt'] };
  },
});

export const getTextRange = defineTool<
  'getTextRange',
  AhwpToolArgs['getTextRange']
>({
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
  readonly: true,
  validate(raw) {
    const v = nonNegInts(raw, [
      'sectionIdx',
      'startParagraphIdx',
      'startOffset',
      'endParagraphIdx',
      'endOffset',
    ]);
    if (!v.ok) return v;
    return { ok: true, args: v.value as AhwpToolArgs['getTextRange'] };
  },
});

export const findInDocument = defineTool<
  'findInDocument',
  AhwpToolArgs['findInDocument']
>({
  name: 'findInDocument',
  description:
    'Return matching coordinates for a query within the body, including inside table cells (each match carries cellContext when found in a cell). Case-sensitive substring. maxResults 1-200 (default 50). Query capped at 1024 bytes.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 1024 },
      maxResults: { type: 'integer', minimum: 1, maximum: 200 },
    },
    required: ['query'],
  },
  readonly: true,
  validate(raw) {
    const query = raw.query;
    if (typeof query !== 'string')
      return { ok: false, reason: 'query-not-string' };
    if (query.length === 0) return { ok: false, reason: 'query-empty' };
    if (byteLen(query) > 1024) return { ok: false, reason: 'query-too-large' };
    const maxResults = raw.maxResults;
    if (
      maxResults !== undefined &&
      (typeof maxResults !== 'number' ||
        !Number.isInteger(maxResults) ||
        maxResults < 1 ||
        maxResults > 200)
    )
      return { ok: false, reason: 'maxResults-out-of-range' };
    return {
      ok: true,
      args: { query, maxResults } as AhwpToolArgs['findInDocument'],
    };
  },
});

export const getPageSvg = defineTool<'getPageSvg', AhwpToolArgs['getPageSvg']>({
  name: 'getPageSvg',
  description:
    'Capture a single page of the active document as an SVG string. Use AFTER a form-fill / write turn to surface a visual snapshot of the result for the user. Vision-capable providers can also see the rasterized PNG (the runtime auto-converts SVG → PNG before sending to the provider). Best uses: (a) user explicitly asked to verify visually, (b) you completed a substantial form-fill turn that warrants confirmation. Do NOT call after every small write (each SVG is tens of KB). pageIdx is 0-based. Form-Fill mode runtime enforces this: announcing completion without ever calling getPageSvg triggers an auto-nudge.',
  inputSchema: {
    type: 'object',
    properties: { pageIdx: { type: 'integer', minimum: 0 } },
    required: ['pageIdx'],
  },
  readonly: true,
  validate(raw) {
    const n = coerceNonNegInt(raw.pageIdx);
    if (n === null) return { ok: false, reason: 'pageIdx-invalid' };
    return { ok: true, args: { pageIdx: n } as AhwpToolArgs['getPageSvg'] };
  },
});

export const searchWorkspaceOutlines = defineTool<
  'searchWorkspaceOutlines',
  AhwpToolArgs['searchWorkspaceOutlines']
>({
  name: 'searchWorkspaceOutlines',
  description:
    'Inventory every readable file in the current folder tree (workspace): filename plus heading outline (paragraphIndex / level / text) for each. Supported formats: .hwp / .hwpx (native, editable) + .pdf / .docx / .xlsx / .xls / .csv / .tsv / .txt / .md / .json / .xml / .html (read-only). For non-HWP files, sectionIndex is always 0 and paragraphIndex addresses chunk-level units (PDF page-or-paragraph / DOCX heading run / spreadsheet sheet / Markdown section). Use when the user refers to a doc that is not attached and only describes it conceptually — identify candidate docs / paragraphs here, then call readParagraphByPath to fetch the bodies. maxDocs 1-200 (default 50). Response scales with folder size — call only when needed.',
  inputSchema: {
    type: 'object',
    properties: { maxDocs: { type: 'integer', minimum: 1, maximum: 200 } },
  },
  readonly: true,
  validate(raw) {
    const r = raw.maxDocs;
    if (r === undefined) {
      return {
        ok: true,
        args: {} as AhwpToolArgs['searchWorkspaceOutlines'],
      };
    }
    const n = coerceNonNegInt(r);
    if (n === null || n < 1 || n > 200)
      return { ok: false, reason: 'maxDocs-out-of-range' };
    return {
      ok: true,
      args: { maxDocs: n } as AhwpToolArgs['searchWorkspaceOutlines'],
    };
  },
});

export const readParagraphByPath = defineTool<
  'readParagraphByPath',
  AhwpToolArgs['readParagraphByPath']
>({
  name: 'readParagraphByPath',
  description:
    'Fetch a specific paragraph body + surrounding context from any readable file in the workspace. Pass path / sectionIdx / paragraphIdx from a searchWorkspaceOutlines response directly. For non-HWP files (.pdf / .docx / .xlsx / .csv / .txt / .md / .json / .xml / .html), sectionIdx MUST be 0 — paragraphIdx addresses chunk units within the extracted text. For .hwp / .hwpx, normal IR (sectionIdx, paragraphIdx) coordinates apply. The active doc IR is never modified (no mutation, no caret movement). contextParagraphs 0-10 (default 2 — fetches 2 chunks on each side). Per-chunk cap 4KB.',
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
  readonly: true,
  validate(raw) {
    const filePath = raw.path;
    if (typeof filePath !== 'string' || filePath.length === 0)
      return { ok: false, reason: 'path-not-string' };
    if (byteLen(filePath) > 4096)
      return { ok: false, reason: 'path-too-large' };
    const v = nonNegInts(raw, ['sectionIdx', 'paragraphIdx']);
    if (!v.ok) return v;
    const rawCtx = raw.contextParagraphs;
    let contextParagraphs: number | undefined;
    if (rawCtx !== undefined) {
      const n = coerceNonNegInt(rawCtx);
      if (n === null || n > 10)
        return { ok: false, reason: 'contextParagraphs-out-of-range' };
      contextParagraphs = n;
    }
    return {
      ok: true,
      args: {
        path: filePath,
        ...v.value,
        ...(contextParagraphs !== undefined ? { contextParagraphs } : {}),
      } as AhwpToolArgs['readParagraphByPath'],
    };
  },
});

export const switchTargetDoc = defineTool<
  'switchTargetDoc',
  AhwpToolArgs['switchTargetDoc']
>({
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
  // IR mutation 없음 — 라우팅 ref 만 갱신. 사용자 승인 게이트 우회 위해
  // readonly 로 표시 (READONLY_TOOL_NAMES set 자동 가입).
  readonly: true,
  validate(raw) {
    const filePath = raw.path;
    if (typeof filePath !== 'string' || filePath.length === 0)
      return { ok: false, reason: 'path-not-string' };
    if (byteLen(filePath) > 4096)
      return { ok: false, reason: 'path-too-large' };
    return {
      ok: true,
      args: { path: filePath } as AhwpToolArgs['switchTargetDoc'],
    };
  },
});
