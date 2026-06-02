import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt, defaultKdf, generateSalt, toBase64, fromBase64 } from '@/lib/crypto/vault';

const kdf = () => ({ ...defaultKdf(), salt: generateSalt() });

describe('crypto hardening', () => {
  it('base64 round-trips every byte value 0..255', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(fromBase64(toBase64(bytes)))).toEqual(Array.from(bytes));
  });
  it('round-trips non-ASCII / UTF-8 / emoji plaintext', async () => {
    const key = await deriveKey('pw', kdf());
    const text = 'cuenta: señor@café.com — clave: 🔐🪐 日本語';
    expect(await decrypt(key, await encrypt(key, text))).toBe(text);
  });
  it('rejects a tampered ciphertext (GCM auth)', async () => {
    const key = await deriveKey('pw', kdf());
    const ct = await encrypt(key, 'secret');
    const bytes = fromBase64(ct);
    bytes[bytes.length - 1] ^= 0x01; // flip a bit in the auth tag region
    await expect(decrypt(key, toBase64(bytes))).rejects.toThrow();
  });
});
