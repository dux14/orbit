import { AppShell } from '@/components/nav/AppShell';
import { SyncLifecycle } from '@/components/sync/sync-lifecycle';
import { ConflictDialog } from '@/components/sync/conflict-dialog';
import { VaultGuard } from './vault-guard';

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <VaultGuard>
      <SyncLifecycle />
      <ConflictDialog />
      <AppShell>{children}</AppShell>
    </VaultGuard>
  );
}
