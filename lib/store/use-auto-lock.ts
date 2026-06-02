'use client';

import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import { vaultStore } from './vault-store';

/**
 * Automatically locks the vault when:
 *   1. The tab becomes hidden (visibilitychange → hidden).
 *   2. The user has been inactive (no pointerdown / keydown) for `inactivityMinutes`.
 *
 * Only active while the vault is unlocked. Cleans up all listeners on unmount.
 */
export function useAutoLock(inactivityMinutes = 5): void {
  const locked = useStore(vaultStore, (s) => s.locked);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (locked) return;

    const delayMs = inactivityMinutes * 60 * 1000;

    function lock() {
      vaultStore.getState().lock();
    }

    function resetTimer() {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(lock, delayMs);
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        lock();
      }
    }

    // Start the inactivity timer immediately.
    resetTimer();

    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('pointerdown', resetTimer);
    document.addEventListener('keydown', resetTimer);

    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('pointerdown', resetTimer);
      document.removeEventListener('keydown', resetTimer);
    };
  }, [locked, inactivityMinutes]);
}
