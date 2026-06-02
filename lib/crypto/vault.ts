export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generateSalt(): string {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  return toBase64(salt);
}

import { argon2id } from 'hash-wasm';
import type { KdfParams } from '@/lib/types';

const VERIFIER_CONSTANT = 'orbit-vault-verifier-v1';

export function defaultKdf(): KdfParams {
  return { algo: 'argon2id', salt: '', memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 };
}

export async function deriveKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
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
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  const out = new Uint8Array(iv.length + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), iv.length);
  return toBase64(out);
}

export async function decrypt(key: CryptoKey, payload: string): Promise<string> {
  const bytes = fromBase64(payload);
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

export async function createVerifier(key: CryptoKey): Promise<string> {
  return encrypt(key, VERIFIER_CONSTANT);
}

export async function checkVerifier(key: CryptoKey, verifier: string): Promise<boolean> {
  try {
    return (await decrypt(key, verifier)) === VERIFIER_CONSTANT;
  } catch {
    return false;
  }
}
