import { repository } from '@/lib/db/repository';
import { deriveKey, checkVerifier, decrypt } from '@/lib/crypto/vault';
import { deriveKekFromPassword, unwrapVaultKey } from '@/lib/crypto/envelope';
import type { BackupFile, VaultData } from '@/lib/types';
import type { VaultSession } from '@/lib/services/vault-service';

const SCHEMA_VERSION = 1;

export async function exportBackup(): Promise<BackupFile> {
  const meta = await repository.getMeta();
  const data = await repository.getEncryptedData();
  if (!meta || data === undefined) throw new Error('No vault to export');
  return { format: 'orbit-backup', schemaVersion: SCHEMA_VERSION, meta, data };
}

export async function importBackup(file: BackupFile, password: string): Promise<VaultSession> {
  if (file.format !== 'orbit-backup') throw new Error('Invalid backup file');

  let key: CryptoKey;
  if (file.meta.envelopeVersion && file.meta.wrappedKeys) {
    // v1 envelope: unwrap VaultKey with KEK_master, then verify with the VaultKey.
    const kek = await deriveKekFromPassword(password, file.meta.kdf);
    try {
      key = await unwrapVaultKey(file.meta.wrappedKeys.master, kek);
    } catch {
      throw new Error('Incorrect master password');
    }
    if (!(await checkVerifier(key, file.meta.verifier))) throw new Error('Incorrect master password');
  } else {
    // v0 legacy: KDF key both verifies and decrypts the blob.
    key = await deriveKey(password, file.meta.kdf);
    if (!(await checkVerifier(key, file.meta.verifier))) throw new Error('Incorrect master password');
  }

  const data: VaultData = JSON.parse(await decrypt(key, file.data));
  // Restore meta+blob verbatim (v1 stays v1, v0 migrates on next unlock).
  await repository.createVault(file.meta, file.data);
  return { key, data };
}

/** Browser helpers (untested in unit env). */
export function downloadBackup(file: BackupFile): void {
  const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orbit-backup-${new Date().toISOString().slice(0, 10)}.orbit`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readBackupFile(f: File): Promise<BackupFile> {
  return JSON.parse(await f.text());
}
