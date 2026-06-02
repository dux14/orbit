'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from 'zustand';
import { vaultStore } from '@/lib/store/vault-store';
import { vaultService } from '@/lib/services/vault-service';
import { OrbitLogo } from '@/components/orbit/OrbitLogo';

/**
 * Root splash / router.
 *
 * Sequence (runs only on mount — store is always locked on a fresh page load):
 *   1. Check IndexedDB for a vault.
 *   2. No vault  → /onboarding
 *   3. Vault + locked (always true on fresh load) → /unlock
 *   4. Vault + unlocked (only reachable via in-memory navigation) → /dashboard
 *
 * A centred OrbitLogo splash is shown while the async check resolves,
 * preventing any content flash.
 */
export default function RootPage() {
  const router = useRouter();
  const locked = useStore(vaultStore, (s) => s.locked);

  useEffect(() => {
    let cancelled = false;

    async function decide() {
      const exists = await vaultService.exists();
      if (cancelled) return;

      if (!exists) {
        router.replace('/onboarding');
      } else if (!locked) {
        router.replace('/dashboard');
      } else {
        router.replace('/unlock');
      }
    }

    decide();
    return () => { cancelled = true; };
    // locked intentionally not in deps — we only want this to run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Splash shown while deciding
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background">
      <OrbitLogo
        size={48}
        className="motion-safe:animate-pulse opacity-70"
        aria-label="Loading Orbit…"
      />
    </div>
  );
}
