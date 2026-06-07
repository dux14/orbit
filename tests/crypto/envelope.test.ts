import { describe, it, expect } from 'vitest';
import { defaultKdf, generateSalt, encrypt, decrypt } from '@/lib/crypto/vault';
import {
  generateVaultKey,
  deriveKekFromPassword,
  wrapVaultKey,
  unwrapVaultKey,
} from '@/lib/crypto/envelope';

const kdf = () => ({ ...defaultKdf(), salt: generateSalt() });

describe('envelope primitives', () => {
  it('generates a usable 256-bit AES-GCM VaultKey', async () => {
    const vk = await generateVaultKey();
    const ct = await encrypt(vk, 'payload');
    expect(await decrypt(vk, ct)).toBe('payload');
  });

  it('wraps and unwraps VaultKey with KEK_master (round-trip)', async () => {
    const params = kdf();
    const kek = await deriveKekFromPassword('master-pw', params);
    const vk = await generateVaultKey();
    const wrapped = await wrapVaultKey(vk, kek);
    expect(typeof wrapped).toBe('string');
    const vk2 = await unwrapVaultKey(wrapped, kek);
    // Same key material => can decrypt what the original encrypted
    const ct = await encrypt(vk, 'secret');
    expect(await decrypt(vk2, ct)).toBe('secret');
  });

  it('unwrap with the wrong KEK rejects (AES-KW integrity)', async () => {
    const params = kdf();
    const vk = await generateVaultKey();
    const wrapped = await wrapVaultKey(vk, await deriveKekFromPassword('right', params));
    await expect(
      unwrapVaultKey(wrapped, await deriveKekFromPassword('wrong', params)),
    ).rejects.toThrow();
  });

});
