import { repository } from '@/lib/db/repository';
import { encrypt, decrypt, createVerifier, checkVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import { generateVaultKey, deriveKekFromPassword, wrapVaultKey, unwrapVaultKey } from '@/lib/crypto/envelope';
import { migrateLegacyVault } from './vault-migration';
import type { VaultData, VaultMeta } from '@/lib/types';

const SCHEMA_VERSION = 1;
const ENVELOPE_VERSION = 1;
const emptyData = (): VaultData => ({ subscriptions: [], credentials: [], paymentMethods: [] });

export interface VaultSession { key: CryptoKey; data: VaultData; }

export const vaultService = {
  exists: () => repository.vaultExists(),

  async create(password: string): Promise<VaultSession> {
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const kek = await deriveKekFromPassword(password, kdf);
    const vaultKey = await generateVaultKey();
    const wrappedMaster = await wrapVaultKey(vaultKey, kek);
    const verifier = await createVerifier(vaultKey);
    const meta: VaultMeta = {
      schemaVersion: SCHEMA_VERSION,
      kdf,
      verifier,
      envelopeVersion: ENVELOPE_VERSION,
      wrappedKeys: { master: wrappedMaster },
    };
    const data = emptyData();
    const blob = await encrypt(vaultKey, JSON.stringify(data));
    await repository.createVault(meta, blob);
    return { key: vaultKey, data };
  },

  async unlock(password: string): Promise<VaultSession> {
    let meta = await repository.getMeta();
    if (!meta) throw new Error('No vault exists');

    // Transparent backward-compatible migration of v0 vaults on first unlock.
    if (meta.envelopeVersion === undefined || meta.wrappedKeys === undefined) {
      meta = await migrateLegacyVault(password, meta);
    }

    const kek = await deriveKekFromPassword(password, meta.kdf);
    let vaultKey: CryptoKey;
    try {
      vaultKey = await unwrapVaultKey(meta.wrappedKeys!.master, kek);
    } catch {
      // AES-KW integrity rejection => wrong password
      throw new Error('Incorrect master password');
    }
    if (!(await checkVerifier(vaultKey, meta.verifier))) throw new Error('Incorrect master password');
    const blob = await repository.getEncryptedData();
    const data: VaultData = blob ? JSON.parse(await decrypt(vaultKey, blob)) : emptyData();
    return { key: vaultKey, data };
  },

  async persist(key: CryptoKey, data: VaultData): Promise<void> {
    await repository.saveEncryptedData(await encrypt(key, JSON.stringify(data)));
  },
};
