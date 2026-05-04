/**
 * 휴리스틱 tool 라우터 — chunk 98. 사용자 query 의 키워드를 기준으로
 * `AHWP_TOOL_NAMES` 의 부분집합만 선택해 LLM 에게 노출. 60+ tool 카탈로그
 * 가 매 turn 에 다 들어가면 (a) request body 가 커져서 NIM hosted 일부
 * 모델이 stall, (b) 모델이 어떤 tool 호출할지 결정에 정신 분산되는
 * 문제 완화.
 *
 * 디자인 원칙:
 * - **결정론**: LLM 이 라우팅 안 함. 키워드 매칭만. 사용자 모델 그대로.
 * - **Fail-safe**: 어떤 키워드도 매칭 안 되면 full catalog (사용자 의도가
 *   모호하면 모델이 자유롭게 선택해야 함).
 * - **Read tool 베이스라인**: 읽기 도구 일부는 거의 모든 turn 에서 유용
 *   (caret 위치 / outline) → 항상 포함.
 * - **Multi-turn 일관**: 같은 turn 안에서 tool catalog 를 변경하면 모델
 *   confusion. user 의 latest 메시지 한 번만 보고 결정해서 이어지는 turn
 *   에서도 동일 subset 유지.
 */
import type { ChatMessage } from '@shared/ai';
import { AHWP_TOOL_NAMES, type AhwpToolName } from '@shared/ai-tools';

/** 매 turn 항상 포함되는 도구 — 위치 결정 / 문서 구조 파악은 어떤
 *  편집 작업에서도 흔히 필요. */
const ALWAYS_INCLUDE: readonly AhwpToolName[] = [
  'getCaretPosition',
  'getDocumentOutline',
];

interface KeywordGroup {
  /** lower-cased substrings; 한 개라도 매칭되면 그룹 활성. */
  keywords: readonly string[];
  tools: readonly AhwpToolName[];
}

const GROUPS: readonly KeywordGroup[] = [
  // 워크스페이스 검색 — 사용자가 다른 문서를 명시 안 하고 가리킬 때.
  {
    keywords: [
      '워크스페이스',
      '폴더',
      '다른 문서',
      '양식',
      '참고',
      '참조',
      '사업계획서',
      '보고서',
      '공고',
      '계획서',
      '기존 자료',
      '예시',
      '샘플',
    ],
    tools: ['searchWorkspaceOutlines', 'readParagraphByPath'],
  },
  // 단순 정렬.
  {
    keywords: ['정렬', '가운데', '왼쪽 끝', '오른쪽 끝', '양쪽'],
    tools: ['applyAlignment', 'applyParaProps'],
  },
  // 글자 서식.
  {
    keywords: [
      '굵게',
      '진하게',
      '기울임',
      '이탤릭',
      '밑줄',
      '취소선',
      '글꼴',
      '폰트',
      '글자 크기',
      '글자색',
      '글자 색',
      '색상',
      '하이라이트',
    ],
    tools: [
      'toggleCharFormat',
      'applyCharFormat',
      'applyFontSize',
      'applyTextColor',
    ],
  },
  // 단락 / 본문 편집.
  {
    keywords: [
      '단락',
      '문단',
      '본문',
      '추가',
      '삽입',
      '넣어',
      '써줘',
      '작성',
      '만들',
      '제목',
      '헤더',
      '섹션',
      '소제목',
      '들여쓰기',
      '내어쓰기',
      '줄 간격',
      '문단 간격',
      '간격',
    ],
    tools: [
      'insertText',
      'insertParagraph',
      'deleteParagraph',
      'mergeParagraph',
      'deleteRange',
      'applyParaProps',
      'applyHtml',
      'applyStyle',
      'getStyleListJson',
      'getStyleAt',
      'getParaPropertiesAt',
      'getCharPropertiesAt',
      'getTextRange',
    ],
  },
  // 표.
  {
    keywords: ['표', '셀', '행', '열', '병합', '나누기', '합쳐', '테이블'],
    tools: [
      'createTable',
      'insertTableRow',
      'insertTableColumn',
      'deleteTableRow',
      'deleteTableColumn',
      'mergeTableCells',
      'splitTableCellInto',
      'unmergeCell',
      'unmergeCell',
      'setTableProperties',
      'setCellProperties',
      'evaluateTableFormula',
      'deleteTableControl',
      'getCellInfo',
      'applyCellStyle',
    ],
  },
  // 그림 / 도형.
  {
    keywords: ['그림', '이미지', '사진', '도형', '사각형', '직사각형', '도식'],
    tools: [
      'insertPicture',
      'setPictureProperties',
      'deletePictureControl',
      'createRectShape',
      'setShapeProperties',
      'deleteShapeControl',
      'changeShapeZOrder',
    ],
  },
  // 머리말 / 꼬리말.
  {
    keywords: ['머리말', '꼬리말', 'header', 'footer'],
    tools: [
      'setHeaderFooterText',
      'applyHfTemplate',
      'createHeaderFooter',
      'deleteHeaderFooter',
    ],
  },
  // 책갈피 / 각주.
  {
    keywords: ['책갈피', '북마크', '각주', '주석'],
    tools: ['addBookmark', 'deleteBookmark', 'insertFootnote'],
  },
  // 쪽 / 페이지.
  {
    keywords: ['쪽', '페이지', '여백', '용지', '가로 모드', '세로 모드'],
    tools: [
      'applyPageDef',
      'insertPageBreak',
      'insertColumnBreak',
      'setColumnDef',
      'setSectionDef',
      'setPageHide',
    ],
  },
  // 검색 / 위치.
  {
    keywords: ['찾', '검색', '어디', '몇 번', '몇번', '위치', '커서', '캐럿'],
    tools: ['findInDocument', 'getCaretPosition', 'getTextRange'],
  },
  // 스타일.
  {
    keywords: ['스타일', '제목 1', '제목 2', '본문 스타일', '명명'],
    tools: ['applyStyle', 'getStyleAt', 'getStyleListJson', 'createNamedStyle'],
  },
];

/** Extract the latest user-authored text from a chat history. Tool
 *  result messages and assistant messages are skipped — only the
 *  human's intent matters for routing. */
function lastUserText(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
}

export interface ToolSelectionResult {
  /** Selected tool name set. Always non-empty (falls back to full
   *  catalog when no group matches). */
  tools: AhwpToolName[];
  /** True when the result is the unfiltered full catalog. Useful for
   *  debug / metrics. */
  isFullCatalog: boolean;
  /** Names of keyword groups that fired. Empty array → fallback. */
  matchedGroups: number[];
}

export function selectToolsForQuery(query: string): ToolSelectionResult {
  const lower = query.toLowerCase();
  const out = new Set<AhwpToolName>(ALWAYS_INCLUDE);
  const matched: number[] = [];
  GROUPS.forEach((g, i) => {
    if (g.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      matched.push(i);
      g.tools.forEach((t) => out.add(t));
    }
  });
  if (matched.length === 0) {
    return {
      tools: Array.from(AHWP_TOOL_NAMES) as AhwpToolName[],
      isFullCatalog: true,
      matchedGroups: [],
    };
  }
  return {
    tools: Array.from(out),
    isFullCatalog: false,
    matchedGroups: matched,
  };
}

/** Convenience wrapper for the streaming hook — extracts user query
 *  from history then runs `selectToolsForQuery`. */
export function selectToolsForHistory(
  history: ChatMessage[],
): ToolSelectionResult {
  return selectToolsForQuery(lastUserText(history));
}
