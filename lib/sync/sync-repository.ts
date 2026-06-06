// lib/sync/sync-repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { ConflictError, type RemoteVault } from './types';

/** Forma de la fila tal como la devuelve Postgres (snake_case). */
interface VaultRow {
  encrypted_meta: string;
  encrypted_blob: string;
  version: number;
  updated_at: string;
}

function rowToRemote(row: VaultRow): RemoteVault {
  return {
    encryptedMeta: row.encrypted_meta,
    encryptedBlob: row.encrypted_blob,
    version: row.version,
    updatedAt: row.updated_at,
  };
}

/**
 * I/O con Supabase para el vault cifrado. Transporta SOLO ciphertext opaco
 * (encryptedMeta / encryptedBlob) y la versión. Nunca descifra ni ve CryptoKey.
 */
export class SyncRepository {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string,
  ) {}

  /** Devuelve la fila remota del usuario o null si aún no existe. */
  async pullVault(): Promise<RemoteVault | null> {
    const { data, error } = await this.client
      .from('vaults')
      .select('encrypted_meta, encrypted_blob, version, updated_at')
      .eq('user_id', this.userId)
      .maybeSingle();

    if (error) throw new Error(`pullVault failed: ${error.message}`);
    if (!data) return null;
    return rowToRemote(data as VaultRow);
  }

  /**
   * Sube el blob+meta cifrados vía la RPC upsert_vault con concurrencia optimista.
   * `expectedVersion` es la versión remota que el cliente cree vigente (0 = inserción inicial).
   * Mapea el errcode 40001 (o el mensaje 'version_conflict') a ConflictError tipado.
   */
  async pushVault(encryptedMeta: string, encryptedBlob: string, expectedVersion: number): Promise<RemoteVault> {
    const { data, error } = await this.client.rpc('upsert_vault', {
      p_meta: encryptedMeta,
      p_blob: encryptedBlob,
      p_expected_version: expectedVersion,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? '';
      if (code === '40001' || message.includes('version_conflict')) {
        throw new ConflictError();
      }
      throw new Error(`pushVault failed: ${message}`);
    }
    return rowToRemote(data as VaultRow);
  }
}
