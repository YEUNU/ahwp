import { useCallback, useEffect, useState } from 'react';
import type { RecentFile } from '@shared/api';

export function useRecentFiles() {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await window.api.file.listRecent();
    setRecent(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await window.api.file.listRecent();
        if (!cancelled) setRecent(list);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { recent, loading, refresh };
}
