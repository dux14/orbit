/**
 * Fixed application-wide PRF salt. PRF mixes this with the authenticator's
 * internal per-credential secret; the salt is NOT a secret itself. Stored per
 * credential (BioCredential.prfSalt) so a future rotation stays decryptable.
 * 32 random bytes, base64. Generated once for Orbit — do not change.
 */
export const APP_PRF_SALT_B64 = 'r9g8k/CkzwEzlqLGwSMDiutbOXOyC54pP15SaKSt/io=';

/** Cheap capability gate for showing the enroll UI. Real PRF support is only
 *  known after credentials.create() — see enroll.ts (strict, no boolean gate). */
export async function isPlatformAuthenticatorMaybeAvailable(): Promise<boolean> {
  if (typeof PublicKeyCredential === 'undefined') return false;
  const fn = (PublicKeyCredential as unknown as {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  }).isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof fn !== 'function') return false;
  try {
    return await fn.call(PublicKeyCredential);
  } catch {
    return false;
  }
}
