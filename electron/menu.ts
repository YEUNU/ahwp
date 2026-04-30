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
      { role: 'cut', label: '잘라내기' },
      { role: 'copy', label: '복사' },
      { role: 'paste', label: '붙여넣기' },
      { role: 'selectAll', label: '전체 선택' },
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
