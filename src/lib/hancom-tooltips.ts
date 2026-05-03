/**
 * 한컴오피스 공식 명칭 / 설명 매핑 — chunk 90.
 *
 * 사용자가 버튼 호버 시 한컴 한글 매뉴얼의 공식 명칭 + 한 줄 설명을
 * 보도록 wallthe `title` 속성으로 사용. 이름은 한글 워드프로세서의
 * 익숙한 명칭이라 한국 사용자가 쉽게 인지.
 *
 * 키 = 우리 코드의 testid 또는 의미적 ID. 값 = `${name}\n${description}`
 * — `\n` 으로 줄 바꿈, native title 툴팁이 멀티라인 렌더링.
 *
 * 출처: 한글 2024 매뉴얼 + 일반 한컴 reflex 명칭. 단축키는 우리 앱 키
 * 매핑 (CmdOrCtrl 표기는 macOS 이미지로 통일).
 */
export interface HancomTooltipEntry {
  /** 공식 명칭 (한글 매뉴얼 기준). */
  name: string;
  /** 한 줄 설명. */
  description: string;
  /** 단축키 표기 (선택). */
  shortcut?: string;
}

export const HANCOM_TOOLTIPS = {
  // 글자 서식
  'studio-format-bold': {
    name: '진하게',
    description: '선택한 글자를 굵게 표시합니다.',
    shortcut: '⌘B',
  },
  'studio-format-italic': {
    name: '기울임',
    description: '선택한 글자를 기울여 표시합니다.',
    shortcut: '⌘I',
  },
  'studio-format-underline': {
    name: '밑줄',
    description: '선택한 글자 아래에 밑줄을 그립니다.',
    shortcut: '⌘U',
  },

  // 단락 정렬
  'studio-align-left': {
    name: '왼쪽 정렬',
    description: '단락을 왼쪽 끝에 맞춰 정렬합니다.',
  },
  'studio-align-center': {
    name: '가운데 정렬',
    description: '단락을 가운데 정렬합니다.',
  },
  'studio-align-right': {
    name: '오른쪽 정렬',
    description: '단락을 오른쪽 끝에 맞춰 정렬합니다.',
  },
  'studio-align-justify': {
    name: '양쪽 혼합 정렬',
    description:
      '단락의 좌우 끝을 모두 맞추되 마지막 줄은 왼쪽에 맞춰 정렬합니다.',
  },

  // 글머리
  'studio-toggle-bullet': {
    name: '글머리 기호',
    description: '선택한 단락에 글머리 기호를 추가합니다.',
  },
  'studio-toggle-number': {
    name: '글머리 번호',
    description: '선택한 단락에 번호 매기기를 합니다.',
  },

  // 들여쓰기
  'studio-indent-increase': {
    name: '들여쓰기',
    description: '단락의 왼쪽 여백을 한 단계 늘립니다.',
  },
  'studio-indent-decrease': {
    name: '내어쓰기',
    description: '단락의 왼쪽 여백을 한 단계 줄입니다.',
  },

  // 표 / 그림 / 도형
  'studio-insert-table': {
    name: '표 넣기',
    description: '지정한 행과 열로 새로운 표를 만듭니다.',
  },
  'studio-insert-image': {
    name: '그림 넣기',
    description: '선택한 그림 파일을 본문에 삽입합니다.',
  },
  'studio-insert-shape': {
    name: '도형 넣기',
    description: '사각형 / 직선 / 곡선 등의 도형을 삽입합니다.',
  },
  'studio-insert-page-break': {
    name: '쪽 나누기',
    description: '현재 커서 위치에서 새로운 쪽을 시작합니다.',
  },

  // 편집
  'studio-undo': {
    name: '되돌리기',
    description: '직전 작업을 취소합니다.',
    shortcut: '⌘Z',
  },
  'studio-redo': {
    name: '다시 실행',
    description: '되돌렸던 작업을 다시 실행합니다.',
    shortcut: '⌘⇧Z',
  },
  'studio-find': {
    name: '찾기',
    description: '본문에서 단어 또는 문구를 찾습니다.',
    shortcut: '⌘F',
  },
  'studio-replace': {
    name: '찾아 바꾸기',
    description: '본문에서 찾은 단어를 다른 단어로 바꿉니다.',
    shortcut: '⌘H',
  },

  // 쪽 / 머리말 / 책갈피 / 각주
  'studio-page-setup': {
    name: '쪽 모양',
    description: '쪽의 크기·방향·여백을 설정합니다.',
  },
  'studio-header-footer': {
    name: '머리말 / 꼬리말',
    description: '쪽마다 반복되는 머리말 또는 꼬리말을 설정합니다.',
  },
  'studio-footnote': {
    name: '각주',
    description: '본문에 각주를 삽입합니다.',
  },
  'studio-bookmark': {
    name: '책갈피',
    description: '본문의 특정 위치를 표시하여 빠르게 이동할 수 있게 합니다.',
  },
  'studio-style-manager': {
    name: '스타일 관리',
    description: '단락 스타일 목록을 편집합니다.',
    shortcut: 'F6',
  },

  // 보기
  'studio-zoom-in': {
    name: '확대',
    description: '본문을 확대해서 표시합니다.',
  },
  'studio-zoom-out': {
    name: '축소',
    description: '본문을 축소해서 표시합니다.',
  },
  'studio-zoom-fit': {
    name: '쪽 맞춤',
    description: '본문 너비에 맞춰 자동으로 확대·축소합니다.',
  },

  // 채팅 / AI
  'chat-mode-manual': {
    name: 'Manual 모드',
    description:
      'AI 가 변경 제안을 코드 블록으로 출력하면 사용자가 적용 버튼을 눌러 반영합니다.',
  },
  'chat-mode-agent': {
    name: 'Agent 모드',
    description:
      'AI 가 도구를 직접 호출해 본문을 자동 수정합니다. ⌘Z 한 번으로 한 turn 전체 롤백 가능.',
  },
  'chat-history-toggle': {
    name: '대화 목록',
    description: '현재 문서의 이전 대화를 불러올 수 있습니다.',
  },
  'chat-history-new': {
    name: '새 대화',
    description: '새 대화를 시작합니다. 기존 대화는 보존됩니다.',
  },
  'chat-attach-checkbox': {
    name: '현재 문서 첨부',
    description:
      '현재 문서 본문 전체 HTML 을 시스템 프롬프트에 첨부합니다. 긴 문서는 토큰 사용량에 주의하세요.',
  },
  'chat-capture-excerpt': {
    name: '발췌 첨부',
    description:
      '에디터에서 선택한 텍스트를 칩으로 첨부합니다. 선택 영역을 입력란으로 드래그해도 동일.',
  },
} as const satisfies Record<string, HancomTooltipEntry>;

export type HancomTooltipKey = keyof typeof HANCOM_TOOLTIPS;

// chunk 90 — platform-aware shortcut 표기.
// macOS: `⌘`, `⌥`, `⇧`, `⌃` 심볼.
// Win/Linux: `Ctrl+`, `Alt+`, `Shift+` 텍스트.
// renderer 에선 process 가 undefined 이라 `navigator.platform` / userAgent
// 로 detect.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || '');

function localizeShortcut(s: string): string {
  if (isMac) return s;
  return s
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⌃/g, 'Ctrl+')
    .replace(/⌥/g, 'Alt+')
    .replace(/⇧/g, 'Shift+')
    .replace(/\+\+/g, '+'); // remove double + from concatenations
}

/** Compose a multi-line `title` string from a HANCOM_TOOLTIPS entry. */
export function hancomTitle(key: HancomTooltipKey): string {
  const t = HANCOM_TOOLTIPS[key] as HancomTooltipEntry;
  const head = t.shortcut
    ? `${t.name} (${localizeShortcut(t.shortcut)})`
    : t.name;
  return `${head}\n${t.description}`;
}

/** Localize a raw shortcut string like `⌘⇧S` for Win/Linux display. */
export function localizeShortcutPublic(s: string): string {
  return localizeShortcut(s);
}
