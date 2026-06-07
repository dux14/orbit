import { repository } from '@/lib/db/repository';
import { deriveKey, checkVerifier, decrypt, meetsKdfFloor } from '@/lib/crypto/vault';
import { deriveKekFromPassword, unwrapVaultKey } from '@/lib/crypto/envelope';
import { assertVaultData } from '@/lib/vault-data';
import type { BackupFile, VaultData } from '@/lib/types';
import type { VaultSession } from '@/lib/services/vault-service';

const SCHEMA_VERSION = 1;

export async function exportBackup(): Promise<BackupFile> {
  const meta = await repository.getMeta();
  const data = await repository.getEncryptedData();
  if (!meta || data === undefined) throw new Error('No vault to export');
  // Deliberately meta+blob only: the bio row (wrapped VaultKey under KEK_bio)
  // is per-device and must never leave the device.
  return { format: 'orbit-backup', schemaVersion: SCHEMA_VERSION, meta, data };
}

export async function importBackup(file: BackupFile, password: string): Promise<VaultSession> {
  if (file.format !== 'orbit-backup') throw new Error('Invalid backup file');
  // KDF floor: a crafted backup must not install degraded Argon2id params as
  // the device's persisted KDF policy (security review S9, M1).
  if (!meetsKdfFloor(file.meta.kdf)) throw new Error('Invalid backup file');

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
  assertVaultData(data);
  // Restore meta+blob verbatim (v1 stays v1, v0 migrates on next unlock).
  await repository.createVault(file.meta, file.data);
  // The restored vault has a different VaultKey: any existing bio credential is
  // wrapped under the OLD key and would yield a permanently failing Face ID
  // button. Invalidate it; the user re-enrolls (code review S9, I1).
  await repository.deleteBio();
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
  // Revoke on a later tick: the download starts async; revoking in the same
  // task yields an empty file on some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function readBackupFile(f: File): Promise<BackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await f.text());
  } catch {
    throw new Error('Invalid backup file');
  }
  const file = parsed as BackupFile | null;
  if (!file || typeof file !== 'object' || file.format !== 'orbit-backup' || typeof file.data !== 'string' || !file.meta) {
    throw new Error('Invalid backup file');
  }
  return file;
}
