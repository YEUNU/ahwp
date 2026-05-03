import type { LocaleKey } from './ko';

/**
 * English — secondary locale (chunk 89). 모든 키는 ko.ts 에서 추가
 * 한 뒤 여기서 번역. 누락 시 i18next fallback 으로 ko 사용.
 *
 * Partial<Record<LocaleKey, string>> 로 점진적 도입 — 새 키 추가
 * 시 en.ts 누락 알림은 별도 lint script 후속.
 */
export const en: Partial<Record<LocaleKey, string>> = {
  // Common
  'common.cancel': 'Cancel',
  'common.confirm': 'OK',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  'common.apply': 'Apply',

  // Settings
  'settings.title': 'Settings',
  'settings.tab.general': 'General',
  'settings.tab.ai': 'AI providers',
  'settings.tab.shortcuts': 'Shortcuts',
  'settings.tab.about': 'About',

  // Welcome
  'welcome.title': 'Hello.',
  'welcome.subtitle':
    'Start with a new document, or open an existing HWP/HWPX file to work with AI assistance. Both .hwp and .hwpx are supported.',
  'welcome.cta.new': 'Start blank',
  'welcome.cta.new.subtitle':
    'Begin from scratch or let the AI scaffold a layout. Chat works on a blank doc too.',
  'welcome.cta.open': 'Open file',
  'welcome.cta.open.subtitle':
    'Select a .hwp or .hwpx file, or drop it onto this region.',

  // TitleBar
  'titlebar.theme.dark': 'Dark mode',
  'titlebar.theme.light': 'Light mode',
  'titlebar.settings': 'Settings',
  'titlebar.no_doc': 'No open document',

  // Folder
  'folder.title': 'Folder',
  'folder.open': 'Open folder',
  'folder.empty': 'No folder open.',

  // Chat
  'chat.title': 'Chat',
  'chat.placeholder.no_doc': 'Ask about the current document or request edits.',
  'chat.send': 'Send',
  'chat.stop': 'Stop',
  'chat.history.toggle': 'Conversations',
  'chat.history.new': 'New conversation',
  'chat.mode.manual': 'Manual',
  'chat.mode.manual.sub': 'Propose → Approve',
  'chat.mode.agent': 'Agent',
  'chat.mode.agent.sub': 'Auto-run',
};
