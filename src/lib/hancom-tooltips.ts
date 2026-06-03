/**
 * Platform-aware shortcut localization — chunk 90.
 *
 * macOS 는 `⌘`, `⌥`, `⇧`, `⌃` 심볼을 그대로 쓰고, Win/Linux 는
 * `Ctrl+`, `Alt+`, `Shift+` 텍스트로 변환해 표기한다. isMac 은 단일
 * canonical 모듈(@/lib/platform)에서 가져온다.
 *
 * (이전의 한컴 명칭 HANCOM_TOOLTIPS 테이블 + hancomTitle 컴포저는 호버
 * 툴팁 UI 가 rhwp-studio iframe 으로 이전되면서 미사용이 되어 제거됨.)
 */
import { isMac } from '@/lib/platform';

function localizeShortcut(s: string): string {
  if (isMac) return s;
  return s
    .replace(/⌘/g, 'Ctrl+')
    .replace(/⌃/g, 'Ctrl+')
    .replace(/⌥/g, 'Alt+')
    .replace(/⇧/g, 'Shift+')
    .replace(/\+\+/g, '+'); // remove double + from concatenations
}

/** Localize a raw shortcut string like `⌘⇧S` for Win/Linux display. */
export function localizeShortcutPublic(s: string): string {
  return localizeShortcut(s);
}
