/**
 * Custom 36px titlebar — UI/UX revamp. Lives at the very top of the
 * AppShell, above the 3-pane body. The OS frame is hidden via
 * `titleBarStyle: 'hiddenInset'` (macOS) / `hidden` (Win/Linux); on
 * macOS we leave 78px on the left for the traffic-light controls.
 *
 * The `-webkit-app-region: drag` on the wrapper makes it a window-drag
 * surface; interactive children (buttons) carry `no-drag` so they
 * remain clickable. No platform branching needed at runtime — the
 * left padding is conditional via getDragPaddingLeft.
 */
import {
  Menu as MenuIcon,
  Moon,
  Settings as SettingsIcon,
  Sun,
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isMac } from '@/lib/platform';
import { useTheme } from './use-theme';

export interface TitleBarProps {
  /** Active tab path, shown next to the logo. Empty string when no tab is open. */
  activeFileName: string;
  /** Whether the active tab has unsaved changes — paints the dirty dot. */
  dirty: boolean;
  /** Open the Settings dialog. */
  onOpenSettings: () => void;
}

export function TitleBar({
  activeFileName,
  dirty,
  onOpenSettings,
}: TitleBarProps): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useTranslation();
  const isDark = resolvedTheme === 'dark';
  // 0.6.12 — Windows / Linux 메뉴 접근성. macOS 는 시스템 메뉴바를
  // 사용하니까 햄버거 버튼 숨김. titleBarStyle: 'hidden' 이 네이티브
  // 메뉴바도 같이 숨기는 플랫폼에서만 노출.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const onMenuClick = (): void => {
    const btn = menuButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    // 버튼 하단 시작 — context menu 가 자연스럽게 펼쳐지도록.
    void window.api.popupAppMenu({
      x: Math.round(rect.left),
      y: Math.round(rect.bottom),
    });
  };
  return (
    <div
      data-testid="app-titlebar"
      className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-secondary text-xs"
      style={
        {
          paddingLeft: isMac ? 78 : 12,
          // 0.6.14 — non-Mac (Windows / Linux) 의 native 창 컨트롤
          // overlay (min / max / close) 가 우상단 ~138px 점유. 이전엔
          // paddingRight: 10 이라 우리 settings / theme 버튼이 같은
          // 좌표에 겹쳐서 사용자가 "X" 클릭한 게 settings 로 라우팅
          // 되어 창이 안 닫혔음. macOS 는 traffic lights 가 좌측이고
          // 우측은 자유 → 기존 10 유지.
          paddingRight: isMac ? 10 : 138,
          // App-region drag (Electron). Buttons override to no-drag.
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      {!isMac && (
        <button
          ref={menuButtonRef}
          type="button"
          onClick={onMenuClick}
          title={t('titlebar.menu') || '메뉴'}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          data-testid="titlebar-menu"
          aria-label={t('titlebar.menu') || '메뉴'}
        >
          <MenuIcon className="size-3.5" />
        </button>
      )}
      <div className="flex items-center gap-2">
        <Logo />
        <span className="font-semibold tracking-tight text-foreground">
          ahwp
        </span>
      </div>
      <div className="h-3.5 w-px bg-border" />
      {activeFileName ? (
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>{activeFileName}</span>
          {dirty ? (
            <span
              className="inline-block size-1 rounded-full bg-primary"
              aria-label={t('titlebar.unsaved') || '저장 안 됨'}
            />
          ) : null}
        </div>
      ) : (
        <span className="text-muted-foreground/70">{t('titlebar.no_doc')}</span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        title={isDark ? t('titlebar.theme.light') : t('titlebar.theme.dark')}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        data-testid="titlebar-theme"
      >
        {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        title={t('titlebar.settings')}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        data-testid="titlebar-settings"
      >
        <SettingsIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** ahwp 로고 마크 — "9 · ㅏ Flag" 컨셉의 squircle SVG. 양쪽 테마에서
 * 같은 색 (배경 #2b6a6b 브랜드 틸 + 글리프 #f6f4ef 페이퍼) 사용.
 *
 * chunk 77 — `<img src="/icon.svg">` 는 packaged Electron 에서
 * `file:///icon.svg` 로 resolve 되어 404. inline SVG 로 교체. */
function Logo(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={18}
      height={18}
      className="rounded-[5px]"
      data-testid="titlebar-logo"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="ahwp-logo-squircle">
          <path d="M 14.3168 0 L 49.6832 0 Q 64 0 64 14.3168 L 64 49.6832 Q 64 64 49.6832 64 L 14.3168 64 Q 0 64 0 49.6832 L 0 14.3168 Q 0 0 14.3168 0 Z" />
        </clipPath>
      </defs>
      <g clipPath="url(#ahwp-logo-squircle)">
        <rect width="64" height="64" fill="#2b6a6b" />
        <rect
          x="26.88"
          y="10.24"
          width="6.4"
          height="43.52"
          rx="0.768"
          fill="#f6f4ef"
        />
        <rect
          x="33.28"
          y="29.44"
          width="20.48"
          height="6.4"
          rx="0.768"
          fill="#f6f4ef"
        />
      </g>
    </svg>
  );
}
