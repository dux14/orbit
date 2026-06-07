import { argon2id } from 'hash-wasm';
import { fromBase64, toBase64 } from './vault';
import type { KdfParams } from '@/lib/types';

/** Random AES-256-GCM data key (extractable=true so it can be wrapped/exported). */
export async function generateVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** KEK from password via Argon2id, imported as an AES-KW key for wrap/unwrap only. */
export async function deriveKekFromPassword(password: string, kdf: KdfParams): Promise<CryptoKey> {
  const rawResult = await argon2id({
    password,
    salt: fromBase64(kdf.salt),
    parallelism: kdf.parallelism,
    iterations: kdf.iterations,
    memorySize: kdf.memorySize,
    hashLength: kdf.hashLength,
    outputType: 'binary',
  });
  // Copy into a plain ArrayBuffer to satisfy WebCrypto's BufferSource type constraint
  const raw = new Uint8Array(rawResult as Uint8Array);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-KW' }, false, ['wrapKey', 'unwrapKey']);
}

/** Wrap VaultKey with a KEK using AES-KW (RFC 3394 — no IV, integrity built in). Returns base64. */
export async function wrapVaultKey(vaultKey: CryptoKey, kek: CryptoKey): Promise<string> {
  const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, kek, { name: 'AES-KW' });
  return toBase64(new Uint8Array(wrapped));
}

/** Unwrap a base64 AES-KW blob back into a usable AES-GCM VaultKey. Throws on bad KEK. */
export async function unwrapVaultKey(wrapped: string, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    fromBase64(wrapped),
    kek,
    { name: 'AES-KW' },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

export async function exportVaultKeyRaw(vaultKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey('raw', vaultKey));
}

export async function importVaultKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
