import { describe, it, expect, beforeEach } from 'vitest';
import { repository as repo } from '@/lib/db/repository';
import { db } from '@/lib/db/database';
import type { VaultMeta, Settings } from '@/lib/types';

const meta: VaultMeta = {
  schemaVersion: 1,
  kdf: { algo: 'argon2id', salt: 'c2FsdHNhbHRzYWx0c2E=', memorySize: 19456, iterations: 2, parallelism: 1, hashLength: 32 },
  verifier: 'dmVyaWZpZXI=',
};
const settings: Settings = { primaryCurrency: 'USD', theme: 'system', locale: 'en', reminderLeadDays: 3, autoLockMinutes: 5 };

beforeEach(async () => { await db.delete(); await db.open(); });

describe('repository', () => {
  it('reports no vault before creation', async () => {
    expect(await repo.vaultExists()).toBe(false);
  });
  it('creates and reads back a vault', async () => {
    await repo.createVault(meta, 'ENC_BLOB');
    expect(await repo.vaultExists()).toBe(true);
    expect(await repo.getMeta()).toEqual(meta);
    expect(await repo.getEncryptedData()).toBe('ENC_BLOB');
  });
  it('updates the encrypted blob', async () => {
    await repo.createVault(meta, 'A');
    await repo.saveEncryptedData('B');
    expect(await repo.getEncryptedData()).toBe('B');
  });
  it('persists and reads settings', async () => {
    await repo.saveSettings(settings);
    expect(await repo.getSettings()).toEqual(settings);
  });
  it('wipes everything', async () => {
    await repo.createVault(meta, 'X');
    await repo.saveSettings(settings);
    await repo.wipeVault();
    expect(await repo.vaultExists()).toBe(false);
    expect(await repo.getSettings()).toBeUndefined();
  });
});
