import { repository } from '@/lib/db/repository';
import { wrapVaultKey } from '@/lib/crypto/envelope';
import { deriveKekFromPrf } from './kek-bio';
import { APP_PRF_SALT_B64, type PrfClientOutputs } from './support';
import { toBase64Url } from './base64url';
import { fromBase64 } from '@/lib/crypto/vault';
import type { BioCredential } from '@/lib/types';

export class PrfUnsupportedError extends Error {
  constructor() { super('Authenticator did not return a PRF result'); this.name = 'PrfUnsupportedError'; }
}

/**
 * Enroll a platform passkey and wrap a second copy of VaultKey under KEK_bio.
 * Requires an UNLOCKED vault (the live VaultKey). Throws PrfUnsupportedError if
 * the browser/authenticator does not deliver a PRF result at creation time —
 * in that case NOTHING is persisted (no biometric unlock without PRF).
 */
export async function enrollBiometric(vaultKey: CryptoKey): Promise<BioCredential> {
  const prfSalt = new Uint8Array(fromBase64(APP_PRF_SALT_B64));
  const userId = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: 'Orbit', id: location.hostname },
      user: { id: userId, name: 'orbit-vault', displayName: 'Orbit Vault' },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      extensions: { prf: { eval: { first: prfSalt } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new PrfUnsupportedError();

  const ext = cred.getClientExtensionResults() as PrfClientOutputs;
  const prfFirst = ext.prf?.results?.first;
  if (!prfFirst) {
    // Some platforms only report prf.enabled at create() and require a follow-up
    // get() to obtain results. We choose the strict path: if no PRF output here,
    // do not enroll. UI will instruct the user that biometrics are unavailable.
    throw new PrfUnsupportedError();
  }

  const kekBio = await deriveKekFromPrf(prfFirst);
  const wrappedVaultKey = await wrapVaultKey(vaultKey, kekBio);

  const bio: BioCredential = {
    credentialId: toBase64Url(new Uint8Array(cred.rawId)),
    prfSalt: APP_PRF_SALT_B64,
    wrappedVaultKey,
    createdAt: new Date().toISOString(),
  };
  await repository.saveBio(bio);
  return bio;
}

export async function revokeBiometric(): Promise<void> {
  await repository.deleteBio();
}

export async function isBiometricEnrolled(): Promise<boolean> {
  return (await repository.getBio()) !== undefined;
}
