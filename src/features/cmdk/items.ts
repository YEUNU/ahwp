import type { MenuAction } from '@shared/api';
import type { CommandItem } from './CommandPalette';

/**
 * Canonical menu-action items for the command palette — chunk 50.
 * Mirrors `MenuAction` (and the native menu wiring), so adding a new
 * menu entry naturally surfaces in ⌘K too. AppShell composes this list
 * with session-dependent items (open tabs, recents, theme).
 */
export function buildActionItems(
  dispatch: (action: MenuAction) => void,
): CommandItem[] {
  const e = (
    id: MenuAction,
    label: string,
    keywords: string[],
    hint?: string,
  ): CommandItem => ({
    id: `action:${id}`,
    kind: 'action',
    label,
    hint,
    keywords,
    run: () => dispatch(id),
  });
  return [
    e('file:new', '파일 → 새 문서', ['file', 'new', '새', '문서'], '⌘N'),
    e('file:open', '파일 → 열기', ['file', 'open', '열기'], '⌘O'),
    e('file:save', '파일 → 저장', ['file', 'save', '저장'], '⌘S'),
    e(
      'file:save-as',
      '파일 → 다른 이름으로 저장',
      ['file', 'save', '다른', 'as'],
      '⌘⇧S',
    ),
    e('file:export-html', '파일 → HTML로 내보내기', [
      'file',
      'export',
      'html',
      '내보내기',
    ]),
    e('file:export-pdf', '파일 → PDF로 내보내기', [
      'file',
      'export',
      'pdf',
      '내보내기',
    ]),
    e('edit:undo', '편집 → 실행 취소', ['edit', 'undo', '취소'], '⌘Z'),
    e('edit:redo', '편집 → 다시 실행', ['edit', 'redo', '다시'], '⌘⇧Z'),
    e('edit:copy', '편집 → 복사', ['edit', 'copy', '복사'], '⌘C'),
    e('edit:cut', '편집 → 잘라내기', ['edit', 'cut', '잘라'], '⌘X'),
    e('edit:paste', '편집 → 붙여넣기', ['edit', 'paste', '붙여'], '⌘V'),
    e('edit:find', '편집 → 찾기', ['edit', 'find', '찾기'], '⌘F'),
    e(
      'edit:replace',
      '편집 → 찾아 바꾸기',
      ['edit', 'replace', '바꾸기'],
      '⌘H',
    ),
    e(
      'edit:copy-control',
      '편집 → 컨트롤로 복사',
      ['copy', 'control', '컨트롤'],
      '⌘⇧C',
    ),
    e(
      'edit:paste-control',
      '편집 → 컨트롤로 붙여넣기',
      ['paste', 'control', '컨트롤'],
      '⌘⇧V',
    ),
    e('view:page-setup', '보기 → 페이지 설정', ['page', 'setup', '페이지']),
    e('insert:header-footer', '삽입 → 머리말/꼬리말', [
      'header',
      'footer',
      '머리말',
      '꼬리말',
    ]),
    e('insert:bookmark', '삽입 → 책갈피', ['bookmark', '책갈피']),
    e('insert:footnote', '삽입 → 각주', ['footnote', '각주']),
    e('view:style-manager', '보기 → 스타일 관리', ['style', '스타일']),
    e('view:picture-props', '보기 → 그림 속성', ['picture', 'image', '그림']),
    e('view:toggle-ruler', '보기 → 룰러 토글', [
      'ruler',
      '룰러',
      '눈금자',
      'cm',
      'mm',
    ]),
    e('view:version-history', '보기 → 버전 히스토리', [
      'version',
      'history',
      '버전',
      '히스토리',
      '복원',
      'restore',
    ]),
    e('app:new-window', '파일 → 새 창', ['window', 'new', '새', '창'], '⌘⇧N'),
    e('insert:equation', '삽입 → 수식', ['equation', '수식']),
    e('insert:shape', '삽입 → 도형', ['shape', '도형']),
    e('format:bold', '서식 → 굵게', ['bold', '굵게'], '⌘B'),
    e('format:italic', '서식 → 기울임', ['italic', '기울임'], '⌘I'),
    e('format:underline', '서식 → 밑줄', ['underline', '밑줄'], '⌘U'),
    e('view:settings', '보기 → 설정', ['settings', '설정', 'preferences']),
    e('view:about', '도움말 → ahwp 정보', ['about', '정보', '버전', 'version']),
  ];
}
