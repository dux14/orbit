'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from 'zustand';
import { vaultStore } from '@/lib/store/vault-store';
import { settingsStore } from '@/lib/store/settings-store';
import { useAutoLock } from '@/lib/store/use-auto-lock';
import { useSettingsStore } from '@/lib/store/settings-store';
import { OrbitLogo } from '@/components/orbit/OrbitLogo';

/**
 * VaultGuard — wraps all (vault) routes.
 *
 * - If locked → redirect to /unlock (covers direct URL navigation after reload).
 * - If unlocked → render children and activate the auto-lock hook.
 *   Auto-lock timeout is read from the settings store (autoLockMinutes).
 *
 * Shows an invisible-feel splash while the redirect fires to avoid layout flash.
 */
export function VaultGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const locked = useStore(vaultStore, (s) => s.locked);
  const autoLockMinutes = useSettingsStore((s) => s.settings.autoLockMinutes);

  // Load settings on boot so the stored value is used immediately.
  useEffect(() => {
    settingsStore.getState().loadSettings();
  }, []);

  // Always call — the hook is a no-op when locked.
  useAutoLock(autoLockMinutes);

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
