import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { db } from '@/lib/db/database';
import { repository } from '@/lib/db/repository';
import { unlockBiometric, BiometricUnavailableError } from '@/lib/webauthn/unlock';
import { revokeBiometric, isBiometricEnrolled } from '@/lib/webauthn/enroll';
import { deriveKey, encrypt, createVerifier, defaultKdf, generateSalt } from '@/lib/crypto/vault';
import type { VaultMeta } from '@/lib/types';

const BIO = { credentialId: 'abc', prfSalt: 'c2FsdA==', wrappedVaultKey: 'd3JhcA==', createdAt: '2026-06-06T00:00:00Z' };

beforeEach(async () => { await db.delete(); await db.open(); });

// Early-exit guards: none of these paths reach navigator.credentials.
describe('unlockBiometric guards', () => {
  it('throws BiometricUnavailableError when not enrolled', async () => {
    await expect(unlockBiometric()).rejects.toBeInstanceOf(BiometricUnavailableError);
  });

  it('throws BiometricUnavailableError on a legacy v0 vault (no envelope)', async () => {
    const kdf = { ...defaultKdf(), salt: generateSalt() };
    const key = await deriveKey('pw', kdf);
    const meta: VaultMeta = { schemaVersion: 1, kdf, verifier: await createVerifier(key) }; // v0
    await repository.createVault(meta, await encrypt(key, '{}'));
    await repository.saveBio(BIO);
    await expect(unlockBiometric()).rejects.toBeInstanceOf(BiometricUnavailableError);
  });
});

describe('revokeBiometric', () => {
  it('clears enrollment so isBiometricEnrolled() reports false', async () => {
    await repository.saveBio(BIO);
    expect(await isBiometricEnrolled()).toBe(true);
    await revokeBiometric();
    expect(await isBiometricEnrolled()).toBe(false);
  });
});
