// lib/sync/use-sync-lifecycle.ts
'use client';
import { useEffect } from 'react';
import { isSyncEnabled } from './sync-controller';
import { getSyncService, maybeReconcileNow } from './sync-trigger';

/** Monta listeners de ciclo de vida para pull en foco/online y flush en pagehide. */
export function useSyncLifecycle(): void {
  useEffect(() => {
    if (!isSyncEnabled()) return;
    const onVisible = () => { if (document.visibilityState === 'visible') maybeReconcileNow(); };
    const onOnline = () => maybeReconcileNow();
    const onHide = () => { void getSyncService().then((svc) => svc?.flush()); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);
}
