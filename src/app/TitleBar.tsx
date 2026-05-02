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
import { Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import { useTheme } from './use-theme';

export interface TitleBarProps {
  /** Active tab path, shown next to the logo. Empty string when no tab is open. */
  activeFileName: string;
  /** Whether the active tab has unsaved changes — paints the dirty dot. */
  dirty: boolean;
  /** Open the Settings dialog. */
  onOpenSettings: () => void;
}

const isMac =
  typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

export function TitleBar({
  activeFileName,
  dirty,
  onOpenSettings,
}: TitleBarProps): JSX.Element {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  return (
    <div
      data-testid="app-titlebar"
      className="flex h-9 shrink-0 items-center gap-3 border-b border-border bg-secondary text-xs"
      style={
        {
          paddingLeft: isMac ? 78 : 12,
          paddingRight: 10,
          // App-region drag (Electron). Buttons override to no-drag.
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      <div className="flex items-center gap-2">
        <Logo dark={isDark} />
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
              aria-label="저장 안 됨"
            />
          ) : null}
        </div>
      ) : (
        <span className="text-muted-foreground/70">열린 문서 없음</span>
      )}
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setTheme(isDark ? 'light' : 'dark')}
        title={isDark ? '라이트 모드' : '다크 모드'}
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        data-testid="titlebar-theme"
      >
        {isDark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      </button>
      <button
        type="button"
        onClick={onOpenSettings}
        title="설정"
        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        data-testid="titlebar-settings"
      >
        <SettingsIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** "한" mark — gradient teal box that anchors the brand. Matches
 * style_example/components/MainScreen.jsx#Logo. */
function Logo({ dark }: { dark: boolean }): JSX.Element {
  return (
    <div
      className="flex size-[18px] items-center justify-center rounded-[5px] text-[10px] font-bold text-white"
      style={{
        background: dark
          ? 'linear-gradient(135deg, #5fb4b3 0%, #2b6a6b 100%)'
          : 'linear-gradient(135deg, #2b6a6b 0%, #1d4f50 100%)',
        letterSpacing: '-0.04em',
        boxShadow: dark
          ? 'inset 0 1px 0 rgba(255,255,255,.15)'
          : '0 1px 0 rgba(0,0,0,.08)',
      }}
    >
      한
    </div>
  );
}
