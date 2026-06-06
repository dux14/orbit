// components/sync/conflict-dialog.tsx
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n/use-t';
import { useSettingsStore } from '@/lib/store/settings-store';
import { useSyncStore } from '@/lib/store/sync-store';
import { getSyncService } from '@/lib/sync/sync-trigger';
import type { RemoteVault } from '@/lib/sync/types';

function fmt(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function ConflictDialog() {
  const t = useT();
  const locale = useSettingsStore((s) => s.settings.locale);
  const conflict = useSyncStore((s) => s.conflict);
  const [resolving, setResolving] = useState(false);

  if (!conflict) return null;

  const resolve = async (which: 'local' | 'remote', remote: RemoteVault) => {
    setResolving(true);
    try {
      const svc = await getSyncService();
      if (!svc) return;
      if (which === 'local') await svc.resolveConflictKeepLocal(remote);
      else await svc.resolveConflictUseRemote(remote);
    } finally {
      setResolving(false);
    }
  };

  return (
    <Dialog open={!!conflict}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('sync.conflictTitle')}</DialogTitle>
          <DialogDescription>{t('sync.conflictBody')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg ring-1 ring-foreground/10 p-3">
            <p className="font-heading text-sm font-medium">{t('sync.conflictThisDevice')}</p>
            <p className="text-xs text-muted-foreground">{t('sync.conflictEditedAt', { time: fmt(conflict.localUpdatedAt, locale) })}</p>
          </div>
          <div className="rounded-lg ring-1 ring-foreground/10 p-3">
            <p className="font-heading text-sm font-medium">{t('sync.conflictOtherDevice')}</p>
            <p className="text-xs text-muted-foreground">{t('sync.conflictEditedAt', { time: fmt(conflict.remoteUpdatedAt, locale) })}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={resolving} onClick={() => void resolve('remote', conflict.remote)}>
            {resolving ? t('sync.conflictResolving') : t('sync.conflictUseRemote')}
          </Button>
          <Button disabled={resolving} onClick={() => void resolve('local', conflict.remote)}>
            {resolving ? t('sync.conflictResolving') : t('sync.conflictKeepLocal')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
