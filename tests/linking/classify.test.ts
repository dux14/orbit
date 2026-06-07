// tests/linking/classify.test.ts
import { describe, it, expect } from 'vitest';
import { classifySituation } from '@/lib/linking/classify';
import type { RemoteVault } from '@/lib/sync/types';
import type { VaultMeta } from '@/lib/types';

const meta = (salt: string): VaultMeta => ({
  schemaVersion: 1,
  kdf: { algo: 'argon2id', salt, memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 },
  verifier: 'VERIFIER',
});

const remoteWithSalt = (salt: string): RemoteVault => ({
  encryptedMeta: JSON.stringify(meta(salt)),
  encryptedBlob: 'BLOB',
  version: 3,
  updatedAt: '2026-06-06T10:00:00.000Z',
});

describe('classifySituation', () => {
  it('no local, no remote → onboarding', () => {
    expect(classifySituation({ localMeta: undefined, remote: null }).situation).toBe('no-remote-no-local');
  });

  it('remote, no local → remote-only (new device)', () => {
    expect(classifySituation({ localMeta: undefined, remote: remoteWithSalt('AAA') }).situation).toBe('remote-only');
  });

  it('local, no remote → local-only (initial push)', () => {
    expect(classifySituation({ localMeta: meta('AAA'), remote: null }).situation).toBe('local-only');
  });

  it('both with same KDF salt → both-same (same vault)', () => {
    expect(classifySituation({ localMeta: meta('AAA'), remote: remoteWithSalt('AAA') }).situation).toBe('both-same');
  });

  it('both with different KDF salt → both-different (distinct vaults)', () => {
    expect(classifySituation({ localMeta: meta('AAA'), remote: remoteWithSalt('BBB') }).situation).toBe('both-different');
  });

  it('carries through hasLocal and remote', () => {
    const c = classifySituation({ localMeta: meta('AAA'), remote: remoteWithSalt('AAA') });
    expect(c.hasLocal).toBe(true);
    expect(c.remote?.version).toBe(3);
  });
});
