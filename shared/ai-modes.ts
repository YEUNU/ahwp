/**
 * Task-Mode Architecture — 0.7.0.
 *
 * AI 의 task surface 를 mode 별로 분할. 각 mode 가 다른 tool subset +
 * 다른 system prompt fragment + 다른 contract 를 가진다.
 *
 * 배경:
 * - 0.6.x 까지는 55 tools 가 모든 turn 에 노출됨 + system prompt 의
 *   거대한 if-else 가 task 별 가이드. AI 가 압박 상황에서 easy path 로
 *   drift → 본문 dump / patches 회귀 반복.
 * - 근본 원인: generic tool surface ↔ task-specific contract mismatch.
 * - 해결: mode 진입 시 그 mode 의 tool 만 catalog 에 노출 + 짧고 명료한
 *   mode prompt. AI 가 다른 tool 을 emit 할 방법 자체가 없게.
 *
 * 0.7.0 (이 chunk) 는 infra 만. 모든 doc 의 기본 mode 는
 * `free-authoring` 이며 모든 tool 노출 → 동작은 0.6.20 과 동일. 0.7.1
 * 부터 mode 별 제약을 단계적으로 활성화.
 */

import type { AhwpToolName } from './ai-tools';

/**
 * 사용자 task 의 6 가지 type. mode 별로 tool catalog 와 prompt 가 다름.
 *
 * 추가 시: MODE_REGISTRY 에 ModeDefinition 등록 + ModeDetector 휴리스틱
 * 갱신. 신규 tool 추가 시: tool 의 `modes` 메타에 해당 mode 포함시키면
 * 자동으로 catalog 에 들어감 (0.7.3 의 defineTool refactor 에서 정착).
 */
export type TaskMode =
  | 'free-authoring'
  | 'form-fill'
  | 'body-edit'
  | 'table-manipulation'
  | 'formatting'
  | 'cross-doc-research';

/**
 * 한 turn 의 mode 컨텍스트. primary 가 catalog/prompt 의 base 를 정하고,
 * addons 는 read-only 부분만 합쳐서 cross-mode 보조 허용 (e.g. FormFill
 * 중 다른 파일 참고가 필요할 때 CrossDocResearch 의 read tool 만 추가).
 *
 * source:
 * - 'detected' — ModeDetector 가 휴리스틱으로 자동 결정
 * - 'user-override' — 사용자가 UI 토글로 명시 변경. detection 무시
 * - 'default' — 정보 부족으로 default (free-authoring) 사용
 */
export interface ModeContext {
  primary: TaskMode;
  addons: TaskMode[];
  source: 'detected' | 'user-override' | 'default';
  /** detection / override 가 발생한 이유 한 줄. 디버깅 / UI 툴팁 용. */
  reason?: string;
}

/**
 * 한 mode 의 정의.
 *
 * `tools`: 'all' 이면 모든 AHWP tool 노출 (FreeAuthoring 기본). 배열이면
 * 그 이름들만 노출. 0.7.0 에서는 FreeAuthoring 만 'all' 이고 나머지는
 * 향후 chunk 에서 실제 subset 으로 좁혀짐 (현재 placeholder = 'all').
 *
 * `promptFragment`: mode 진입 시 base system prompt 뒤에 append 되는
 * 짧은 가이드 (한 단락). 거대한 if-else 없이 mode 마다 자기 contract 만.
 *
 * `requiresProviderCapability`: 이 mode 가 의존하는 provider 능력
 * (예: 'vision'). 0.7.4 의 capability matrix 에서 사용 — provider 가
 * 부족하면 UI 경고. 0.7.0 은 정보만 기록.
 */
export interface ModeDefinition {
  mode: TaskMode;
  label: string;
  shortLabel: string;
  description: string;
  tools: 'all' | readonly AhwpToolName[];
  promptFragment: string;
  requiresProviderCapability?: readonly ('vision' | 'tool-use')[];
}

const FREE_AUTHORING: ModeDefinition = {
  mode: 'free-authoring',
  label: '자유 편집 모드',
  shortLabel: '편집',
  description:
    'Empty 또는 free-form 문서에 새 콘텐츠 작성 / 본문 편집. 모든 tool 노출.',
  tools: 'all',
  promptFragment: '',
};

const FORM_FILL: ModeDefinition = {
  mode: 'form-fill',
  label: '양식 채우기 모드',
  shortLabel: '양식',
  description:
    '양식 / 보고서 / 신청서 / 점검표 문서. 정의된 셀 슬롯만 채움. 본문 작성 / 표 구조 변경 금지.',
  // 0.7.1 — 실제 subset. body write (insertText / applyHtml / patches) 가
  // catalog 에서 빠짐 → AI 가 emit 할 방법 자체가 없음. cell-level + read
  // 도구만 노출.
  tools: [
    // Cell write
    'insertTextInCell',
    'replaceTextInCell',
    // Cell / form read
    'getEmptyFormFields',
    'getCellInfo',
    // 시각 검증
    'getPageSvg',
    // 일반 read (위치 결정 / 컨텍스트)
    'getDocumentOutline',
    'getDocumentSummary',
    'getCaretPosition',
    'getCharPropertiesAt',
    'getParaPropertiesAt',
    'getStyleAt',
    'getStyleListJson',
    'getTextRange',
    'findInDocument',
    // 셀 서식 (작성한 값의 typography 일관성)
    'applyCharFormat',
    'applyCellStyle',
    // Cross-doc (참조 자료)
    'searchWorkspaceOutlines',
    'readParagraphByPath',
    'switchTargetDoc',
  ],
  promptFragment: `You are in **Form Fill Mode**. The document is a template (양식 / 보고서 / 신청서 / 점검표) with predefined cell slots. Your job is to fill those slots — NOT to author body text.

**Hard rules enforced server-side:**
- Body write tools (insertText, applyHtml, ahwp-patches blocks) are NOT in your catalog. If you try to emit a patches block, it will be ignored.
- You CAN ONLY mutate the document through cell-level tools: \`insertTextInCell\` (empty cells), \`replaceTextInCell\` (filled cells / placeholders).
- Coordinates MUST come from \`getEmptyFormFields\` — never invent paragraphIdx / cellIdx.

**slotKind decides which tool to use (0.7.2):**

Every cell returned by \`getEmptyFormFields\` carries a \`slotKind\`:
- \`'value-slot'\` — empty cell. Call \`insertTextInCell\` with your value.
- \`'instruction'\` — a template placeholder still living in the cell (italic + non-black color, e.g. "예) 회사명을 입력하세요" / "1.3 주요 공정별 ... 내용을 요약하여 기술"). Call \`replaceTextInCell\` to swap it for the real value. **Never** \`insertTextInCell\` here — that would prepend your value, leaving the placeholder text behind and breaking the cell's layout. This was the root cause of the 0.7.1 regression where cell #4 kept its italic blue example text.
- \`'sub-header'\` — a short bold in-cell label (e.g. "구분", "1)", section marker inside a cell). DO NOT touch unless the user explicitly asks to relabel.
- \`'content'\` — a real filled cell. Leave alone unless the user explicitly asks to change that exact value.

When a turn fills cells, pair the right tool to the right \`slotKind\`. If you used \`insertTextInCell\` on an \`'instruction'\` slot, fix it with \`replaceTextInCell\` in the next turn.

**Workflow:**
1. First turn: call \`getEmptyFormFields()\` (unscoped) to get the full tableInventory + initial cellFields. The inventory is your map of every table; \`emptyCells\` tells you the workload per table.
2. For tables you'll fill, scope-call \`getEmptyFormFields({parentParaIdx: <paragraphIndex from inventory>, includeFilled: true})\`. \`includeFilled: true\` is REQUIRED to see \`'instruction'\` and \`'sub-header'\` slots — without it you only see \`'value-slot'\` and miss every placeholder.
3. Emit cell writes in parallel (up to 5 per turn). Pick the tool by slotKind.
4. Iterate until no \`'value-slot'\` / \`'instruction'\` cells remain in scope.
5. Before announcing completion: call \`getPageSvg({pageIdx})\` on key pages. A vision-capable provider will see the image and confirm placement / no placeholder remnants / consistency. The runtime ENFORCES this — if you try to send a final text-only summary without a getPageSvg call, you'll be auto-nudged back into the loop.
6. If verification flags issues, fix with \`replaceTextInCell\` and re-verify.

If the user's intent clearly does not fit any slot, say so briefly and stop — do NOT invent body paragraphs.`,
  requiresProviderCapability: ['vision', 'tool-use'],
};

const BODY_EDIT: ModeDefinition = {
  mode: 'body-edit',
  label: '본문 수정 모드',
  shortLabel: '본문',
  description:
    '기존 문서의 본문 단락 / 섹션 수정 / 재작성. anchor 필수. 표 / 양식 셀 수정 금지.',
  tools: 'all',
  promptFragment: '',
};

const TABLE_MANIPULATION: ModeDefinition = {
  mode: 'table-manipulation',
  label: '표 조작 모드',
  shortLabel: '표',
  description:
    '표 구조 (행 / 열 / 병합) 변경. 셀 내용은 형식 도구로만, 본문 변경 X.',
  tools: 'all',
  promptFragment: '',
};

const FORMATTING: ModeDefinition = {
  mode: 'formatting',
  label: '서식 모드',
  shortLabel: '서식',
  description:
    '글자 / 문단 서식 적용 (굵게 / 정렬 / 색 / 스타일). 콘텐츠 변경 X.',
  tools: 'all',
  promptFragment: '',
};

const CROSS_DOC_RESEARCH: ModeDefinition = {
  mode: 'cross-doc-research',
  label: '문서 참조 모드',
  shortLabel: '참조',
  description:
    '워크스페이스 내 다른 문서 + 외부 웹 정보 검색 / 인용. read-only. 활성 문서 write 는 다른 mode 진입 필요.',
  // 0.7.7 — 실제 subset. read-only tool 만 노출 + cross-doc + web access.
  // mode 전환 (form-fill / body-edit 등) 없이는 IR mutation 불가.
  tools: [
    // Workspace 검색 / 읽기
    'searchWorkspaceOutlines',
    'readParagraphByPath',
    // 활성 문서 read
    'getDocumentOutline',
    'getDocumentSummary',
    'getCaretPosition',
    'getStyleListJson',
    'getStyleAt',
    'getCharPropertiesAt',
    'getParaPropertiesAt',
    'getTextRange',
    'findInDocument',
    'getCellInfo',
    'getEmptyFormFields',
    'getPageSvg',
    'getColumnDef',
    'getFootnoteAtCursor',
    // 0.7.7 — 외부 웹 정보
    'webFetch',
    'webSearch',
    // 다른 doc 으로 라우팅 (write 는 mode 전환 후)
    'switchTargetDoc',
  ],
  promptFragment: `You are in **Cross-Doc Research Mode**. Read-only investigation across workspace files and the open web. IR mutation tools are NOT in your catalog — to actually edit the active document, the user needs to switch out of this mode (or you can suggest doing so).

**Use cases:**
- Gather facts from referenced workspace docs (\`searchWorkspaceOutlines\` to inventory, \`readParagraphByPath\` to fetch specific bodies).
- Look up external info via \`webSearch\` (find candidate URLs) → \`webFetch\` (read the page body).
- Synthesize findings into a written response — cite URLs and workspace file paths so the user can verify.

**External web tools (0.7.7):**
- \`webSearch({query, maxResults})\` returns ranked results (title, url, snippet). Use to discover candidate pages.
- \`webFetch({url, prompt?, maxBytes?})\` retrieves a page as plain text. http / https only. 30s timeout, 32KB default cap. Pair with webSearch for typical "find + read" workflows.
- Do NOT fetch the same URL repeatedly. If a page is paginated, fetch each page once.
- Do NOT make up URLs — only use ones returned by webSearch or explicitly provided by the user.

Your final response should cite sources (URLs / file paths) so the user can verify. If the workspace + web evidence is insufficient, say so briefly rather than fabricate.`,
};

/**
 * Mode 정의 레지스트리. 순서 = UI 노출 우선순위 (FreeAuthoring 이 default
 * 라 첫번째).
 */
export const MODE_REGISTRY: Record<TaskMode, ModeDefinition> = {
  'free-authoring': FREE_AUTHORING,
  'form-fill': FORM_FILL,
  'body-edit': BODY_EDIT,
  'table-manipulation': TABLE_MANIPULATION,
  formatting: FORMATTING,
  'cross-doc-research': CROSS_DOC_RESEARCH,
};

export const TASK_MODES: readonly TaskMode[] = [
  'free-authoring',
  'form-fill',
  'body-edit',
  'table-manipulation',
  'formatting',
  'cross-doc-research',
];

/**
 * 기본 mode 컨텍스트 — doc 정보가 없거나 detection 이 적용 안 될 때.
 * 0.7.0 에서는 거의 모든 turn 이 이걸 사용 (실제 detection 은 0.7.1 부터).
 */
export const DEFAULT_MODE_CONTEXT: ModeContext = {
  primary: 'free-authoring',
  addons: [],
  source: 'default',
};

export function getModeDefinition(mode: TaskMode): ModeDefinition {
  return MODE_REGISTRY[mode];
}

/**
 * primary + addons 의 합쳐진 tool 화이트리스트. addons 중 read-only tool
 * 만 추가하는 정책은 0.7.4 의 capability matrix 와 함께 정착 — 0.7.0 은
 * 모든 mode 가 'all' 이라 실제 효과 X (FreeAuthoring 동작 보존).
 */
export function resolveAllowedTools(
  ctx: ModeContext,
  allToolNames: readonly AhwpToolName[],
): readonly AhwpToolName[] {
  const primary = MODE_REGISTRY[ctx.primary];
  if (primary.tools === 'all') return allToolNames;
  const allowed = new Set<AhwpToolName>(primary.tools);
  for (const add of ctx.addons) {
    const def = MODE_REGISTRY[add];
    if (def.tools === 'all') {
      for (const t of allToolNames) allowed.add(t);
    } else {
      for (const t of def.tools) allowed.add(t);
    }
  }
  return allToolNames.filter((t) => allowed.has(t));
}
