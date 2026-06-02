import OrbitLogo from "@/components/orbit/OrbitLogo";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background text-foreground">
      <OrbitLogo size={64} />
      <p className="text-lg font-medium text-muted-foreground">You&apos;re offline.</p>
    </main>
  );
}
