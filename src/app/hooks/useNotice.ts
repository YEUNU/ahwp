/**
 * `useNotice` — Phase R3 (2차) refactor (REFACTORING_PLAN.md).
 *
 * Lightweight in-app notice — surfaces non-fatal save-time messages
 * (e.g. "saved as .hwp because .hwpx round-trip is lossy"). Auto-clears
 * after 5 seconds; replaces any in-flight notice.
 */
import { useCallback, useRef, useState } from 'react';

export interface NoticeState {
  kind: 'info' | 'warn';
  text: string;
}

export interface NoticeHandle {
  notice: NoticeState | null;
  showNotice: (text: string, kind?: 'info' | 'warn') => void;
  dismissNotice: () => void;
}

export function useNotice(): NoticeHandle {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  const showNotice = useCallback(
    (text: string, kind: 'info' | 'warn' = 'info'): void => {
      setNotice({ kind, text });
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
      noticeTimerRef.current = window.setTimeout(() => {
        setNotice(null);
        noticeTimerRef.current = null;
      }, 5000);
    },
    [],
  );

  const dismissNotice = useCallback((): void => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
    setNotice(null);
  }, []);

  return { notice, showNotice, dismissNotice };
}
