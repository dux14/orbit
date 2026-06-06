// lib/sync/sync-trigger.ts
import { isSyncEnabled, createSyncService } from './sync-controller';
import type { SyncService } from './sync-service';

let servicePromise: Promise<SyncService | null> | null = null;

/** Singleton perezoso del SyncService (una sola instancia por sesión de app). */
export function getSyncService(): Promise<SyncService | null> {
  if (!isSyncEnabled()) return Promise.resolve(null);
  if (!servicePromise) servicePromise = createSyncService();
  return servicePromise;
}

/** Programa un push con debounce si el sync está activo; no-op en Phase 1. */
export function maybeSchedulePush(): void {
  if (!isSyncEnabled()) return;
  void getSyncService().then((svc) => svc?.schedulePush());
}

/** Pull inicial al unlock; no-op en Phase 1. */
export function maybeReconcileNow(): void {
  if (!isSyncEnabled()) return;
  void getSyncService().then((svc) => svc?.reconcileNow());
}

/** Resetea el singleton (sign-out / tests). */
export function resetSyncService(): void {
  servicePromise = null;
}
