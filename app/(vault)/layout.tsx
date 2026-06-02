import { AppShell } from "@/components/nav/AppShell";

export default function VaultLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}
