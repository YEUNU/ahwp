/**
 * About 창 — chunk 52 (Phase 4 진입).
 *
 * 메뉴 "ahwp 정보" 클릭 시 native About 패널 대신 커스텀 다이얼로그를
 * 표시. 버전 / 라이선스 / GitHub 링크 / 의존성 버전 (Electron / Chrome /
 * Node) / OS 정보. macOS Apple menu 의 "About" 도 동일 다이얼로그로 라우팅
 * (electron/menu.ts 에서 `view:about` MenuAction emit).
 */
import { useCallback, useEffect, useState } from 'react';
import type { AppVersions } from '@shared/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REPO_URL = 'https://github.com/YEUNU/ahwp';
const ISSUES_URL = `${REPO_URL}/issues`;
const RELEASES_URL = `${REPO_URL}/releases`;

export function AboutDialog({
  open,
  onOpenChange,
}: AboutDialogProps): JSX.Element {
  const [versions, setVersions] = useState<AppVersions | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.api.getVersions().then((v) => {
      if (!cancelled) setVersions(v);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const openExternal = useCallback((url: string): void => {
    // Electron 의 contextBridge 는 shell 직접 노출 안 함. window.open 으로
    // 새 창을 띄우는 대신 anchor href + target='_blank' 를 만들고 click
    // — Electron main 의 will-navigate 핸들러가 외부 URL 을 OS 브라우저
    // 로 라우팅 (electron/main.ts setWindowOpenHandler).
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="about-dialog" className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle className="text-xl">ahwp</DialogTitle>
          <DialogDescription>
            AI-powered HWP/HWPX desktop editor
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-3 text-sm">
          <div className="flex justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">버전</span>
            <span
              className="font-mono font-semibold"
              data-testid="about-app-version"
            >
              {versions ? `v${versions.app}` : '…'}
            </span>
          </div>

          <div className="space-y-1.5 font-mono text-xs">
            <Row label="Electron" value={versions?.electron} />
            <Row label="Chromium" value={versions?.chrome} />
            <Row label="Node.js" value={versions?.node} />
            <Row
              label="OS"
              value={
                versions ? `${versions.platform} ${versions.arch}` : undefined
              }
            />
          </div>

          <div className="border-t border-border pt-2 text-xs text-muted-foreground">
            라이선스: Apache License 2.0
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openExternal(REPO_URL)}
              data-testid="about-github"
            >
              GitHub
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openExternal(RELEASES_URL)}
              data-testid="about-releases"
            >
              Releases
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openExternal(ISSUES_URL)}
              data-testid="about-issues"
            >
              Issues
            </Button>
          </div>
        </section>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-testid="about-close"
          >
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
}: {
  label: string;
  value: string | undefined;
}): JSX.Element {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value ?? '…'}</span>
    </div>
  );
}
