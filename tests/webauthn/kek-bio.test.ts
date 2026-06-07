import { describe, it, expect } from 'vitest';
import { deriveKekFromPrf } from '@/lib/webauthn/kek-bio';
import { generateVaultKey, wrapVaultKey, unwrapVaultKey } from '@/lib/crypto/envelope';
import { encrypt, decrypt } from '@/lib/crypto/vault';

describe('KEK_bio from PRF output', () => {
  it('derives a stable AES-KW key from the same PRF output', async () => {
    const prf = crypto.getRandomValues(new Uint8Array(32)).buffer;
    const vk = await generateVaultKey();
    const kek1 = await deriveKekFromPrf(prf);
    const wrapped = await wrapVaultKey(vk, kek1);
    const kek2 = await deriveKekFromPrf(prf);          // re-derive
    const vk2 = await unwrapVaultKey(wrapped, kek2);
    const ct = await encrypt(vk, 'bio-secret');
    expect(await decrypt(vk2, ct)).toBe('bio-secret');
  });

  it('different PRF outputs produce non-interoperable KEKs', async () => {
    const vk = await generateVaultKey();
    const wrapped = await wrapVaultKey(vk, await deriveKekFromPrf(crypto.getRandomValues(new Uint8Array(32)).buffer));
    await expect(
      unwrapVaultKey(wrapped, await deriveKekFromPrf(crypto.getRandomValues(new Uint8Array(32)).buffer)),
    ).rejects.toThrow();
  });
});
