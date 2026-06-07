import { fromBase64, toBase64 } from '@/lib/crypto/vault';

/** Inverse pair for credentialId round-trips — keep colocated so the padding
 *  and character-substitution logic can never diverge (ts review S9, L3). */

export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return fromBase64(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
}
