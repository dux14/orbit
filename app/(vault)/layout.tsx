import { AppShell } from '@/components/nav/AppShell';
import { VaultGuard } from './vault-guard';

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <VaultGuard>
      <AppShell>{children}</AppShell>
    </VaultGuard>
  );
}
