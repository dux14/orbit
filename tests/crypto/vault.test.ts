import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt, createVerifier, checkVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';

const kdf = () => ({ ...defaultKdf(), salt: generateSalt() });

describe('vault crypto', () => {
  it('encrypts then decrypts to the same plaintext', async () => {
    const key = await deriveKey('correct horse', kdf());
    const ct = await encrypt(key, 'hello orbit');
    expect(ct).not.toContain('hello');
    expect(await decrypt(key, ct)).toBe('hello orbit');
  });

  it('produces a different ciphertext each call (unique IV)', async () => {
    const key = await deriveKey('pw', kdf());
    expect(await encrypt(key, 'x')).not.toBe(await encrypt(key, 'x'));
  });

  it('derivation is deterministic for same password + params', async () => {
    const params = kdf();
    const a = await deriveKey('pw', params);
    const b = await deriveKey('pw', params);
    const ct = await encrypt(a, 'data');
    expect(await decrypt(b, ct)).toBe('data');
  });

  it('verifier validates the correct master password', async () => {
    const params = kdf();
    const key = await deriveKey('master', params);
    const verifier = await createVerifier(key);
    expect(await checkVerifier(key, verifier)).toBe(true);
  });

  it('verifier rejects a wrong master password', async () => {
    const params = kdf();
    const verifier = await createVerifier(await deriveKey('master', params));
    const wrong = await deriveKey('not-master', params);
    expect(await checkVerifier(wrong, verifier)).toBe(false);
  });

  it('decrypt with wrong key throws', async () => {
    const params = kdf();
    const ct = await encrypt(await deriveKey('a', params), 'secret');
    await expect(decrypt(await deriveKey('b', params), ct)).rejects.toThrow();
  });
});
