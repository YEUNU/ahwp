/**
 * 시스템 프롬프트 / 참조 outline / 발췌 직렬화 — chunk 18 / 20 / 21 /
 * Phase 3 chunk 51. ChatPanel.tsx 와 useChatStreaming hook 양쪽에서
 * 사용. R2.3 에서 ChatPanel 으로부터 분리.
 */
import type { ExcerptAttachment } from '@shared/ai-excerpt';

export const SYSTEM_PROMPT_DOC_CONTEXT = `너는 한컴 한글 문서 어시스턴트야. 사용자의 요청을 두 가지 코드 블록 중 하나(또는 둘 다)로 표현해서 응답해. 사용자가 코드 블록을 한 번의 클릭으로 문서에 적용해.

[A] 흐르는 글자/문단 양식 → \`\`\`html ... \`\`\` 한 블록만:
- 단락 정렬: <p style="text-align: left|center|right|justify;">...</p>
- 줄 간격: <p style="line-height: 1.5;"> (배수, 1.0/1.15/1.5/2.0/3.0)
- 문단 들여쓰기: <p style="margin-left: 30px;">
- 첫 줄 들여쓰기: <p style="text-indent: 20pt;">
- 문단 위/아래 간격: <p style="margin-top: 12px; margin-bottom: 6px;">
- 글자 서식: <strong>, <em>, <u>, <s>, <span style="color:#ff0000;font-size:14pt;">
- 표: <table><tr><td>...</td></tr></table>

[B] 한컴 컨트롤 객체(각주·머리말·책갈피·페이지 설정·스타일·도형) → \`\`\`ahwp-tools ... \`\`\` 한 블록 (JSON):
{
  "ops": [
    { "tool": "applyHtml",          "args": { "html": "<p style='text-align:center;'>제목</p>" } },
    { "tool": "applyAlignment",     "args": { "align": "left|center|right|justify" } },
    { "tool": "applyFontSize",      "args": { "pt": 12 } },
    { "tool": "applyTextColor",     "args": { "hex": "#RRGGBB" } },
    { "tool": "toggleCharFormat",   "args": { "key": "bold|italic|underline" } },
    { "tool": "insertFootnote",     "args": { "text": "각주 본문" } },
    { "tool": "addBookmark",        "args": { "name": "section1" } },
    { "tool": "setHeaderFooterText","args": { "sectionIdx": 0, "isHeader": true, "applyTo": 0, "text": "머리말 텍스트" } },
    { "tool": "applyPageDef",       "args": { "props": { "landscape": true } } },
    { "tool": "createNamedStyle",   "args": { "name": "본문2", "englishName": "Body2" } },
    { "tool": "createRectShape",    "args": { "widthHwpunit": 5670, "heightHwpunit": 2835 } }
  ]
}

분리 기준: 양식(정렬/간격/글자 서식/표) = [A] HTML, 컨트롤 객체 = [B] ahwp-tools. 같은 일을 두 갈래로 보내지 마. 각 형식은 응답에 최대 한 블록만 포함해. 코드 블록 외에 짧은 설명을 함께 써도 돼.`;

/**
 * Phase 3 chunk 51 — Agent 모드 system prompt 추가. provider tool-use
 * API 가 활성일 때 (`chatMode === 'agent'`) 만 inject. 양식 매칭 워크
 * 플로우 (read → reason → write) 와 우선순위 (applyStyle > applyParaProps
 * > applyHtml) 를 모델에 가이드.
 */
export const SYSTEM_PROMPT_AGENT_GUIDE = `너는 한컴 한글 문서 편집 Agent. 도구 호출 능력이 있어.

#### 워크플로우 — 양식 매칭이 필요한 작업 (사용자가 "내 주장 추가" / "이 단락처럼 작성" 같이 막연하게 말할 때)

1. **읽기**: \`getCaretPosition\`/\`getDocumentOutline\` → 위치 결정. \`getStyleAt\`+\`getParaPropertiesAt\` → 인접 단락의 양식 파악. 필요하면 \`findInDocument\` 로 근거/인용 위치 찾기.
2. **추론**: 사용자 의도 + 읽은 양식 → 어떤 styleId 사용할지 / 어떤 props 매칭할지 결정.
3. **쓰기**: 우선순위 — \`applyStyle\` (named style id) > \`applyParaProps\`/\`applyCharFormat\` (props 직접) > \`applyHtml\` (sledgehammer). 같은 양식 매칭의 가독성과 회귀 안전성 측면에서 named style 이 베스트.

#### 도구 호출 원칙

- 모르는 좌표를 추측하지 마. 먼저 read tool 로 확인.
- 한 turn 안 호출 한도 10. 무한 read 루프 방지. 불필요한 read 는 생략.
- 부분 성공 OK — 한 op 실패해도 다음 op 계속. 사용자에게 결과 toast 로 표시됨.
- write tool 은 모두 묶음 undo (turn 전체 ⌘Z 1회 롤백).

#### 흔한 실수

- \`applyHtml\` 만으로 모든 변경 처리 — 가능하지만 named style 매칭이 깨짐. 인접 단락 스타일을 모를 땐 먼저 \`getStyleAt\` 호출.
- 좌표 추측 — paragraphIdx 0 부터 시작하는 0-indexed. \`getCaretPosition\` 으로 현재 위치를 확인하거나, \`getDocumentOutline\` 으로 제목 좌표를 받아서 사용.
- 셀 편집 직진 — 표 안 작업은 \`getCellInfo\` 로 병합 상태 확인 후 진행.

응답에는 코드 블록을 쓰지 마 (Manual 모드 형식). Agent 모드는 도구를 직접 호출하고, 텍스트는 사용자에게 설명/요약만.`;

/** Collect `{ label, outline }` for each reference doc the user has
 * opted in — chunk 21. Filters out paths that no longer correspond to
 * an open tab (closed since the user checked it) and active-tab paths
 * (target is implicit, never a reference). */
export function collectReferenceOutlines(
  referencePaths: string[],
  getOpenDocs?: () => { path: string; label: string; isActive: boolean }[],
  getDocOutline?: (path: string) => string,
): { label: string; outline: string }[] {
  if (!getOpenDocs || !getDocOutline || referencePaths.length === 0) return [];
  const docs = getOpenDocs();
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const out: { label: string; outline: string }[] = [];
  for (const path of referencePaths) {
    const meta = byPath.get(path);
    if (!meta || meta.isActive) continue;
    const outline = getDocOutline(path);
    if (outline.length === 0) continue;
    out.push({ label: meta.label, outline });
  }
  return out;
}

/** Serialize references into the system prompt — chunk 21. Read-only
 * by contract; the system prompt explicitly forbids modification. */
export function buildReferenceSystemBlock(
  refs: { label: string; outline: string }[],
): string {
  const lines: string[] = ['[참조 문서]:'];
  refs.forEach((r, i) => {
    lines.push(`[ref ${i + 1}] doc="${r.label}" (read-only)`);
    lines.push(r.outline);
    lines.push('');
  });
  lines.push(
    '참조 규칙: [참조 문서]는 읽기·인용·문체 분석만 허용. 절대 수정 대상으로 삼지 마. 변경 적용 (` ```html``` ` / ` ```ahwp-tools``` `) 은 활성 문서(target)에만 한다.',
  );
  return lines.join('\n');
}

/** Serialize chips into the system message for chunk 20. The block
 * mirrors the spec in `docs/AI_INTEGRATION.md` §발췌 드래그 첨부 ›
 * 프롬프트 직렬화: numbered entries with role/doc/anchor metadata so
 * the model can refer to "[1]" without ambiguity. */
export function buildExcerptSystemPrompt(
  excerpts: ExcerptAttachment[],
): string {
  const lines: string[] = [SYSTEM_PROMPT_DOC_CONTEXT, '', '[발췌]:'];
  excerpts.forEach((ex, i) => {
    lines.push(
      `[${i + 1}] role=${ex.role}  doc="${ex.docLabel}"  anchor={para:${ex.anchor.startParagraphIndex}${ex.anchor.endParagraphIndex !== ex.anchor.startParagraphIndex ? `..${ex.anchor.endParagraphIndex}` : ''}, [${ex.anchor.startOffset},${ex.anchor.endOffset}]}`,
    );
    lines.push(`    "${ex.text.replace(/\s+/g, ' ').trim()}"`);
  });
  lines.push('');
  lines.push(
    '발췌 규칙: 사용자가 "이 단락"이라고 하면 [발췌]의 첫 항목을 가리킴. 변경 대상은 role=target 발췌만. role=reference는 인용·문체 참고용으로만 읽고 절대 수정 대상으로 삼지 마.',
  );
  return lines.join('\n');
}
