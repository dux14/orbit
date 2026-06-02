'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from 'zustand';
import { vaultStore } from '@/lib/store/vault-store';
import { useAutoLock } from '@/lib/store/use-auto-lock';
import { OrbitLogo } from '@/components/orbit/OrbitLogo';

/**
 * VaultGuard — wraps all (vault) routes.
 *
 * - If locked → redirect to /unlock (covers direct URL navigation after reload).
 * - If unlocked → render children and activate the auto-lock hook (5 min inactivity).
 *
 * Shows an invisible-feel splash while the redirect fires to avoid layout flash.
 */
export function VaultGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const locked = useStore(vaultStore, (s) => s.locked);

  // Always call — the hook is a no-op when locked.
  useAutoLock(5);

  useEffect(() => {
    if (locked) {
      router.replace('/unlock');
    }
  }, [locked, router]);

  if (locked) {
    // Minimise flash: render a centred logo while the redirect is in flight.
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background">
        <OrbitLogo size={40} className="opacity-40" aria-label="Redirecting to unlock…" />
      </div>
    );
  }

  return <>{children}</>;
}
