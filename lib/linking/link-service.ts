// lib/linking/link-service.ts
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import { deriveKey, decrypt, checkVerifier } from '@/lib/crypto/vault';
import { classifySituation } from './classify';
import { LinkError, type LinkClassification } from './types';
import type { SyncRepository } from '@/lib/sync/sync-repository';
import type { RemoteVault, VaultMeta } from '@/lib/sync/types';
import type { VaultData } from '@/lib/types';

function isNetworkError(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? '';
  return /failed to fetch|network|offline|ECONN|fetch/i.test(m);
}

/**
 * Orquesta la vinculación de dispositivo. El descifrado del blob remoto ocurre
 * 100% en cliente (deriveKey/checkVerifier/decrypt de Phase 1). SyncRepository
 * solo transporta ciphertext; nunca recibe la password ni la CryptoKey.
 */
export class LinkService {
  constructor(private readonly repo: SyncRepository) {}

  /** Detecta la situación combinando meta local + fila remota. */
  async detect(): Promise<LinkClassification> {
    let remote: RemoteVault | null;
    try {
      remote = await this.repo.pullVault();
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', (e as Error).message);
    }
    const localMeta = await repository.getMeta();
    return classifySituation({ localMeta, remote });
  }

  /**
   * Dispositivo nuevo: baja meta+blob remotos, deriva la clave con el salt remoto,
   * valida con el verifier, descifra, persiste localmente y carga en el store.
   */
  async linkNewDevice(password: string): Promise<void> {
    let remote: RemoteVault | null;
    try {
      remote = await this.repo.pullVault();
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', (e as Error).message);
    }
    if (!remote) throw new LinkError('unknown', 'No remote vault to link');

    const meta = JSON.parse(remote.encryptedMeta) as VaultMeta;
    const key = await deriveKey(password, meta.kdf);
    if (!(await checkVerifier(key, meta.verifier))) {
      throw new LinkError('wrong-password');
    }

    const data = JSON.parse(await decrypt(key, remote.encryptedBlob)) as VaultData;

    // Persistir meta + blob remotos en Dexie y fijar el estado de sync a la versión remota.
    await repository.createVault(meta, remote.encryptedBlob);
    await repository.saveSyncState({ version: remote.version, updatedAt: remote.updatedAt });

    // Cargar en memoria: vault desbloqueado con la clave derivada.
    vaultStore.setState({ key, data, locked: false });
  }

  /**
   * Sube el vault local a Supabase usando `expectedVersion` como base esperada.
   * - Por defecto (0): push inicial sin fila remota previa (caso local-only).
   * - Valor > 0: path destructivo "keep local" que sobrescribe la fila remota
   *   vigente; upsert_vault solo avanza si p_expected_version coincide con la
   *   versión actual de la fila, así que hay que pasar la versión remota detectada.
   */
  async linkLocalVault(expectedVersion = 0): Promise<void> {
    const meta = await repository.getMeta();
    const blob = await repository.getEncryptedData();
    if (!meta || !blob) throw new LinkError('unknown', 'No local vault to push');
    try {
      const saved = await this.repo.pushVault(JSON.stringify(meta), blob, expectedVersion);
      await repository.saveSyncState({ version: saved.version, updatedAt: saved.updatedAt });
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', (e as Error).message);
    }
  }
}
