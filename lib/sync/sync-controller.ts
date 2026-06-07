// lib/sync/sync-controller.ts
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import { decrypt, checkVerifier, meetsKdfFloor } from '@/lib/crypto/vault';
import { assertVaultData } from '@/lib/vault-data';
import { SyncRepository } from './sync-repository';
import { SyncService, type LocalSnapshot } from './sync-service';
import type { RemoteVault, VaultMeta } from './types';
import type { VaultData } from '@/lib/types';

/** El flag de feature: la UI/engine de sync solo opera con NEXT_PUBLIC_SYNC_ENABLED === 'true'. */
export function isSyncEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true';
}

async function getSession(): Promise<{ userId: string; client: import('@supabase/supabase-js').SupabaseClient } | null> {
  const { createClient } = await import('@/lib/supabase/client');
  const client = createClient();
  const { data } = await client.auth.getSession();
  const userId = data.session?.user?.id;
  if (!userId) return null;
  return { userId, client };
}

/** Lee el snapshot local (ciphertext + versión + timestamp) desde Dexie. */
async function readLocal(): Promise<LocalSnapshot> {
  const meta = await repository.getMeta();
  const blob = (await repository.getEncryptedData()) ?? '';
  const syncRef = await repository.getSyncState();
  return {
    meta: meta ? JSON.stringify(meta) : '',
    blob,
    version: syncRef?.version ?? 0,
    updatedAt: syncRef?.updatedAt ?? new Date(0).toISOString(),
  };
}

/**
 * Aplica el blob remoto: descifra con la CryptoKey en memoria y re-hidrata el vault store.
 * El descifrado ocurre SOLO aquí (cliente). SyncRepository jamás ve la clave.
 * Exportada para poder testear la defensa del verifier (meta-swap) con crypto real.
 */
export async function applyRemote(remote: RemoteVault): Promise<void> {
  const key = vaultStore.getState().key;
  if (!key) throw new Error('applyRemote: vault is locked, cannot decrypt remote blob');
  const meta = JSON.parse(remote.encryptedMeta) as VaultMeta;
  // Defensa meta/KDF swap: solo se acepta un meta cuyo verifier descifra con la
  // clave viva. Un meta envenenado (KDF degradado + verifier ajeno) en la fila
  // remota debilitaría el cifrado local en el próximo unlock — DB no es confiable.
  if (!(await checkVerifier(key, meta.verifier))) {
    throw new Error('applyRemote: remote meta verifier does not match current key — rejecting');
  }
  // KDF floor: en v1 el verifier prueba la VaultKey, no la fuerza de meta.kdf —
  // un kdf degradado en la fila remota quedaría persistido como política local
  // del próximo unlock por password (security review S9, H1).
  if (!meetsKdfFloor(meta.kdf)) {
    throw new Error('applyRemote: remote meta KDF params below the accepted floor — rejecting');
  }
  const data: VaultData = JSON.parse(await decrypt(key, remote.encryptedBlob));
  assertVaultData(data);
  // Memoria primero, Dexie después — mismo orden que vault-store (set → persist).
  vaultStore.setState({ data });
  await repository.createVault(meta, remote.encryptedBlob);
}

/**
 * Acepta una base de sync conservando el updatedAt local si es MAYOR que el del
 * servidor: una mutación local ocurrida mientras el push estaba en vuelo dejaría
 * de subir si su timestamp fuera pisado (reconcile la vería como ya sincronizada).
 * Conservarlo provoca, a lo sumo, un push extra inofensivo.
 */
export async function acceptSyncBase(ref: { version: number; updatedAt: string }): Promise<void> {
  const cur = await repository.getSyncState();
  const updatedAt =
    cur && Date.parse(cur.updatedAt) > Date.parse(ref.updatedAt) ? cur.updatedAt : ref.updatedAt;
  await repository.saveSyncState({ version: ref.version, updatedAt });
}

export async function createSyncService(): Promise<SyncService | null> {
  if (!isSyncEnabled()) return null;
  const session = await getSession();
  if (!session) return null;
  const repo = new SyncRepository(session.client, session.userId);
  return new SyncService(repo, readLocal, applyRemote, acceptSyncBase);
}
