import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { vaultService } from '@/lib/services/vault-service';
import { deriveKey, encrypt, createVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import type { VaultMeta, VaultData } from '@/lib/types';

beforeEach(async () => { await db.delete(); await db.open(); });

/** Recreate a pre-envelope (v0) vault exactly as the old vault-service did. */
async function seedLegacyVault(password: string, data: VaultData) {
  const kdf = { ...defaultKdf(), salt: generateSalt() };
  const key = await deriveKey(password, kdf);          // KDF key encrypts the blob directly
  const verifier = await createVerifier(key);
  const meta: VaultMeta = { schemaVersion: 1, kdf, verifier }; // NO envelopeVersion, NO wrappedKeys
  const blob = await encrypt(key, JSON.stringify(data));
  await repository.createVault(meta, blob);
}

describe('legacy v0 -> v1 migration', () => {
  it('migrates on first unlock and decrypts existing data', async () => {
    const data = { subscriptions: [], credentials: [], paymentMethods: [{ id: '1', label: 'M', brand: 'Visa', last4: '4242', color: '#fff' }] };
    await seedLegacyVault('master-pw', data);

    const meta0 = await repository.getMeta();
    expect(meta0?.envelopeVersion).toBeUndefined();

    const session = await vaultService.unlock('master-pw');
    expect(session.data.paymentMethods).toHaveLength(1);

    const meta1 = await repository.getMeta();
    expect(meta1?.envelopeVersion).toBe(1);
    expect(typeof meta1?.wrappedKeys?.master).toBe('string');
    // kdf salt is preserved (same password still works)
    expect(meta1?.kdf.salt).toBe(meta0?.kdf.salt);
  });

  it('migrated vault unlocks normally on subsequent unlocks (no re-migration)', async () => {
    await seedLegacyVault('pw', { subscriptions: [], credentials: [], paymentMethods: [] });
    await vaultService.unlock('pw');                 // migrates
    const again = await vaultService.unlock('pw');   // pure envelope path
    expect(again.data).toEqual({ subscriptions: [], credentials: [], paymentMethods: [] });
  });

  it('rejects wrong password on a legacy vault without migrating', async () => {
    await seedLegacyVault('right', { subscriptions: [], credentials: [], paymentMethods: [] });
    await expect(vaultService.unlock('wrong')).rejects.toThrow(/master password/i);
    const meta = await repository.getMeta();
    expect(meta?.envelopeVersion).toBeUndefined(); // unchanged
  });
});
