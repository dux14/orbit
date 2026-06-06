// lib/sync/reconcile.ts
import type { ReconcileInput, ReconcileResult } from './types';

/**
 * Decide la acción de sincronización comparando el estado local conocido
 * contra la fila remota actual. PURA: sin I/O, sin crypto, determinista.
 *
 * Convención de versiones (fijada por sync-service):
 *  - local.version = última versión remota que el cliente aceptó (push/pull OK). 0 = nunca sincronizó.
 *  - local.updatedAt = timestamp de la última MUTACIÓN local persistida. Si es mayor que el
 *    updatedAt remoto de la base aceptada, hay cambios locales pendientes de subir.
 */
export function reconcile({ local, remote }: ReconcileInput): ReconcileResult {
  if (remote === null) {
    return { action: 'push', reason: 'no remote row: initial upload' };
  }

  if (local.version === 0) {
    return { action: 'pull', reason: 'local never synced but remote exists: pull to adopt remote' };
  }

  if (remote.version === local.version) {
    if (Date.parse(local.updatedAt) > Date.parse(remote.updatedAt)) {
      return { action: 'push', reason: 'same version, local mutated after last sync: push local' };
    }
    return { action: 'noop', reason: 'same version, no local changes: up to date' };
  }

  if (remote.version > local.version) {
    const localHasPendingMutation = Date.parse(local.updatedAt) > Date.parse(remote.updatedAt);
    if (localHasPendingMutation) {
      return { action: 'conflict', reason: 'remote advanced AND local has unsynced changes: conflict' };
    }
    return { action: 'pull', reason: 'remote advanced, no local changes: pull remote' };
  }

  // local.version > remote.version — el servidor es la autoridad de versión; defensivo.
  return { action: 'push', reason: 'local version ahead of remote (defensive): push local' };
}
