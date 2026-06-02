import { repository } from '@/lib/db/repository';
import { deriveKey, encrypt, decrypt, createVerifier, checkVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import type { VaultData, VaultMeta } from '@/lib/types';

const SCHEMA_VERSION = 1;
const emptyData = (): VaultData => ({ subscriptions: [], credentials: [], paymentMethods: [] });

export interface VaultSession { key: CryptoKey; data: VaultData; }

export const vaultService = {
  exists: () => repository.vaultExists(),

  async create(password: string): Promise<VaultSession> {
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey(password, kdf);
    const verifier = await createVerifier(key);
    const meta: VaultMeta = { schemaVersion: SCHEMA_VERSION, kdf, verifier };
    const data = emptyData();
    const blob = await encrypt(key, JSON.stringify(data));
    await repository.createVault(meta, blob);
    return { key, data };
  },

  async unlock(password: string): Promise<VaultSession> {
    const meta = await repository.getMeta();
    if (!meta) throw new Error('No vault exists');
    const key = await deriveKey(password, meta.kdf);
    if (!(await checkVerifier(key, meta.verifier))) throw new Error('Incorrect master password');
    const blob = await repository.getEncryptedData();
    const data: VaultData = blob ? JSON.parse(await decrypt(key, blob)) : emptyData();
    return { key, data };
  },

  async persist(key: CryptoKey, data: VaultData): Promise<void> {
    await repository.saveEncryptedData(await encrypt(key, JSON.stringify(data)));
  },
};
