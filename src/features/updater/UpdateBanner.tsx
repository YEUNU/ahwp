/// <reference lib="dom" />
/**
 * UpdateBanner — 0.6.2.
 *
 * 우상단 TitleBar 아래에 들러붙는 inline banner. 4 visible state:
 * - `available` — "v0.7.0 업데이트가 있습니다 [지금 받기] [나중에]"
 * - `downloading` — "다운로드 중... 42%" (progress bar 포함)
 * - `downloaded` — "v0.7.0 설치 준비 완료 [재시작해서 설치] [나중에]"
 * - `error` — "업데이트 확인 실패: ..." [닫기]
 *
 * 그 외 상태 (`idle` / `checking` / `up-to-date`) 는 noop — 사용자 시야에
 * 굳이 뜰 필요 X. checking 은 너무 짧고 up-to-date 는 manual check 의
 * 결과를 Settings 안에서 별도로 보여줌.
 *
 * "나중에" 는 단순 hide — 다음 app launch 때 다시 알림 (autoUpdater 가
 * 다시 검사). 영구 dismiss 는 의도적으로 안 제공 (보안 패치 누락 위험).
 *
 * dev / `AHWP_DISABLE_UPDATER=1` 환경에선 useUpdater 의 `enabled=false` 가
 * 모든 state 를 `idle` 로 강제 → 자연스럽게 noop.
 */
import { useEffect, useState } from 'react';
import { Download, RefreshCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { UpdaterState } from '@shared/api';

export function UpdateBanner(): React.ReactElement | null {
  const [state, setState] = useState<UpdaterState>({
    status: 'idle',
    enabled: false,
  });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 초기 상태 fetch + 라이브 이벤트 구독.
    void window.api.updater.getState().then(setState);
    const off = window.api.updater.onEvent((next) => {
      setState(next);
      setDismissed(false); // 새 state 가 오면 dismiss 해제.
    });
    return off;
  }, []);

  if (!state.enabled || dismissed) return null;

  // 노출이 의미있는 상태만 렌더.
  if (
    state.status !== 'available' &&
    state.status !== 'downloading' &&
    state.status !== 'downloaded' &&
    state.status !== 'error'
  ) {
    return null;
  }

  const version = state.version ?? '';

  return (
    <div
      data-testid="updater-banner"
      data-status={state.status}
      role="status"
      className="flex items-center justify-between gap-3 border-b border-sky-300 bg-sky-50 px-4 py-2 text-xs text-sky-900 dark:border-sky-700 dark:bg-sky-950/40 dark:text-sky-200"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {state.status === 'available' && (
          <>
            <Download className="size-4 shrink-0" aria-hidden />
            <span className="truncate">
              {version
                ? `새 버전 ${version} 이 준비되었습니다.`
                : '새 버전이 준비되었습니다.'}
            </span>
          </>
        )}
        {state.status === 'downloading' && (
          <>
            <Download className="size-4 shrink-0 animate-pulse" aria-hidden />
            <span className="truncate">
              다운로드 중… {Math.round(state.progressPercent ?? 0)}%
            </span>
            <div
              className="h-1 w-32 overflow-hidden rounded bg-sky-200 dark:bg-sky-900"
              aria-hidden
            >
              <div
                className="h-full bg-sky-500"
                style={{
                  width: `${Math.max(2, Math.min(100, Math.round(state.progressPercent ?? 0)))}%`,
                }}
              />
            </div>
          </>
        )}
        {state.status === 'downloaded' && (
          <>
            <RefreshCcw className="size-4 shrink-0" aria-hidden />
            <span className="truncate">
              {version
                ? `버전 ${version} 설치 준비 완료. 재시작 시 적용됩니다.`
                : '설치 준비 완료. 재시작 시 적용됩니다.'}
            </span>
          </>
        )}
        {state.status === 'error' && (
          <span className="truncate text-red-700 dark:text-red-300">
            업데이트 확인 실패: {state.errorMessage ?? '알 수 없는 오류'}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {state.status === 'available' && (
          <Button
            size="sm"
            variant="default"
            data-testid="updater-download"
            onClick={() => {
              void window.api.updater.downloadUpdate();
            }}
          >
            지금 받기
          </Button>
        )}
        {state.status === 'downloaded' && (
          <Button
            size="sm"
            variant="default"
            data-testid="updater-install"
            onClick={() => {
              void window.api.updater.quitAndInstall();
            }}
          >
            재시작해서 설치
          </Button>
        )}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded px-2 py-0.5 hover:bg-black/5 dark:hover:bg-white/10"
          aria-label="업데이트 알림 닫기"
          data-testid="updater-dismiss"
        >
          <X className="size-3" aria-hidden />
        </button>
      </div>
    </div>
  );
}
