import { AppShell } from '@/components/nav/AppShell';
import { SyncLifecycle } from '@/components/sync/sync-lifecycle';
import { VaultGuard } from './vault-guard';

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <VaultGuard>
      <SyncLifecycle />
      <AppShell>{children}</AppShell>
    </VaultGuard>
  );
}
