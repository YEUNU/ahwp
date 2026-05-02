import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Shortcut cheatsheet — chunk 53. ⌘/ (or `?` outside an input) opens
 * this read-only dialog. Items mirror the actual key bindings wired in
 * `StudioViewer.handleKeyDown` and `AppShell` document-level listeners
 * — keep these in sync when adding new shortcuts.
 */

interface Row {
  keys: string;
  label: string;
}

interface Section {
  title: string;
  rows: Row[];
}

const SECTIONS: Section[] = [
  {
    title: '파일',
    rows: [
      { keys: '⌘N', label: '새 문서' },
      { keys: '⌘O', label: '파일 열기' },
      { keys: '⌘S', label: '저장' },
      { keys: '⌘⇧S', label: '다른 이름으로 저장' },
      { keys: '⌘W', label: '현재 탭 닫기' },
    ],
  },
  {
    title: '편집',
    rows: [
      { keys: '⌘Z', label: '실행 취소' },
      { keys: '⌘⇧Z / ⌘Y', label: '다시 실행' },
      { keys: '⌘C / ⌘X / ⌘V', label: '복사 / 잘라내기 / 붙여넣기' },
      { keys: '⌘⇧C / ⌘⇧V', label: '컨트롤 복사 / 붙여넣기' },
      { keys: '⌘A', label: '전체 선택' },
      { keys: '⌘F', label: '찾기' },
      { keys: '⌘H', label: '찾아 바꾸기' },
    ],
  },
  {
    title: '서식',
    rows: [
      { keys: '⌘B', label: '진하게' },
      { keys: '⌘I', label: '기울임' },
      { keys: '⌘U', label: '밑줄' },
    ],
  },
  {
    title: '캐럿 / 선택',
    rows: [
      { keys: '← / →', label: '글자 단위 이동' },
      { keys: '↑ / ↓', label: '시각 라인 단위 이동' },
      { keys: '⌘← / ⌘→', label: '단어 단위 이동' },
      { keys: 'Home / End', label: '단락 시작 / 끝' },
      { keys: '⌘Home / ⌘End', label: '문서 시작 / 끝' },
      { keys: 'Shift + 위 화살표 / 클릭', label: '선택 확장' },
      { keys: 'Esc (드래그 중)', label: '드래그 선택 취소' },
    ],
  },
  {
    title: '네비게이션',
    rows: [
      { keys: '⌘K', label: '명령 팔레트' },
      { keys: '⌘/', label: '단축키 도움말 (이 창)' },
      { keys: 'PageUp / PageDown', label: '페이지 단위 스크롤' },
    ],
  },
  {
    title: '표 / 셀',
    rows: [
      { keys: 'Tab / Shift+Tab', label: '셀 사이 이동 (셀 안에서)' },
      { keys: '우클릭', label: '셀 컨텍스트 메뉴 (속성·수식·스타일)' },
    ],
  },
];

export interface ShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: ShortcutsDialogProps): JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="shortcuts-dialog" className="max-w-2xl gap-3">
        <DialogHeader>
          <DialogTitle>단축키</DialogTitle>
          <DialogDescription>
            ⌘K로 모든 명령을 검색해 키보드만으로 실행할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {SECTIONS.map((s) => (
            <div key={s.title}>
              <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.title}
              </h3>
              <ul className="space-y-1">
                {s.rows.map((r) => (
                  <li
                    key={r.keys}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-foreground">{r.label}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {r.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
