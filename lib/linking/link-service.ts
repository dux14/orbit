// lib/linking/link-service.ts
import { repository } from '@/lib/db/repository';
import { vaultStore } from '@/lib/store/vault-store';
import { deriveKey, decrypt, checkVerifier, meetsKdfFloor } from '@/lib/crypto/vault';
import { deriveKekFromPassword, unwrapVaultKey } from '@/lib/crypto/envelope';
import { acceptSyncBase } from '@/lib/sync/sync-controller';
import { classifySituation, parseRemoteMeta } from './classify';
import { LinkError, type LinkClassification } from './types';
import type { SyncRepository } from '@/lib/sync/sync-repository';
import type { RemoteVault } from '@/lib/sync/types';
import type { VaultData } from '@/lib/types';

function isNetworkError(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? '';
  return /failed to fetch|network|offline|ECONN/i.test(m);
}

function errorDetail(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', errorDetail(e));
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
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', errorDetail(e));
    }
    if (!remote) throw new LinkError('unknown', 'No remote vault to link');

    const meta = parseRemoteMeta(remote.encryptedMeta);
    // KDF floor: la meta remota es entrada no confiable (la DB puede estar
    // comprometida). Sin este piso, una meta con Argon2id degradado quedaría
    // persistida como la meta local del dispositivo — el verifier prueba
    // posesión de la password, no la fuerza de los parámetros.
    if (!meetsKdfFloor(meta.kdf)) {
      throw new LinkError('unknown', 'Remote vault KDF params below the accepted floor');
    }
    // Envelope v1: la VaultKey viaja envuelta en wrappedKeys.master; el verifier
    // está cifrado bajo la VaultKey, no bajo la clave derivada del password.
    // v0 legado: la clave KDF verifica y descifra el blob directamente.
    let key: CryptoKey;
    if (meta.envelopeVersion && meta.wrappedKeys) {
      const kek = await deriveKekFromPassword(password, meta.kdf);
      try {
        key = await unwrapVaultKey(meta.wrappedKeys.master, kek);
      } catch {
        // Rechazo de integridad AES-KW = password incorrecto
        throw new LinkError('wrong-password');
      }
    } else {
      key = await deriveKey(password, meta.kdf);
    }
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
      // acceptSyncBase (S6) y no saveSyncState directo: preserva un updatedAt
      // local mayor si hubo una mutación con el push en vuelo — si se pisara,
      // reconcile la daría por sincronizada y ese edit no subiría nunca.
      await acceptSyncBase({ version: saved.version, updatedAt: saved.updatedAt });
    } catch (e) {
      throw new LinkError(isNetworkError(e) ? 'offline' : 'unknown', errorDetail(e));
    }
  }
}
