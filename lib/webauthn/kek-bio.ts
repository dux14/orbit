const HKDF_INFO = new TextEncoder().encode('orbit-bio-kek-v1');
const HKDF_SALT = new TextEncoder().encode('orbit-bio-hkdf-salt-v1');

/**
 * Derive KEK_bio from a WebAuthn PRF output via HKDF-SHA256, imported as an
 * AES-KW key for wrapping/unwrapping the VaultKey. The PRF output is the IKM
 * (its secret lives in the authenticator hardware); salt/info are fixed app
 * constants — domain separation, not secrets.
 */
export async function deriveKekFromPrf(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey']);
  // Fresh copies: TypedArray consts are mutable views; a stray write elsewhere
  // must not silently corrupt the domain-separation constants.
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT.slice(), info: HKDF_INFO.slice() },
    ikm,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}
