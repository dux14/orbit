// components/sync/sync-status.tsx
'use client';

import { useT } from '@/lib/i18n/use-t';
import { useSyncStore } from '@/lib/store/sync-store';
import { isSyncEnabled } from '@/lib/sync/sync-controller';

export function SyncStatus() {
  const t = useT();
  const status = useSyncStore((s) => s.status);
  const lastSyncedAt = useSyncStore((s) => s.lastSyncedAt);

  if (!isSyncEnabled()) return null;

  const label =
    status === 'syncing' ? t('sync.statusSyncing')
    : status === 'error' ? t('sync.statusError')
    : status === 'conflict' ? t('sync.statusConflict')
    : t('sync.statusIdle');

  const sub = lastSyncedAt
    ? t('sync.lastSynced', { time: new Date(lastSyncedAt).toLocaleString() })
    : t('sync.never');

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-sm">{label}</span>
      <span className="text-xs text-muted-foreground">{sub}</span>
    </div>
  );
}
