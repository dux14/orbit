import { repository } from '@/lib/db/repository';
import { unwrapVaultKey } from '@/lib/crypto/envelope';
import { deriveKekFromPrf } from './kek-bio';
import { fromBase64Url } from './base64url';
import { decrypt, checkVerifier, fromBase64 } from '@/lib/crypto/vault';
import { assertVaultData } from '@/lib/vault-data';
import type { PrfClientOutputs } from './support';
import type { VaultData } from '@/lib/types';
import type { VaultSession } from '@/lib/services/vault-service';

const emptyData = (): VaultData => ({ subscriptions: [], credentials: [], paymentMethods: [] });

export class BiometricUnavailableError extends Error {
  constructor(msg = 'Biometric unlock unavailable') { super(msg); this.name = 'BiometricUnavailableError'; }
}

/** Unlock the vault via a platform passkey + PRF. Throws if not enrolled or PRF missing. */
export async function unlockBiometric(): Promise<VaultSession> {
  const bio = await repository.getBio();
  if (!bio) throw new BiometricUnavailableError('Not enrolled');

  const meta = await repository.getMeta();
  if (!meta || meta.envelopeVersion === undefined) {
    throw new BiometricUnavailableError('Vault not in envelope format');
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: location.hostname,
      allowCredentials: [{ type: 'public-key', id: new Uint8Array(fromBase64Url(bio.credentialId)) }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: new Uint8Array(fromBase64(bio.prfSalt)) } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new BiometricUnavailableError('No assertion');
  const ext = assertion.getClientExtensionResults() as PrfClientOutputs;
  const prfFirst = ext.prf?.results?.first;
  if (!prfFirst) throw new BiometricUnavailableError('No PRF result');

  const kekBio = await deriveKekFromPrf(prfFirst);
  let vaultKey: CryptoKey;
  try {
    vaultKey = await unwrapVaultKey(bio.wrappedVaultKey, kekBio);
  } catch {
    throw new BiometricUnavailableError('Could not unwrap VaultKey');
  }
  if (!(await checkVerifier(vaultKey, meta.verifier))) throw new BiometricUnavailableError('Verifier mismatch');

  const blob = await repository.getEncryptedData();
  const data: VaultData = blob ? JSON.parse(await decrypt(vaultKey, blob)) : emptyData();
  assertVaultData(data);
  return { key: vaultKey, data };
}
