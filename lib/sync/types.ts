// lib/sync/types.ts
import type { VaultMeta } from '@/lib/types';

/** Estado observable de la sincronización para la UI. */
export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict' | 'disabled';

/** Fila remota tal como vive en public.vaults — ciphertext opaco + meta + versión. */
export interface RemoteVault {
  encryptedMeta: string;   // JSON.stringify(VaultMeta) — opaco para el servidor
  encryptedBlob: string;   // AES-256-GCM ciphertext de VaultData — opaco
  version: number;         // entero monotónico controlado por upsert_vault()
  updatedAt: string;       // ISO 8601 (timestamptz del servidor)
}

/** Lado local de la comparación (no incluye claves ni plaintext). */
export interface LocalVaultRef {
  version: number;         // versión local persistida en Dexie (0 si nunca se sincronizó)
  updatedAt: string;       // ISO 8601 de la última mutación local persistida
}

/** Entrada de la función pura de reconciliación. `remote` null = no hay fila remota. */
export interface ReconcileInput {
  local: LocalVaultRef;
  remote: RemoteVault | null;
}

/**
 * Resultado de reconcile():
 *  - 'noop'     versiones iguales, nada que hacer
 *  - 'push'     local por delante (o no hay remoto) → subir local
 *  - 'pull'     remoto por delante → bajar y aplicar remoto
 *  - 'conflict' ambos divergieron desde el ancestro común → pedir al usuario
 */
export type ReconcileAction = 'noop' | 'push' | 'pull' | 'conflict';

export interface ReconcileResult {
  action: ReconcileAction;
  reason: string;          // explicación legible para logs/tests
}

/** Snapshot que el sync-store expone a la UI. */
export interface SyncSnapshot {
  status: SyncStatus;
  lastSyncedAt: string | null;
  conflict: ConflictInfo | null;
}

/** Info mostrada en el diálogo de conflicto. */
export interface ConflictInfo {
  localUpdatedAt: string;  // ISO 8601 — "este dispositivo"
  remoteUpdatedAt: string; // ISO 8601 — "el otro dispositivo"
  remote: RemoteVault;     // se conserva para poder aplicar "usar remoto" sin re-pull
}

/** Error tipado para el conflicto de versión (errcode 40001 de upsert_vault). */
export class ConflictError extends Error {
  readonly code = 'version_conflict' as const;
  constructor(message = 'Vault version conflict') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Helper de narrowing usado por sync-service y sync-repository. */
export function isConflictError(e: unknown): e is ConflictError {
  return e instanceof ConflictError || (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'version_conflict');
}

/** Re-export para evitar import circular en consumidores. */
export type { VaultMeta };
