// lib/sync/sync-service.ts
import { reconcile } from './reconcile';
import { isConflictError, type RemoteVault, type LocalVaultRef } from './types';
import type { SyncRepository } from './sync-repository';
import { syncStore } from '@/lib/store/sync-store';

/** Snapshot local que el servicio necesita: ciphertext + versión + timestamp. */
export interface LocalSnapshot {
  meta: string;     // encryptedMeta (JSON.stringify(VaultMeta))
  blob: string;     // encryptedBlob (AES-GCM ciphertext)
  version: number;  // versión remota aceptada (de la tabla `sync`); 0 si nunca sincronizó
  updatedAt: string; // timestamp de la última mutación local persistida
}

export type ReadLocal = () => Promise<LocalSnapshot>;
export type ApplyRemote = (remote: RemoteVault) => Promise<void>;
export type SaveSyncState = (ref: LocalVaultRef) => Promise<void>;

/** Debounce agresivo del push tras mutaciones locales (ver justificación en el plan). */
export const PUSH_DEBOUNCE_MS = 4000;

export class SyncService {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly repo: SyncRepository,
    private readonly readLocal: ReadLocal,
    private readonly applyRemote: ApplyRemote,
    private readonly saveSyncState: SaveSyncState,
  ) {}

  /** Ciclo completo de reconciliación. Idempotente; seguro de llamar en cualquier momento.
   *  No reentrante: si ya hay un ciclo en vuelo (visibilitychange + online simultáneos),
   *  la llamada extra es no-op — evita pushes dobles que fabrican falsos conflictos. */
  async reconcileNow(): Promise<void> {
    if (this.running) return;
    this.running = true;
    syncStore.getState().setStatus('syncing');
    try {
      const local = await this.readLocal();
      const remote = await this.repo.pullVault();
      const { action } = reconcile({
        local: { version: local.version, updatedAt: local.updatedAt },
        remote,
      });

      if (action === 'noop') {
        syncStore.getState().setStatus('idle');
        return;
      }
      if (action === 'push') {
        const saved = await this.repo.pushVault(local.meta, local.blob, local.version);
        await this.saveSyncState({ version: saved.version, updatedAt: saved.updatedAt });
        syncStore.getState().markSynced(new Date().toISOString());
        return;
      }
      if (action === 'pull') {
        // remote no puede ser null aquí (reconcile sólo devuelve 'pull' con remoto presente)
        await this.applyRemote(remote!);
        await this.saveSyncState({ version: remote!.version, updatedAt: remote!.updatedAt });
        syncStore.getState().markSynced(new Date().toISOString());
        return;
      }
      // conflict
      syncStore.getState().setConflict({
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote!.updatedAt,
        remote: remote!,
      });
    } catch (e) {
      if (isConflictError(e)) {
        // El push perdió la carrera: vuelve a pull para mostrar el remoto en el diálogo.
        const remote = await this.repo.pullVault().catch(() => null);
        const local = await this.readLocal();
        if (remote) {
          syncStore.getState().setConflict({
            localUpdatedAt: local.updatedAt,
            remoteUpdatedAt: remote.updatedAt,
            remote,
          });
          return;
        }
      }
      syncStore.getState().setStatus('error');
    } finally {
      this.running = false;
    }
  }

  /** Programa un push con debounce agresivo tras una mutación local. */
  schedulePush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.reconcileNow();
    }, PUSH_DEBOUNCE_MS);
  }

  /** Cancela el push pendiente sin ejecutarlo (lock / sign-out): un timer huérfano
   *  dispararía reconcile con el vault ya bloqueado y fabricaría un error espurio. */
  cancelPendingPush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Fuerza el flush inmediato del push pendiente (al lock / pagehide). */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.reconcileNow();
    }
  }

  /** Conflicto → conservar lo de ESTE dispositivo: push local con la versión remota como base. */
  async resolveConflictKeepLocal(remote: RemoteVault): Promise<void> {
    syncStore.getState().setStatus('syncing');
    try {
      const local = await this.readLocal();
      const saved = await this.repo.pushVault(local.meta, local.blob, remote.version);
      await this.saveSyncState({ version: saved.version, updatedAt: saved.updatedAt });
      syncStore.getState().markSynced(new Date().toISOString());
    } catch {
      syncStore.getState().setStatus('error');
    }
  }

  /** Conflicto → usar lo del OTRO dispositivo: aplicar remoto y aceptar su versión. */
  async resolveConflictUseRemote(remote: RemoteVault): Promise<void> {
    syncStore.getState().setStatus('syncing');
    try {
      await this.applyRemote(remote);
      await this.saveSyncState({ version: remote.version, updatedAt: remote.updatedAt });
      syncStore.getState().markSynced(new Date().toISOString());
    } catch {
      syncStore.getState().setStatus('error');
    }
  }
}
