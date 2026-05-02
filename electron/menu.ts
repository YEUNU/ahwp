import {
  app,
  Menu,
  shell,
  type BrowserWindow,
  type MenuItemConstructorOptions,
} from 'electron';
import type { MenuAction } from '../shared/api';

const isMac = process.platform === 'darwin';

function send(window: BrowserWindow | null, action: MenuAction): void {
  if (window && !window.isDestroyed()) {
    window.webContents.send('menu:action', action);
  }
}

export function buildAppMenu(getWindow: () => BrowserWindow | null): Menu {
  const fileMenu: MenuItemConstructorOptions = {
    label: '파일',
    submenu: [
      {
        label: '새 문서',
        accelerator: 'CmdOrCtrl+N',
        click: () => send(getWindow(), 'file:new'),
      },
      {
        label: '열기…',
        accelerator: 'CmdOrCtrl+O',
        click: () => send(getWindow(), 'file:open'),
      },
      { type: 'separator' },
      {
        label: '저장',
        accelerator: 'CmdOrCtrl+S',
        click: () => send(getWindow(), 'file:save'),
      },
      {
        label: '다른 이름으로 저장…',
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => send(getWindow(), 'file:save-as'),
      },
      {
        label: 'HTML로 내보내기…',
        click: () => send(getWindow(), 'file:export-html'),
      },
      { type: 'separator' },
      isMac
        ? { role: 'close', label: '창 닫기' }
        : { role: 'quit', label: '종료' },
    ],
  };

  const editMenu: MenuItemConstructorOptions = {
    label: '편집',
    submenu: [
      {
        label: '실행 취소',
        accelerator: 'CmdOrCtrl+Z',
        click: () => send(getWindow(), 'edit:undo'),
      },
      {
        label: '다시 실행',
        accelerator: 'Shift+CmdOrCtrl+Z',
        click: () => send(getWindow(), 'edit:redo'),
      },
      { type: 'separator' },
      {
        label: '잘라내기',
        accelerator: 'CmdOrCtrl+X',
        click: () => send(getWindow(), 'edit:cut'),
      },
      {
        label: '복사',
        accelerator: 'CmdOrCtrl+C',
        click: () => send(getWindow(), 'edit:copy'),
      },
      {
        label: '붙여넣기',
        accelerator: 'CmdOrCtrl+V',
        click: () => send(getWindow(), 'edit:paste'),
      },
      { role: 'selectAll', label: '전체 선택' },
      { type: 'separator' },
      {
        label: '찾기…',
        accelerator: 'CmdOrCtrl+F',
        click: () => send(getWindow(), 'edit:find'),
      },
      {
        label: '바꾸기…',
        accelerator: 'CmdOrCtrl+H',
        click: () => send(getWindow(), 'edit:replace'),
      },
      { type: 'separator' },
      {
        label: '컨트롤로 복사',
        accelerator: 'CmdOrCtrl+Shift+C',
        click: () => send(getWindow(), 'edit:copy-control'),
      },
      {
        label: '컨트롤로 붙여넣기',
        accelerator: 'CmdOrCtrl+Shift+V',
        click: () => send(getWindow(), 'edit:paste-control'),
      },
    ],
  };

  const formatMenu: MenuItemConstructorOptions = {
    label: '서식',
    submenu: [
      {
        label: '진하게',
        accelerator: 'CmdOrCtrl+B',
        click: () => send(getWindow(), 'format:bold'),
      },
      {
        label: '기울임',
        accelerator: 'CmdOrCtrl+I',
        click: () => send(getWindow(), 'format:italic'),
      },
      {
        label: '밑줄',
        accelerator: 'CmdOrCtrl+U',
        click: () => send(getWindow(), 'format:underline'),
      },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: '보기',
    submenu: [
      { role: 'reload', label: '새로고침' },
      { role: 'forceReload', label: '강제 새로고침' },
      { role: 'toggleDevTools', label: '개발자 도구' },
      { type: 'separator' },
      { role: 'resetZoom', label: '실제 크기' },
      { role: 'zoomIn', label: '확대' },
      { role: 'zoomOut', label: '축소' },
      { type: 'separator' },
      { role: 'togglefullscreen', label: '전체 화면' },
      { type: 'separator' },
      {
        label: '페이지 설정…',
        click: () => send(getWindow(), 'view:page-setup'),
      },
      {
        label: '머리말 / 꼬리말…',
        click: () => send(getWindow(), 'insert:header-footer'),
      },
      {
        label: '책갈피…',
        click: () => send(getWindow(), 'insert:bookmark'),
      },
      {
        label: '각주…',
        click: () => send(getWindow(), 'insert:footnote'),
      },
      {
        label: '스타일 관리…',
        click: () => send(getWindow(), 'view:style-manager'),
      },
      {
        label: '수식 미리보기…',
        click: () => send(getWindow(), 'insert:equation'),
      },
      {
        label: '사각형 도형…',
        click: () => send(getWindow(), 'insert:shape'),
      },
      {
        label: '그림 속성…',
        click: () => send(getWindow(), 'view:picture-props'),
      },
      {
        label: '설정…',
        accelerator: 'CmdOrCtrl+,',
        click: () => send(getWindow(), 'view:settings'),
      },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = {
    label: '윈도우',
    submenu: isMac
      ? [
          { role: 'minimize', label: '최소화' },
          { role: 'zoom', label: '확대/축소' },
          { type: 'separator' },
          { role: 'front', label: '모두 앞으로' },
        ]
      : [
          { role: 'minimize', label: '최소화' },
          { role: 'close', label: '닫기' },
        ],
  };

  const helpMenu: MenuItemConstructorOptions = {
    label: '도움말',
    submenu: [
      {
        label: 'GitHub 저장소',
        click: () => void shell.openExternal('https://github.com/YEUNU/ahwp'),
      },
      {
        label: '이슈 보고',
        click: () =>
          void shell.openExternal('https://github.com/YEUNU/ahwp/issues'),
      },
      { type: 'separator' },
      { role: 'about', label: 'ahwp 정보' },
    ],
  };

  const template: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about', label: 'ahwp 정보' },
            { type: 'separator' },
            {
              label: '설정…',
              accelerator: 'Cmd+,',
              click: () => send(getWindow(), 'view:settings'),
            },
            { type: 'separator' },
            { role: 'services', label: '서비스' },
            { type: 'separator' },
            { role: 'hide', label: 'ahwp 가리기' },
            { role: 'hideOthers', label: '다른 항목 가리기' },
            { role: 'unhide', label: '모두 보기' },
            { type: 'separator' },
            { role: 'quit', label: 'ahwp 종료' },
          ],
        },
        fileMenu,
        editMenu,
        formatMenu,
        viewMenu,
        windowMenu,
        helpMenu,
      ]
    : [fileMenu, editMenu, formatMenu, viewMenu, windowMenu, helpMenu];

  return Menu.buildFromTemplate(template);
}
