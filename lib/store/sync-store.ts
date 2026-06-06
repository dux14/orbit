// lib/store/sync-store.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ConflictInfo, SyncStatus } from '@/lib/sync/types';

interface SyncState {
  status: SyncStatus;
  lastSyncedAt: string | null;
  conflict: ConflictInfo | null;
  setStatus: (status: SyncStatus) => void;
  setConflict: (conflict: ConflictInfo) => void;
  clearConflict: () => void;
  markSynced: (at: string) => void;
  reset: () => void;
}

export const syncStore = createStore<SyncState>((set) => ({
  status: 'idle',
  lastSyncedAt: null,
  conflict: null,
  setStatus: (status) => set({ status }),
  setConflict: (conflict) => set({ status: 'conflict', conflict }),
  clearConflict: () => set({ conflict: null }),
  markSynced: (at) => set({ status: 'idle', lastSyncedAt: at, conflict: null }),
  reset: () => set({ status: 'idle', lastSyncedAt: null, conflict: null }),
}));

/** React binding — use like: useSyncStore(s => s.status) */
export function useSyncStore<T>(selector: (state: SyncState) => T): T {
  return useStore(syncStore, selector);
}
