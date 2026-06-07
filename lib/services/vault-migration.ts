import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { deriveKey, decrypt, encrypt, createVerifier, checkVerifier } from '@/lib/crypto/vault';
import { generateVaultKey, deriveKekFromPassword, wrapVaultKey } from '@/lib/crypto/envelope';
import type { VaultMeta } from '@/lib/types';

const ENVELOPE_VERSION = 1;

/**
 * Migrate a legacy v0 vault (KDF key encrypts the blob directly) to envelope v1.
 * Validates the password against the v0 verifier first; throws on mismatch
 * WITHOUT mutating storage. On success, re-encrypts under a fresh VaultKey and
 * persists the new meta + blob atomically. Returns the new meta.
 */
export async function migrateLegacyVault(password: string, meta: VaultMeta): Promise<VaultMeta> {
  // 1. v0 key derives directly from password and both verifies + decrypts the blob.
  const legacyKey = await deriveKey(password, meta.kdf);
  if (!(await checkVerifier(legacyKey, meta.verifier))) {
    throw new Error('Incorrect master password');
  }
  const blob = await repository.getEncryptedData();
  const plaintext = blob ? await decrypt(legacyKey, blob) : JSON.stringify({ subscriptions: [], credentials: [], paymentMethods: [] });

  // 2. New envelope material.
  const vaultKey = await generateVaultKey();
  const kek = await deriveKekFromPassword(password, meta.kdf); // reuse same salt/kdf params
  const wrappedMaster = await wrapVaultKey(vaultKey, kek);
  const newVerifier = await createVerifier(vaultKey);
  const newBlob = await encrypt(vaultKey, plaintext);

  const newMeta: VaultMeta = {
    ...meta,
    verifier: newVerifier,
    envelopeVersion: ENVELOPE_VERSION,
    wrappedKeys: { master: wrappedMaster },
  };

  // 3. Atomic write — never leave meta and blob in mixed formats.
  await db.transaction('rw', db.meta, db.blob, async () => {
    await repository.saveMeta(newMeta);
    await repository.saveEncryptedData(newBlob);
  });

  return newMeta;
}
