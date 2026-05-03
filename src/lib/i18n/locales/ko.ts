/**
 * Korean — default locale (chunk 89). 모든 사용자 facing UI 텍스트는
 * key-based 로 이 파일에 정의. 새 텍스트는 의미적 namespace 로 그룹.
 *
 * 채택 정책: i18next 의 nested keys 대신 flat dot-notation 사용 (`app.title`)
 * — IDE find/replace 가 평탄하게 동작 + 누락 키 경고 명확.
 */
export const ko = {
  // Common
  'common.cancel': '취소',
  'common.confirm': '확인',
  'common.save': '저장',
  'common.delete': '삭제',
  'common.close': '닫기',
  'common.apply': '적용',

  // Settings
  'settings.title': '설정',
  'settings.tab.general': '일반',
  'settings.tab.ai': 'AI 공급자',
  'settings.tab.shortcuts': '단축키',
  'settings.tab.about': '정보',

  // Welcome
  'welcome.title': '안녕하세요.',
  'welcome.subtitle':
    '새 문서로 시작하거나, 기존 한글 문서를 열어 AI와 함께 작업해 보세요. .hwp 와 .hwpx 모두 지원합니다.',
  'welcome.cta.new': '빈 문서로 시작',
  'welcome.cta.new.subtitle':
    '0부터 작성하거나 AI에게 양식을 맡기세요. 빈 문서에서도 채팅이 바로 작동합니다.',
  'welcome.cta.open': '파일 열기',
  'welcome.cta.open.subtitle':
    '.hwp 또는 .hwpx 파일을 선택하거나, 이 영역에 끌어다 놓으세요.',

  // TitleBar
  'titlebar.theme.dark': '다크 모드',
  'titlebar.theme.light': '라이트 모드',
  'titlebar.settings': '설정',
  'titlebar.no_doc': '열린 문서 없음',

  // Folder pane
  'folder.title': '폴더',
  'folder.open': '폴더 열기',
  'folder.empty': '열린 폴더가 없습니다.',

  // Chat
  'chat.title': '챗봇',
  'chat.placeholder.no_doc': '현재 문서에 대해 질문하거나 도움을 요청하세요.',
  'chat.send': '전송',
  'chat.stop': '전송 중단',
  'chat.history.toggle': '대화 목록',
  'chat.history.new': '새 대화',
  'chat.mode.manual': 'Manual',
  'chat.mode.manual.sub': '제안 → 승인',
  'chat.mode.agent': 'Agent',
  'chat.mode.agent.sub': '자동 실행',
} as const;

export type LocaleKey = keyof typeof ko;
